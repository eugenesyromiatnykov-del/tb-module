// ============================================================================
// TB-MODULE-BRIDGE.JS
//
// Tiny content script injected on tb-module.vercel.app pages. The web app
// can't talk to the extension service worker directly (no chrome.runtime in
// page world), so it dispatches plain `window` CustomEvents and we forward
// them to the SW.
//
// Today the bridge only carries `tb-sync-poke` — fired by the web app right
// after a sync_job is created so the SW opens /doctors/journal immediately
// instead of waiting up to 30 s for the next chrome.alarms tick.
// ============================================================================

(() => {
  'use strict';

  window.addEventListener('tb-sync-poke', () => {
    try {
      chrome.runtime.sendMessage({ type: 'tb-sync-check' });
    } catch (_) {
      // Extension context might be invalidated mid-update — page reload will
      // re-inject this script.
    }
  });

  console.log('[TB Bridge] tb-module bridge installed');
})();
