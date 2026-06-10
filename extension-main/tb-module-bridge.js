// ============================================================================
// TB-MODULE-BRIDGE.JS
//
// Content script injected on tb-module.vercel.app pages. Two jobs:
//
// 1. Forward `tb-sync-poke` from the page to the SW so the SW wakes up
//    immediately after the doctor creates a sync_job.
//
// 2. Hand the SW's stable device_id to the page so the doctor's click on
//    "Sync" can pin the new sync_jobs row to THIS device.
//
// Cross-world delivery: content scripts run in an ISOLATED world from the
// page. Direct `window.foo = bar` and CustomEvents stay inside the
// content-script world. Inline `<script>` tags would work but are
// blocked by the tb-module deploy's CSP. The remaining clean channel is
// `window.postMessage` — MessageEvents propagate across worlds because
// they go through DOM-level event dispatch and the page's window object
// is a shared event target.
//
// Protocol with the page-world React hook:
//   bridge → page: { source: 'tb-bridge', type: 'device-id-ready',
//                    device_id, device_label }
//   page  → bridge: { type: 'tb-bridge-request-device-id' }   (poll)
// The page sends a request on mount; if the bridge already has the value
// cached it broadcasts immediately. Bridge ALSO broadcasts unsolicited
// the first time it receives the value from the SW.
// ============================================================================

(() => {
  'use strict';

  console.log('[TB Bridge] tb-module bridge installed');

  window.addEventListener('tb-sync-poke', () => {
    try {
      chrome.runtime.sendMessage({ type: 'tb-sync-check' });
    } catch (_) { /* extension context invalidated; page reload re-injects */ }
  });

  let cached = null; // { device_id, device_label } | null

  function broadcast() {
    if (!cached) return;
    window.postMessage(
      { source: 'tb-bridge', type: 'device-id-ready', ...cached },
      '*',
    );
  }

  // Respond to page-world requests. Filter on e.source === window to
  // ignore messages from iframes / extensions / postMessage from elsewhere.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.source === 'tb-bridge') return; // don't echo our own
    if (e.data.type === 'tb-bridge-request-device-id') broadcast();
  });

  // Bridge → SW handshake. SW may be dormant on cold start; retry with
  // linear backoff so a slow wake doesn't strand the binding.
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
        cached = { device_id: resp.device_id, device_label: resp.device_label || null };
        broadcast(); // unsolicited initial publish
        console.log('[TB Bridge] device-id ready:', resp.device_id, resp.device_label);
      });
    } catch (e) {
      console.warn('[TB Bridge] sendMessage threw:', e?.message);
      if (attempts < 5) setTimeout(requestDeviceId, 400 * attempts);
    }
  }
  requestDeviceId();
})();
