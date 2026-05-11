// Logic for "Додаток 9" (WHO 4-symptom TB screening questionnaire).

export type SymptomKey = 'cough' | 'night_sweats' | 'weight_loss' | 'fever';
export type QuestionnaireResult = 'low_risk' | 'needs_xray' | 'needs_referral';
export type FilledBy = 'doctor' | 'nurse' | 'self';

export type QuestionnaireAnswers = {
  cough: boolean;            // кашель > 2 тижнів
  night_sweats: boolean;     // нічна пітливість
  weight_loss: boolean;      // схуднення
  fever: boolean;            // лихоманка
  last_contact_date: string | null;   // ISO; null = не контактував
  last_xray_date: string | null;      // ISO; null = не пам'ятає / не робив
  positive_screening_test: boolean;   // позитивний тубтест / IGRA
};

export const SYMPTOM_LABELS: Record<SymptomKey, string> = {
  cough: 'Кашель тривалістю більше 2 тижнів',
  night_sweats: 'Нічна пітливість',
  weight_loss: 'Схуднення без причини',
  fever: 'Підвищена температура (субфебрилітет)',
};

export const RESULT_LABELS: Record<QuestionnaireResult, string> = {
  low_risk: 'Низький ризик',
  needs_xray: 'Потребує R-ОГК',
  needs_referral: 'Потребує направлення до фтизіатра',
};

export const FILLED_BY_LABELS: Record<FilledBy, string> = {
  doctor: 'Лікар',
  nurse: 'Медсестра',
  self: 'Самостійно',
};

function monthsAgo(iso: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

export function calculateResult(a: QuestionnaireAnswers): QuestionnaireResult {
  const symptomsCount = [a.cough, a.night_sweats, a.weight_loss, a.fever].filter(Boolean).length;
  const contactMonths = monthsAgo(a.last_contact_date);
  const xrayMonths = monthsAgo(a.last_xray_date);
  const recentContact = contactMonths !== null && contactMonths < 12;
  // R-ОГК older than 12 months OR never done → "outdated".
  const outdatedXray = a.last_xray_date == null || (xrayMonths !== null && xrayMonths > 12);

  // All 4 symptoms + positive screening → referral.
  if (symptomsCount >= 4 && a.positive_screening_test) return 'needs_referral';
  // Any symptom, recent contact, or outdated R-ОГК → R-ОГК.
  if (symptomsCount >= 1 || recentContact || outdatedXray) return 'needs_xray';
  return 'low_risk';
}

export function emptyAnswers(): QuestionnaireAnswers {
  return {
    cough: false,
    night_sweats: false,
    weight_loss: false,
    fever: false,
    last_contact_date: null,
    last_xray_date: null,
    positive_screening_test: false,
  };
}
