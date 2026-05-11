document.addEventListener('DOMContentLoaded', () => {
  const moduleUrlEl = document.getElementById('moduleUrl');
  const pinEl = document.getElementById('pin');
  const saveBtn = document.getElementById('save');
  const statusEl = document.getElementById('status');

  chrome.storage.sync.get(['moduleUrl', 'pin'], (v) => {
    moduleUrlEl.value = v.moduleUrl || '';
    pinEl.value = v.pin || '';
  });

  saveBtn.addEventListener('click', async () => {
    statusEl.textContent = '';
    statusEl.className = '';

    const moduleUrl = (moduleUrlEl.value || '').trim().replace(/\/$/, '');
    const pin = (pinEl.value || '').trim();

    if (!moduleUrl) {
      statusEl.textContent = 'Вкажіть URL модуля';
      statusEl.className = 'status-err';
      return;
    }
    if (!/^\d{4,12}$/.test(pin)) {
      statusEl.textContent = 'PIN має бути 4–12 цифр';
      statusEl.className = 'status-err';
      return;
    }

    statusEl.textContent = 'Перевіряємо…';

    // Try a probe call. We don't have a verify endpoint per se; we just hit
    // /api/extension-sync without medics_id — it should return 400 (Bad
    // Request) but only AFTER passing auth. 401 means PIN is wrong.
    try {
      const r = await fetch(`${moduleUrl}/api/extension-sync`, {
        headers: { Authorization: `Bearer ${pin}` },
      });
      if (r.status === 401) {
        statusEl.textContent = 'Невірний PIN';
        statusEl.className = 'status-err';
        return;
      }
      // 400 (no medics_id) or 200 — both mean auth passed.
      chrome.storage.sync.set({ moduleUrl, pin }, () => {
        statusEl.textContent = 'Збережено. Можете закрити це вікно.';
        statusEl.className = 'status-ok';
      });
    } catch (e) {
      statusEl.textContent = 'Не вдалось зʼєднатися: ' + (e && e.message ? e.message : 'unknown');
      statusEl.className = 'status-err';
    }
  });
});
