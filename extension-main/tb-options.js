document.addEventListener('DOMContentLoaded', () => {
  const moduleUrlEl = document.getElementById('moduleUrl');
  const pinEl = document.getElementById('pin');
  const autoAnalyzeEl = document.getElementById('autoAnalyze');
  const saveBtn = document.getElementById('save');
  const statusEl = document.getElementById('status');

  chrome.storage.sync.get(['tbModuleUrl', 'tbModulePin', 'tbAutoAnalyze'], (v) => {
    moduleUrlEl.value = v.tbModuleUrl || '';
    pinEl.value = v.tbModulePin || '';
    // Default true — auto-analyze is on by default for backward compat.
    autoAnalyzeEl.checked = v.tbAutoAnalyze !== false;
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

    // Probe — call extension-sync without medics_id. 400 means auth passed.
    try {
      const r = await fetch(`${moduleUrl}/api/extension-sync`, {
        headers: { Authorization: `Bearer ${pin}` },
      });
      if (r.status === 401) {
        statusEl.textContent = 'Невірний PIN';
        statusEl.className = 'status-err';
        return;
      }
      chrome.storage.sync.set({ tbModuleUrl: moduleUrl, tbModulePin: pin }, () => {
        statusEl.textContent = 'Збережено. Можете закрити це вікно.';
        statusEl.className = 'status-ok';
      });
    } catch (e) {
      statusEl.textContent = 'Не вдалось зʼєднатися: ' + (e && e.message ? e.message : 'unknown');
      statusEl.className = 'status-err';
    }
  });
});
