// ============================================================================
// TB-MODULE-BRIDGE.JS
//
// Content script injected on tb-module.vercel.app pages. Two jobs:
//
// 1. Forward `tb-sync-poke` from the page to the SW so the SW wakes up
//    immediately after the doctor creates a sync_job instead of waiting
//    for the next chrome.alarms tick.
//
// 2. Hand the SW's stable device_id to the page so the doctor's click on
//    "Sync" can pin the new sync_jobs row to THIS device (otherwise the
//    nurse's laptop on the same Wi-Fi can claim the job).
//
// Important: content scripts run in an ISOLATED world from the page. A
// content script's `window.foo = 'bar'` is NOT visible to React. Same for
// CustomEvents dispatched against the content-script's window — they
// dispatch in the wrong context. To deliver values to the page we have
// to inject a <script> element into the DOM; the browser executes it in
// the MAIN/page world, so its globals + events reach React.
// ============================================================================

(() => {
  'use strict';

  console.log('[TB Bridge] tb-module bridge installed');

  window.addEventListener('tb-sync-poke', () => {
    try {
      chrome.runtime.sendMessage({ type: 'tb-sync-check' });
    } catch (_) { /* extension context invalidated; page reload re-injects */ }
  });

  // Inject a <script> tag into the page so the assignment + dispatch run
  // in the MAIN world. JSON.stringify is enough for our values (string,
  // pre-validated by SW) — but stripping `</script>` defensively keeps
  // the inline script from being closed early by hostile content.
  function injectIntoPage(deviceId, deviceLabel) {
    const safeId = JSON.stringify(deviceId).replace(/<\/script>/gi, '');
    const safeLabel = JSON.stringify(deviceLabel).replace(/<\/script>/gi, '');
    const script = document.createElement('script');
    script.textContent = `
      window.__tbDeviceId = ${safeId};
      window.__tbDeviceLabel = ${safeLabel};
      window.dispatchEvent(new CustomEvent('tb-device-id-ready', {
        detail: { device_id: ${safeId}, device_label: ${safeLabel} }
      }));
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // text already executed; element no longer needed
  }

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
        injectIntoPage(resp.device_id, resp.device_label || null);
        console.log('[TB Bridge] device-id ready:', resp.device_id, resp.device_label);
      });
    } catch (e) {
      console.warn('[TB Bridge] sendMessage threw:', e?.message);
      if (attempts < 5) setTimeout(requestDeviceId, 400 * attempts);
    }
  }
  requestDeviceId();
})();
