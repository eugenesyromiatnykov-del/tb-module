// ============================================================================
// BACKGROUND.JS (manifest v3 service worker)
//
// Periodically polls our backend for an active sync_job. If one exists and
// there's no medics.ua tab in any window, opens
// https://medics.ua/doctors/journal in a foreground tab — then the content
// script (batch-runner.js) picks it up and starts driving.
//
// We don't fight Chrome's auto-activate behavior anymore. MIS opens each
// med-card via window.open() which makes it the active tab; we let that
// happen. The doctor leaves the machine running overnight; everything
// stays in the foreground so MIS analyzer isn't throttled.
//
// Service workers in MV3 are short-lived; chrome.alarms wakes us back up
// every ~30 seconds so polling survives the SW being put to sleep.
// ============================================================================

const POLL_ALARM = 'tb-sync-poll';
const POLL_PERIOD_MIN = 0.5; // 30 seconds (Chrome's minimum for unpacked is 30s)
const JOURNAL_URL = 'https://medics.ua/doctors/journal';

// Server flags accounts that can't launch sync (can_run_sync = false) by
// returning { sync_disabled: true } on the sync_job GET. Caching that
// verdict for 1 h lets us skip the 30-s alarm entirely for those doctors
// — otherwise the SW pays full bcrypt auth twice a minute for nothing.
const SYNC_DISABLED_KEY = 'tb_sync_disabled_until';
const SYNC_DISABLED_TTL_MS = 60 * 60_000;
function readSyncDisabledUntil() {
  return new Promise((r) =>
    chrome.storage.local.get([SYNC_DISABLED_KEY], (v) => r(v[SYNC_DISABLED_KEY] || 0)),
  );
}
function markSyncDisabled() {
  return new Promise((r) =>
    chrome.storage.local.set({ [SYNC_DISABLED_KEY]: Date.now() + SYNC_DISABLED_TTL_MS }, r),
  );
}
function clearSyncDisabled() {
  return new Promise((r) => chrome.storage.local.remove([SYNC_DISABLED_KEY], r));
}

function ensureAlarm() {
  chrome.alarms.get(POLL_ALARM, (existing) => {
    if (existing) return;
    chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[TB SW] installed');
  ensureAlarm();
  checkAndEnsureTab(true).catch((e) => console.warn('[TB SW] initial check failed', e));
});
chrome.runtime.onStartup.addListener(() => {
  console.log('[TB SW] startup');
  ensureAlarm();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  checkAndEnsureTab(false).catch((e) => console.warn('[TB SW] poll failed', e));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'tb-sync-check') {
    // force=true → bypass sync_disabled cache. Web app sends this on
    // login (auth state changed) and after action='start', so a
    // freshly-enabled doctor wakes us instantly without waiting for
    // the 1-h TTL.
    checkAndEnsureTab(true).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e?.message }));
    return true; // async response
  }
  if (msg && msg.type === 'tb-close-tab') {
    const tabId = sender?.tab?.id;
    if (tabId != null) {
      console.log('[TB SW] closing tab', tabId, 'by request from content script');
      chrome.tabs.remove(tabId).catch((e) => console.warn('[TB SW] close failed', e));
    }
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'tb-job-complete') {
    // Job's queue is exhausted. Close all medics.ua/doctors/journal tabs
    // (the batch-runner doesn't have a tabs API), then bring focus back
    // to a tb-module tab so the doctor can keep working there.
    console.log('[TB SW] job complete, cleaning up tabs');
    finishJobCleanup(msg.adhoc === true).catch((e) =>
      console.warn('[TB SW] cleanup failed', e),
    );
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'tb-device-id-request') {
    // The web-app bridge asks for our device_id so the doctor's click on
    // "Sync" can pin the new sync_jobs row to THIS device. Without this,
    // when several browsers on the same Wi-Fi (e.g. doctor + nurse) are
    // both logged into the TB module and both have the extension, the
    // first one to poll wins the CAS — meaning the wrong laptop drives
    // medics.ua under the wrong MIS profile.
    //
    // Generate-on-demand: previously this returned null if the user had
    // never opened medics.ua yet (batch-runner generates lazily there).
    // Returning null leaked the click into the legacy first-to-poll race.
    // Now we mirror batch-runner's ensureDeviceId() so the SW alone can
    // produce a stable id — both sites read/write the SAME storage keys.
    chrome.storage.local.get(['tb_device_id', 'tb_device_label'], (v) => {
      let id = v.tb_device_id;
      let label = v.tb_device_label;
      const toSet = {};
      if (!id) {
        id = (self.crypto && self.crypto.randomUUID)
          ? self.crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
        toSet.tb_device_id = id;
      }
      if (!label) {
        // We can't read navigator.userAgent reliably in SW context,
        // so just stamp 'Browser' here — batch-runner will refine to
        // 'Mac' / 'Windows' / 'Linux' on its first run on medics.ua
        // and overwrite this key.
        label = 'Browser';
        toSet.tb_device_label = label;
      }
      if (Object.keys(toSet).length > 0) {
        chrome.storage.local.set(toSet);
      }
      sendResponse({ device_id: id, device_label: label });
    });
    return true; // async response
  }
  return false;
});

async function loadCfg() {
  return new Promise((r) =>
    chrome.storage.sync.get(['tbModuleUrl', 'tbModulePin'], (v) =>
      r({ url: (v.tbModuleUrl || '').replace(/\/$/, ''), pin: v.tbModulePin || '' }),
    ),
  );
}

async function getActiveJob() {
  const cfg = await loadCfg();
  if (!cfg.url || !cfg.pin) return null;
  try {
    const r = await fetch(`${cfg.url}/api/patients?mode=sync_job`, {
      headers: { Authorization: `Bearer ${cfg.pin}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.sync_disabled === true) {
      await markSyncDisabled();
    } else if (j && j.sync_disabled === false) {
      await clearSyncDisabled();
    }
    return j.job ?? null;
  } catch (e) {
    console.warn('[TB SW] getActiveJob failed', e);
    return null;
  }
}

async function getMyDeviceId() {
  return new Promise((r) => {
    chrome.storage.local.get(['tb_device_id'], (v) => r(v.tb_device_id || null));
  });
}

async function checkAndEnsureTab(force) {
  // Alarm-fired polls (force=false) honor the sync_disabled cache so
  // we stop hammering the endpoint when the doctor's account can't
  // sync. Message-driven calls (force=true) bypass: they're triggered
  // by an explicit user action and need to cut through stale cache.
  if (!force) {
    const disabledUntil = await readSyncDisabledUntil();
    if (disabledUntil && disabledUntil > Date.now()) return;
  }
  const job = await getActiveJob();
  if (!job) return;
  if (job.status !== 'running' && job.status !== 'queued') return;
  // Device-ownership gate with staleness override. If the existing
  // owner hasn't heartbeat in OWNER_STALE_MS we consider the lock
  // orphaned (laptop disconnected, extension reloaded with new
  // device_id, etc) and any device can take over.
  if (job.owner_device_id) {
    const myId = await getMyDeviceId();
    if (myId && job.owner_device_id !== myId) {
      const OWNER_STALE_MS = 5 * 60 * 1000;
      const lastBeat = job.last_heartbeat_at
        ? new Date(job.last_heartbeat_at).getTime()
        : 0;
      const isStale = Date.now() - lastBeat > OWNER_STALE_MS;
      if (!isStale) {
        console.log('[TB SW] active job belongs to another device (fresh), standing down');
        return;
      }
      console.log('[TB SW] active job owner is stale — taking over');
    }
  }

  // Prefer an existing /doctors/journal tab — wake it. We DO NOT
  // chrome.tabs.update({active:true}) here anymore: the alarm fires every
  // 30 s, and each fire was yanking the doctor away from whichever
  // med-card they were watching analyze. Wake-via-executeScript runs the
  // poll() in the journal tab without touching focus.
  const journalTabs = await chrome.tabs.query({ url: 'https://medics.ua/doctors/journal*' });
  if (journalTabs.length > 0) {
    const t = journalTabs[0];
    if (t.id != null) {
      console.log(`[TB SW] active job ${job.id}: poking existing journal tab ${t.id}`);
      wakeTab(t.id);
    }
    // Also poke any other medics.ua tabs (stale medcards from prior runs);
    // their tab-local guards (myMedCardMedicsId) will keep them quiet.
    const allMedics = await chrome.tabs.query({ url: 'https://medics.ua/*' });
    for (const other of allMedics) {
      if (other.id != null && other.id !== t.id) wakeTab(other.id);
    }
    return;
  }

  // No journal tab → open one. Foreground so the doctor sees it land.
  console.log(`[TB SW] active job ${job.id}: opening journal tab`);
  const tab = await chrome.tabs.create({ url: JOURNAL_URL, active: true });
  if (tab.id != null) {
    const onUpdated = (id, info) => {
      if (id !== tab.id || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      setTimeout(() => wakeTab(tab.id), 1500);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  }
}

// Job-complete cleanup. Always closes any /doctors/journal tab so it
// doesn't linger; for ad-hoc 1-patient runs we also try to restore focus
// to a tb-module tab (the doctor clicked the freshness pill there and
// expects to land back where they started).
async function finishJobCleanup(isAdhoc) {
  try {
    const journalTabs = await chrome.tabs.query({
      url: 'https://medics.ua/doctors/journal*',
    });
    for (const t of journalTabs) {
      if (t.id != null) {
        try { await chrome.tabs.remove(t.id); } catch (_) {}
      }
    }
  } catch (e) { console.warn('[TB SW] journal close failed:', e?.message); }

  if (isAdhoc) {
    try {
      const tbTabs = await chrome.tabs.query({
        url: ['https://tb-module.vercel.app/*', 'http://localhost/*'],
      });
      // Prefer a tab in the user's last focused window, else first match.
      const focusedWin = await chrome.windows.getLastFocused().catch(() => null);
      const pick =
        (focusedWin && tbTabs.find((t) => t.windowId === focusedWin.id)) ||
        tbTabs[0];
      if (pick?.id != null) {
        await chrome.tabs.update(pick.id, { active: true });
        if (pick.windowId != null) {
          await chrome.windows.update(pick.windowId, { focused: true });
        }
      }
    } catch (e) {
      console.warn('[TB SW] focus restore failed:', e?.message);
    }
  }
}

// SW wake mechanism — runtime messages can be dropped on frozen pages, so
// we dispatch a CustomEvent into the page's MAIN world; the content script
// has a window listener that picks it up.
async function wakeTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => { window.dispatchEvent(new CustomEvent('tb-batch-wake')); },
    });
  } catch (e) {
    try { await chrome.tabs.sendMessage(tabId, { type: 'tb-poke-poll' }); } catch (_) {}
    console.warn('[TB SW] executeScript wake failed, fell back to sendMessage:', e?.message);
  }
}
