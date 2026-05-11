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
    card.querySelector('.tb-module-body').innerHTML = `
      <div class="tb-module-status tb-module-status--empty">Пацієнт не зареєстрований у модулі</div>
      <div class="tb-module-meta">Medics ID: <code>${medicsId}</code></div>
    `;
    const actions = card.querySelector('.tb-module-actions');
    actions.innerHTML = `<button class="tb-module-btn tb-module-btn--primary" id="tb-add">Додати в модуль ТБ</button>`;
    actions.querySelector('#tb-add').addEventListener('click', async () => {
      await addPatient(cfg, medicsId, ctx, card);
    });
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

  // ── Context extractor — fill what we can from the page ────────────────
  // Override these selectors after inspecting the actual medics.ua DOM.
  function extractPatientContext() {
    const get = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || '').trim() : null;
    };
    return {
      surname: get('[data-tb-field="surname"]'),
      first_name: get('[data-tb-field="first_name"]'),
      patronymic: get('[data-tb-field="patronymic"]'),
      birth_date: null, // Should be parsed and ISO-formatted by the host page if possible.
      // location_id: 'bilohirska' | 'zaluzhe' — derive from "Відділення" field if present.
    };
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
