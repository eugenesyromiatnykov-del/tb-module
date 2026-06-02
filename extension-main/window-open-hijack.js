// ============================================================================
// WINDOW-OPEN-HIJACK.JS  (MAIN world, document_start)
//
// Pre-empt Chrome's auto-activate behavior for new tabs.
//
// When MIS handles «Підтвердити» it opens the med-card with window.open()
// (and/or a synthetic click on <a target="_blank">). Either way Chrome
// makes the new tab the active one — yanking focus away from whatever the
// doctor is doing AND bringing Chrome's window to the foreground (so even
// VSCode loses focus). Our tabs.onActivated snap-back fires AFTER the fact,
// so there's always a flash of focus theft per patient.
//
// Solution: override window.open and capture-phase intercept anchor clicks
// BEFORE MIS uses them. Forward the would-be-opened URL to our content
// script via postMessage, which forwards it to the SW, which opens the
// new tab with chrome.tabs.create({active: false}) — no auto-activate.
//
// Also spoof document.visibilityState so MIS's own "hidden tab? slow down"
// logic doesn't kick in. Doesn't disable Chrome's underlying throttling,
// but apps that gate background work on the Page Visibility API benefit.
// ============================================================================

(() => {
  'use strict';

  const origOpen = window.open;
  window.open = function (url, target, features) {
    // Leave non-MIS URLs alone — Google login, external links, etc.
    if (url && typeof url === 'string' && url.includes('medics.ua')) {
      window.postMessage({ source: 'tb-bg-open', url }, '*');
      // Dummy window-like return so MIS callers that touch .focus() or
      // .location.href don't crash.
      return {
        focus() {}, blur() {}, close() {}, closed: false,
        location: { href: url, assign() {}, replace() {} },
        document: { write() {}, close() {} },
        postMessage() {},
      };
    }
    return origOpen.call(this, url, target, features);
  };

  // Capture-phase anchor interception for MIS variants that dispatch a
  // synthetic click on <a target="_blank"> instead of calling window.open.
  document.addEventListener('click', function (e) {
    const a = e.target && e.target.closest && e.target.closest('a');
    if (!a || !a.href) return;
    if (a.target !== '_blank') return;
    if (!a.href.includes('medics.ua')) return;
    e.preventDefault();
    e.stopPropagation();
    window.postMessage({ source: 'tb-bg-open', url: a.href }, '*');
  }, true);

  // Visibility spoof. Some MIS code (and AngularJS digest under throttling)
  // gates work on document.hidden / visibilityState. Tell them we're always
  // visible so they keep grinding even when the tab is in the background.
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  } catch (_) { /* already defined elsewhere */ }
  // Swallow visibilitychange events too, so listeners that pause work
  // when the tab "loses focus" never get notified.
  window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);

  console.log('[TB] window.open hijack installed (v4.3.0)');
})();
