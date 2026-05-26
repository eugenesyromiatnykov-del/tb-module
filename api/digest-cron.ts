import { getSupabaseAdmin } from './_lib/supabase-server.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};
type Res = {
  status: (code: number) => Res;
  json: (data: unknown) => void;
};

export const config = { runtime: 'nodejs' };

type DashboardRow = {
  id: string;
  surname: string;
  first_name: string;
  patronymic: string | null;
  birth_date: string;
  location_id: string | null;
  tb_status: string;
  last_fluoro_date: string | null;
  next_planned_date: string | null;
  medics_id: string | null;
};

const LOCATION_LABELS: Record<string, string> = {
  bilohirska: 'Білогірська амбулаторія',
  zaluzhe: 'Залужжя',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}

function formatDateUk(iso: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export default async function handler(req: Req, res: Res) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when
  // the project has CRON_SECRET configured. Manual triggers need the same.
  const auth = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const ok = (Array.isArray(auth) ? auth[0] : auth) === `Bearer ${expected}`;
    if (!ok) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const supabase = getSupabaseAdmin();
  const today = todayIso();

  // ── Pull overdue patients (top 50; we'll show 10 in the email) ───────────
  const { data: overdue, error: overdueErr } = await supabase
    .from('patient_dashboard')
    .select('id, surname, first_name, patronymic, birth_date, location_id, tb_status, last_fluoro_date, next_planned_date, medics_id')
    .eq('archived', false)
    .lt('next_planned_date', today)
    .not('next_planned_date', 'is', null)
    .order('next_planned_date', { ascending: true })
    .limit(50);
  if (overdueErr) {
    res.status(500).json({ error: `overdue: ${overdueErr.message}` });
    return;
  }

  // Counts for the summary line.
  const counts: Record<string, number> = {};
  for (const filter of ['overdue', 'this_week', 'next_30', 'detected', 'contacts_no_fluoro'] as const) {
    let q = supabase.from('patient_dashboard').select('id', { count: 'exact', head: true }).eq('archived', false);
    if (filter === 'overdue') q = q.lt('next_planned_date', today).not('next_planned_date', 'is', null);
    if (filter === 'this_week') {
      const w = new Date();
      w.setDate(w.getDate() + 7);
      q = q.gte('next_planned_date', today).lte('next_planned_date', w.toISOString().slice(0, 10));
    }
    if (filter === 'next_30') {
      const a = new Date();
      a.setDate(a.getDate() + 7);
      const b = new Date();
      b.setDate(b.getDate() + 30);
      q = q.gt('next_planned_date', a.toISOString().slice(0, 10)).lte('next_planned_date', b.toISOString().slice(0, 10));
    }
    if (filter === 'detected') q = q.eq('tb_status', 'detected');
    if (filter === 'contacts_no_fluoro') q = q.contains('social_risk_groups', ['close_contact']).is('last_fluoro_date', null);
    const { count, error } = await q;
    if (error) {
      res.status(500).json({ error: `count ${filter}: ${error.message}` });
      return;
    }
    counts[filter] = count ?? 0;
  }

  // ── Build the email ──────────────────────────────────────────────────────
  const rows = (overdue ?? []) as DashboardRow[];
  const topRows = rows.slice(0, 10);

  const appUrl = process.env.APP_URL ?? 'https://tb-module.vercel.app';
  const subject = `Модуль ТБ: тижневий звіт (${formatDateUk(today)})`;

  const html = renderHtml({ counts, topRows, appUrl });
  const text = renderText({ counts, topRows, appUrl });

  // ── Recipients + send ────────────────────────────────────────────────────
  const recipientsRaw = process.env.DIGEST_RECIPIENTS ?? '';
  const recipients = recipientsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) {
    res.status(500).json({ error: 'DIGEST_RECIPIENTS is not set' });
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'RESEND_API_KEY is not set' });
    return;
  }
  const from = process.env.DIGEST_FROM ?? 'Модуль ТБ <onboarding@resend.dev>';

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from, to: recipients, subject, html, text }),
  });
  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    res.status(500).json({ error: `Resend ${sendRes.status}`, detail: sendBody });
    return;
  }

  res.status(200).json({ ok: true, recipients, counts, topCount: topRows.length, resend: sendBody });
}

// ── Templates ────────────────────────────────────────────────────────────────

function renderHtml(args: { counts: Record<string, number>; topRows: DashboardRow[]; appUrl: string }): string {
  const { counts, topRows, appUrl } = args;
  const overdueRowsHtml = topRows
    .map((r) => {
      const fullName = [r.surname, r.first_name, r.patronymic].filter(Boolean).join(' ');
      const overdueDays = r.next_planned_date ? daysAgo(r.next_planned_date) : 0;
      const loc = r.location_id ? LOCATION_LABELS[r.location_id] ?? r.location_id : '—';
      return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:14px;">
            <a href="${appUrl}/patients/${r.id}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(fullName)}</a><br>
            <span style="color:#64748b;font-size:12px;">${formatDateUk(r.birth_date)} · ${escapeHtml(loc)}</span>
          </td>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#dc2626;text-align:right;white-space:nowrap;">
            ${formatDateUk(r.next_planned_date)}<br>
            <span style="font-size:12px;">просрочено ${overdueDays} дн.</span>
          </td>
        </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="uk"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
        <tr><td style="padding:24px;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:18px;font-weight:600;color:#0f172a;">Модуль ТБ — тижневий звіт</div>
          <div style="font-size:13px;color:#64748b;margin-top:4px;">${formatDateUk(todayIso())}</div>
        </td></tr>
        <tr><td style="padding:20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${stat('Просрочено', counts.overdue, '#dc2626')}
              ${stat('На цьому тижні', counts.this_week, '#ea580c')}
              ${stat('Найближчі 30 днів', counts.next_30, '#0891b2')}
            </tr>
            <tr>
              ${stat('Виявлені', counts.detected, '#a16207')}
              ${stat('Контактні без флюоро', counts.contacts_no_fluoro, '#7c3aed')}
              <td width="33%"></td>
            </tr>
          </table>
        </td></tr>
        ${
          topRows.length > 0
            ? `<tr><td style="padding:8px 24px 24px;">
                <div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:8px;">
                  ТОП-${topRows.length} прострочених
                </div>
                <table width="100%" cellpadding="0" cellspacing="0">${overdueRowsHtml}</table>
              </td></tr>`
            : `<tr><td style="padding:24px;text-align:center;color:#16a34a;font-size:14px;">
                Немає прострочених — все під контролем.
              </td></tr>`
        }
        <tr><td style="padding:16px 24px 24px;border-top:1px solid #e2e8f0;text-align:center;">
          <a href="${appUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">
            Відкрити модуль
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function stat(label: string, value: number, color: string): string {
  return `
    <td width="33%" style="padding:6px;">
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">${label}</div>
        <div style="font-size:28px;font-weight:700;color:${color};margin-top:4px;">${value ?? 0}</div>
      </div>
    </td>`;
}

function renderText(args: { counts: Record<string, number>; topRows: DashboardRow[]; appUrl: string }): string {
  const { counts, topRows, appUrl } = args;
  const lines = [
    `Модуль ТБ — тижневий звіт (${formatDateUk(todayIso())})`,
    '',
    `Просрочено:           ${counts.overdue}`,
    `На цьому тижні:       ${counts.this_week}`,
    `Найближчі 30 днів:    ${counts.next_30}`,
    `Виявлені:             ${counts.detected}`,
    `Контактні без флюоро: ${counts.contacts_no_fluoro}`,
    '',
  ];
  if (topRows.length > 0) {
    lines.push(`ТОП-${topRows.length} прострочених:`);
    for (const r of topRows) {
      const name = [r.surname, r.first_name, r.patronymic].filter(Boolean).join(' ');
      const days = r.next_planned_date ? daysAgo(r.next_planned_date) : 0;
      lines.push(`  • ${name} (${formatDateUk(r.birth_date)}) — план ${formatDateUk(r.next_planned_date)} (${days} дн. прострочено)`);
    }
    lines.push('');
  }
  lines.push(`Відкрити модуль: ${appUrl}`);
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
