// ============================================================================
// GENDER-SELECTOR.JS
// Примітка: основний переключатель статі вбудовано в ui.js (renderGenderSelector).
// Цей файл надає лише глобальний об'єкт GENDER_SELECTOR для зворотньої сумісності.
// ============================================================================

class GenderSelector {
  setManualGender(gender) {
    if (typeof GENDER_DETECTOR !== 'undefined') {
      GENDER_DETECTOR.setManualGender(gender);
      this.triggerReanalysis();
    }
  }

  triggerReanalysis() {
    const btn = document.getElementById('mi-analyze-btn');
    if (btn) btn.click();
  }

  getStatus() {
    if (typeof GENDER_DETECTOR !== 'undefined') return GENDER_DETECTOR.getStatus();
    return { detected: null, manual: null, current: null, source: 'unknown' };
  }
}

const GENDER_SELECTOR = new GenderSelector();
console.log('[Medics Indicators] Gender-selector.js завантажено');
