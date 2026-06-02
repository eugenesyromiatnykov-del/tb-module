// ============================================================================
// BATCH-RUNNER.JS
// Worker для пакетного аналізу. Не має власного UI — керується через
// TB-module веб-додаток (сторінка /sync). Опитує наш бекенд, бачить активний
// sync_job → веде MIS DOM по його чергу, heart-beat'ить прогрес.
//
// Цикл (state machine driven by URL + job.status):
//   poll → бачимо job.status === 'running' →
//     ├─ якщо не на /doctors/journal і не на медкарті → idle, чекаємо
//     ├─ якщо на /doctors/journal → ввести medics_id, клік «Переглянути»,
//     │   обрати амбулаторію, клік «Підтвердити» → MIS навігує на медкарту
//     └─ якщо на медкарті → дочекатись `tb-sync-completed` (емітить
//        tb-module-sync.js після успішного syncing) → POST heartbeat
//        cursor+1 → assign /doctors/journal → наступний
//
// Стан НЕ зберігається локально — джерело правди це таблиця sync_jobs.
// ============================================================================

(() => {
  'use strict';

  const JOURNAL_URL = 'https://medics.ua/doctors/journal';

  const SELECTORS = {
    searchInput: 'input[name="id"][ng-model="patients.filter.params.id"]',
    viewBtn: 'button[ng-click="workplace_modal.open(user)"]',
    workplaceModal: '.custom-modal.is-open',
    confirmBtn: 'button[ng-click="workplace_modal.select(workplace_modal.workplace)"]',
    medCardMounted: '#med-card-block',
  };

  const WORKPLACE_LABEL = {
    bilohirska: 'Білогірська',
    zaluzhe: 'Залузьк',
  };

  const TIMING = {
    afterSearchType: 1500,
    afterModalOpen: 800,
    syncTimeoutMs: 90_000,
    betweenPatientsMs: 5000,
    pollIntervalMs: 4000,
    pollIntervalFastMs: 1000,
  };

  // ─── Config / auth ───────────────────────────────────────────────────────
  function loadCfg() {
    return new Promise((r) =>
      chrome.storage.sync.get(['tbModuleUrl', 'tbModulePin'], (v) =>
        r({ url: (v.tbModuleUrl || '').replace(/\/$/, ''), pin: v.tbModulePin || '' }),
      ),
    );
  }
  async function api(path, init) {
    const cfg = await loadCfg();
    if (!cfg.url || !cfg.pin) throw new Error('Модуль не налаштовано');
    const r = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.pin}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  }
  function getActiveJob() {
    return api('/api/patients?mode=sync_job', { method: 'GET' }).then((j) => j.job ?? null);
  }
  function heartbeat(jobId, patch) {
    return api('/api/patients?mode=sync_job', {
      method: 'POST',
      body: JSON.stringify({ action: 'heartbeat', job_id: jobId, ...patch }),
    });
  }
  function completeJob(jobId, cursor, failed) {
    return api('/api/patients?mode=sync_job', {
      method: 'POST',
      body: JSON.stringify({ action: 'complete', job_id: jobId, cursor, failed }),
    });
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
      await wait(200);
    }
    return null;
  }
  function setAngularInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Workplace modal cleanup. MIS sometimes leaves the modal open on the
  // /doctors/journal tab after «Підтвердити» — by the next iteration it's
  // sitting on top of everything and blocks viewBtn clicks. Three escalating
  // fallbacks so we never get stuck on this:
  //   1. Click the X close button (works most of the time)
  //   2. Reach into AngularJS scope and call workplace_modal.close() directly
  //   3. Strip the is-open class AND set display:none inline
  async function dismissAnyOpenModal() {
    let open = document.querySelector(SELECTORS.workplaceModal);
    if (!open) return;
    console.log('[TB Batch] dismissing leftover workplace modal');

    const closeBtn = open.querySelector('button[ng-click="workplace_modal.close()"]');
    if (closeBtn) {
      closeBtn.click();
      await wait(500);
    }
    if (!document.querySelector(SELECTORS.workplaceModal)) return;

    // Fallback: AngularJS scope.workplace_modal.close() + $apply.
    try {
      const ng = window.angular;
      if (ng && open) {
        const scope = ng.element(open).scope();
        if (scope?.workplace_modal?.close) {
          console.log('[TB Batch] closing modal via AngularJS scope');
          scope.workplace_modal.close();
          scope.$applyAsync ? scope.$applyAsync() : scope.$apply();
          await wait(500);
        }
      }
    } catch (e) {
      console.warn('[TB Batch] scope close failed', e?.message);
    }
    if (!document.querySelector(SELECTORS.workplaceModal)) return;

    // Last resort: nuke from DOM perspective.
    console.warn('[TB Batch] modal still up — force-stripping');
    const stuck = document.querySelector('.custom-modal');
    if (stuck) {
      stuck.classList.remove('is-open');
      stuck.style.display = 'none';
    }
    await wait(200);
  }

  // AngularJS radios bind via ng-model + ng-value. Native .click() flips the
  // DOM `checked` flag but the AngularJS digest sometimes misses it (no
  // synthetic 'change' event), so workplace_modal.workplace stays undefined
  // and «Підтвердити» becomes a no-op. Click the LABEL — it's what Angular's
  // own ng-click bindings expect — and dispatch click+change for good measure.
  function selectAngularRadio(input) {
    let dispatched = false;
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.click();
        dispatched = true;
      }
    }
    if (!dispatched) input.click();
    // Belt-and-suspenders for AngularJS digest:
    input.checked = true;
    input.dispatchEvent(new Event('click', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function isOnJournal() {
    return location.pathname.includes('/doctors/journal');
  }
  function isOnMedCard() {
    return !!document.querySelector(SELECTORS.medCardMounted)
      && !!document.querySelector('.c-patient-info-card--user-name');
  }

  // ─── Driver state (in-memory, ephemeral) ─────────────────────────────────
  let driving = false;
  let lastSeenJobId = null;
  let lastCursor = -1;

  const DISPATCH_LOCK_KEY = 'tb-batch-dispatched';
  const DISPATCH_LOCK_TTL_MS = 120_000; // give the medcard tab time to sync

  function readDispatchLock() {
    return new Promise((r) =>
      chrome.storage.local.get([DISPATCH_LOCK_KEY], (v) => r(v[DISPATCH_LOCK_KEY] || null)),
    );
  }
  function writeDispatchLock(d) {
    return new Promise((r) => chrome.storage.local.set({ [DISPATCH_LOCK_KEY]: d }, r));
  }
  function clearDispatchLock() {
    return new Promise((r) => chrome.storage.local.remove([DISPATCH_LOCK_KEY], r));
  }

  // ─── Main poll loop ─────────────────────────────────────────────────────
  async function poll() {
    let job;
    try {
      job = await getActiveJob();
    } catch (e) {
      console.warn('[TB Batch] poll failed:', e?.message);
      schedule(TIMING.pollIntervalMs);
      return;
    }

    if (!job || (job.status !== 'running' && job.status !== 'queued')) {
      lastSeenJobId = null;
      schedule(TIMING.pollIntervalMs);
      return;
    }

    // If queued, first heartbeat will flip it to running.
    const ourJob = job;
    if (ourJob.id !== lastSeenJobId) {
      console.log('[TB Batch] new active job:', ourJob.id, `cursor=${ourJob.cursor}/${ourJob.queue.length}`);
      lastSeenJobId = ourJob.id;
      lastCursor = -1;
    }

    if (ourJob.cursor >= ourJob.queue.length) {
      console.log('[TB Batch] queue exhausted, completing');
      try { await completeJob(ourJob.id, ourJob.cursor, ourJob.failed); } catch (_) {}
      schedule(TIMING.pollIntervalMs);
      return;
    }

    if (driving) {
      schedule(TIMING.pollIntervalFastMs);
      return;
    }
    driving = true;
    try {
      await driveOneCycle(ourJob);
    } catch (e) {
      console.error('[TB Batch] cycle error:', e);
    } finally {
      driving = false;
    }
    schedule(TIMING.pollIntervalFastMs);
  }

  let scheduled = null;
  function schedule(ms) {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(poll, ms);
  }

  async function driveOneCycle(job) {
    const item = job.queue[job.cursor];
    if (!item || !item.medics_id) {
      // Bad row — record failure, advance.
      await heartbeat(job.id, {
        cursor: job.cursor + 1,
        failed: [...(job.failed || []), {
          medics_id: item?.medics_id ?? null,
          surname: item?.surname ?? null,
          reason: 'Порожній medics_id у черзі',
        }],
        current_medics_id: null,
      });
      return;
    }

    if (isOnJournal()) {
      // Cross-tab dispatch lock: when this (or any other) journal tab clicked
      // «Підтвердити» recently, MIS spawned a med-card tab and is syncing.
      // Don't re-dispatch from here until the cursor moves on or the lock
      // expires — otherwise we double-open the same patient.
      const lock = await readDispatchLock();
      if (lock && lock.job_id === job.id && lock.cursor === job.cursor &&
          Date.now() - lock.at < DISPATCH_LOCK_TTL_MS) {
        console.log('[TB Batch] dispatch lock active (', Math.round((Date.now() - lock.at) / 1000), 's), waiting');
        return;
      }
      if (lock) await clearDispatchLock(); // stale lock — purge
      await driveJournal(job, item);
      return;
    }
    if (isOnMedCard()) {
      await driveMedCard(job, item);
      return;
    }
    // Not on a useful page — try to go to journal once.
    if (location.host === 'medics.ua') {
      console.log('[TB Batch] off-route, navigating to journal');
      location.assign(JOURNAL_URL);
    }
  }

  async function driveJournal(job, item) {
    console.log('[TB Batch] journal → searching', item.medics_id, item.surname);
    // Heartbeat — tell web UI "we picked it up, doing now".
    try {
      await heartbeat(job.id, {
        cursor: job.cursor,
        failed: job.failed,
        current_medics_id: item.medics_id,
      });
    } catch (_) {}

    // Clean up any leftover workplace modal from the previous patient.
    // After «Підтвердити» MIS sometimes leaves the modal open on the
    // original tab for a beat (or longer), which blocks our next pass —
    // viewBtn for the next patient gets hidden behind it, search filter
    // ng-change might be ignored, etc. Force it shut first.
    await dismissAnyOpenModal();

    try {
      const searchInput = await waitFor(SELECTORS.searchInput, 15_000);
      if (!searchInput) throw new Error('Пошук medics_id не знайдено');
      // Clear first, then set — defensively, in case Angular's ng-change
      // debouncer ate the previous patient's filter call mid-flight.
      setAngularInputValue(searchInput, '');
      await wait(200);
      setAngularInputValue(searchInput, item.medics_id);
      await wait(TIMING.afterSearchType);

      const viewBtn = await waitFor(() => {
        const btns = document.querySelectorAll(SELECTORS.viewBtn);
        for (const b of btns) if (b.offsetParent !== null) return b;
        return null;
      }, 8_000);
      if (!viewBtn) {
        // Likely journal is in a bad state (stale filter list, modal still
        // hiding it, AJAX hiccup). Reload the page — next page-load resumes
        // the driver from the same cursor and tries again fresh.
        const reloadKey = `tb-journal-reload-${item.medics_id}`;
        const prev = sessionStorage.getItem(reloadKey);
        if (!prev) {
          console.warn('[TB Batch] viewBtn missing — reloading /doctors/journal once');
          sessionStorage.setItem(reloadKey, '1');
          location.assign(JOURNAL_URL);
          await wait(3000); // let nav fire before falling through
          return;
        }
        sessionStorage.removeItem(reloadKey);
        throw new Error('Кнопка «Переглянути» не зʼявилася навіть після reload');
      }
      viewBtn.click();
      await wait(TIMING.afterModalOpen);

      const wantedLabel = WORKPLACE_LABEL[item.location_id];
      if (!wantedLabel) throw new Error(`Невідомий location_id: ${item.location_id}`);
      const modal = await waitFor(SELECTORS.workplaceModal, 5_000);
      if (!modal) throw new Error('Модалка вибору амбулаторії не зʼявилася');
      let radioInput = null;
      for (const rm of modal.querySelectorAll('.c-radio-media')) {
        const title = rm.querySelector('.c-radio-media--title');
        if (title && title.textContent.includes(wantedLabel)) {
          radioInput = rm.querySelector('input[type="radio"]');
          break;
        }
      }
      if (!radioInput) throw new Error(`Радіо «${wantedLabel}» не знайдено`);
      selectAngularRadio(radioInput);
      await wait(500);

      const confirmBtn = modal.querySelector(SELECTORS.confirmBtn);
      if (!confirmBtn) throw new Error('Кнопка «Підтвердити» не знайдена');
      // Set dispatch lock BEFORE click — once MIS navigates, this script dies
      // and a fresh batch-runner on the new med-card tab takes over.
      await writeDispatchLock({ job_id: job.id, cursor: job.cursor, at: Date.now() });
      confirmBtn.click();
    } catch (e) {
      console.warn('[TB Batch] journal step failed:', e?.message);
      await heartbeat(job.id, {
        cursor: job.cursor + 1,
        failed: [...job.failed, {
          medics_id: item.medics_id,
          surname: item.surname,
          reason: e?.message ?? String(e),
        }],
        current_medics_id: null,
      });
      await wait(TIMING.betweenPatientsMs);
    }
  }

  async function driveMedCard(job, item) {
    // Don't re-process if the cursor has already moved on (e.g. heartbeat
    // landed and a fresh poll picked up the next patient before we acted).
    if (lastCursor === job.cursor) return;
    lastCursor = job.cursor;

    console.log('[TB Batch] med-card → waiting for sync of', item.medics_id);

    // Force-click the Medics Indicators analyze button. The widget's own
    // auto-analyze is gated by the «АВТО» toggle — we don't care about that
    // here, batch always wants to analyze. Wait a moment for the widget to
    // mount, then click.
    setTimeout(async () => {
      const btn = await waitFor('#mi-analyze-btn', 10_000);
      if (btn && !btn.disabled) {
        console.log('[TB Batch] med-card: clicking analyze');
        btn.click();
      } else {
        console.warn('[TB Batch] med-card: analyze button not found or disabled');
      }
    }, 1500);

    let failedReason = null;
    try {
      await waitForSyncCompleted(item.medics_id, TIMING.syncTimeoutMs);
      console.log('[TB Batch] sync OK', item.medics_id);
    } catch (e) {
      failedReason = e?.message ?? String(e);
      console.warn('[TB Batch] sync failed:', failedReason);
    }

    const newFailed = failedReason
      ? [...job.failed, { medics_id: item.medics_id, surname: item.surname, reason: failedReason }]
      : job.failed;
    try {
      await heartbeat(job.id, {
        cursor: job.cursor + 1,
        failed: newFailed,
        current_medics_id: null,
      });
    } catch (_) {}
    // Cursor moved on — clear the dispatch lock so the next journal-tab poll
    // can dispatch the next patient.
    await clearDispatchLock();

    await wait(TIMING.betweenPatientsMs);

    // If we were spawned by MIS in a new tab (target=_blank from the Confirm
    // button), close ourselves so tabs don't pile up. Otherwise just navigate
    // back to journal — the original tab is still around.
    if (window.opener || document.referrer.includes('medics.ua')) {
      console.log('[TB Batch] closing spawned med-card tab');
      try { chrome.runtime.sendMessage({ type: 'tb-close-tab' }); } catch (_) {}
      // As a fallback if message + remove fails:
      setTimeout(() => { try { window.close(); } catch (_) {} }, 1000);
    } else {
      location.assign(JOURNAL_URL);
    }
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

  // ─── Boot ────────────────────────────────────────────────────────────────
  // Slightly delay so Angular bootstraps + analyzer hook installs first.
  setTimeout(poll, 2500);
  console.log('[TB Batch] batch-runner.js loaded (backend-driven, build 2026-06-02)');
})();
