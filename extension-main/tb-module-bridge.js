// ============================================================================
// TB-MODULE-BRIDGE.JS
//
// Tiny content script injected on tb-module.vercel.app pages. The web app
// can't talk to the extension service worker directly (no chrome.runtime in
// page world), so it dispatches plain `window` CustomEvents and we forward
// them to the SW.
//
// Carries two things today:
//   • `tb-sync-poke` — web app fires after a sync_job is created so the SW
//     opens /doctors/journal immediately instead of waiting up to 30 s for
//     the next chrome.alarms tick.
//   • device-id handshake — on bridge install we read the SW's stable
//     device_id from chrome.storage.local (via SW because page world can't
//     access extension storage), then push it onto the page as
//     `window.__tbDeviceId` plus a `tb-device-id-ready` event. The web app
//     then includes that id in {action:'start'} so the new sync_jobs row
//     is pinned to THIS device from the outset. Without this, on a shared
//     Wi-Fi the first extension to poll claims the job — meaning the
//     doctor's click on his laptop can drive the nurse's MIS profile.
// ============================================================================

(() => {
  'use strict';

  console.log('[TB Bridge] tb-module bridge installed');

  window.addEventListener('tb-sync-poke', () => {
    try {
      chrome.runtime.sendMessage({ type: 'tb-sync-check' });
    } catch (_) {
      // Extension context might be invalidated mid-update — page reload will
      // re-inject this script.
    }
  });

  // Fetch device_id from the SW and expose it to the page. The SW may be
  // dormant when the bridge loads (Chrome aggressively suspends MV3 service
  // workers after ~30s idle), in which case the first sendMessage races
  // with the SW spin-up. Retry a few times with backoff so a cold start
  // doesn't permanently strand the handshake.
  let attempts = 0;
  function requestDeviceId() {
    attempts += 1;
    try {
      chrome.runtime.sendMessage({ type: 'tb-device-id-request' }, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn('[TB Bridge] device-id sendMessage error:', chrome.runtime.lastError.message);
          if (attempts < 5) setTimeout(requestDeviceId, 400 * attempts);
          return;
        }
        if (!resp || !resp.device_id) {
          console.warn('[TB Bridge] device-id response empty', resp);
          if (attempts < 5) setTimeout(requestDeviceId, 400 * attempts);
          return;
        }
        window.__tbDeviceId = resp.device_id;
        window.__tbDeviceLabel = resp.device_label || null;
        window.dispatchEvent(
          new CustomEvent('tb-device-id-ready', {
            detail: {
              device_id: resp.device_id,
              device_label: resp.device_label || null,
            },
          }),
        );
        console.log('[TB Bridge] device-id ready:', resp.device_id, resp.device_label);
      });
    } catch (e) {
      console.warn('[TB Bridge] sendMessage threw:', e?.message);
      if (attempts < 5) setTimeout(requestDeviceId, 400 * attempts);
    }
  }
  requestDeviceId();
})();
