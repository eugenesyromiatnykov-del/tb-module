import { useEffect, useState } from 'react';

// The Chrome extension's tb-module-bridge content script reads a stable
// device_id from chrome.storage.local (via the SW) and hands it to the
// page via window.postMessage — that's the one channel that crosses
// content-script ↔ page isolated worlds without tripping CSP.
//
// Protocol (see tb-module-bridge.js):
//   bridge → page: { source: 'tb-bridge', type: 'device-id-ready',
//                    device_id, device_label }
//   page  → bridge: { type: 'tb-bridge-request-device-id' }   (poll)
//
// Race handling: on mount we attach the listener AND immediately send a
// request. Three cases:
//   • Bridge already has the value cached → it responds to our request
//     within a tick; listener catches device-id-ready.
//   • Bridge is mid-handshake with SW → it broadcasts when SW responds;
//     listener catches that.
//   • Bridge isn't loaded (extension missing) → no response, state stays
//     null forever. Callers fall back to legacy first-to-poll claim.
//
// Returns {id: null, label: null} until a message arrives.
export function useExtensionDevice() {
  const [state, setState] = useState<{ id: string | null; label: string | null }>({
    id: null,
    label: null,
  });

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.source !== 'tb-bridge') return;
      if (d.type !== 'device-id-ready') return;
      const id = typeof d.device_id === 'string' ? d.device_id : null;
      const label = typeof d.device_label === 'string' ? d.device_label : null;
      if (id) setState((prev) => (prev.id ? prev : { id, label }));
    };
    window.addEventListener('message', handler);
    // Ask the bridge in case it already has the value cached and our
    // listener missed the initial unsolicited broadcast.
    window.postMessage({ type: 'tb-bridge-request-device-id' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  return state;
}
