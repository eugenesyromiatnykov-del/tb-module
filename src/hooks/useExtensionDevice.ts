import { useEffect, useState } from 'react';

// The Chrome extension's tb-module-bridge content script reads a stable
// device_id from chrome.storage.local (via the SW) and pushes it onto
// `window.__tbDeviceId` plus a `tb-device-id-ready` CustomEvent.
//
// This hook surfaces that to React. It does TWO reads, because the
// bridge and React mount race in either order:
//   1. Initial sync read of `window.__tbDeviceId` — covers the case
//      where the bridge dispatched the event before React's effect ran.
//   2. Event listener for `tb-device-id-ready` — covers the case where
//      React mounted first and the bridge hasn't finished its handshake
//      yet (or the SW was sleeping and just woke up).
//
// Returns null when the extension isn't installed or hasn't responded
// yet. Callers that need to start a sync should fall back to NULL
// owner_device_id (current first-come-first-served behavior); they
// should NOT block the sync click on this — the doctor will be
// confused if a working button stops working after a Chrome restart
// just because the bridge hasn't initialised.
export function useExtensionDevice() {
  const [state, setState] = useState<{ id: string | null; label: string | null }>(() => {
    const w = window as unknown as { __tbDeviceId?: string; __tbDeviceLabel?: string };
    return { id: w.__tbDeviceId ?? null, label: w.__tbDeviceLabel ?? null };
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { device_id?: string; device_label?: string } | undefined;
      if (detail?.device_id) {
        setState({ id: detail.device_id, label: detail.device_label ?? null });
      }
    };
    window.addEventListener('tb-device-id-ready', handler);
    return () => window.removeEventListener('tb-device-id-ready', handler);
  }, []);

  return state;
}
