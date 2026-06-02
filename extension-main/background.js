// ============================================================================
// BACKGROUND.JS (manifest v3 service worker)
//
// Periodically polls our backend for an active sync_job. If one exists and
// there's no medics.ua tab in any window, opens
// https://medics.ua/doctors/journal in a background tab — then the content
// script (batch-runner.js) picks it up and starts driving.
//
// Service workers in MV3 are short-lived; chrome.alarms wakes us back up
// every ~30 seconds so polling survives the SW being put to sleep.
// ============================================================================

const POLL_ALARM = 'tb-sync-poll';
const POLL_PERIOD_MIN = 0.5; // 30 seconds (Chrome's minimum for unpacked is 30s)
const JOURNAL_URL = 'https://medics.ua/doctors/journal';

function ensureAlarm() {
  chrome.alarms.get(POLL_ALARM, (existing) => {
    if (existing) return;
    chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[TB SW] installed');
  ensureAlarm();
  checkAndEnsureTab().catch((e) => console.warn('[TB SW] initial check failed', e));
});
chrome.runtime.onStartup.addListener(() => {
  console.log('[TB SW] startup');
  ensureAlarm();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  checkAndEnsureTab().catch((e) => console.warn('[TB SW] poll failed', e));
});

// Allow the options page / content script to trigger an immediate check
// (e.g. right after the doctor presses Запустити on /sync — content script
// can fire chrome.runtime.sendMessage({type: 'tb-sync-check'}) to skip the
// alarm wait).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'tb-sync-check') {
    checkAndEnsureTab().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e?.message }));
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
    return j.job ?? null;
  } catch (e) {
    console.warn('[TB SW] getActiveJob failed', e);
    return null;
  }
}

async function checkAndEnsureTab() {
  const job = await getActiveJob();
  if (!job) return;
  if (job.status !== 'running' && job.status !== 'queued') return;

  // Any medics.ua tab is enough — the content script polls there.
  const tabs = await chrome.tabs.query({ url: 'https://medics.ua/*' });
  if (tabs.length === 0) {
    console.log(`[TB SW] active job ${job.id}: opening journal in background tab`);
    const tab = await chrome.tabs.create({ url: JOURNAL_URL, active: false });
    // Once the tab finishes loading, wake it up immediately rather than
    // waiting for the next 30 s alarm — otherwise it might already be
    // throttled by then.
    if (tab.id != null) {
      const onUpdated = (id, info) => {
        if (id !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        // Tiny delay so document_idle content scripts finish loading first.
        setTimeout(() => wakeTab(tab.id), 1500);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    }
    return;
  }
  console.log(`[TB SW] active job ${job.id}: medics.ua tab already open (${tabs.length}), poking content scripts`);
  for (const t of tabs) {
    if (t.id != null) wakeTab(t.id);
  }
}

// Background tabs get aggressively throttled — setTimeout in the content
// script may stall, and chrome.tabs.sendMessage isn't always delivered when
// the page is in the "frozen" lifecycle state. chrome.scripting.executeScript
// reliably runs code in any tab regardless of throttling state, so we use it
// as the primary wake mechanism, with sendMessage as a fallback.
async function wakeTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        // Dispatch a custom event the content script listens for. Runs in
        // the page's own world so the dispatch reaches isolated-world
        // listeners via the event loop.
        window.dispatchEvent(new CustomEvent('tb-batch-wake'));
      },
    });
  } catch (e) {
    // Fallback to message channel.
    try { await chrome.tabs.sendMessage(tabId, { type: 'tb-poke-poll' }); } catch (_) {}
    console.warn('[TB SW] executeScript wake failed, fell back to sendMessage:', e?.message);
  }
}
