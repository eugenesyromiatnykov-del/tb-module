// ============================================================================
// BATCH-RUNNER.JS
// Прохід по списку medics_id, для кожного:
//   1) перейти на «Мої пацієнти» (/doctors/journal) якщо ми не там
//   2) ввести medics_id в пошук → дочекатись фільтрації
//   3) клік «Переглянути» (відкриває workplace_modal)
//   4) обрати радіо потрібної амбулаторії (Білогірська | Залузька)
//   5) клік «Підтвердити» → MIS робить SPA-нав на медкарту
//   6) існуючий tb-module-sync ловить SPA-зміну, запускає startAutoAnalyze
//   7) чекаємо подію `tb-sync-completed` (емітимо її з doSync)
//   8) повертаємось на /doctors/journal → наступний
//
// Стан зберігається в chrome.storage.local — після кожної навігації наш
// content-script стартує знову, читає стан і продовжує з того ж місця.
// ============================================================================

(() => {
  'use strict';

  const STORAGE_KEY = 'tb-batch';
  const JOURNAL_URL = 'https://medics.ua/doctors/journal';

  const SELECTORS = {
    searchInput: 'input[name="id"][ng-model="patients.filter.params.id"]',
    viewBtn: 'button[ng-click="workplace_modal.open(user)"]',
    workplaceModal: '.custom-modal.is-open',
    confirmBtn: 'button[ng-click="workplace_modal.select(workplace_modal.workplace)"]',
    medCardMounted: '#med-card-block',
  };

  // Текст у `.c-radio-media--title` — за ним матчимо радіо до location_id.
  const WORKPLACE_LABEL = {
    bilohirska: 'Білогірська',
    zaluzhe: 'Залузьк', // 'Залузька' / 'Залузьке' — підрядок
  };

  const TIMING = {
    afterSearchType: 1500,        // ng-change + filter debounce
    afterModalOpen: 800,          // workplace modal animation
    syncTimeoutMs: 90_000,        // per-patient timeout
    betweenPatientsMs: 5000,      // throttle MIS politely
    pollIntervalMs: 200,
  };

  // ─── State helpers ───────────────────────────────────────────────────────
  function readState() {
    return new Promise((r) =>
      chrome.storage.local.get([STORAGE_KEY], (v) => r(v[STORAGE_KEY] || null)),
    );
  }
  function writeState(s) {
    return new Promise((r) => chrome.storage.local.set({ [STORAGE_KEY]: s }, r));
  }
  function clearState() {
    return new Promise((r) => chrome.storage.local.remove([STORAGE_KEY], r));
  }
  function initialState() {
    return {
      status: 'idle',         // idle | running | paused | done | error
      queue: [],
      cursor: 0,
      failed: [],
      startedAt: null,
      lastUpdatedAt: null,
      location: null,
      onlyUnsynced: true,
    };
  }

  // ─── DOM helpers ─────────────────────────────────────────────────────────
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  async function waitFor(selectorOrFn, timeoutMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = typeof selectorOrFn === 'string'
        ? document.querySelector(selectorOrFn)
        : selectorOrFn();
      if (found) return found;
      await wait(TIMING.pollIntervalMs);
    }
    return null;
  }
  function setAngularInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isOnJournal() {
    return location.pathname.includes('/doctors/journal');
  }

  // ─── Network: fetch queue from our backend ───────────────────────────────
  async function fetchQueue(loc, onlyUnsynced) {
    const cfg = await new Promise((r) =>
      chrome.storage.sync.get(['tbModuleUrl', 'tbModulePin'], (v) =>
        r({ url: (v.tbModuleUrl || '').replace(/\/$/, ''), pin: v.tbModulePin || '' }),
      ),
    );
    if (!cfg.url || !cfg.pin) throw new Error('Модуль не налаштовано в опціях розширення');
    const params = new URLSearchParams({ mode: 'batch_queue', location: loc });
    if (onlyUnsynced) params.set('only_unsynced', '1');
    const r = await fetch(`${cfg.url}/api/patients?${params}`, {
      headers: { Authorization: `Bearer ${cfg.pin}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const json = await r.json();
    return Array.isArray(json.queue) ? json.queue : [];
  }

  // ─── Public control ─────────────────────────────────────────────────────
  async function start({ location: loc, onlyUnsynced = true }) {
    const existing = await readState();
    if (existing && existing.status === 'running') {
      throw new Error('Батч уже виконується');
    }
    const queue = await fetchQueue(loc, onlyUnsynced);
    if (queue.length === 0) throw new Error('Список пустий — нічого аналізувати');
    const s = {
      ...initialState(),
      status: 'running',
      queue,
      cursor: 0,
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      location: loc,
      onlyUnsynced,
    };
    await writeState(s);
    console.log('[TB Batch] starting:', queue.length, 'patients,', loc);
    if (!isOnJournal()) {
      location.assign(JOURNAL_URL);
      return s;
    }
    drive();
    return s;
  }
  async function pause() {
    const s = await readState();
    if (!s || s.status !== 'running') return;
    s.status = 'paused';
    s.lastUpdatedAt = Date.now();
    await writeState(s);
  }
  async function resume() {
    const s = await readState();
    if (!s || s.status !== 'paused') return;
    s.status = 'running';
    s.lastUpdatedAt = Date.now();
    await writeState(s);
    drive();
  }
  async function stop() {
    const s = await readState();
    if (!s) return;
    s.status = 'idle';
    s.lastUpdatedAt = Date.now();
    await writeState(s);
  }

  // ─── Driver loop: dispatches based on current URL ────────────────────────
  // We never increment cursor before the patient is confirmed synced.
  // Each navigation cuts off the in-memory promise; the next page load
  // calls drive() again via initOnLoad() and resumes.

  let driving = false;

  async function drive() {
    if (driving) return;
    driving = true;
    try {
      while (true) {
        const s = await readState();
        if (!s || s.status !== 'running') return;
        if (s.cursor >= s.queue.length) {
          await writeState({ ...s, status: 'done', lastUpdatedAt: Date.now() });
          console.log('[TB Batch] done. failed:', s.failed.length);
          notifyDoneOnce(s);
          return;
        }
        const item = s.queue[s.cursor];
        if (isOnJournal()) {
          await driveJournal(item);
          // After successful click on «Підтвердити», MIS navigates away
          // and this loop dies; next page-load resumes via initOnLoad.
          return;
        }
        // We're on a med-card (or some other patient sub-page).
        await driveMedCard(item);
        // After waitForSync, we explicitly navigate back to journal — same
        // story, this loop dies and resumes on the next page load.
        return;
      }
    } finally {
      driving = false;
    }
  }

  async function driveJournal(item) {
    console.log('[TB Batch] journal → searching for', item.medics_id, item.surname);
    try {
      const searchInput = await waitFor(SELECTORS.searchInput, 15_000);
      if (!searchInput) throw new Error('Пошук medics_id не знайдено');
      setAngularInputValue(searchInput, item.medics_id);
      await wait(TIMING.afterSearchType);

      const viewBtn = await waitFor(() => {
        const btns = document.querySelectorAll(SELECTORS.viewBtn);
        for (const b of btns) if (b.offsetParent !== null) return b;
        return null;
      }, 8_000);
      if (!viewBtn) throw new Error('Кнопка «Переглянути» не зʼявилася (пацієнта не знайдено?)');
      viewBtn.click();
      await wait(TIMING.afterModalOpen);

      const wantedLabel = WORKPLACE_LABEL[item.location_id];
      if (!wantedLabel) throw new Error(`Невідомий location_id: ${item.location_id}`);
      const modal = await waitFor(SELECTORS.workplaceModal, 5_000);
      if (!modal) throw new Error('Модалка вибору амбулаторії не зʼявилася');
      const radios = modal.querySelectorAll('.c-radio-media');
      let radioInput = null;
      for (const rm of radios) {
        const title = rm.querySelector('.c-radio-media--title');
        if (title && title.textContent.includes(wantedLabel)) {
          radioInput = rm.querySelector('input[type="radio"]');
          break;
        }
      }
      if (!radioInput) throw new Error(`Радіо «${wantedLabel}» не знайдено в модалці`);
      radioInput.click();
      await wait(300);

      const confirmBtn = modal.querySelector(SELECTORS.confirmBtn);
      if (!confirmBtn) throw new Error('Кнопка «Підтвердити» не знайдена');
      confirmBtn.click();
      // Now MIS navigates to the med-card; in-flight promise will be killed
      // by the unload. Don't await anything else here — next page load
      // resumes the driver, this time hitting driveMedCard().
    } catch (e) {
      console.warn('[TB Batch] driveJournal failed:', item.medics_id, e?.message);
      await recordFailureAndAdvance(item, e?.message ?? String(e));
      await wait(TIMING.betweenPatientsMs);
      // Stay on journal, kick the driver again to take the next patient.
      driving = false;
      drive();
    }
  }

  async function driveMedCard(item) {
    console.log('[TB Batch] med-card → waiting for sync of', item.medics_id);
    try {
      const evt = await waitForSyncCompleted(item.medics_id, TIMING.syncTimeoutMs);
      console.log('[TB Batch] sync OK:', evt);
      await advanceCursor();
    } catch (e) {
      console.warn('[TB Batch] driveMedCard failed:', item.medics_id, e?.message);
      await recordFailureAndAdvance(item, e?.message ?? String(e));
    }
    await wait(TIMING.betweenPatientsMs);
    location.assign(JOURNAL_URL);
  }

  function waitForSyncCompleted(expectedMedicsId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        window.removeEventListener('tb-sync-completed', onDone);
        window.removeEventListener('tb-sync-failed', onFail);
        reject(new Error(`Таймаут ${Math.round(timeoutMs / 1000)}с — sync не завершився`));
      }, timeoutMs);
      function onDone(e) {
        if (e.detail?.medics_id && String(e.detail.medics_id) !== String(expectedMedicsId)) return;
        clearTimeout(t);
        window.removeEventListener('tb-sync-completed', onDone);
        window.removeEventListener('tb-sync-failed', onFail);
        resolve(e.detail);
      }
      function onFail(e) {
        clearTimeout(t);
        window.removeEventListener('tb-sync-completed', onDone);
        window.removeEventListener('tb-sync-failed', onFail);
        reject(new Error(e.detail?.error ?? 'sync failed'));
      }
      window.addEventListener('tb-sync-completed', onDone);
      window.addEventListener('tb-sync-failed', onFail);
    });
  }

  async function advanceCursor() {
    const s = await readState();
    if (!s) return;
    s.cursor += 1;
    s.lastUpdatedAt = Date.now();
    await writeState(s);
  }
  async function recordFailureAndAdvance(item, reason) {
    const s = await readState();
    if (!s) return;
    s.failed.push({
      medics_id: item.medics_id,
      surname: item.surname,
      reason,
    });
    s.cursor += 1;
    s.lastUpdatedAt = Date.now();
    await writeState(s);
  }

  let didNotify = false;
  function notifyDoneOnce(s) {
    if (didNotify) return;
    didNotify = true;
    try {
      alert(
        `Пакетний аналіз завершено.\n` +
          `Оброблено: ${s.cursor}/${s.queue.length}\n` +
          `Помилки: ${s.failed.length}`,
      );
    } catch (_) { /* ignore */ }
  }

  // ─── Auto-resume on every page load ──────────────────────────────────────
  async function initOnLoad() {
    const s = await readState();
    if (!s || s.status !== 'running') return;
    console.log('[TB Batch] resuming at cursor', s.cursor, '/', s.queue.length);
    await wait(2500); // Angular bootstrap
    drive();
  }

  // ─── Public API ──────────────────────────────────────────────────────────
  window.TbBatchRunner = {
    start,
    pause,
    resume,
    stop,
    clearState,
    getState: readState,
  };

  initOnLoad();
  console.log('[TB Batch] batch-runner.js loaded');
})();
