import { useEffect, useState } from 'react';

// The Chrome extension's tb-module-bridge content script reads a stable
// device_id from chrome.storage.local (via the SW) and pushes it onto
// `window.__tbDeviceId` plus a `tb-device-id-ready` CustomEvent.
//
// This hook surfaces that to React. Three layers because the bridge and
// React mount race in either order, and we discovered the worst case
// where bridge dispatches the event in the narrow window between React's
// initial render (useState ran with globals empty) and the useEffect
// mount (listener not attached yet) — both signals missed:
//   1. useState lazy initializer reads window.__tbDeviceId. Wins when
//      bridge ran before React's first render.
//   2. useEffect attaches a tb-device-id-ready listener AND re-reads the
//      window globals as a re-check. Re-check catches the missed-event
//      race because globals stay set even after the dispatch fires.
//   3. Short backup poll (every 400ms, capped at ~5s) for the
//      pathological case where chrome.runtime.sendMessage callback fires
//      after React commit but before any visible interaction — by then
//      both reads above have run with empty globals. Polling is cheap
//      and stops the moment we read a value.
//
// Returns null when the extension isn't installed. Callers should NOT
// block on this — null falls back to the legacy first-to-poll claim.
export function useExtensionDevice() {
  const [state, setState] = useState<{ id: string | null; label: string | null }>(() => {
    const w = window as unknown as { __tbDeviceId?: string; __tbDeviceLabel?: string };
    return { id: w.__tbDeviceId ?? null, label: w.__tbDeviceLabel ?? null };
  });

  useEffect(() => {
    const w = window as unknown as { __tbDeviceId?: string; __tbDeviceLabel?: string };

    const pickup = () => {
      if (w.__tbDeviceId) {
        setState((prev) => (prev.id ? prev : { id: w.__tbDeviceId!, label: w.__tbDeviceLabel ?? null }));
        return true;
      }
      return false;
    };

    // Re-check immediately — bridge may have set globals between initial
    // render and this effect running.
    if (pickup()) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { device_id?: string; device_label?: string } | undefined;
      if (detail?.device_id) {
        setState({ id: detail.device_id, label: detail.device_label ?? null });
      }
    };
    window.addEventListener('tb-device-id-ready', handler);

    // Backup poll — covers the case where the event already fired in
    // the gap between initial render and useEffect (so globals are set
    // but the listener attached too late).
    const interval = window.setInterval(() => {
      if (pickup()) window.clearInterval(interval);
    }, 400);
    const timeout = window.setTimeout(() => window.clearInterval(interval), 5000);

    return () => {
      window.removeEventListener('tb-device-id-ready', handler);
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, []);

  return state;
}
