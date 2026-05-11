// ============================================================================
// TB-MODULE-SYNC.JS
// Інтеграція з Medics Indicators: дані пацієнта (ПІБ, ДН, ICPC-2 діагнози)
// після кожного "Аналізувати" автоматично відправляються в модуль ТБ.
//
// Завантажується останнім у content_scripts після ui.js (потрібен
// MedicsIndicatorUI.prototype.displayResults) і parser.js (для діагнозів).
// ============================================================================

(() => {
  'use strict';

  const STATE = {
    config: null,                  // { url, pin }
    currentKey: null,              // location.href without query/hash, used to remember manual Medics ID
    currentMedicsId: null,         // resolved Medics ID (auto or manual)
    sectionEl: null,
    lastSyncedAt: null,
    booted: false,
  };

  // ─── Config (chrome.storage.sync) ─────────────────────────────────────
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['tbModuleUrl', 'tbModulePin'], (v) => {
        resolve({
          url: (v.tbModuleUrl || '').replace(/\/$/, ''),
          pin: v.tbModulePin || '',
        });
      });
    });
  }

  function isConfigured() {
    return !!(STATE.config && STATE.config.url && STATE.config.pin);
  }

  // ─── ICPC-2 → medical_risk_groups (mirrors src/lib/risk-groups.ts) ───
  const ICPC_TO_GROUP = {
    B90: 'hiv',
    T89: 'diabetes', T90: 'diabetes',
    A79: 'oncology', B72: 'oncology', B74: 'oncology',
    D74: 'oncology', D75: 'oncology', D76: 'oncology', D77: 'oncology', D78: 'oncology',
    R84: 'oncology', R85: 'oncology',
    U75: 'oncology', U76: 'oncology', U77: 'oncology',
    R95: 'chronic_respiratory', R96: 'chronic_respiratory',
    R79: 'chronic_respiratory',
    R81: 'pneumonia_history',
    D85: 'peptic_ulcer', D86: 'peptic_ulcer',
  };

  function diagnosesToGroups(diagnoses) {
    if (!Array.isArray(diagnoses)) return { groups: [], codes: [] };
    const groups = new Set();
    const codes = new Set();
    for (const d of diagnoses) {
      const code = typeof d === 'string' ? d : d.code;
      if (!code) continue;
      codes.add(code);
      const base = code.split('.')[0];
      const g = ICPC_TO_GROUP[base];
      if (g) groups.add(g);
    }
    return { groups: [...groups], codes: [...codes] };
  }

  // ─── Page key → manual Medics ID mapping (in storage) ────────────────
  function pageKey() {
    // Strip query/hash so reload won't drop saved Medics ID.
    return location.origin + location.pathname;
  }

  function getManualMappings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['tbManualMedics'], (v) => {
        resolve(v.tbManualMedics || {});
      });
    });
  }
  function saveManualMapping(key, medicsId) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['tbManualMedics'], (v) => {
        const map = v.tbManualMedics || {};
        map[key] = medicsId;
        chrome.storage.sync.set({ tbManualMedics: map }, () => resolve());
      });
    });
  }
  function deleteManualMapping(key) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['tbManualMedics'], (v) => {
        const map = v.tbManualMedics || {};
        delete map[key];
        chrome.storage.sync.set({ tbManualMedics: map }, () => resolve());
      });
    });
  }

  // ─── Medics ID extraction (auto + manual fallback) ──────────────────
  function tryAutoExtractMedicsId() {
    // 1) Query params
    try {
      const url = new URL(location.href);
      for (const k of ['medics_id', 'patient_id', 'id', 'mid']) {
        const v = url.searchParams.get(k);
        if (v && /^\d{4,}$/.test(v)) return v;
      }
    } catch (_) {}

    // 2) URL path: /patient/<id>, /patients/<id>
    const path = location.pathname + location.hash;
    let m = path.match(/\/patients?\/(\d{4,})\b/i);
    if (m) return m[1];

    // 3) Data attributes
    const attr = document.querySelector('[data-medics-id], [data-patient-id]');
    if (attr) {
      const v = attr.getAttribute('data-medics-id') || attr.getAttribute('data-patient-id');
      if (v && /^\d{4,}$/.test(v)) return v;
    }

    // 4) "Medics ID" / "ID пацієнта" labels inside patient card
    const labels = ['Medics ID', 'ID пацієнта', 'ID Medics'];
    for (const txt of labels) {
      if (typeof findElementByText === 'function') {
        const el = findElementByText(txt);
        if (el) {
          // Search next 3 siblings + parent's children for digit run.
          let node = el;
          for (let i = 0; i < 5; i++) {
            node = node.nextElementSibling || node.parentElement?.nextElementSibling;
            if (!node) break;
            const mm = (node.textContent || '').match(/(\d{4,})/);
            if (mm) return mm[1];
          }
        }
      }
    }

    // 5) Numeric run in patient-info-card itself (last-ditch heuristic)
    const card = document.querySelector('#med-card-block, .c-patient-info-card');
    if (card) {
      const txt = (card.textContent || '').replace(/\s+/g, ' ');
      const mm = txt.match(/\b(\d{7,10})\b/);
      if (mm) return mm[1];
    }
    return null;
  }

  async function resolveMedicsId() {
    const auto = tryAutoExtractMedicsId();
    if (auto) return { id: auto, source: 'auto' };
    const map = await getManualMappings();
    const m = map[pageKey()];
    if (m) return { id: m, source: 'manual' };
    return { id: null, source: null };
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────
  function extractNameParts() {
    const nameEl = document.querySelector('.c-patient-info-card--user-name');
    if (!nameEl) return null;
    const parts = nameEl.textContent.trim().split(/\s+/);
    if (parts.length < 2) return null;
    return {
      surname: parts[0],
      first_name: parts[1],
      patronymic: parts.slice(2).join(' ') || null,
    };
  }

  function parseBirthDateIso() {
    if (typeof findElementByText !== 'function') return null;
    const label = findElementByText('Дата народження');
    if (!label) return null;
    let el = label.parentElement;
    for (let i = 0; i < 5 && el; i++) {
      const m = el.textContent.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      el = el.parentElement;
    }
    return null;
  }

  function getGender() {
    if (typeof GENDER_DETECTOR !== 'undefined' && GENDER_DETECTOR.detectGender) {
      return GENDER_DETECTOR.detectGender();
    }
    return null;
  }

  function extractContext() {
    const np = extractNameParts();
    return {
      ...(np || { surname: null, first_name: null, patronymic: null }),
      birth_date: parseBirthDateIso(),
      gender: getGender(),
    };
  }

  // ─── API ──────────────────────────────────────────────────────────────
  async function apiGet(medicsId) {
    const r = await fetch(
      `${STATE.config.url}/api/extension-sync?medics_id=${encodeURIComponent(medicsId)}`,
      { headers: { Authorization: `Bearer ${STATE.config.pin}` } },
    );
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  }
  async function apiUpsert(payload) {
    const r = await fetch(`${STATE.config.url}/api/extension-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STATE.config.pin}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  }

  // ─── Inject CSS once ──────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('tb-module-styles')) return;
    const s = document.createElement('style');
    s.id = 'tb-module-styles';
    s.textContent = `
      .tb-section {
        margin: 12px 14px !important;
        padding: 12px 14px !important;
        background: #ffffff !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 12px !important;
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif !important;
        font-size: 13px !important;
        color: #0f172a !important;
        box-sizing: border-box !important;
      }
      .tb-section--ok      { border-color: #86efac !important; background: #f0fdf4 !important; }
      .tb-section--warn    { border-color: #fbbf24 !important; background: #fffbeb !important; }
      .tb-section--err     { border-color: #fca5a5 !important; background: #fef2f2 !important; }
      .tb-section--info    { border-color: #93c5fd !important; background: #eff6ff !important; }
      .tb-section--neutral { border-color: #e2e8f0 !important; background: #f8fafc !important; }
      .tb-section__head {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        margin-bottom: 8px !important;
      }
      .tb-section__title {
        font-weight: 600 !important;
        font-size: 13px !important;
        color: #0f172a !important;
        margin: 0 !important;
      }
      .tb-section__dot {
        width: 8px !important;
        height: 8px !important;
        border-radius: 50% !important;
        display: inline-block !important;
        flex-shrink: 0 !important;
      }
      .tb-section__body { line-height: 1.5 !important; }
      .tb-section__row {
        display: flex !important;
        justify-content: space-between !important;
        gap: 10px !important;
        padding: 2px 0 !important;
        color: #475569 !important;
        font-size: 12px !important;
      }
      .tb-section__row strong { color: #0f172a !important; font-weight: 600 !important; }
      .tb-section__status {
        display: inline-block !important;
        padding: 2px 8px !important;
        border-radius: 999px !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        margin-left: 4px !important;
      }
      .tb-section__actions {
        margin-top: 10px !important;
        display: flex !important;
        gap: 6px !important;
        flex-wrap: wrap !important;
      }
      .tb-btn {
        background: #2563eb !important; color: #fff !important;
        border: 0 !important; border-radius: 6px !important;
        padding: 6px 12px !important; font-size: 12px !important;
        font-weight: 500 !important; cursor: pointer !important;
        text-decoration: none !important; display: inline-flex !important;
        align-items: center !important; gap: 4px !important;
        font-family: inherit !important;
      }
      .tb-btn:hover { background: #1d4ed8 !important; }
      .tb-btn--ghost {
        background: #ffffff !important; color: #0f172a !important;
        border: 1px solid #cbd5e1 !important;
      }
      .tb-btn--ghost:hover { background: #f1f5f9 !important; }
      .tb-btn--danger { background: #dc2626 !important; }
      .tb-btn--danger:hover { background: #b91c1c !important; }
      .tb-btn:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }
      .tb-input {
        font-family: inherit !important;
        padding: 6px 10px !important;
        font-size: 12px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 6px !important;
        flex: 1 !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }
      .tb-input:focus { outline: 2px solid #2563eb !important; outline-offset: -1px !important; border-color: transparent !important; }
      .tb-section__hint { font-size: 11px !important; color: #64748b !important; margin-top: 4px !important; }
      .tb-section__name {
        font-weight: 600 !important; font-size: 14px !important;
        color: #0f172a !important; margin: 0 0 2px !important;
      }
      .tb-section__meta {
        font-size: 11px !important; color: #64748b !important;
        margin-bottom: 8px !important;
      }
      .tb-section__groups {
        display: flex !important; flex-wrap: wrap !important; gap: 4px !important;
        margin-top: 6px !important;
      }
      .tb-section__group {
        background: #f1f5f9 !important; border: 1px solid #cbd5e1 !important;
        padding: 1px 7px !important; border-radius: 999px !important;
        font-size: 11px !important; color: #334155 !important;
      }
    `;
    document.head.appendChild(s);
  }

  // ─── Section UI ───────────────────────────────────────────────────────
  function ensureSection() {
    let sec = document.getElementById('tb-module-section');
    if (sec) return sec;

    injectStyles();

    // Place section just AFTER the patient banner inside the widget.
    const banner = document.getElementById('mi-patient-banner');
    if (!banner || !banner.parentNode) return null;

    sec = document.createElement('div');
    sec.id = 'tb-module-section';
    sec.className = 'tb-section tb-section--neutral';
    sec.innerHTML = `
      <div class="tb-section__head">
        <span class="tb-section__dot" style="background:#94a3b8;"></span>
        <h3 class="tb-section__title">📋 Модуль ТБ</h3>
      </div>
      <div class="tb-section__body">Завантаження…</div>
    `;
    banner.insertAdjacentElement('afterend', sec);
    STATE.sectionEl = sec;
    return sec;
  }

  function setSection(state, html) {
    const sec = ensureSection();
    if (!sec) return;
    sec.className = `tb-section tb-section--${state}`;
    const dot = sec.querySelector('.tb-section__dot');
    if (dot) {
      const colors = { ok: '#22c55e', warn: '#f59e0b', err: '#ef4444', info: '#3b82f6', neutral: '#94a3b8' };
      dot.style.background = colors[state] || colors.neutral;
    }
    const body = sec.querySelector('.tb-section__body');
    if (body) body.innerHTML = html;
  }

  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function formatDate(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
  }
  function statusLabel(s) {
    return ({
      risk: 'На ризику', detected: 'Виявлений', contact: 'Контактний',
      cleared: 'Знятий з обліку', external: 'Не декларант', archived: 'Архівний',
    })[s] || s;
  }
  function statusTone(s) {
    return ({
      risk: 'background:#f1f5f9;color:#334155', detected: 'background:#fef3c7;color:#92400e',
      contact: 'background:#dbeafe;color:#1e40af', cleared: 'background:#d1fae5;color:#065f46',
      external: 'background:#ede9fe;color:#6d28d9', archived: 'background:#f1f5f9;color:#94a3b8',
    })[s] || 'background:#f1f5f9;color:#334155';
  }

  // ─── Render variants ──────────────────────────────────────────────────
  function renderUnconfigured() {
    setSection('warn', `
      <div>Не налаштовано. Введіть URL модуля та PIN в опціях розширення.</div>
      <div class="tb-section__actions">
        <button class="tb-btn" id="tb-open-options" type="button">Відкрити опції</button>
      </div>
    `);
    document.getElementById('tb-open-options')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'openOptions' });
      // Fallback for cases where background message handler isn't set up.
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    });
  }

  function renderNeedMedicsId() {
    const map = STATE._pendingMappings || {};
    const last = map[pageKey()] || '';
    setSection('warn', `
      <div>Не вдалось знайти Medics ID на сторінці. Введіть його вручну — запамʼятаю для цієї сторінки.</div>
      <div class="tb-section__actions">
        <input class="tb-input" id="tb-medics-input" placeholder="напр. 3990123" value="${escHtml(last)}" inputmode="numeric" />
        <button class="tb-btn" id="tb-medics-save" type="button">Зберегти</button>
      </div>
      <div class="tb-section__hint">Medics ID — це числове поле на профілі НСЗУ. Знайти можна у виписці декларантів з МІС.</div>
    `);
    const input = document.getElementById('tb-medics-input');
    const save = document.getElementById('tb-medics-save');
    const submit = async () => {
      const v = (input.value || '').trim();
      if (!/^\d{4,}$/.test(v)) {
        input.style.borderColor = '#ef4444';
        return;
      }
      await saveManualMapping(pageKey(), v);
      STATE.currentMedicsId = v;
      await refresh();
    };
    save.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  function renderError(msg) {
    setSection('err', `
      <div>${escHtml(msg)}</div>
      <div class="tb-section__actions">
        <button class="tb-btn tb-btn--ghost" id="tb-retry" type="button">Спробувати знову</button>
      </div>
    `);
    document.getElementById('tb-retry')?.addEventListener('click', () => refresh());
  }

  function renderEmpty(medicsId, source) {
    const ctx = extractContext();
    const missing = [];
    if (!ctx.surname) missing.push('ПІБ');
    if (!ctx.birth_date) missing.push('ДН');
    const canCreate = missing.length === 0;
    const sourceLabel = source === 'manual' ? '(введено вручну)' : '';

    setSection('info', `
      <div>
        <div class="tb-section__name">Пацієнта немає в реєстрі ТБ</div>
        <div class="tb-section__meta">Medics ID: ${escHtml(medicsId)} ${sourceLabel}</div>
      </div>
      ${
        canCreate
          ? `<div class="tb-section__row"><span>Зчитано:</span><strong>${escHtml([ctx.surname, ctx.first_name, ctx.patronymic].filter(Boolean).join(' '))} · ${escHtml(ctx.birth_date || '')}</strong></div>`
          : `<div class="tb-section__row" style="color:#92400e;"><span>Не зчитано:</span><strong>${missing.join(', ')}</strong></div>`
      }
      <div class="tb-section__actions">
        <button class="tb-btn" id="tb-sync" type="button"${canCreate ? '' : ' disabled'}>
          ${canCreate ? 'Створити в модулі' : 'Не вистачає даних'}
        </button>
        ${source === 'manual' ? '<button class="tb-btn tb-btn--ghost" id="tb-forget" type="button">Забути Medics ID</button>' : ''}
        <button class="tb-btn tb-btn--ghost" id="tb-change-medics" type="button">Інший Medics ID</button>
      </div>
    `);
    document.getElementById('tb-sync')?.addEventListener('click', () => doSync(true));
    document.getElementById('tb-forget')?.addEventListener('click', async () => {
      await deleteManualMapping(pageKey());
      STATE.currentMedicsId = null;
      await refresh();
    });
    document.getElementById('tb-change-medics')?.addEventListener('click', () => renderNeedMedicsId());
  }

  function renderExisting(p, source) {
    const ctx = extractContext();
    const sourceLabel = source === 'manual' ? '(введено вручну)' : '';
    const next = p.next_planned_date;
    let nextRow = '';
    if (next) {
      const m = next.match(/^(\d{4})-(\d{2})-(\d{2})/);
      let extra = '';
      if (m) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        const days = Math.round((today - d) / 86400000);
        if (days > 0) extra = ` <span style="color:#dc2626;font-weight:600;">просрочено ${days} дн.</span>`;
        else if (days >= -7) extra = ` <span style="color:#ea580c;">через ${-days} дн.</span>`;
      }
      nextRow = `<div class="tb-section__row"><span>Наступна:</span><strong>${formatDate(next)}${extra}</strong></div>`;
    }
    const groups = [...(p.medical_risk_groups || []), ...(p.social_risk_groups || [])];

    setSection('ok', `
      <div>
        <div class="tb-section__name">${escHtml([p.surname, p.first_name, p.patronymic].filter(Boolean).join(' '))}</div>
        <div class="tb-section__meta">
          Medics ID: ${escHtml(p.medics_id || '')} ${sourceLabel} ·
          <span class="tb-section__status" style="${statusTone(p.tb_status)}">${statusLabel(p.tb_status)}</span>
        </div>
      </div>
      <div class="tb-section__row"><span>Остання флюоро:</span><strong>${p.last_fluoro_date ? formatDate(p.last_fluoro_date) : '—'}</strong></div>
      ${nextRow}
      ${groups.length > 0 ? `<div class="tb-section__groups">${groups.map((g) => `<span class="tb-section__group">${escHtml(g)}</span>`).join('')}</div>` : ''}
      ${STATE.lastSyncedAt ? `<div class="tb-section__hint">Синхронізовано ${new Date(STATE.lastSyncedAt).toLocaleTimeString('uk-UA')}</div>` : ''}
      <div class="tb-section__actions">
        <button class="tb-btn" id="tb-sync" type="button">Оновити з МІС</button>
        <a class="tb-btn tb-btn--ghost" href="${STATE.config.url}/patients/${p.id}" target="_blank">Картка ↗</a>
        ${source === 'manual' ? '<button class="tb-btn tb-btn--ghost" id="tb-forget" type="button">Забути ID</button>' : ''}
      </div>
    `);
    document.getElementById('tb-sync')?.addEventListener('click', () => doSync(true));
    document.getElementById('tb-forget')?.addEventListener('click', async () => {
      await deleteManualMapping(pageKey());
      STATE.currentMedicsId = null;
      await refresh();
    });
  }

  function renderLoading() {
    setSection('neutral', '<div>Завантаження…</div>');
  }

  // ─── Main flow ────────────────────────────────────────────────────────
  async function refresh() {
    if (!isConfigured()) return renderUnconfigured();
    renderLoading();

    const resolved = await resolveMedicsId();
    if (!resolved.id) return renderNeedMedicsId();
    STATE.currentMedicsId = resolved.id;

    try {
      const r = await apiGet(resolved.id);
      if (!r.found) return renderEmpty(resolved.id, resolved.source);
      return renderExisting(r.patient, resolved.source);
    } catch (e) {
      console.error('[TB Module] apiGet failed:', e);
      return renderError(`Помилка запиту: ${e.message}`);
    }
  }

  async function doSync(manual, analyzedData) {
    if (!isConfigured()) return renderUnconfigured();
    let medicsId = STATE.currentMedicsId;
    if (!medicsId) {
      const r = await resolveMedicsId();
      medicsId = r.id;
    }
    if (!medicsId) {
      console.warn('[TB Module] sync aborted: no Medics ID');
      return renderNeedMedicsId();
    }

    const ctx = extractContext();
    if (!ctx.surname || !ctx.first_name) {
      console.warn('[TB Module] sync aborted: missing name', ctx);
      return renderError('Не вдалось зчитати ПІБ зі сторінки');
    }

    // Diagnoses: prefer analyzer's collected data; fallback to parser.
    let diag = { groups: [], codes: [] };
    if (analyzedData?.patient?.diagnoses) {
      diag = diagnosesToGroups(analyzedData.patient.diagnoses);
    } else if (typeof MedicsParser !== 'undefined') {
      try {
        const p = new MedicsParser();
        const data = p.parseAll();
        if (data?.diagnoses) diag = diagnosesToGroups(data.diagnoses);
      } catch (_) {}
    }

    setSection('info', '<div>Синхронізуємо…</div>');
    const payload = {
      medics_id: medicsId,
      surname: ctx.surname,
      first_name: ctx.first_name,
      patronymic: ctx.patronymic,
      birth_date: ctx.birth_date,
      gender: ctx.gender,
      diagnoses_codes: diag.codes,
      medical_risk_groups: diag.groups,
    };
    console.log('[TB Module] sync payload:', payload);
    try {
      const result = await apiUpsert(payload);
      STATE.lastSyncedAt = Date.now();
      console.log('[TB Module] sync OK:', result, 'groups:', diag.groups.join(',') || '—');
      await refresh();
    } catch (e) {
      console.error('[TB Module] sync FAILED:', e);
      renderError(`Помилка синхронізації: ${e.message}`);
    }
  }

  // ─── Hook displayResults so auto-sync runs after each Analyze ────────
  function installAnalyzeHook() {
    if (typeof MedicsIndicatorUI === 'undefined' || !MedicsIndicatorUI.prototype) return false;
    if (MedicsIndicatorUI.prototype.__tbModulePatched) return true;
    const orig = MedicsIndicatorUI.prototype.displayResults;
    if (typeof orig !== 'function') return false;

    MedicsIndicatorUI.prototype.displayResults = function (results, collectedData) {
      orig.call(this, results, collectedData);
      try {
        doSync(false, collectedData).catch((e) => console.error('[TB Module] auto-sync:', e));
      } catch (e) {
        console.error('[TB Module] auto-sync error:', e);
      }
    };
    MedicsIndicatorUI.prototype.__tbModulePatched = true;
    console.log('[TB Module] displayResults hook installed');
    return true;
  }

  // ─── Boot ─────────────────────────────────────────────────────────────
  async function boot() {
    if (STATE.booted) return;
    STATE.config = await loadConfig();
    STATE._pendingMappings = await getManualMappings();

    const tryInit = () => {
      if (!document.getElementById('mi-patient-banner')) return false;
      installAnalyzeHook();
      refresh();
      STATE.booted = true;
      return true;
    };

    if (tryInit()) return;
    const obs = new MutationObserver(() => {
      if (tryInit()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 60000);
  }

  // Live-react to config changes saved in options page.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.tbModuleUrl || changes.tbModulePin || changes.tbManualMedics) {
      loadConfig().then((cfg) => {
        STATE.config = cfg;
        STATE.currentMedicsId = null;
        refresh();
      });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 600));
  } else {
    setTimeout(boot, 600);
  }

  console.log('[TB Module] tb-module-sync.js loaded');
})();
