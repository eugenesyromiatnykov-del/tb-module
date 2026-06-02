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
    analyzing: false,    // overlay is up and we're waiting for displayResults
    lastBannerName: '',  // for SPA navigation detection
    overlayTimeout: null,
    lastAdpM: null,      // { date: 'YYYY-MM-DD', vaccine_name } | null — parsed from page, not from TB module backend yet
  };

  // ─── Config (chrome.storage.sync) ─────────────────────────────────────
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['tbModuleUrl', 'tbModulePin', 'tbAutoAnalyze'], (v) => {
        resolve({
          url: (v.tbModuleUrl || '').replace(/\/$/, ''),
          pin: v.tbModulePin || '',
          autoAnalyze: v.tbAutoAnalyze !== false, // default true
        });
      });
    });
  }

  function setAutoAnalyzePref(value) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ tbAutoAnalyze: !!value }, () => resolve());
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

  // ─── Code → medical_risk_groups ───────────────────────────────────────
  // ICPC-2 codes have no dot (3 chars: "B90", "T90"). МКХ-10 codes have a
  // dot ("B20.0", "E11.71"). The SAME 3-char string can mean different
  // things in each system — e.g. ICPC-2 B90 = "ВІЛ/СНІД", but МКХ-10 B90
  // (and B90.0-B90.9) = "Наслідки туберкульозу". So we split them by
  // dot-presence.

  // ICPC-2: exact match on the full code (no dot expected).
  const ICPC_TO_GROUP = {
    B90: 'hiv',
    A79: 'oncology', B72: 'oncology', B74: 'oncology',
    D74: 'oncology', D75: 'oncology', D76: 'oncology', D77: 'oncology',
    // D78 was here too but it's "Доброякісне новоутворення травної системи" — dropped.
    L71: 'oncology', N74: 'oncology',
    R84: 'oncology', R85: 'oncology',
    U75: 'oncology', U76: 'oncology', U77: 'oncology',
    T71: 'oncology', W72: 'oncology',
    X75: 'oncology', X76: 'oncology', X77: 'oncology',
    Y77: 'oncology', Y78: 'oncology',
    T89: 'diabetes', T90: 'diabetes',
    P15: 'alcohol_abuse', P16: 'alcohol_abuse',
    P17: 'tobacco_use',
    P19: 'drug_abuse',
    R95: 'chronic_respiratory', R96: 'chronic_respiratory', R79: 'chronic_respiratory',
    R81: 'pneumonia_history',
    R82: 'pleurisy',
    T05: 'nutrition_problem',
    T08: 'weight_loss',
    U28: 'urology_disorder',
    W78: 'pregnancy', W84: 'pregnancy',
    W90: 'pregnancy', W91: 'pregnancy', W92: 'pregnancy', W93: 'pregnancy',
  };

  // МКХ-10: prefix match. Walks from longest prefix to shortest.
  // First match wins (so a more specific prefix overrides a generic one).
  const ICD10_PREFIX_RULES = [
    // HIV/AIDS — but ONLY B20-B24 (NOT B90.*, which is "Sequelae of TB")
    [/^B2[0-4]\b/, 'hiv'],
    // Sequelae of tuberculosis — B90 + B90.x in МКХ-10
    [/^B90(\.|$)/, 'previously_treated'],
    // Active TB history — A15-A19, plus the doctor-style A15.x, etc.
    [/^A1[5-9]\b/, 'previously_treated'],
    [/^Z86\.1\b/, 'previously_treated'],
    // Oncology — strictly malignant + carcinoma in situ + active hematologic
    // surveillance. Benign neoplasms (D10–D36, e.g. D22 melanocytic nevus =
    // "родинка") and most uncertain-behavior codes (D37–D44, D48) are NOT
    // immunosuppressive and were causing false positives.
    [/^C\d/, 'oncology'],        // C00–C97 — all malignant neoplasms
    [/^D0\d/, 'oncology'],       // D00–D09 — carcinoma in situ
    [/^D4[567]\b/, 'oncology'],  // D45–D47 — polycythaemia vera, MDS, other myeloid/lymphoid neoplasms of uncertain behavior
    // Diabetes — E10-E14
    [/^E1[0-4]\b/, 'diabetes'],
    // Chronic respiratory — J40-J47
    [/^J4[0-7]\b/, 'chronic_respiratory'],
    // Pneumonia history — J12-J18
    [/^J1[2-8]\b/, 'pneumonia_history'],
    // Peptic ulcer — K25-K28
    [/^K2[5-8]\b/, 'peptic_ulcer'],
    // Psychiatry — F-codes
    [/^F\d/, 'psychiatric'],
    // Alcohol / tobacco / drug as МКХ-10
    [/^F10\b/, 'alcohol_abuse'],
    [/^F17\b/, 'tobacco_use'],
    [/^Z72\.0\b/, 'tobacco_use'],
    [/^Z86\.43\b/, 'tobacco_use'],
    [/^G31\.2\b/, 'alcohol_abuse'],
  ];

  function icpcGroup(code) {
    return ICPC_TO_GROUP[code] || null;
  }
  function icd10Group(code) {
    for (const [re, group] of ICD10_PREFIX_RULES) {
      if (re.test(code)) return group;
    }
    return null;
  }

  function diagnosesToGroups(diagnoses) {
    if (!Array.isArray(diagnoses)) return { groups: [], codes: [] };
    const groups = new Set();
    const codes = new Set();
    for (const d of diagnoses) {
      const code = typeof d === 'string' ? d : d.code;
      if (!code) continue;
      codes.add(code);
      const isIcd10 = code.includes('.');
      const g = isIcd10 ? icd10Group(code) : icpcGroup(code);
      if (g) groups.add(g);
    }
    return { groups: [...groups], codes: [...codes] };
  }

  function ageFromBirth(iso) {
    if (!iso) return null;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const today = new Date();
    let age = today.getFullYear() - +m[1];
    const md = today.getMonth() + 1 - +m[2];
    if (md < 0 || (md === 0 && today.getDate() < +m[3])) age -= 1;
    return age;
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
  // Only codes that unambiguously identify chest imaging (per indicator 10
  // requiredActions). A34030 was removed: in medics.ua it's also used
  // for "Аналіз; біохімія" and other non-imaging reports — too generic.
  const RX_CHEST_CODES = ['58500-00', '56301-00'];

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

  // ─── Auto-analyze overlay ─────────────────────────────────────────────
  function ensureOverlayStyles() {
    if (document.getElementById('tb-overlay-styles')) return;
    const s = document.createElement('style');
    s.id = 'tb-overlay-styles';
    s.textContent = `
      #tb-auto-overlay {
        position: fixed !important; inset: 0 !important;
        background: rgba(15, 23, 42, 0.55) !important;
        backdrop-filter: blur(3px) !important;
        -webkit-backdrop-filter: blur(3px) !important;
        z-index: 2147483646 !important;
        display: flex !important;
        align-items: center !important; justify-content: center !important;
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif !important;
      }
      #tb-auto-overlay .tb-overlay-card {
        background: #fff !important; border-radius: 12px !important;
        padding: 22px 28px !important;
        box-shadow: 0 20px 40px rgba(0,0,0,0.25) !important;
        display: flex !important; flex-direction: column !important;
        align-items: center !important; gap: 12px !important;
        min-width: 240px !important;
      }
      #tb-auto-overlay .tb-overlay-spinner {
        width: 32px !important; height: 32px !important;
        border: 3px solid #e2e8f0 !important;
        border-top-color: #2563eb !important;
        border-radius: 50% !important;
        animation: tb-overlay-spin 0.8s linear infinite !important;
      }
      @keyframes tb-overlay-spin { to { transform: rotate(360deg); } }
      #tb-auto-overlay .tb-overlay-text {
        color: #0f172a !important; font-size: 14px !important; font-weight: 500 !important;
        text-align: center !important;
      }
      #tb-auto-overlay .tb-overlay-sub {
        color: #64748b !important; font-size: 12px !important; text-align: center !important;
      }
      #tb-auto-overlay .tb-overlay-cancel {
        margin-top: 6px !important; padding: 6px 14px !important;
        background: transparent !important; color: #64748b !important;
        border: 1px solid #cbd5e1 !important; border-radius: 6px !important;
        font-size: 12px !important; cursor: pointer !important;
        font-family: inherit !important;
      }
      #tb-auto-overlay .tb-overlay-cancel:hover { background: #f1f5f9 !important; color: #0f172a !important; }
    `;
    document.head.appendChild(s);
  }

  function showOverlay() {
    if (document.getElementById('tb-auto-overlay')) return;
    ensureOverlayStyles();
    const ov = document.createElement('div');
    ov.id = 'tb-auto-overlay';
    ov.innerHTML = `
      <div class="tb-overlay-card">
        <div class="tb-overlay-spinner"></div>
        <div class="tb-overlay-text">Аналізуємо пацієнта…</div>
        <div class="tb-overlay-sub">Збираємо діагнози, направлення та R-ОГК</div>
        <button type="button" class="tb-overlay-cancel">Скасувати</button>
      </div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('.tb-overlay-cancel')?.addEventListener('click', () => hideOverlay());
  }

  function hideOverlay() {
    document.getElementById('tb-auto-overlay')?.remove();
    STATE.analyzing = false;
    if (STATE.overlayTimeout) {
      clearTimeout(STATE.overlayTimeout);
      STATE.overlayTimeout = null;
    }
  }

  // Show overlay IMMEDIATELY when a patient page is detected (well before
  // the indicators widget renders) so the user can't click anything on the
  // half-loaded page. The actual analyze click happens later, only after
  // the page DOM has settled.
  function isPatientPage() {
    return !!(
      document.querySelector('#med-card-block') &&
      document.querySelector('.c-patient-info-card--user-name')
    );
  }

  // Resolves once the DOM hasn't mutated for `quietMs` ms (or after maxMs).
  // Mirrors data-collector's waitForDomStable so we don't fire the analyze
  // click before medics.ua finishes loading episodes / encounters / DRs.
  function waitForDomStable(quietMs = 700, maxMs = 8000) {
    return new Promise((resolve) => {
      let lastMutation = Date.now();
      const observer = new MutationObserver(() => { lastMutation = Date.now(); });
      observer.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'ng-hide'],
      });
      const start = Date.now();
      const tick = setInterval(() => {
        const quiet = Date.now() - lastMutation;
        const total = Date.now() - start;
        if (quiet >= quietMs || total >= maxMs) {
          clearInterval(tick);
          observer.disconnect();
          resolve(quiet >= quietMs ? 'stable' : 'timeout');
        }
      }, 100);
    });
  }

  async function startAutoAnalyze() {
    if (STATE.analyzing) return;
    STATE.analyzing = true;
    showOverlay();

    // Safety net: if analyze never completes in 60s, drop the overlay.
    STATE.overlayTimeout = setTimeout(() => {
      console.warn('[TB Module] auto-analyze timeout — dropping overlay');
      hideOverlay();
    }, 60_000);

    // Wait for the Analyze button to be present AND the page DOM to settle
    // (medics.ua keeps streaming episodes/encounters/DRs for ~1-2s after the
    // patient banner appears).
    const start = Date.now();
    while (Date.now() - start < 15_000) {
      const btn = document.getElementById('mi-analyze-btn');
      if (btn) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    const btn = document.getElementById('mi-analyze-btn');
    if (!btn) {
      console.warn('[TB Module] mi-analyze-btn never appeared');
      hideOverlay();
      return;
    }
    const reason = await waitForDomStable(700, 8000);
    console.log(`[TB Module] page settled (${reason}) — clicking Аналізувати`);
    try { btn.click(); } catch (e) {
      console.error('[TB Module] auto-analyze click failed:', e);
      hideOverlay();
    }
  }

  // ─── CSS once ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('tb-module-styles')) return;
    const s = document.createElement('style');
    s.id = 'tb-module-styles';
    s.textContent = `
      /* v5.0.0: hide deprecated noise sections */
      #mi-completion-bar,
      #mi-progress-container,
      .mi-summary-sticky, .mi-tiles, .mi-legend,
      #mi-instruction { display: none !important; }

      /* Inline gender picker in patient banner */
      .tb-gender-inline { display: inline-flex !important; gap: 4px !important; margin-left: 6px !important; vertical-align: middle !important; }
      .tb-gender-inline button {
        background: transparent !important; border: 1px solid #cbd5e1 !important;
        border-radius: 5px !important; padding: 1px 6px !important;
        font-size: 11px !important; line-height: 1 !important; cursor: pointer !important;
        font-family: inherit !important; color: #475569 !important;
      }
      .tb-gender-inline button.is-active { background: #0284c7 !important; border-color: #0284c7 !important; color: #fff !important; }
      .tb-gender-inline button.is-active-f { background: #db2777 !important; border-color: #db2777 !important; color: #fff !important; }
      .tb-gender-inline button:hover { background: #f1f5f9 !important; }

      /* ── TB section: compact, glanceable ────────────────────────────── */
      .tb-section{
        margin:0 0 12px 0!important;padding:10px 12px!important;background:#fff!important;
        border:1px solid #e2e8f0!important;border-left:3px solid #cbd5e1!important;
        border-radius:8px!important;
        font-family:-apple-system,"Segoe UI",Roboto,sans-serif!important;
        font-size:13px!important;color:#0f172a!important;box-sizing:border-box!important;
      }
      .tb-section--ok      { border-left-color:#10b981!important }
      .tb-section--warn    { border-left-color:#f59e0b!important }
      .tb-section--err     { border-left-color:#ef4444!important;background:#fef2f2!important }
      .tb-section--info    { border-left-color:#3b82f6!important }
      .tb-section--neutral { border-left-color:#cbd5e1!important }

      .tb-head{display:flex!important;align-items:center!important;gap:8px!important;margin-bottom:8px!important;font-size:12px!important}
      .tb-head__spacer{flex:1!important}
      .tb-head__meta{color:#94a3b8!important;font-size:11px!important}
      .tb-head__link{color:#64748b!important;text-decoration:none!important;padding:2px 6px!important;border-radius:5px!important;font-size:12px!important;line-height:1!important}
      .tb-head__link:hover{background:#f1f5f9!important;color:#0f172a!important}
      .tb-status-pill{display:inline-flex!important;align-items:center!important;padding:2px 9px!important;border-radius:999px!important;font-size:11px!important;font-weight:600!important;letter-spacing:0.2px!important}

      .tb-tiles{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important}
      .tb-tile{padding:8px 10px!important;background:#f8fafc!important;border:1px solid #e2e8f0!important;border-radius:7px!important;min-width:0!important}
      .tb-tile__label{font-size:10px!important;font-weight:700!important;color:#64748b!important;text-transform:uppercase!important;letter-spacing:0.5px!important;margin-bottom:3px!important}
      .tb-tile__date{font-size:15px!important;font-weight:600!important;color:#0f172a!important;line-height:1.15!important;margin-bottom:3px!important}
      .tb-tile__state{font-size:11px!important;font-weight:500!important;display:flex!important;align-items:center!important;gap:5px!important}
      .tb-tile__dot{width:6px!important;height:6px!important;border-radius:50%!important;display:inline-block!important;flex-shrink:0!important}

      /* Generic buttons reused by sub-views (rare but kept for emptyState etc.) */
      .tb-btn{background:#0f172a!important;color:#fff!important;border:0!important;border-radius:6px!important;padding:6px 12px!important;font-size:12px!important;font-weight:500!important;cursor:pointer!important;text-decoration:none!important;display:inline-flex!important;align-items:center!important;gap:4px!important;font-family:inherit!important}
      .tb-btn:hover{background:#1e293b!important}
      .tb-btn--ghost{background:#fff!important;color:#0f172a!important;border:1px solid #cbd5e1!important}
      .tb-btn--ghost:hover{background:#f1f5f9!important}
      .tb-btn:disabled{opacity:0.5!important;cursor:not-allowed!important}
      .tb-input{font-family:inherit!important;padding:6px 10px!important;font-size:12px!important;border:1px solid #cbd5e1!important;border-radius:6px!important;flex:1!important;min-width:0!important;box-sizing:border-box!important}
      .tb-input:focus{outline:2px solid #2563eb!important;outline-offset:-1px!important;border-color:transparent!important}
      .tb-section__row{display:flex!important;justify-content:space-between!important;gap:10px!important;padding:2px 0!important;color:#475569!important;font-size:12px!important}
      .tb-section__row strong{color:#0f172a!important;font-weight:600!important}
      .tb-section__title{font-weight:600!important;font-size:13px!important;color:#0f172a!important;margin:0!important}
      .tb-section__hint{font-size:11px!important;color:#64748b!important;margin-top:4px!important}
      .tb-section__name{font-weight:600!important;font-size:14px!important;color:#0f172a!important;margin:0 0 2px!important}
      .tb-section__meta{font-size:11px!important;color:#64748b!important;margin-bottom:8px!important}
      .tb-section__actions{margin-top:8px!important;display:flex!important;gap:6px!important;flex-wrap:wrap!important}
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
    sec.innerHTML = `<div class="tb-section__body">…</div>`;
    body.insertAdjacentElement('afterbegin', sec);
    STATE.sectionEl = sec;
    return sec;
  }

  // Inject auto-analyze toggle directly into the Medics Indicators widget
  // header, next to the S/M/L scale buttons.
  function injectAutoToggle() {
    if (document.getElementById('mi-tb-auto-toggle')) return;
    const header = document.getElementById('mi-header');
    if (!header) return;
    // Insert before the scale-button cluster so it sits on the left of the
    // header controls (S/M/L + minimise). Anchored on a stable id rather
    // than an inline-style substring, which broke last time the header
    // padding/gap was tweaked.
    const rightCluster =
      header.querySelector('#mi-header-actions') ||
      header.querySelector('div[style*="display: flex"][style*="gap:"]');
    if (!rightCluster) return;

    if (!document.getElementById('mi-tb-auto-style')) {
      const st = document.createElement('style');
      st.id = 'mi-tb-auto-style';
      st.textContent = `
        #mi-tb-auto-toggle {
          display: inline-flex !important; align-items: center !important; gap: 5px !important;
          padding: 2px 8px !important;
          background: rgba(255,255,255,0.08) !important;
          border: 1px solid rgba(255,255,255,0.18) !important;
          border-radius: 999px !important;
          font-size: 0.72em !important; font-weight: 700 !important;
          letter-spacing: 0.06em !important;
          cursor: pointer !important;
          font-family: inherit !important;
          user-select: none !important;
          color: rgba(255,255,255,0.85) !important;
          line-height: 1.5 !important;
          flex-shrink: 0 !important;
        }
        #mi-tb-auto-toggle .tb-auto-dot {
          width: 7px !important; height: 7px !important;
          border-radius: 50% !important;
          transition: background 0.15s ease, box-shadow 0.15s ease !important;
        }
        #mi-tb-auto-toggle[data-on="true"] .tb-auto-dot {
          background: #10b981 !important;
          box-shadow: 0 0 0 2px rgba(16,185,129,0.25) !important;
        }
        #mi-tb-auto-toggle[data-on="false"] .tb-auto-dot {
          background: rgba(148,163,184,0.55) !important;
        }
        #mi-tb-auto-toggle:hover { background: rgba(255,255,255,0.14) !important; }
      `;
      document.head.appendChild(st);
    }

    const checked = STATE.config?.autoAnalyze !== false;
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.id = 'mi-tb-auto-toggle';
    wrap.title = checked
      ? 'Авто-аналіз увімкнено (клік щоб вимкнути)'
      : 'Авто-аналіз вимкнено (клік щоб увімкнути)';
    wrap.dataset.on = String(checked);
    wrap.innerHTML = `<span class="tb-auto-dot"></span><span>АВТО</span>`;
    rightCluster.insertAdjacentElement('afterbegin', wrap);

    wrap.addEventListener('click', async (e) => {
      e.stopPropagation();
      const on = wrap.dataset.on !== 'true';
      wrap.dataset.on = String(on);
      wrap.title = on
        ? 'Авто-аналіз увімкнено (клік щоб вимкнути)'
        : 'Авто-аналіз вимкнено (клік щоб увімкнути)';
      await setAutoAnalyzePref(on);
      STATE.config = { ...STATE.config, autoAnalyze: on };
      if (on && !STATE.analyzing) {
        startAutoAnalyze();
      }
    });
  }


  function setSection(state, html) {
    const sec = ensureSection();
    if (!sec) return;
    sec.style.display = STATE.analyzedOnce ? '' : 'none';
    sec.className = `tb-section tb-section--${state}`;
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

  // Українська плюралізація: 1 рік / 2 роки / 5 років
  function pluralUk(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // Кількість днів → читабельний рядок «X р. Y міс.» / «N міс.» / «N днів».
  function formatDuration(days) {
    if (days < 30) return `${days} ${pluralUk(days, 'день', 'дні', 'днів')}`;
    if (days < 365) {
      const months = Math.max(1, Math.round(days / 30));
      return `${months} ${pluralUk(months, 'місяць', 'місяці', 'місяців')}`;
    }
    const years = Math.floor(days / 365);
    const months = Math.round((days - years * 365) / 30);
    const yLbl = `${years} ${pluralUk(years, 'рік', 'роки', 'років')}`;
    if (months === 0) return yLbl;
    return `${yLbl} ${months} ${pluralUk(months, 'місяць', 'місяці', 'місяців')}`;
  }

  // Додає років до ISO-дати, повертає ISO 'YYYY-MM-DD' (або null).
  function addYearsIso(iso, years) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    d.setFullYear(d.getFullYear() + years);
    return toLocalIso(d);
  }

  // Скільки днів минуло з ISO-дати до сьогодні. Якщо дата майбутня — від'ємне.
  function daysSinceIso(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today - d) / 86400000);
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

  // Relative "X ago" label for analysis freshness.
  function relativeLabel(ts) {
    if (!ts) return null;
    try {
      const d = new Date(ts);
      const diff = Date.now() - d.getTime();
      const day = 86400000;
      if (diff < 60 * 60 * 1000) return 'щойно';
      if (diff < day) return 'сьогодні';
      if (diff < 2 * day) return 'вчора';
      if (diff < 7 * day) return `${Math.floor(diff / day)} дн. тому`;
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    } catch (_) { return null; }
  }

  // Compute fluoro tile state — { dateLabel, stateLabel, tone }.
  function computeFluoroTile(p, needsFluoro) {
    if (p.last_fluoro_date) {
      const dateLabel = formatDate(p.last_fluoro_date);
      if (needsFluoro && p.next_planned_date) {
        const overdueDays = daysSinceIso(p.next_planned_date);
        if (overdueDays != null && overdueDays > 0) {
          return { dateLabel, stateLabel: `просрочено ${formatDuration(overdueDays)}`, tone: 'err' };
        }
      }
      return { dateLabel, stateLabel: needsFluoro ? 'у нормі' : '', tone: 'ok' };
    }
    if (needsFluoro) return { dateLabel: '—', stateLabel: 'не зроблено', tone: 'err' };
    return { dateLabel: '—', stateLabel: 'не вносилось', tone: 'mute' };
  }

  // Compute АДП-М tile state.
  function computeAdpmTile(p) {
    if (p.adpm_contraindication) return { dateLabel: '—', stateLabel: 'протипоказання', tone: 'mute' };
    if (p.adpm_refused) return { dateLabel: '—', stateLabel: 'відмова', tone: 'mute' };
    const lastIso = p.last_adpm_date || (STATE.lastAdpM?.date ?? null);
    if (!lastIso) {
      return STATE.analyzedOnce
        ? { dateLabel: '—', stateLabel: 'не внесено', tone: 'err' }
        : { dateLabel: '—', stateLabel: 'немає даних', tone: 'mute' };
    }
    const dateLabel = formatDate(lastIso);
    const nextIso = p.next_adpm_date || addYearsIso(lastIso, 10);
    if (nextIso) {
      const overdueDays = daysSinceIso(nextIso);
      if (overdueDays != null && overdueDays > 0) {
        return { dateLabel, stateLabel: `просрочено ${formatDuration(overdueDays)}`, tone: 'err' };
      }
      if (overdueDays != null) {
        const m = nextIso.match(/^(\d{4})-/);
        if (m && +m[1] === new Date().getFullYear()) {
          return { dateLabel, stateLabel: 'цьогоріч', tone: 'warn' };
        }
      }
    }
    return { dateLabel, stateLabel: 'у нормі', tone: 'ok' };
  }

  // Render one тlefty/right tile for the flu/АДПМ row. Tone palette is
  // intentionally muted — the colour belongs on the section accent, not
  // on every inner block.
  function renderTile(label, tile) {
    const TONE = {
      ok:   { fg: '#065f46', dot: '#10b981' },
      warn: { fg: '#9a3412', dot: '#f59e0b' },
      err:  { fg: '#991b1b', dot: '#ef4444' },
      mute: { fg: '#64748b', dot: '#cbd5e1' },
    };
    const t = TONE[tile.tone] || TONE.mute;
    return `
      <div class="tb-tile">
        <div class="tb-tile__label">${label}</div>
        <div class="tb-tile__date">${tile.dateLabel}</div>
        ${tile.stateLabel ? `<div class="tb-tile__state" style="color:${t.fg};">
          <span class="tb-tile__dot" style="background:${t.dot};"></span>
          ${tile.stateLabel}
        </div>` : ''}
      </div>`;
  }

  // Indicator chips removed in v5.0.0 per user request — the doctor uses
  // the TODO list, not per-indicator state. Full breakdown still available
  // via the «Деталі індикаторів» toggle in the widget body.
  function renderExisting(p, _source, _indicators) {
    const inRiskGroup =
      p.tb_status === 'risk' ||
      p.tb_status === 'detected' ||
      (p.medical_risk_groups?.length || 0) > 0 ||
      (p.social_risk_groups?.length || 0) > 0;
    const needsFluoro = inRiskGroup && p.tb_status !== 'archived';

    const STATUS_META = {
      risk:     { label: 'В групі ризику', bg: '#fed7aa', fg: '#9a3412' },
      detected: { label: 'Виявлений ТБ',   bg: '#fecaca', fg: '#991b1b' },
      cleared:  { label: 'Без ризику ТБ',  bg: '#d1fae5', fg: '#065f46' },
      archived: { label: 'Архівний',        bg: '#e2e8f0', fg: '#475569' },
    };
    const sm = STATUS_META[p.tb_status] || { label: p.tb_status || '—', bg: '#f1f5f9', fg: '#334155' };

    const flu = computeFluoroTile(p, needsFluoro);
    const adpm = computeAdpmTile(p);

    // Overall section tone — driven by the worst of (TB detected, flu,
    // АДП-М). Affects the section border / accent.
    let state = 'ok';
    if (p.tb_status === 'detected' || flu.tone === 'err' || adpm.tone === 'err') state = 'err';
    else if (adpm.tone === 'warn') state = 'warn';

    const lastSync = relativeLabel(p.last_indicators_synced_at);

    setSection(state, `
      <div class="tb-head">
        <span class="tb-status-pill" style="background:${sm.bg};color:${sm.fg};">${sm.label}</span>
        <span class="tb-head__spacer"></span>
        ${lastSync ? `<span class="tb-head__meta">${lastSync}</span>` : ''}
        <a class="tb-head__link" href="${STATE.config.url}/patients/${p.id}" target="_blank" title="Картка в реєстрі">↗</a>
      </div>
      <div class="tb-tiles">
        ${renderTile('Флюоро', flu)}
        ${renderTile('АДП-М', adpm)}
      </div>
    `);
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
      return renderExisting(res.patient, r.source, res.indicators ?? []);
    } catch (e) {
      console.error('[TB Module] apiGet:', e);
      return renderError(`Помилка запиту: ${e.message}`);
    }
  }

  // Serialize a single value for safe JSONB storage. Dates → ISO 'YYYY-MM-DD',
  // strings/numbers/booleans untouched, anything else (Sets, functions, undefined)
  // dropped. Recursively handles plain objects + arrays.
  function jsonSafe(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return !isNaN(v) ? toLocalIso(v) : null;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'function' || t === 'symbol') return null;
    if (Array.isArray(v)) return v.map(jsonSafe);
    if (t === 'object') {
      const out = {};
      for (const k of Object.keys(v)) {
        const safe = jsonSafe(v[k]);
        if (safe !== null || v[k] === null) out[k] = safe;
      }
      return out;
    }
    return null;
  }

  // Serialize one indicator-matcher result into the shape /api/extension-sync
  // expects. Pulls ALL fields from the action objects (including orGroupId,
  // isAlternative, value, etc) so the registry-side UI can reconstruct the
  // full МІС widget view — TODO grouping, OR-groups, tooltips, the lot.
  function serializeIndicator(r) {
    if (!r || !r.rule) return null;
    const isoDate = (d) => (d instanceof Date && !isNaN(d) ? toLocalIso(d) : null);
    // Total count: indicator-matcher already adjusts for OR-groups/conditional/
    // recommended referrals internally — we read those directly off the result.
    // For the cached count we use what the matcher logged in details when
    // available, otherwise approximate from requiredActions excluding
    // recommended referrals + conditional that weren't met.
    const nonRecommended = (r.requiredActions ?? []).filter((a) => !a.isRecommendedReferral);
    return {
      rule_id: r.rule.id,
      rule_name: r.rule.name ?? null,
      rule_category: r.rule.category ?? null,
      rule_type: r.rule.type ?? null,
      applicability_reason: r.applicabilityReason ?? null,
      state: r.status, // 'completed' | 'overdue' | 'partial' | 'not_done'
      is_overdue: !!r.isOverdue,
      completed_count: nonRecommended.filter((a) => a.isCompleted).length,
      total_count: nonRecommended.length,
      last_date: isoDate(r.lastDate),
      next_date: isoDate(r.nextDate),
      frequency_months: typeof r.rule.frequency === 'number' ? r.rule.frequency : null,
      // Pass through ALL action fields (jsonSafe handles Dates). Keeps
      // orGroupId, isAlternative, value, conditionalCodes, etc — anything
      // the matcher adds.
      required_actions: jsonSafe(r.requiredActions ?? []),
      details: Array.isArray(r.details) ? r.details : [],
    };
  }

  // Patient-wide raw collected data (observations, referrals, diagnostic
  // reports, episodes, encounter actions). Saved alongside indicators so
  // the registry-side UI can show actual lab values and resolved dates
  // (not just "completed: yes/no").
  function serializeAnalyzerSnapshot(collected) {
    const a = collected?.analyzer;
    if (!a) return null;
    return jsonSafe({
      observations: a.observations ?? {},
      referrals: a.referrals ?? {},
      diagnosticReports: a.diagnosticReports ?? {},
      episodes: a.episodes ?? {},
      encounterActions: a.encounterActions ?? {},
    });
  }

  async function doSync(manual, analyzedData, analyzedResults) {
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

    // Diagnoses → groups + codes + per-diagnosis detail (code, name, date).
    let diag = { groups: [], codes: [] };
    let diagnosesRaw = null; // [{code, name}]
    if (analyzedData?.patient?.diagnoses) {
      diag = diagnosesToGroups(analyzedData.patient.diagnoses);
      diagnosesRaw = analyzedData.patient.diagnoses;
    } else if (typeof MedicsParser !== 'undefined') {
      try {
        const p = new MedicsParser();
        const data = p.parseAll();
        if (data?.diagnoses) {
          diag = diagnosesToGroups(data.diagnoses);
          diagnosesRaw = data.diagnoses;
        }
      } catch (_) {}
    }

    // Build diagnoses_detail by joining parsed diagnoses with episode dates
    // (analyzer.episodes is keyed by code → { date: Date | null, … }).
    let diagnosesDetail = null;
    if (Array.isArray(diagnosesRaw)) {
      const episodes = analyzedData?.analyzer?.episodes ?? {};
      diagnosesDetail = diagnosesRaw.map((d) => {
        const code = typeof d === 'string' ? d : d.code;
        const name = typeof d === 'string' ? null : d.name ?? null;
        const ep = code ? episodes[code] : null;
        const isoDate = ep?.date instanceof Date ? toLocalIso(ep.date) : null;
        return { code, name, date: isoDate };
      }).filter((d) => d.code);
    }

    // R-ОГК last record + planned next.
    const fluoro = analyzedData ? extractLastFluoro(analyzedData) : null;

    // АДП-М from page — UI only for now, no backend storage yet.
    const adpm = analyzedData?.patient?.lastAdpM;
    STATE.lastAdpM = adpm?.date instanceof Date ? {
      date: toLocalIso(adpm.date),
      vaccine_name: adpm.vaccine_name || null,
    } : null;

    setSection('info', '<div>Синхронізуємо…</div>');
    // Age-based social group: 60+ auto-tagged on creation. (The server
    // /api/extension-sync only appends to medical_risk_groups, so we
    // attach a separate social_risk_groups field — server merges it too.)
    const autoSocial = [];
    const age = ageFromBirth(ctx.birth_date);
    if (age != null && age >= 60) autoSocial.push('elderly_60');

    const payload = {
      medics_id: medicsId,
      surname: ctx.surname,
      first_name: ctx.first_name,
      patronymic: ctx.patronymic,
      birth_date: ctx.birth_date,
      gender: ctx.gender,
      diagnoses_codes: diag.codes,
      medical_risk_groups: diag.groups,
      social_risk_groups: autoSocial,
    };
    if (diagnosesDetail) payload.diagnoses_detail = diagnosesDetail;
    if (fluoro) payload.fluoro = fluoro;

    // Indicator analysis snapshot — sending the array (even empty) makes
    // the server replace the patient's stored results. We send ONLY when
    // we actually have matcher output, so a sync triggered without an
    // analysis (e.g. just a manual ПІБ change) doesn't wipe history.
    if (Array.isArray(analyzedResults) && analyzedResults.length > 0) {
      payload.indicators = analyzedResults
        .map(serializeIndicator)
        .filter(Boolean);
      // Patient-wide raw analyzer data — observations, referrals, episodes
      // etc. Shared across all indicators for this patient; saved once on
      // patients.last_analysis_snapshot.
      const snap = serializeAnalyzerSnapshot(analyzedData);
      if (snap) payload.analysis_snapshot = snap;
    }

    // АДП-М: send the latest valid record (status 'Виконана') if parsed.
    // Backend dedupes on (patient_id + date).
    const adpmFull = analyzedData?.patient?.lastAdpM;
    if (adpmFull?.date instanceof Date) {
      payload.adpm = {
        date: toLocalIso(adpmFull.date),
        vaccine_name: adpmFull.vaccine_name || null,
        manufacturer: adpmFull.manufacturer || null,
        lot_number: adpmFull.lot_number || null,
        notes: adpmFull.reasons || null,
      };
    }

    console.log('[TB Module] sync payload:', payload);
    try {
      const result = await apiUpsert(payload);
      STATE.lastSyncedAt = Date.now();
      console.log('[TB Module] sync OK:', result);
      await refresh();
      // Signal for batch-runner — fires after the patient is fully synced.
      window.dispatchEvent(new CustomEvent('tb-sync-completed', {
        detail: { medics_id: medicsId, patient_id: result?.patient_id ?? null },
      }));
    } catch (e) {
      console.error('[TB Module] sync FAILED:', e);
      renderError(`Помилка синхронізації: ${e.message}`);
      window.dispatchEvent(new CustomEvent('tb-sync-failed', {
        detail: { medics_id: medicsId, error: e?.message ?? String(e) },
      }));
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
      hideOverlay();
      revealSection();
      try {
        doSync(false, collectedData, results).catch((e) => console.error('[TB Module] auto-sync:', e));
      } catch (e) {
        console.error('[TB Module] auto-sync error:', e);
      }
    };

    // Drop overlay if analyze raises an error (showError is their failure path).
    const origShowError = MedicsIndicatorUI.prototype.showError;
    if (typeof origShowError === 'function') {
      MedicsIndicatorUI.prototype.showError = function (msg) {
        hideOverlay();
        origShowError.call(this, msg);
      };
    }

    // Strip age tail from the name and inject inline gender picker into meta.
    // Also detect SPA navigation between patients (name changes) and trigger
    // a fresh auto-analyze.
    const origUpdateBanner = MedicsIndicatorUI.prototype.updatePatientBanner;
    if (typeof origUpdateBanner === 'function') {
      MedicsIndicatorUI.prototype.updatePatientBanner = function (info) {
        const data = info || (typeof this.getQuickPatientInfo === 'function' ? this.getQuickPatientInfo() : null);
        if (data && data.name) {
          data.name = data.name
            .replace(/[,;].*$/, '')
            .replace(/\s+\d+\s*(р\.?|років|років\.?)\s*$/iu, '')
            .replace(/\s+\d+\s*$/, '')
            .trim();
        }
        origUpdateBanner.call(this, data);
        decorateBannerMeta(data);

        // SPA navigation: name changed → new patient → re-analyze.
        const currentName = (data?.name || '').trim();
        if (
          currentName &&
          STATE.lastBannerName &&
          currentName !== STATE.lastBannerName &&
          !STATE.analyzing
        ) {
          STATE.currentMedicsId = null;
          STATE.analyzedOnce = false;
          STATE.lastAdpM = null;
          const sec = document.getElementById('tb-module-section');
          if (sec) sec.style.display = 'none';
          // Cover the screen instantly; startAutoAnalyze waits for DOM stable.
          showOverlay();
          setTimeout(() => startAutoAnalyze(), 100);
        }
        if (currentName) STATE.lastBannerName = currentName;
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

    // Only cover the screen up-front if auto-analyze is on. With auto off
    // the doctor opens the page like usual and clicks "Проаналізувати"
    // when ready.
    const ensureOverlayUpEarly = () => {
      if (!STATE.config.autoAnalyze) return;
      if (isPatientPage() && !document.getElementById('tb-auto-overlay') && !STATE.analyzing) {
        showOverlay();
      }
    };
    ensureOverlayUpEarly();

    const tryInit = () => {
      ensureOverlayUpEarly();
      if (!document.getElementById('mi-patient-banner')) return false;
      installAnalyzeHook();
      injectAutoToggle();
      STATE.booted = true;
      if (STATE.config.autoAnalyze) {
        // startAutoAnalyze itself waits for mi-analyze-btn + DOM stable.
        setTimeout(() => startAutoAnalyze(), 100);
      } else {
        // Show the TB section in "manual" state so the doctor can see status
        // and an in-place toggle for auto-analyze.
        revealSection();
        refresh();
      }
      return true;
    };
    if (tryInit()) return;
    const obs = new MutationObserver(() => { if (tryInit()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 60000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.tbModuleUrl || changes.tbModulePin || changes.tbManualMedics || changes.tbAutoAnalyze) {
      loadConfig().then((cfg) => { STATE.config = cfg; STATE.currentMedicsId = null; refresh(); });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 600));
  } else {
    setTimeout(boot, 600);
  }

  console.log('[TB Module] tb-module-sync.js loaded — build 2026-05-29 (diagnoses_detail)');
})();
