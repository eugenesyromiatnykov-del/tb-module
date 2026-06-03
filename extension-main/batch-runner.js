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
    afterSearchType: 800,         // was 1500 — Angular ng-change + filter usually finishes < 800ms
    afterModalOpen: 400,          // was 800
    syncTimeoutMs: 90_000,
    betweenPatientsMs: 1500,      // was 5000 — once sync event fires, no reason to linger
    pollIntervalMs: 4000,
    pollIntervalFastMs: 1000,
    medCardBootDelay: 600,        // was 1500 — widget mounts faster than that
    pageBootDelay: 1500,          // was 2500 in initOnLoad
  };

  // ─── Config / auth ───────────────────────────────────────────────────────
  function loadCfg() {
    return new Promise((r) =>
      chrome.storage.sync.get(['tbModuleUrl', 'tbModulePin'], (v) =>
        r({ url: (v.tbModuleUrl || '').replace(/\/$/, ''), pin: v.tbModulePin || '' }),
      ),
    );
  }

  // ─── Device identity ─────────────────────────────────────────────────────
  // Stable UUID generated once per browser profile, kept in chrome.storage.
  // Every sync_jobs heartbeat carries this so the server can CAS-lock the
  // job to whichever device claims it first — second laptop with the same
  // PIN sees the job is owned, idles instead of stomping the run.
  let DEVICE_ID = null;
  let DEVICE_LABEL = null;
  function guessDeviceLabel() {
    const ua = navigator.userAgent || '';
    let os = 'Browser';
    if (/Mac/i.test(ua)) os = 'Mac';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Linux/i.test(ua)) os = 'Linux';
    // Append a short suffix from the device-id so two Macs are
    // distinguishable in the /sync UI.
    return os;
  }
  async function ensureDeviceId() {
    if (DEVICE_ID) return DEVICE_ID;
    return new Promise((r) => {
      chrome.storage.local.get(['tb_device_id', 'tb_device_label'], (v) => {
        DEVICE_ID = v.tb_device_id || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
        DEVICE_LABEL = v.tb_device_label || guessDeviceLabel();
        const toSet = {};
        if (!v.tb_device_id) toSet.tb_device_id = DEVICE_ID;
        if (!v.tb_device_label) toSet.tb_device_label = DEVICE_LABEL;
        if (Object.keys(toSet).length) chrome.storage.local.set(toSet);
        r(DEVICE_ID);
      });
    });
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
    if (!r.ok) {
      const text = await r.text();
      const err = new Error(`HTTP ${r.status}: ${text}`);
      err.status = r.status;
      err.body = text;
      throw err;
    }
    return r.json();
  }
  function getActiveJob() {
    return api('/api/patients?mode=sync_job', { method: 'GET' }).then((j) => j.job ?? null);
  }
  async function heartbeat(jobId, patch) {
    await ensureDeviceId();
    try {
      return await api('/api/patients?mode=sync_job', {
        method: 'POST',
        body: JSON.stringify({
          action: 'heartbeat',
          job_id: jobId,
          device_id: DEVICE_ID,
          device_label: DEVICE_LABEL,
          ...patch,
        }),
      });
    } catch (e) {
      // 409 = either (a) another device owns the job, or (b) the job has
      // been stopped/cancelled while we were mid-cycle. Both → stand down
      // immediately; the next poll() sees the canonical state and idles.
      if (e?.status === 409) {
        let reason = 'rejected';
        try {
          const parsed = JSON.parse(e.body || '{}');
          reason = parsed.error || reason;
        } catch (_) {}
        console.warn('[TB Batch] heartbeat rejected:', reason);
        const e2 = new Error(reason);
        e2.handover = true;
        throw e2;
      }
      throw e;
    }
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
    // STRICT match: the list page is exactly /doctors/journal (optional
    // trailing slash). Anything under it (e.g. /doctors/journal/12345 —
    // the per-patient med-card URL MIS routes to from the workplace
    // modal) is NOT journal. Before v5.6.4 this used .includes(),
    // which made every freshly opened med-card briefly look like a
    // journal in the window between content-script load and Angular
    // mounting #med-card-block — currentTabRole() pinned the tab to
    // 'journal', driveJournal clicked confirm in MIS, MIS spawned
    // another med-card, that one repeated the same race, and tabs
    // multiplied recursively.
    return /^\/doctors\/journal\/?$/.test(location.pathname);
  }
  function isOnMedCard() {
    return !!document.querySelector(SELECTORS.medCardMounted)
      && !!document.querySelector('.c-patient-info-card--user-name');
  }

  // Sticky tab role. Once we detect this tab is a med-card we never
  // demote — MIS's Angular re-renders briefly remove .c-patient-info-card
  // mid-analysis (episode expand/collapse triggers ng-if churn). Without
  // sticky, isOnMedCard() flapped → driveOneCycle off-route branch fired
  // → location.assign(JOURNAL_URL) turned the medcard tab into a journal
  // mid-analysis. That was the doctor's "после 10 секунд скрипт
  // переключает фокус со страницы пациента на /journal" bug.
  let stickyTabRole = null; // 'journal' | 'medcard' | null
  function currentTabRole() {
    if (stickyTabRole === 'medcard') return 'medcard';
    if (isOnMedCard()) {
      stickyTabRole = 'medcard';
      return 'medcard';
    }
    if (isOnJournal()) {
      if (stickyTabRole !== 'journal') stickyTabRole = 'journal';
      return 'journal';
    }
    return null;
  }

  // ─── Driver state (in-memory, ephemeral) ─────────────────────────────────
  let driving = false;
  let lastSeenJobId = null;
  let lastCursor = -1;
  // Tab-local guards. Each medics.ua tab has its own JS context, so these
  // identify "what THIS tab is responsible for".
  //   • journalDispatchedCursor — last cursor this journal tab handed off
  //     to MIS (= clicked Підтвердити for). Prevents the same tab from
  //     dispatching the same patient twice when SW pokes hammer poll().
  //   • myMedCardMedicsId — the patient this med-card tab was opened for.
  //     If SW pokes a stale med-card tab after its work is done and the
  //     cursor has advanced, we'd otherwise drive a 90-s sync wait for the
  //     WRONG patient, then heartbeat cursor+1 → real patient gets skipped.
  let journalDispatchedCursor = -1;
  let myMedCardMedicsId = null;

  // Watchdog: if the journal tab sees the SAME (jobId, cursor) for too many
  // polls without anything happening — modal stuck, AJAX hung, MIS quirk —
  // force-reload the page to reset state. The cycle then resumes from the
  // server-side cursor without losing position.
  const WATCHDOG_STALE_THRESHOLD_MS = 45_000;
  let stallSinceCursor = -1;
  let stallSinceTime = 0;

  // No-op stub — used to be a top-right diagnostic overlay (v4.1.9–4.4.0).
  // Doctor confirmed sync is stable; kept the function as a no-op so the
  // existing call sites don't have to be rewritten. Reinstate by replacing
  // the body with the old DOM-injection code if we ever need diagnostics
  // again.
  function setBanner(_text, _tone) { /* no-op */ }

  // ─── Tab keep-alive: defeat Chrome's background-tab throttling ──────────
  // When the doctor switches away from the medics.ua tab Chrome aggressively
  // throttles setTimeout (and may suspend execution entirely after 5 min in
  // background). Two-pronged defence:
  //   1. Play a silent looped <audio> — Chrome exempts "playing media" tabs
  //      from throttling. Autoplay policy may block this initially; if it
  //      does the SW kick (below) still keeps us going at a slower pace.
  //   2. Listen for `tb-poke-poll` messages from the service-worker alarm.
  //      Even fully-throttled background tabs still receive runtime messages
  //      promptly, so the SW becomes our external heartbeat.
  let keepAliveAudio = null;
  function startKeepAlive() {
    if (keepAliveAudio) return;
    try {
      const a = document.createElement('audio');
      // 1s of 8kHz PCM zeroes — valid WAV header, no audible content.
      a.src = 'data:audio/wav;base64,UklGRkAAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      a.loop = true;
      a.style.display = 'none';
      document.documentElement.appendChild(a);
      const p = a.play();
      if (p && p.catch) {
        p.catch((e) => console.warn('[TB Batch] keep-alive audio blocked (autoplay):', e?.message));
      }
      keepAliveAudio = a;
    } catch (e) {
      console.warn('[TB Batch] keep-alive audio init failed:', e?.message);
    }
  }
  function stopKeepAlive() {
    if (!keepAliveAudio) return;
    try { keepAliveAudio.pause(); keepAliveAudio.remove(); } catch (_) {}
    keepAliveAudio = null;
  }

  // SW poke channel — fires poll() on demand, ignoring whatever throttled
  // setTimeout was due to fire. Two listening paths because Chrome's tab
  // freeze can drop runtime messages while still delivering DOM events:
  //   1. chrome.runtime message (`tb-poke-poll`) — works in most states
  //   2. window CustomEvent (`tb-batch-wake`) dispatched by SW via
  //      chrome.scripting.executeScript with world: 'MAIN' — bypasses
  //      runtime-channel throttling, works on frozen pages.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'tb-poke-poll') {
        console.log('[TB Batch] SW poke (message) received, polling now');
        poll();
      }
    });
  } catch (_) { /* not in extension context */ }
  window.addEventListener('tb-batch-wake', () => {
    console.log('[TB Batch] SW poke (event) received, polling now');
    poll();
  });

  const DISPATCH_LOCK_KEY = 'tb-batch-dispatched';
  const DISPATCH_LOCK_TTL_MS = 60_000; // give the medcard tab a minute to sync; stale lock recovers fast

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
      setBanner(`poll failed: ${e?.message ?? e}`, 'err');
      schedule(TIMING.pollIntervalMs);
      return;
    }

    if (!job || (job.status !== 'running' && job.status !== 'queued')) {
      lastSeenJobId = null;
      stopKeepAlive();
      setBanner(`idle — no active job\nstatus: ${job?.status ?? 'null'}`);
      schedule(TIMING.pollIntervalMs);
      return;
    }

    // Device-ownership gate with staleness override. Stand down only if
    // the existing owner is actively heart-beating. If their last
    // heartbeat is > 5 min old we treat the lock as orphaned and start
    // driving — the heartbeat CAS on the server has the same threshold,
    // so whichever device sends one first becomes the new owner.
    await ensureDeviceId();
    if (job.owner_device_id && job.owner_device_id !== DEVICE_ID) {
      const OWNER_STALE_MS = 5 * 60 * 1000;
      const lastBeat = job.last_heartbeat_at
        ? new Date(job.last_heartbeat_at).getTime()
        : 0;
      const isStale = Date.now() - lastBeat > OWNER_STALE_MS;
      if (!isStale) {
        stopKeepAlive();
        setBanner(`idle — sync owned by other device\n(${job.owner_device_label || job.owner_device_id.slice(0, 8)})`);
        schedule(TIMING.pollIntervalMs);
        return;
      }
      console.log('[TB Batch] owner stale, taking over');
    }

    // If queued, first heartbeat will flip it to running.
    const ourJob = job;
    if (ourJob.id !== lastSeenJobId) {
      console.log('[TB Batch] new active job:', ourJob.id, `cursor=${ourJob.cursor}/${ourJob.queue.length}`);
      lastSeenJobId = ourJob.id;
      lastCursor = -1;
      startKeepAlive();
    }
    setBanner(`job ${ourJob.id.slice(0, 8)}…\ncursor ${ourJob.cursor}/${ourJob.queue.length} · status ${ourJob.status}\non ${isOnJournal() ? 'journal' : isOnMedCard() ? 'med-card' : 'other'} · driving ${driving}`);

    if (ourJob.cursor >= ourJob.queue.length) {
      console.log('[TB Batch] queue exhausted, completing');
      try { await completeJob(ourJob.id, ourJob.cursor, ourJob.failed); } catch (_) {}
      // Tell SW to close the journal tab and refocus the tb-module tab.
      // Especially important for ad-hoc 1-patient runs (clicked from the
      // freshness pill) — the doctor stays on /patients and shouldn't have
      // to manually clean up the medics.ua tab afterwards.
      try {
        chrome.runtime.sendMessage({
          type: 'tb-job-complete',
          job_id: ourJob.id,
          adhoc: ourJob.scope === 'subset' && ourJob.queue.length === 1,
        });
      } catch (_) {}
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

    const role = currentTabRole();

    if (role === 'journal') {
      // Read the cross-tab dispatch lock once, up front: the watchdog
      // needs to know "is a medcard alive right now?" so it doesn't kick
      // the journal out from under an in-flight analysis. A fresh lock
      // means we already dispatched and a medcard is processing — even
      // if cursor hasn't advanced in a long time (3 min analyses are
      // normal). Only when the lock is missing / stale should we treat
      // the journal as truly stuck.
      const lock = await readDispatchLock();
      const lockFresh = !!(lock && lock.job_id === job.id
        && lock.cursor === job.cursor
        && Date.now() - lock.at < DISPATCH_LOCK_TTL_MS);

      // Watchdog
      if (stallSinceCursor !== job.cursor) {
        stallSinceCursor = job.cursor;
        stallSinceTime = Date.now();
      } else if (!lockFresh && stallSinceTime
          && Date.now() - stallSinceTime > WATCHDOG_STALE_THRESHOLD_MS) {
        console.warn('[TB Batch] watchdog: cursor stuck for', Math.round((Date.now() - stallSinceTime) / 1000), 's, no fresh dispatch — reloading journal');
        await clearDispatchLock();
        stallSinceTime = 0;
        location.reload();
        return;
      }

      // Active med-card: stand down for this poll.
      if (lockFresh) {
        console.log('[TB Batch] dispatch lock active (', Math.round((Date.now() - lock.at) / 1000), 's), waiting');
        return;
      }
      if (lock) await clearDispatchLock(); // stale lock — purge
      // Reset stall tracker since we're about to do work.
      stallSinceCursor = job.cursor;
      stallSinceTime = Date.now();
      await driveJournal(job, item);
      return;
    }
    if (role === 'medcard') {
      await driveMedCard(job, item);
      return;
    }
    // role is null — either Angular hasn't mounted med-card yet, or we
    // landed on some unrelated MIS page (login, settings, …).
    //
    // Do NOT auto-navigate to journal here. The old fallback
    // (location.assign(JOURNAL_URL)) turned freshly opened med-card tabs
    // — whose Angular was still mid-render — into journal tabs, which
    // then dispatched another patient, which spawned another med-card,
    // which again raced its Angular mount, and so on. That's how the
    // browser ended up with hundreds of tabs after a 30-min run.
    //
    // Quiet wait is correct: the next poll runs in 1 s, by which time
    // Angular will have mounted #med-card-block on a real med-card and
    // sticky role pins it. On a truly unrelated page we just sit idle —
    // no harm done, the doctor can close the tab manually.
  }

  async function driveJournal(job, item) {
    // Per-tab dispatch guard. Multiple SW pokes in quick succession could
    // otherwise have this tab re-run search→confirm for the SAME cursor
    // while the previous med-card is still being processed (cross-tab lock
    // window can race during the click→navigation gap).
    if (journalDispatchedCursor === job.cursor) {
      console.log('[TB Batch] this journal tab already dispatched cursor', job.cursor, '— waiting');
      return;
    }
    console.log('[TB Batch] journal → searching', item.medics_id, item.surname);
    setBanner(`journal → searching\n${item.medics_id} ${item.surname ?? ''}\ncursor ${job.cursor}/${job.queue.length}`);
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

      // Wait up to 3 s for «Переглянути». If the medics_id doesn't exist
      // in MIS (deleted patient, typo, wrong workplace), filter returns
      // an empty list and viewBtn never appears — there's no point
      // waiting 8 s + reloading. Reload retry remains only as a safety
      // net for transient MIS hiccups, and is gated by `dirtyState` so
      // we don't reload when the page is clearly empty rather than mid-
      // loading.
      const viewBtn = await waitFor(() => {
        const btns = document.querySelectorAll(SELECTORS.viewBtn);
        for (const b of btns) if (b.offsetParent !== null) return b;
        return null;
      }, 3_000);
      if (!viewBtn) {
        // If the filter has clearly settled into an empty result set (no
        // viewBtn anywhere on the page, not just hidden), the patient
        // isn't findable in journal — fail this row fast, don't reload.
        const anyHiddenBtn = document.querySelector(SELECTORS.viewBtn);
        const looksEmpty = !anyHiddenBtn;
        if (looksEmpty) {
          throw new Error(`Пацієнта з ID ${item.medics_id} не знайдено в журналі MIS`);
        }
        // Some viewBtn exists in the DOM but isn't visible — that's the
        // "modal still up / mid-AJAX" case the reload retry was built for.
        const reloadKey = `tb-journal-reload-${item.medics_id}`;
        const prev = sessionStorage.getItem(reloadKey);
        if (!prev) {
          console.warn('[TB Batch] viewBtn hidden — reloading /doctors/journal once');
          sessionStorage.setItem(reloadKey, '1');
          location.assign(JOURNAL_URL);
          await wait(1500);
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
      // Mark THIS tab as having dispatched this cursor BEFORE writing the
      // cross-tab lock or clicking — so any racing poll() in this same tab
      // sees the guard and bails immediately.
      journalDispatchedCursor = job.cursor;
      await writeDispatchLock({ job_id: job.id, cursor: job.cursor, at: Date.now() });
      confirmBtn.click();
    } catch (e) {
      console.warn('[TB Batch] journal step failed:', e?.message);
      setBanner(`journal failed: ${e?.message ?? e}\nadvancing cursor and continuing`, 'err');
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
    // Stale-tab guard. Each med-card tab MUST process exactly one patient
    // (the one whose Confirm click opened it). After we finish + heartbeat
    // cursor+1, SW pokes still arrive at this tab until it closes. Those
    // pokes carry the NEW cursor's item → without this guard we'd start a
    // 90-s sync wait for the wrong patient on a page that's about to die,
    // then heartbeat cursor+1 again → REAL patient skipped silently.
    if (myMedCardMedicsId === null) {
      myMedCardMedicsId = item.medics_id;
    } else if (String(myMedCardMedicsId) !== String(item.medics_id)) {
      console.log('[TB Batch] stale med-card tab (mine:', myMedCardMedicsId, '; current cursor:', item.medics_id, ') — ignoring poke');
      setBanner(`stale tab — mine ${myMedCardMedicsId}\ncursor advanced to ${item.medics_id}\n(closing soon)`, 'warn');
      return;
    }
    // Don't re-process if the cursor has already moved on (e.g. heartbeat
    // landed and a fresh poll picked up the next patient before we acted).
    if (lastCursor === job.cursor) return;
    lastCursor = job.cursor;

    console.log('[TB Batch] med-card → waiting for sync of', item.medics_id);
    setBanner(`med-card → analyzing\n${item.medics_id} ${item.surname ?? ''}\ncursor ${job.cursor}/${job.queue.length}`);

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
        setBanner('med-card: analyze button not found', 'err');
      }
    }, TIMING.medCardBootDelay);

    // Refresh the cross-tab dispatch lock while we analyze. Analysis on
    // a complex patient runs 2–3 minutes — well past DISPATCH_LOCK_TTL_MS
    // (60 s). Without this the journal tab sees the lock as stale, clears
    // it, and re-dispatches the same cursor — duplicate medcards stack
    // up until we eventually heartbeat cursor+1. Refresh every 30 s keeps
    // the lock fresh for as long as this medcard is alive; if the tab
    // crashes the refresh stops and the lock genuinely goes stale at TTL.
    const lockRefresh = setInterval(() => {
      writeDispatchLock({ job_id: job.id, cursor: job.cursor, at: Date.now() })
        .catch(() => {});
    }, 30_000);

    let failedReason = null;
    try {
      await waitForSyncCompleted(item.medics_id, TIMING.syncTimeoutMs);
      console.log('[TB Batch] sync OK', item.medics_id);
      setBanner(`sync OK ${item.medics_id}\nclosing tab in ${TIMING.betweenPatientsMs / 1000}s`, 'ok');
    } catch (e) {
      failedReason = e?.message ?? String(e);
      console.warn('[TB Batch] sync failed:', failedReason);
      setBanner(`sync failed: ${failedReason}`, 'err');
    } finally {
      clearInterval(lockRefresh);
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

    // This tab is a batch worker (myMedCardMedicsId was set at the top of
    // driveMedCard — that's how we got here). Always close. The old
    // window.opener / referrer check fell back to location.assign(JOURNAL_URL)
    // when MIS used a noopener-style window.open, turning the medcard into
    // a second journal tab; over a 1000-patient overnight run that
    // accumulated 100+ stale journal tabs in the browser. The journal tab
    // the SW controls is alive elsewhere — we don't need to "return" to it.
    console.log('[TB Batch] closing batch-worker med-card tab');
    try { chrome.runtime.sendMessage({ type: 'tb-close-tab' }); } catch (_) {}
    setTimeout(() => { try { window.close(); } catch (_) {} }, 1000);
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
  setTimeout(poll, TIMING.pageBootDelay);
  console.log('[TB Batch] batch-runner.js loaded (backend-driven, build 2026-06-03 fast)');
})();
