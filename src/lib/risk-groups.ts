// Single source of truth for risk group keys + Ukrainian labels.
// Imported by both this app and the future tb-module-bridge.js for the
// Chrome extension (Phase 4). See plan section 8.

export type RiskGroupKey =
  // medical (auto-derived from ICPC-2 / МКХ-10 in Phase 4)
  | 'hiv'
  | 'oncology'
  | 'diabetes'
  | 'previously_treated'
  | 'chronic_respiratory'
  | 'pneumonia_history'
  | 'peptic_ulcer'
  | 'psychiatric'
  // social (manually toggled)
  | 'close_contact'
  | 'medical_worker'
  | 'prisoners'
  | 'displaced'
  | 'low_income'
  | 'shelters'
  | 'elderly_60';

export type RiskGroupCategory = 'medical' | 'social';

export type RiskGroupDef = {
  key: RiskGroupKey;
  label: string;
  category: RiskGroupCategory;
  // Optional: ICPC-2 / МКХ-10 codes for auto-detection (Phase 4).
  icpc2?: string[];
  icd10?: string[];
};

export const RISK_GROUPS: RiskGroupDef[] = [
  // medical
  { key: 'hiv', label: 'ВІЛ', category: 'medical', icpc2: ['B90'], icd10: ['B20', 'B21', 'B22', 'B23', 'B24'] },
  { key: 'oncology', label: 'Онкологія', category: 'medical', icpc2: ['A79', 'B72', 'B74', 'D74', 'D75', 'D76', 'D77', 'D78', 'R84', 'R85'], icd10: ['C'] },
  { key: 'diabetes', label: 'Цукровий діабет', category: 'medical', icpc2: ['T89', 'T90'], icd10: ['E10', 'E11', 'E12', 'E13', 'E14'] },
  { key: 'previously_treated', label: 'Раніше лікувались від ТБ', category: 'medical', icd10: ['A15', 'A16', 'A17', 'A18', 'A19', 'Z86.1'] },
  { key: 'chronic_respiratory', label: 'Хронічні респіраторні', category: 'medical', icpc2: ['R95', 'R96'], icd10: ['J40', 'J41', 'J42', 'J43', 'J44', 'J45', 'J46', 'J47'] },
  { key: 'pneumonia_history', label: 'Пневмонія в анамнезі', category: 'medical', icpc2: ['R81'], icd10: ['J12', 'J13', 'J14', 'J15', 'J16', 'J17', 'J18'] },
  { key: 'peptic_ulcer', label: 'Виразкова хвороба', category: 'medical', icpc2: ['D85', 'D86'], icd10: ['K25', 'K26', 'K27', 'K28'] },
  { key: 'psychiatric', label: 'Психіатрія', category: 'medical', icd10: ['F'] },
  // social
  { key: 'close_contact', label: 'Близький контакт', category: 'social' },
  { key: 'medical_worker', label: 'Медичний працівник', category: 'social' },
  { key: 'prisoners', label: 'Позбавлені волі', category: 'social' },
  { key: 'displaced', label: 'Переселенці', category: 'social' },
  { key: 'low_income', label: 'Малозабезпечені', category: 'social' },
  { key: 'shelters', label: 'Притулки', category: 'social' },
  { key: 'elderly_60', label: 'Особи старші 60 років', category: 'social' },
];

export const RISK_GROUP_BY_KEY: Record<string, RiskGroupDef> = Object.fromEntries(
  RISK_GROUPS.map((g) => [g.key, g]),
);

export const SOCIAL_GROUPS = RISK_GROUPS.filter((g) => g.category === 'social');
export const MEDICAL_GROUPS = RISK_GROUPS.filter((g) => g.category === 'medical');

export function labelOf(key: string): string {
  return RISK_GROUP_BY_KEY[key]?.label ?? key;
}
