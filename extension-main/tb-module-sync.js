// ============================================================================
// TB-MODULE-SYNC.JS
// Бридж між Medics Indicators та модулем ТБ.
//   • Показує бейдж "📋 Модуль ТБ" у patient-banner з поточним статусом
//   • Авто-синхронізація: monkey-patch на displayResults → після кожного
//     "Аналізувати" дані пацієнта (ПІБ, ДН, стать, ICPC-2 діагнози →
//     medical_risk_groups) відправляються в TB-модуль
//   • Ручна синхронізація через кнопку у бейджі
//   • Конфіг (URL модуля + PIN) — в chrome.storage.sync, options-page
//
// Файл завантажується останнім у content_scripts списку manifest.json,
// після ui.js (де визначений MedicsIndicatorUI) і parser.js.
// ============================================================================

(() => {
  'use strict';

  const STATE = {
    config: null,        // { url, pin }
    currentMedicsId: null,
    statusEl: null,
    lastSyncedAt: null,
    booted: false,
  };

  // ── Config ────────────────────────────────────────────────────────────
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

  // ── ICPC-2 → medical_risk_groups mapping ──────────────────────────────
  // Mirrors src/lib/risk-groups.ts on the web side.
  const ICPC_TO_GROUP = {
    // ВІЛ
    'B90': 'hiv',
    // Цукровий діабет
    'T89': 'diabetes', 'T90': 'diabetes',
    // Онкологія
    'A79': 'oncology', 'B72': 'oncology', 'B74': 'oncology',
    'D74': 'oncology', 'D75': 'oncology', 'D76': 'oncology', 'D77': 'oncology', 'D78': 'oncology',
    'R84': 'oncology', 'R85': 'oncology',
    'U75': 'oncology', 'U76': 'oncology', 'U77': 'oncology',
    // Хронічні респіраторні
    'R95': 'chronic_respiratory', 'R96': 'chronic_respiratory',
    // Пневмонія в анамнезі
    'R81': 'pneumonia_history',
    // Виразкова хвороба
    'D85': 'peptic_ulcer', 'D86': 'peptic_ulcer',
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

  // ── DOM extraction (reuses helpers from helpers.js when available) ────
  function extractMedicsId() {
    // Try URL patterns.
    try {
      const url = new URL(location.href);
      const fromQuery = url.searchParams.get('id')
        || url.searchParams.get('patient_id')
        || url.searchParams.get('medics_id');
      if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
    } catch (_) {}

    const m = location.pathname.match(/\/(?:patient|patients)\/(\d+)/i);
    if (m) return m[1];

    // Data attributes on common containers.
    const attr = document.querySelector('[data-patient-id], [data-medics-id]');
    if (attr) {
      const v = attr.getAttribute('data-patient-id') || attr.getAttribute('data-medics-id');
      if (v) return v;
    }

    // Label-based fallback inside the patient card.
    if (typeof findElementByText === 'function') {
      const lbl = findElementByText('Medics ID');
      if (lbl) {
        const sib = lbl.nextElementSibling || lbl.parentElement?.nextElementSibling;
        const txt = (sib?.textContent || '').trim();
        const mm = txt.match(/(\d{4,})/);
        if (mm) return mm[1];
      }
    }
    return null;
  }

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
    // Reuses helpers.js findElementByText + parseDate if loaded.
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
    if (!np) return null;
    return { ...np, birth_date: parseBirthDateIso(), gender: getGender() };
  }

  // ── API calls ─────────────────────────────────────────────────────────
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

  // ── Badge UI inside the indicators widget banner ──────────────────────
  function ensureBadge() {
    if (STATE.statusEl && document.body.contains(STATE.statusEl)) return STATE.statusEl;
    const banner = document.getElementById('mi-patient-banner');
    if (!banner) return null;

    const badge = document.createElement('div');
    badge.id = 'tb-module-badge';
    badge.innerHTML = `
      <span class="tb-icon" style="font-size:14px;">📋</span>
      <span class="tb-text" style="flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Модуль ТБ: завантаження…</span>
      <a class="tb-link" style="display:none; color:#1d4ed8; text-decoration:none; font-size:11px; white-space:nowrap;" target="_blank">картка ↗</a>
      <button class="tb-sync-btn" type="button" style="background:#2563eb; color:#fff; border:0; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer; white-space:nowrap;">Синхронізувати</button>
    `;
    badge.style.cssText = `
      margin-top: 6px; padding: 6px 10px; border-radius: 8px;
      background: #f1f5f9; color: #334155; font-size: 12px;
      display: flex; align-items: center; gap: 8px;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    `;
    banner.appendChild(badge);
    STATE.statusEl = badge;

    badge.querySelector('.tb-sync-btn').addEventListener('click', () => {
      doSync(true).catch(console.error);
    });
    return badge;
  }

  function setBadge(text, opts = {}) {
    const badge = ensureBadge();
    if (!badge) return;
    badge.style.background = opts.bg || '#f1f5f9';
    badge.style.color = opts.fg || '#334155';
    const t = badge.querySelector('.tb-text');
    if (t) t.textContent = text;
    const a = badge.querySelector('.tb-link');
    if (a) {
      if (opts.cardUrl) {
        a.href = opts.cardUrl;
        a.style.display = '';
      } else {
        a.style.display = 'none';
      }
    }
  }

  function formatDate(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
  }

  function statusLabel(s) {
    return ({
      risk: 'на ризику',
      detected: 'виявлений',
      contact: 'контактний',
      cleared: 'знятий з обліку',
      external: 'не декларант',
      archived: 'архівний',
    })[s] || s;
  }

  function overdueLabel(p) {
    if (!p.next_planned_date) return '';
    const m = p.next_planned_date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const next = new Date(+m[1], +m[2] - 1, +m[3]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    next.setHours(0, 0, 0, 0);
    const days = Math.round((today - next) / 86400000);
    if (days > 0) return ` · просрочено ${days} дн.`;
    if (days >= -7) return ` · через ${-days} дн.`;
    return '';
  }

  // ── Main flow ─────────────────────────────────────────────────────────
  async function refreshBadge() {
    if (!isConfigured()) {
      setBadge('Модуль ТБ: не налаштовано (відкрийте опції розширення)', { fg: '#92400e', bg: '#fef3c7' });
      return;
    }
    const medicsId = extractMedicsId();
    if (!medicsId) {
      setBadge('Модуль ТБ: Medics ID не знайдено на сторінці', { fg: '#92400e', bg: '#fef3c7' });
      return;
    }
    STATE.currentMedicsId = medicsId;
    try {
      const r = await apiGet(medicsId);
      if (!r.found) {
        setBadge(`Модуль ТБ: пацієнта немає в реєстрі (натисніть "Синхронізувати")`, {
          fg: '#0c4a6e',
          bg: '#cffafe',
        });
      } else {
        const p = r.patient;
        const last = p.last_fluoro_date ? `флюоро ${formatDate(p.last_fluoro_date)}` : 'без флюоро';
        const next = overdueLabel(p);
        setBadge(`Модуль ТБ: ${statusLabel(p.tb_status)} · ${last}${next}`, {
          fg: '#065f46',
          bg: '#d1fae5',
          cardUrl: `${STATE.config.url}/patients/${p.id}`,
        });
      }
    } catch (e) {
      setBadge(`Модуль ТБ: ${e.message}`, { fg: '#991b1b', bg: '#fee2e2' });
    }
  }

  async function doSync(manual, analyzedData) {
    if (!isConfigured()) {
      setBadge('Модуль ТБ: не налаштовано (відкрийте опції)', { fg: '#92400e', bg: '#fef3c7' });
      return;
    }
    const medicsId = extractMedicsId();
    if (!medicsId) {
      setBadge('Модуль ТБ: Medics ID не знайдено', { fg: '#991b1b', bg: '#fee2e2' });
      return;
    }
    const ctx = extractContext();
    if (!ctx || !ctx.surname || !ctx.first_name) {
      setBadge('Модуль ТБ: не зчитано ПІБ', { fg: '#991b1b', bg: '#fee2e2' });
      return;
    }

    // Take diagnoses from the analyzer's collectedData if present (most
    // accurate — sections were expanded). Fallback: parse current DOM.
    let diagPayload = { groups: [], codes: [] };
    if (analyzedData && analyzedData.patient && Array.isArray(analyzedData.patient.diagnoses)) {
      diagPayload = diagnosesToGroups(analyzedData.patient.diagnoses);
    } else if (typeof MedicsParser !== 'undefined') {
      try {
        const parser = new MedicsParser();
        const data = parser.parseAll();
        if (data && Array.isArray(data.diagnoses)) {
          diagPayload = diagnosesToGroups(data.diagnoses);
        }
      } catch (_) {}
    }

    setBadge('Модуль ТБ: синхронізація…', { fg: '#0c4a6e', bg: '#cffafe' });
    const payload = {
      medics_id: medicsId,
      surname: ctx.surname,
      first_name: ctx.first_name,
      patronymic: ctx.patronymic,
      birth_date: ctx.birth_date,  // server requires for new patients only
      gender: ctx.gender,
      diagnoses_codes: diagPayload.codes,
      medical_risk_groups: diagPayload.groups,
    };
    try {
      await apiUpsert(payload);
      STATE.lastSyncedAt = Date.now();
      console.log(`[TB Module] synced ${medicsId} (groups: ${diagPayload.groups.join(',') || '—'})`);
      await refreshBadge();
    } catch (e) {
      setBadge(`Модуль ТБ: ${e.message}`, { fg: '#991b1b', bg: '#fee2e2' });
      console.error('[TB Module] sync failed:', e);
    }
  }

  // ── Hook displayResults so auto-sync runs after every Analyze ─────────
  function installAnalyzeHook() {
    if (typeof MedicsIndicatorUI === 'undefined' || !MedicsIndicatorUI.prototype) return false;
    if (MedicsIndicatorUI.prototype.__tbModulePatched) return true;
    const orig = MedicsIndicatorUI.prototype.displayResults;
    if (typeof orig !== 'function') return false;

    MedicsIndicatorUI.prototype.displayResults = function (results, collectedData) {
      orig.call(this, results, collectedData);
      // After-render — non-blocking background sync.
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

  // ── Boot ──────────────────────────────────────────────────────────────
  async function boot() {
    if (STATE.booted) return;
    STATE.config = await loadConfig();

    const tryInit = () => {
      if (!document.getElementById('mi-patient-banner')) return false;
      installAnalyzeHook();
      refreshBadge();
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

  // React to config changes (saved in options page).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.tbModuleUrl || changes.tbModulePin) {
      loadConfig().then((cfg) => {
        STATE.config = cfg;
        refreshBadge();
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
