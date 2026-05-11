// Content script injected into medics.ua. When the user opens a patient page,
// we extract the Medics ID, ask the TB module about that patient, and inject
// a card with current TB status, last fluoro, and an "Update / Add" action.

(() => {
  'use strict';

  const STATE = { observer: null, lastUrl: null, currentMedicsId: null };

  // ── Config (loaded from chrome.storage) ────────────────────────────────
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['moduleUrl', 'pin'], (v) => {
        resolve({
          moduleUrl: (v.moduleUrl || '').replace(/\/$/, ''),
          pin: v.pin || '',
        });
      });
    });
  }

  // ── Medics ID extraction ───────────────────────────────────────────────
  // medics.ua URLs we've seen so far don't expose the numeric Medics ID
  // directly. Try several strategies in order; first match wins.
  function extractMedicsId() {
    // 1) URL pattern: …/patients/<medicsId> (adapt as needed)
    const m1 = location.pathname.match(/\/patients?\/(\d+)/i);
    if (m1) return m1[1];

    // 2) Look for "Medics ID" text in the DOM with a numeric sibling.
    const labels = Array.from(document.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && /medics\s*id/i.test(el.textContent || ''),
    );
    for (const lbl of labels) {
      // Try next sibling or parent's next sibling.
      const sib = lbl.nextElementSibling || lbl.parentElement?.nextElementSibling;
      const text = (sib?.textContent || '').trim();
      const m = text.match(/(\d{4,})/);
      if (m) return m[1];
    }

    // 3) data-attribute fallback
    const attr = document.querySelector('[data-medics-id]');
    if (attr) return attr.getAttribute('data-medics-id');

    return null;
  }

  // ── API calls ──────────────────────────────────────────────────────────
  async function apiGetPatient(cfg, medicsId) {
    const r = await fetch(`${cfg.moduleUrl}/api/extension-sync?medics_id=${encodeURIComponent(medicsId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.pin}` },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`${r.status}: ${t}`);
    }
    return r.json();
  }

  async function apiUpsertPatient(cfg, payload) {
    const r = await fetch(`${cfg.moduleUrl}/api/extension-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.pin}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`${r.status}: ${t}`);
    }
    return r.json();
  }

  // ── UI ─────────────────────────────────────────────────────────────────
  function ensureCard() {
    let card = document.getElementById('tb-module-card');
    if (card) return card;
    card = document.createElement('div');
    card.id = 'tb-module-card';
    card.innerHTML = `
      <div class="tb-module-header">
        <div class="tb-module-title">📋 Модуль ТБ</div>
        <button class="tb-module-close" type="button" title="Сховати">✕</button>
      </div>
      <div class="tb-module-body">Завантаження…</div>
      <div class="tb-module-actions"></div>
    `;
    document.body.appendChild(card);
    card.querySelector('.tb-module-close').addEventListener('click', () => {
      card.style.display = 'none';
    });
    return card;
  }

  function renderEmpty(card, cfg, medicsId, ctx) {
    const missing = [];
    if (!ctx.surname) missing.push('Прізвище');
    if (!ctx.first_name) missing.push('Імʼя');
    if (!ctx.birth_date) missing.push('Дата народження');
    const canAdd = missing.length === 0;
    const detected = canAdd
      ? `<div class="tb-module-meta">Зчитано: <strong>${escapeHtml([ctx.surname, ctx.first_name, ctx.patronymic].filter(Boolean).join(' '))}</strong>, ${ctx.birth_date}${ctx.location_id ? `, ${ctx.location_id}` : ''}</div>`
      : `<div class="tb-module-error" style="margin-top:6px;">Не зчитано: ${missing.join(', ')}</div>`;

    card.querySelector('.tb-module-body').innerHTML = `
      <div class="tb-module-status tb-module-status--empty">Пацієнт не зареєстрований у модулі</div>
      <div class="tb-module-meta">Medics ID: <code>${medicsId}</code></div>
      ${detected}
    `;
    const actions = card.querySelector('.tb-module-actions');
    actions.innerHTML = `<button class="tb-module-btn tb-module-btn--primary" id="tb-add"${canAdd ? '' : ' disabled style="opacity:0.5;cursor:not-allowed"'}>Додати в модуль ТБ</button>`;
    if (canAdd) {
      actions.querySelector('#tb-add').addEventListener('click', async () => {
        await addPatient(cfg, medicsId, ctx, card);
      });
    }
  }

  function renderExisting(card, p, cfg, ctx) {
    const fullName = [p.surname, p.first_name, p.patronymic].filter(Boolean).join(' ');
    const status = (
      { risk: 'На ризику', detected: 'Виявлений', contact: 'Контактний', cleared: 'Знятий', external: 'Не декларант', archived: 'Архівний' }[p.tb_status] ||
      p.tb_status
    );
    const lastFluoro = p.last_fluoro_date ? formatDate(p.last_fluoro_date) : 'немає';
    const nextPlanned = p.next_planned_date ? formatDate(p.next_planned_date) : '—';
    const overdueDays = p.next_planned_date ? daysSince(p.next_planned_date) : null;
    const groups = [...(p.medical_risk_groups || []), ...(p.social_risk_groups || [])];

    card.querySelector('.tb-module-body').innerHTML = `
      <div class="tb-module-name">${escapeHtml(fullName)}</div>
      <div class="tb-module-status tb-module-status--${p.tb_status}">${status}</div>
      <div class="tb-module-row">
        <span>Остання флюоро:</span>
        <strong>${lastFluoro}</strong>
      </div>
      <div class="tb-module-row">
        <span>Наступна:</span>
        <strong style="${overdueDays && overdueDays > 0 ? 'color:#dc2626' : ''}">
          ${nextPlanned}${overdueDays && overdueDays > 0 ? ` (просрочено ${overdueDays} дн.)` : ''}
        </strong>
      </div>
      ${groups.length > 0 ? `<div class="tb-module-groups">${groups.map((g) => `<span>${escapeHtml(g)}</span>`).join('')}</div>` : ''}
    `;
    const actions = card.querySelector('.tb-module-actions');
    actions.innerHTML = `
      <a class="tb-module-btn tb-module-btn--ghost" href="${cfg.moduleUrl}/patients/${p.id}" target="_blank">Картка ↗</a>
      <button class="tb-module-btn tb-module-btn--primary" id="tb-update">Оновити з МІС</button>
    `;
    actions.querySelector('#tb-update').addEventListener('click', async () => {
      await syncPatient(cfg, p.medics_id, ctx, card);
    });
  }

  async function addPatient(cfg, medicsId, ctx, card) {
    card.querySelector('.tb-module-body').innerHTML = 'Створюємо…';
    try {
      const payload = { medics_id: medicsId, ...ctx };
      await apiUpsertPatient(cfg, payload);
      await refresh(cfg, medicsId, card);
    } catch (e) {
      renderError(card, e.message);
    }
  }

  async function syncPatient(cfg, medicsId, ctx, card) {
    card.querySelector('.tb-module-body').innerHTML = 'Оновлюємо…';
    try {
      const payload = { medics_id: medicsId, ...ctx };
      await apiUpsertPatient(cfg, payload);
      await refresh(cfg, medicsId, card);
    } catch (e) {
      renderError(card, e.message);
    }
  }

  function renderError(card, msg) {
    card.querySelector('.tb-module-body').innerHTML =
      `<div class="tb-module-error">Помилка: ${escapeHtml(msg)}</div>`;
    card.querySelector('.tb-module-actions').innerHTML = '';
  }

  function renderUnconfigured(card) {
    card.querySelector('.tb-module-body').innerHTML = `
      <div class="tb-module-error">Не налаштовано. Відкрийте опції розширення.</div>
    `;
    card.querySelector('.tb-module-actions').innerHTML = '';
  }

  // ── Context extractor — heuristic label→value scan over the DOM ──────
  // Looks for leaf elements whose text matches Ukrainian labels (Прізвище,
  // Імʼя, По батькові, Дата народження, Телефон, Адреса, Стать, Відділення)
  // and reads the value from a neighbour. Works for most label-value
  // layouts (table rows, dt/dd, label+input, label+span).
  function extractPatientContext() {
    const ctx = {
      surname: null,
      first_name: null,
      patronymic: null,
      birth_date: null,
      gender: null,
      phone: null,
      address: null,
      location_id: null,
    };

    function valueOf(el) {
      // 1) Try next element sibling.
      let next = el.nextElementSibling;
      if (next) {
        const t = textOrInputValue(next);
        if (t) return t;
      }
      // 2) Try parent's next element sibling (label in one cell, value in next).
      if (el.parentElement) {
        next = el.parentElement.nextElementSibling;
        if (next) {
          const t = textOrInputValue(next);
          if (t) return t;
        }
      }
      // 3) Try parent's last child (label and value share a parent).
      if (el.parentElement && el.parentElement.children.length > 1) {
        const last = el.parentElement.lastElementChild;
        if (last && last !== el) {
          const t = textOrInputValue(last);
          if (t) return t;
        }
      }
      return null;
    }

    function textOrInputValue(el) {
      if (!el) return null;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return (el.value || '').trim();
      return (el.textContent || '').trim();
    }

    const all = document.querySelectorAll('label, dt, th, td, span, div, p');
    for (const el of all) {
      // Skip nodes with children (we want a leaf label).
      if (el.children.length > 0 && !['LABEL', 'TH', 'TD'].includes(el.tagName)) continue;
      const text = (el.textContent || '').replace(/[: ]/g, ' ').trim();
      if (!text || text.length > 60) continue;

      if (!ctx.surname && /^прізвище\b/i.test(text)) {
        ctx.surname = valueOf(el);
      } else if (!ctx.first_name && /^і?м[ʼ’']?я\b/i.test(text) && !/по\s*батькові/i.test(text)) {
        ctx.first_name = valueOf(el);
      } else if (!ctx.patronymic && /^по\s*батькові\b/i.test(text)) {
        ctx.patronymic = valueOf(el);
      } else if (!ctx.birth_date && /дата\s*народження/i.test(text)) {
        const raw = valueOf(el);
        ctx.birth_date = parseDateToIso(raw);
      } else if (!ctx.gender && /^стать\b/i.test(text)) {
        ctx.gender = mapGender(valueOf(el));
      } else if (!ctx.phone && /^телефон/i.test(text)) {
        ctx.phone = valueOf(el);
      } else if (!ctx.address && /^адрес/i.test(text)) {
        ctx.address = valueOf(el);
      } else if (!ctx.location_id && /відділення|підрозділ|амбулатор/i.test(text)) {
        const raw = (valueOf(el) || '').toLowerCase();
        if (raw.includes('білогір')) ctx.location_id = 'bilohirska';
        else if (raw.includes('залуж')) ctx.location_id = 'zaluzhe';
      }
    }

    // Single-cell ПІБ fallback: "Іваненко Іван Іванович" all in one element.
    if (!ctx.surname || !ctx.first_name) {
      const h = document.querySelector('h1, h2');
      if (h) {
        const parts = (h.textContent || '').trim().split(/\s+/);
        if (parts.length >= 2 && /^[А-ЯІЇЄҐ]/u.test(parts[0])) {
          if (!ctx.surname) ctx.surname = parts[0];
          if (!ctx.first_name) ctx.first_name = parts[1];
          if (!ctx.patronymic && parts[2]) ctx.patronymic = parts.slice(2).join(' ');
        }
      }
    }

    return ctx;
  }

  function parseDateToIso(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    const pad = (n) => String(n).padStart(2, '0');
    // DD.MM.YYYY
    let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
    // MM/DD/YYYY or M/D/YY (assume MM/DD when ambiguous)
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let y = +m[3];
      if (y < 100) y = y >= 30 ? 1900 + y : 2000 + y;
      return `${String(y).padStart(4, '0')}-${pad(+m[1])}-${pad(+m[2])}`;
    }
    // YYYY-MM-DD
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    return null;
  }

  function mapGender(raw) {
    if (!raw) return null;
    const s = String(raw).toLowerCase();
    if (s.startsWith('ч') || s === 'm' || s === 'м') return 'M';
    if (s.startsWith('ж') || s === 'f' || s === 'ф') return 'F';
    return null;
  }

  // ── Main flow ──────────────────────────────────────────────────────────
  async function refresh(cfg, medicsId, card) {
    try {
      const r = await apiGetPatient(cfg, medicsId);
      if (r.found) renderExisting(card, r.patient, cfg, extractPatientContext());
      else renderEmpty(card, cfg, medicsId, extractPatientContext());
    } catch (e) {
      renderError(card, e.message);
    }
  }

  async function run() {
    const cfg = await loadConfig();
    if (!cfg.moduleUrl || !cfg.pin) {
      const card = ensureCard();
      renderUnconfigured(card);
      return;
    }
    const medicsId = extractMedicsId();
    if (!medicsId) {
      const card = document.getElementById('tb-module-card');
      if (card) card.remove();
      return;
    }
    if (STATE.currentMedicsId === medicsId) return;
    STATE.currentMedicsId = medicsId;
    const card = ensureCard();
    await refresh(cfg, medicsId, card);
  }

  // SPA navigation detector: re-run when URL changes.
  function watchUrlChanges() {
    if (STATE.observer) return;
    const obs = new MutationObserver(() => {
      if (location.href !== STATE.lastUrl) {
        STATE.lastUrl = location.href;
        STATE.currentMedicsId = null;
        run();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    STATE.observer = obs;
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function formatDate(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : iso || '—';
  }

  function daysSince(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const t = new Date();
    d.setHours(0, 0, 0, 0);
    t.setHours(0, 0, 0, 0);
    return Math.round((t - d) / 86400000);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  STATE.lastUrl = location.href;
  watchUrlChanges();
  run();
})();
