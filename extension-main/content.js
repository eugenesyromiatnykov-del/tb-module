// CONTENT.JS - з debounce, без шуму в консолі

console.log('Medics Indicators: content.js завантажено');

function isPatientPage() {
  const cardBlock = document.querySelector('#med-card-block');
  const hasName = document.querySelector('.c-patient-info-card--user-name');
  return !!(cardBlock && hasName);
}

function initializeExtension() {
  if (!isPatientPage()) return false;

  // Не инициализируем дважды
  if (document.getElementById('medics-indicators-widget')) return true;

  if (typeof MedicsIndicatorUI === 'undefined') {
    console.error('Medics Indicators: MedicsIndicatorUI не завантажено!');
    return false;
  }
  if (typeof MedicsParser === 'undefined') {
    console.error('Medics Indicators: MedicsParser не завантажено!');
    return false;
  }
  if (typeof IndicatorAnalyzer === 'undefined') {
    console.error('Medics Indicators: IndicatorAnalyzer не завантажено!');
    return false;
  }
  if (typeof INDICATORS_RULES === 'undefined') {
    console.error('Medics Indicators: INDICATORS_RULES не завантажено!');
    return false;
  }

  console.log('Medics Indicators: ✅ Сторінка пацієнта — ініціалізація UI...');
  try {
    const uiWidget = new MedicsIndicatorUI();
    uiWidget.init();
    console.log('Medics Indicators: ✅ UI ініціалізовано');
    return true;
  } catch (error) {
    console.error('Medics Indicators: помилка ініціалізації:', error);
    return false;
  }
}

function waitForPatientPage(timeout = 15000) {
  if (initializeExtension()) return;

  let initialized = false;
  const startTime = Date.now();
  let debounceTimer = null;

  const observer = new MutationObserver(() => {
    if (initialized) return;
    if (Date.now() - startTime > timeout) {
      observer.disconnect();
      return;
    }
    // Debounce 200ms — ждём паузы в изменениях DOM перед проверкой
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (initialized) return;
      if (initializeExtension()) {
        initialized = true;
        observer.disconnect();
        console.log('Medics Indicators: ✅ Observer зупинено');
      }
    }, 200);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(waitForPatientPage, 500));
} else {
  setTimeout(waitForPatientPage, 500);
}
