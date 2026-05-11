// ============================================================================
// TB-MODULE-SYNC.JS
// Інтеграція з Medics Indicators: після кожного "Аналізувати" дані пацієнта
// (ПІБ, ДН, ICPC-2 діагнози → medical_risk_groups, останній R-ОГК з результатом)
// автоматично відправляються в модуль ТБ.
//
// Завантажується останнім у content_scripts після ui.js + parser.js + analyzer.js.
// ============================================================================

(() => {
  'use strict';

  const STATE = {
    config: null,
    currentMedicsId: null,
    sectionEl: null,
    lastSyncedAt: null,
    booted: false,
    analyzedOnce: false, // section stays hidden until first "Проаналізувати"
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
  function isConfigured() { return !!(STATE.config && STATE.config.url && STATE.config.pin); }

  // ─── Manual Medics ID storage (pageURL → Medics ID) ──────────────────
  function pageKey() { return location.origin + location.pathname; }
  function getManualMappings() {
    return new Promise((r) => chrome.storage.sync.get(['tbManualMedics'], (v) => r(v.tbManualMedics || {})));
  }
  function saveManualMapping(key, id) {
    return new Promise((r) => chrome.storage.sync.get(['tbManualMedics'], (v) => {
      const m = v.tbManualMedics || {}; m[key] = id;
      chrome.storage.sync.set({ tbManualMedics: m }, r);
    }));
  }
  function deleteManualMapping(key) {
    return new Promise((r) => chrome.storage.sync.get(['tbManualMedics'], (v) => {
      const m = v.tbManualMedics || {}; delete m[key];
      chrome.storage.sync.set({ tbManualMedics: m }, r);
    }));
  }

  // ─── ICPC-2 → medical_risk_groups ─────────────────────────────────────
  // Covers RISK_FACTORS_TB except the Z01-Z06 social codes — those mean
  // "бідність / харчі / житло / безробіття" in ICPC-2 but conflict with
  // unrelated МКХ-10 Z-codes and are too generic for auto-tagging.
  // The 'social_distress' group is kept in the module but reserved for
  // manual selection in the patient card.
  const ICPC_TO_GROUP = {
    // ВІЛ / СНІД
    B90: 'hiv',
    // Онкологія
    A79: 'oncology', B72: 'oncology', B74: 'oncology',
    D74: 'oncology', D75: 'oncology', D76: 'oncology', D77: 'oncology', D78: 'oncology',
    L71: 'oncology', N74: 'oncology',
    R84: 'oncology', R85: 'oncology',
    U75: 'oncology', U76: 'oncology', U77: 'oncology',
    T71: 'oncology', W72: 'oncology',
    X75: 'oncology', X76: 'oncology', X77: 'oncology',
    Y77: 'oncology', Y78: 'oncology',
    // Цукровий діабет
    T89: 'diabetes', T90: 'diabetes',
    // Шкідливі звички
    P15: 'alcohol_abuse', P16: 'alcohol_abuse',
    P17: 'tobacco_use',
    P19: 'drug_abuse',
    // Респіраторні
    R95: 'chronic_respiratory', R96: 'chronic_respiratory',
    R79: 'chronic_respiratory',
    R81: 'pneumonia_history',
    R82: 'pleurisy',
    // Харчування / вага
    T05: 'nutrition_problem',
    T08: 'weight_loss',
    // Урологія
    U28: 'urology_disorder',
    // Вагітність / пологи
    W78: 'pregnancy', W84: 'pregnancy',
    W90: 'pregnancy', W91: 'pregnancy', W92: 'pregnancy', W93: 'pregnancy',
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

  // ─── Medics ID extraction (auto + manual fallback) ───────────────────
  function tryAutoExtractMedicsId() {
    try {
      const url = new URL(location.href);
      for (const k of ['medics_id', 'patient_id', 'id', 'mid']) {
        const v = url.searchParams.get(k);
        if (v && /^\d{4,}$/.test(v)) return v;
      }
    } catch (_) {}
    const path = location.pathname + location.hash;
    const m = path.match(/\/patients?\/(\d{4,})\b/i);
    if (m) return m[1];
    const attr = document.querySelector('[data-medics-id], [data-patient-id]');
    if (attr) {
      const v = attr.getAttribute('data-medics-id') || attr.getAttribute('data-patient-id');
      if (v && /^\d{4,}$/.test(v)) return v;
    }
    if (typeof findElementByText === 'function') {
      for (const txt of ['Medics ID', 'ID пацієнта']) {
        const el = findElementByText(txt);
        if (!el) continue;
        let node = el;
        for (let i = 0; i < 5; i++) {
          node = node.nextElementSibling || node.parentElement?.nextElementSibling;
          if (!node) break;
          const mm = (node.textContent || '').match(/(\d{4,})/);
          if (mm) return mm[1];
        }
      }
    }
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

  // ─── ПІБ extraction — only Cyrillic words, max 3 ─────────────────────
  // .c-patient-info-card--user-name often contains "Іваненко Іван Іванович, 75 років"
  // We keep only cyrillic words (including apostrophes), discard age/commas.
  function extractNameParts() {
    const nameEl = document.querySelector('.c-patient-info-card--user-name');
    if (!nameEl) return null;
    const raw = (nameEl.textContent || '').trim();
    if (!raw) return null;
    const cleaned = raw.replace(/[,;()].*/, '');
    const tokens = cleaned
      .split(/\s+/)
      .filter((w) => /^[А-ЯІЇЄҐа-яіїєґʼ'`\-]+$/.test(w))
      .slice(0, 3);
    if (tokens.length < 2) return null;
    return {
      surname: tokens[0],
      first_name: tokens[1],
      patronymic: tokens[2] || null,
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

  // ─── R-ОГК: pull last diagnostic report + its conclusion text ────────
  // Codes from indicator 10 requiredActions / sample data:
  //   58500-00 Рентгенографія грудної клітки
  //   56301-00 КТ грудної клітки
  //   A34030   (alias used in the rendered DOM)
  const RX_CHEST_CODES = ['58500-00', '56301-00', 'A34030'];

  function classifyResult(text) {
    if (!text) return 'unknown';
    const s = text.toLowerCase();
    // "norm" / "without pathology" / "without features"
    if (/без\s*патолог|у\s*меж[аі]х\s*норм|без\s*особлив|норм/.test(s)) return 'normal';
    if (/патолог|зміни|інфільтрат|тінь|вогнищ|туберкульоз|зззтб|хр\.\s*бр/.test(s)) return 'pathology';
    if (/відмов/.test(s)) return 'refused';
    if (/очік|pending/.test(s)) return 'pending';
    return 'unknown';
  }

  // Pull last R-ОГК from the DOM. Anchors on .c-collapse--item-name
  // (the only element whose text starts with the code, e.g.
  // "58500-00 Рентгенографія грудної клітки"), climbs to its parent
  // .c-collapse--item, then reads the date + conclusion from THAT item.
  function extractLastFluoro(_collectedData) {
    const RX_NAME_RX = new RegExp(`^\\s*(${RX_CHEST_CODES.map((c) => c.replace(/[-/]/g, '\\$&')).join('|')})\\b`);

    const candidates = [];
    document.querySelectorAll('.c-collapse--item-name').forEach((nameEl) => {
      const nameText = (nameEl.textContent || '').trim();
      if (!RX_NAME_RX.test(nameText)) return;
      const item = nameEl.closest('.c-collapse--item');
      if (!item) return;

      // Date — within the same .c-collapse--item-text container that holds name.
      // Falls back to any .c-collapse--item-info inside the item.
      const itemText = nameEl.closest('.c-collapse--item-text');
      const info = itemText?.querySelector('.c-collapse--item-info')
        || item.querySelector(':scope > .c-collapse--item-header .c-collapse--item-info');
      const infoText = (info?.textContent || '').trim();
      const parsed = parseLooseDate(infoText);
      if (!parsed) return;
      const iso = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;

      // Conclusion lives in .c-collapse--item-body of THIS item only.
      // Use a :scope-rooted selector so we don't bleed into sibling items.
      let result = null;
      const body = item.querySelector(':scope > .c-collapse--item-body');
      if (body) {
        body.querySelectorAll('.c-collapse--output-item').forEach((oi) => {
          if (result) return;
          const t = oi.querySelector('.c-collapse--output-title');
          if (!t || !/висновок/i.test((t.textContent || '').trim())) return;
          const txt = oi.querySelector('.c-collapse--output-text');
          const text = (txt?.textContent || '').trim();
          if (text) result = text;
        });
      }

      candidates.push({ iso, result, nameText, hasBody: !!body, item });
    });

    console.log('[TB Module] R-ОГК candidates:', candidates.map((c) => ({
      name: c.nameText, iso: c.iso, hasBody: c.hasBody, result: c.result,
    })));

    if (candidates.length === 0) return null;
    // Pick the latest by ISO date; if it has no expanded body, fall back
    // to the latest one that DOES have a body (conclusion).
    candidates.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
    const latest = candidates[0];
    let chosen = latest;
    if (!latest.result) {
      const withResult = candidates.find((c) => c.result);
      if (withResult) chosen = withResult;
    }
    console.log('[TB Module] R-ОГК chosen:', { name: chosen.nameText, iso: chosen.iso, result: chosen.result });

    return {
      date: chosen.iso,
      result: chosen.result,
      result_code: classifyResult(chosen.result),
      next_planned_date: addMonthsIso(chosen.iso, 12),
    };
  }

  // Parse "25 груд. 2025 р. 16:54" / "25.12.2025" / "12/25/2025" → Date.
  function parseLooseDate(s) {
    if (!s) return null;
    // Reuse helpers.parseDate if it covers the Ukrainian-text format.
    if (typeof parseDate === 'function') {
      const d = parseDate(s);
      if (d && !isNaN(d.getTime())) return d;
    }
    const ddmmyyyy = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (ddmmyyyy) return new Date(+ddmmyyyy[3], +ddmmyyyy[2] - 1, +ddmmyyyy[1]);
    const mdY = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (mdY) {
      let y = +mdY[3]; if (y < 100) y = y >= 30 ? 1900 + y : 2000 + y;
      return new Date(y, +mdY[1] - 1, +mdY[2]);
    }
    return null;
  }

  function addMonthsIso(iso, months) {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1 + months, +m[3]);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  // ─── CSS once ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('tb-module-styles')) return;
    const s = document.createElement('style');
    s.id = 'tb-module-styles';
    s.textContent = `
      /* Hide noise we don't need anymore */
      #mi-completion-bar { display: none !important; }
      .mi-summary-sticky, .mi-tiles, .mi-legend { display: none !important; }
      #mi-instruction { display: none !important; }

      /* Inline gender picker in patient banner */
      .tb-gender-inline { display: inline-flex !important; gap: 4px !important; margin-left: 6px !important; vertical-align: middle !important; }
      .tb-gender-inline button {
        background: transparent !important; border: 1px solid #cbd5e1 !important;
        border-radius: 6px !important; padding: 2px 6px !important;
        font-size: 12px !important; line-height: 1 !important; cursor: pointer !important;
        font-family: inherit !important; color: #475569 !important;
      }
      .tb-gender-inline button.is-active { background: #0284c7 !important; border-color: #0284c7 !important; color: #fff !important; }
      .tb-gender-inline button.is-active-f { background: #db2777 !important; border-color: #db2777 !important; color: #fff !important; }
      .tb-gender-inline button:hover { background: #f1f5f9 !important; }

      .tb-section { margin:0 0 12px 0!important; padding:12px 14px!important; background:#fff!important; border:1px solid #e2e8f0!important; border-radius:12px!important; font-family:-apple-system,"Segoe UI",Roboto,sans-serif!important; font-size:13px!important; color:#0f172a!important; box-sizing:border-box!important; }
      .tb-section--ok{border-color:#86efac!important;background:#f0fdf4!important}
      .tb-section--warn{border-color:#fbbf24!important;background:#fffbeb!important}
      .tb-section--err{border-color:#fca5a5!important;background:#fef2f2!important}
      .tb-section--info{border-color:#93c5fd!important;background:#eff6ff!important}
      .tb-section--neutral{border-color:#e2e8f0!important;background:#f8fafc!important}
      .tb-section__head{display:flex!important;align-items:center!important;gap:8px!important;margin-bottom:8px!important}
      .tb-section__title{font-weight:600!important;font-size:13px!important;color:#0f172a!important;margin:0!important}
      .tb-section__dot{width:8px!important;height:8px!important;border-radius:50%!important;display:inline-block!important;flex-shrink:0!important}
      .tb-section__body{line-height:1.5!important}
      .tb-section__row{display:flex!important;justify-content:space-between!important;gap:10px!important;padding:2px 0!important;color:#475569!important;font-size:12px!important}
      .tb-section__row strong{color:#0f172a!important;font-weight:600!important}
      .tb-section__status{display:inline-block!important;padding:2px 8px!important;border-radius:999px!important;font-size:11px!important;font-weight:500!important;margin-left:4px!important}
      .tb-section__actions{margin-top:10px!important;display:flex!important;gap:6px!important;flex-wrap:wrap!important}
      .tb-btn{background:#2563eb!important;color:#fff!important;border:0!important;border-radius:6px!important;padding:6px 12px!important;font-size:12px!important;font-weight:500!important;cursor:pointer!important;text-decoration:none!important;display:inline-flex!important;align-items:center!important;gap:4px!important;font-family:inherit!important}
      .tb-btn:hover{background:#1d4ed8!important}
      .tb-btn--ghost{background:#fff!important;color:#0f172a!important;border:1px solid #cbd5e1!important}
      .tb-btn--ghost:hover{background:#f1f5f9!important}
      .tb-btn:disabled{opacity:0.5!important;cursor:not-allowed!important}
      .tb-input{font-family:inherit!important;padding:6px 10px!important;font-size:12px!important;border:1px solid #cbd5e1!important;border-radius:6px!important;flex:1!important;min-width:0!important;box-sizing:border-box!important}
      .tb-input:focus{outline:2px solid #2563eb!important;outline-offset:-1px!important;border-color:transparent!important}
      .tb-section__hint{font-size:11px!important;color:#64748b!important;margin-top:4px!important}
      .tb-section__name{font-weight:600!important;font-size:14px!important;color:#0f172a!important;margin:0 0 2px!important}
      .tb-section__meta{font-size:11px!important;color:#64748b!important;margin-bottom:8px!important}
      .tb-section__groups{display:flex!important;flex-wrap:wrap!important;gap:4px!important;margin-top:6px!important}
      .tb-section__group{background:#f1f5f9!important;border:1px solid #cbd5e1!important;padding:1px 7px!important;border-radius:999px!important;font-size:11px!important;color:#334155!important}
      .tb-section__quote{margin-top:6px!important;padding:8px 10px!important;background:#fff!important;border:1px solid #e2e8f0!important;border-radius:6px!important;font-size:11px!important;color:#475569!important;font-style:italic!important;line-height:1.4!important}
    `;
    document.head.appendChild(s);
  }

  function ensureSection() {
    let sec = document.getElementById('tb-module-section');
    if (sec && document.body.contains(sec)) return sec;
    injectStyles();
    // Insert as the FIRST child of widget body so it folds with the toggle.
    const body = document.getElementById('mi-widget-body');
    if (!body) return null;
    sec = document.createElement('div');
    sec.id = 'tb-module-section';
    sec.className = 'tb-section tb-section--neutral';
    sec.innerHTML = `
      <div class="tb-section__head">
        <span class="tb-section__dot" style="background:#94a3b8;"></span>
        <h3 class="tb-section__title">📋 Модуль ТБ</h3>
      </div>
      <div class="tb-section__body">…</div>
    `;
    body.insertAdjacentElement('afterbegin', sec);
    STATE.sectionEl = sec;
    return sec;
  }

  function setSection(state, html) {
    const sec = ensureSection();
    if (!sec) return;
    sec.style.display = STATE.analyzedOnce ? '' : 'none';
    sec.className = `tb-section tb-section--${state}`;
    const dot = sec.querySelector('.tb-section__dot');
    if (dot) {
      const colors = { ok: '#22c55e', warn: '#f59e0b', err: '#ef4444', info: '#3b82f6', neutral: '#94a3b8' };
      dot.style.background = colors[state] || colors.neutral;
    }
    const body = sec.querySelector('.tb-section__body');
    if (body) body.innerHTML = html;
  }

  function revealSection() {
    STATE.analyzedOnce = true;
    const sec = document.getElementById('tb-module-section');
    if (sec) sec.style.display = '';
  }

  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function formatDate(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
  }
  function statusLabel(s) {
    return ({ observed: 'Спостереження', risk: 'В групі ризику', detected: 'Виявлений', contact: 'Контактний', cleared: 'Знятий з обліку', external: 'Не декларант', archived: 'Архівний' })[s] || s;
  }
  function statusTone(s) {
    return ({
      observed: 'background:#f8fafc;color:#475569',
      risk: 'background:#fed7aa;color:#9a3412',
      detected: 'background:#fef3c7;color:#92400e',
      contact: 'background:#dbeafe;color:#1e40af',
      cleared: 'background:#d1fae5;color:#065f46',
      external: 'background:#ede9fe;color:#6d28d9',
      archived: 'background:#f1f5f9;color:#94a3b8',
    })[s] || 'background:#f1f5f9;color:#334155';
  }

  function renderUnconfigured() {
    setSection('warn', `
      <div>Не налаштовано. Введіть URL модуля та PIN в опціях розширення.</div>
      <div class="tb-section__actions"><button class="tb-btn" id="tb-open-options" type="button">Відкрити опції</button></div>
    `);
    document.getElementById('tb-open-options')?.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    });
  }

  function renderNeedMedicsId() {
    setSection('warn', `
      <div>Не вдалось знайти Medics ID на сторінці. Введіть його вручну — запамʼятаю для цієї сторінки.</div>
      <div class="tb-section__actions">
        <input class="tb-input" id="tb-medics-input" placeholder="напр. 3990123" inputmode="numeric" />
        <button class="tb-btn" id="tb-medics-save" type="button">Зберегти</button>
      </div>
      <div class="tb-section__hint">Medics ID — числове поле з НСЗУ. Знайти можна у виписці декларантів.</div>
    `);
    const input = document.getElementById('tb-medics-input');
    const submit = async () => {
      const v = (input.value || '').trim();
      if (!/^\d{4,}$/.test(v)) { input.style.borderColor = '#ef4444'; return; }
      await saveManualMapping(pageKey(), v);
      STATE.currentMedicsId = v;
      await refresh();
    };
    document.getElementById('tb-medics-save').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  function renderError(msg) {
    setSection('err', `
      <div>${escHtml(msg)}</div>
      <div class="tb-section__actions"><button class="tb-btn tb-btn--ghost" id="tb-retry" type="button">Спробувати знову</button></div>
    `);
    document.getElementById('tb-retry')?.addEventListener('click', () => refresh());
  }

  function renderEmpty(medicsId, source) {
    const srcLbl = source === 'manual' ? ' (введено вручну)' : '';
    setSection('info', `
      <div class="tb-section__meta">Medics ID: ${escHtml(medicsId)}${srcLbl} · <strong>немає в реєстрі ТБ</strong></div>
      <div class="tb-section__hint">Натисніть «Проаналізувати» — пацієнт додасться автоматично з діагнозами та R-ОГК.</div>
      <div class="tb-section__actions">
        ${source === 'manual' ? '<button class="tb-btn tb-btn--ghost" id="tb-forget" type="button">Забути ID</button>' : ''}
        <button class="tb-btn tb-btn--ghost" id="tb-change-medics" type="button">Інший Medics ID</button>
      </div>
    `);
    document.getElementById('tb-forget')?.addEventListener('click', async () => {
      await deleteManualMapping(pageKey()); STATE.currentMedicsId = null; await refresh();
    });
    document.getElementById('tb-change-medics')?.addEventListener('click', renderNeedMedicsId);
  }

  function renderExisting(p, source) {
    const srcLbl = source === 'manual' ? ' (введено вручну)' : '';
    let nextRow = '';
    if (p.next_planned_date) {
      const m = p.next_planned_date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      let extra = '';
      if (m) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        const days = Math.round((today - d) / 86400000);
        if (days > 0) extra = ` <span style="color:#dc2626;font-weight:600;">просрочено ${days} дн.</span>`;
        else if (days >= -7) extra = ` <span style="color:#ea580c;">через ${-days} дн.</span>`;
      }
      nextRow = `<div class="tb-section__row"><span>Наступна:</span><strong>${formatDate(p.next_planned_date)}${extra}</strong></div>`;
    }
    const groups = [...(p.medical_risk_groups || []), ...(p.social_risk_groups || [])];

    setSection('ok', `
      <div class="tb-section__meta">
        Medics ID: ${escHtml(p.medics_id || '')}${srcLbl} ·
        <span class="tb-section__status" style="${statusTone(p.tb_status)}">${statusLabel(p.tb_status)}</span>
      </div>
      <div class="tb-section__row"><span>Остання флюоро:</span><strong>${p.last_fluoro_date ? formatDate(p.last_fluoro_date) : '—'}</strong></div>
      ${nextRow}
      ${groups.length > 0 ? `<div class="tb-section__groups">${groups.map((g) => `<span class="tb-section__group">${escHtml(g)}</span>`).join('')}</div>` : ''}
      ${STATE.lastSyncedAt
        ? `<div class="tb-section__hint">Синхронізовано ${new Date(STATE.lastSyncedAt).toLocaleTimeString('uk-UA')}</div>`
        : `<div class="tb-section__hint">Оновлюється після «Проаналізувати».</div>`}
      <div class="tb-section__actions">
        <a class="tb-btn tb-btn--ghost" href="${STATE.config.url}/patients/${p.id}" target="_blank">Картка ↗</a>
        ${source === 'manual' ? '<button class="tb-btn tb-btn--ghost" id="tb-forget" type="button">Забути ID</button>' : ''}
      </div>
    `);
    document.getElementById('tb-forget')?.addEventListener('click', async () => {
      await deleteManualMapping(pageKey()); STATE.currentMedicsId = null; await refresh();
    });
  }

  // ─── Main flow ────────────────────────────────────────────────────────
  async function refresh() {
    if (!isConfigured()) return renderUnconfigured();
    setSection('neutral', '<div>Завантаження…</div>');
    const r = await resolveMedicsId();
    if (!r.id) return renderNeedMedicsId();
    STATE.currentMedicsId = r.id;
    try {
      const res = await apiGet(r.id);
      if (!res.found) return renderEmpty(r.id, r.source);
      return renderExisting(res.patient, r.source);
    } catch (e) {
      console.error('[TB Module] apiGet:', e);
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
    if (!medicsId) return renderNeedMedicsId();

    const ctx = extractContext();
    if (!ctx.surname || !ctx.first_name) {
      console.warn('[TB Module] sync aborted: missing name', ctx);
      return renderError('Не вдалось зчитати ПІБ зі сторінки');
    }

    // Diagnoses → groups + codes.
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

    // R-ОГК last record + planned next.
    const fluoro = analyzedData ? extractLastFluoro(analyzedData) : null;

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
    if (fluoro) payload.fluoro = fluoro;

    console.log('[TB Module] sync payload:', payload);
    try {
      const result = await apiUpsert(payload);
      STATE.lastSyncedAt = Date.now();
      console.log('[TB Module] sync OK:', result);
      await refresh();
    } catch (e) {
      console.error('[TB Module] sync FAILED:', e);
      renderError(`Помилка синхронізації: ${e.message}`);
    }
  }

  // ─── Hook into displayResults ─────────────────────────────────────────
  function installAnalyzeHook() {
    if (typeof MedicsIndicatorUI === 'undefined' || !MedicsIndicatorUI.prototype) return false;
    if (MedicsIndicatorUI.prototype.__tbModulePatched) return true;

    const origDisplay = MedicsIndicatorUI.prototype.displayResults;
    if (typeof origDisplay !== 'function') return false;
    MedicsIndicatorUI.prototype.displayResults = function (results, collectedData) {
      origDisplay.call(this, results, collectedData);
      revealSection();
      try {
        doSync(false, collectedData).catch((e) => console.error('[TB Module] auto-sync:', e));
      } catch (e) {
        console.error('[TB Module] auto-sync error:', e);
      }
    };

    // Strip age tail from the name and inject inline gender picker into meta.
    const origUpdateBanner = MedicsIndicatorUI.prototype.updatePatientBanner;
    if (typeof origUpdateBanner === 'function') {
      MedicsIndicatorUI.prototype.updatePatientBanner = function (info) {
        const data = info || (typeof this.getQuickPatientInfo === 'function' ? this.getQuickPatientInfo() : null);
        if (data && data.name) {
          // Strip trailing "<digits> р." / "<digits>р." / "<digits> років" / "<digits>" etc.
          data.name = data.name
            .replace(/[,;].*$/, '')
            .replace(/\s+\d+\s*(р\.?|років|років\.?)\s*$/iu, '')
            .replace(/\s+\d+\s*$/, '')
            .trim();
        }
        origUpdateBanner.call(this, data);
        decorateBannerMeta(data);
      };
    }

    // Hide the in-results "Стать пацієнта" card — picker now lives in the banner.
    if (typeof MedicsIndicatorUI.prototype.renderGenderSelector === 'function') {
      MedicsIndicatorUI.prototype.renderGenderSelector = function () { return ''; };
    }

    MedicsIndicatorUI.prototype.__tbModulePatched = true;
    console.log('[TB Module] hooks installed (displayResults + updatePatientBanner + renderGenderSelector)');
    return true;
  }

  // Replace the textual meta ("• 74 років, ♂ чол.") with age text + inline
  // gender toggle buttons that hook into GENDER_DETECTOR.
  function decorateBannerMeta(data) {
    const meta = document.getElementById('mi-patient-meta');
    if (!meta) return;
    const age = data?.age;
    const gender = data?.gender; // 'M' | 'F' | null

    const ageHtml = age != null ? `• ${age} років` : '';
    const maleClass = gender === 'M' ? 'is-active' : '';
    const femaleClass = gender === 'F' ? 'is-active-f' : '';

    meta.innerHTML = `
      ${ageHtml}
      <span class="tb-gender-inline">
        <button type="button" id="tb-banner-male" class="${maleClass}" title="Чоловік">👨</button>
        <button type="button" id="tb-banner-female" class="${femaleClass}" title="Жінка">👩</button>
      </span>
    `;

    const setGender = (g) => {
      if (typeof GENDER_DETECTOR === 'undefined' || !GENDER_DETECTOR.setManualGender) return;
      GENDER_DETECTOR.setManualGender(g);
      // Re-trigger analysis through their own button (no need for instance ref).
      document.getElementById('mi-analyze-btn')?.click();
    };
    document.getElementById('tb-banner-male')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setGender('M');
    });
    document.getElementById('tb-banner-female')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setGender('F');
    });
  }

  async function boot() {
    if (STATE.booted) return;
    STATE.config = await loadConfig();
    const tryInit = () => {
      if (!document.getElementById('mi-patient-banner')) return false;
      installAnalyzeHook();
      // Do NOT call refresh() on boot — section stays out of sight until
      // the user clicks "Проаналізувати". The hook in displayResults will
      // call revealSection() + sync.
      STATE.booted = true;
      return true;
    };
    if (tryInit()) return;
    const obs = new MutationObserver(() => { if (tryInit()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 60000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.tbModuleUrl || changes.tbModulePin || changes.tbManualMedics) {
      loadConfig().then((cfg) => { STATE.config = cfg; STATE.currentMedicsId = null; refresh(); });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 600));
  } else {
    setTimeout(boot, 600);
  }

  console.log('[TB Module] tb-module-sync.js loaded');
})();
