// ============================================================================
// GENDER-DETECTOR.JS
// ============================================================================

class GenderDetector {
  constructor() {
    this.detectedGender = null;
    this.manualGender = null;
    this.patronymic = null;
  }

  detectGenderByPatronymic(patronymic) {
    if (!patronymic) return null;
    const last = patronymic.trim().slice(-1).toLowerCase();
    if (last === 'ч') return 'M';
    if (last === 'а') return 'F';
    return null;
  }

  extractPatronymicFromUserCard() {
    const el = document.querySelector('.c-patient-info-card--user-name');
    if (!el) return null;

    const text = el.textContent.trim()
      .replace(/\s+/g, ' ')
      .replace(/\d+р\./g, '')
      .trim();

    const words = text.split(/\s+/).filter(Boolean);
    return words.length >= 3 ? words[2] : null;
  }

  detectGender() {
    if (this.manualGender) return this.manualGender;

    const patronymic = this.extractPatronymicFromUserCard();
    if (patronymic) {
      this.patronymic = patronymic;
      this.detectedGender = this.detectGenderByPatronymic(patronymic);
      console.log(`[Gender Detector] По-батькові: "${patronymic}" → ${this.detectedGender || 'невизначено'}`);
      return this.detectedGender;
    }

    return null;
  }

  setManualGender(gender) {
    if (gender === 'M' || gender === 'F') {
      this.manualGender = gender;
      return true;
    }
    return false;
  }

  getCurrentGender() {
    return this.manualGender || this.detectedGender || null;
  }

  resetManualGender() {
    this.manualGender = null;
  }

  getStatus() {
    return {
      detected: this.detectedGender,
      manual: this.manualGender,
      current: this.getCurrentGender(),
      patronymic: this.patronymic,
      source: this.manualGender ? 'manual' : (this.detectedGender ? 'auto' : 'unknown')
    };
  }
}

const GENDER_DETECTOR = new GenderDetector();
console.log('[Medics Indicators] Gender-detector.js завантажено');
