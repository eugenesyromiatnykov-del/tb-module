import * as XLSX from 'xlsx';
import type { Patient } from '@/types/database';
import { LOCATION_LABELS, TB_STATUS_LABELS } from '@/types/database';
import { calcAge, formatDateUk } from './date-utils';
import { labelOf } from './risk-groups';
import type { ReportRow } from '@/hooks/usePatients';

// ── Report export (Google Sheets target) ───────────────────────────────────

// Risk groups mapped to the reporting form's controlled vocabulary. Order
// is priority: the first matching key on a patient wins as the "primary"
// group for the report cell.
const REPORT_RISK_GROUPS: Array<{ key: string; label: string }> = [
  { key: 'close_contact',       label: 'Тубконтакт' },
  { key: 'previously_treated',  label: 'особи, які раніше лікувались від ТБ' },
  { key: 'hiv',                 label: 'ЛЖВ' },
  { key: 'pregnancy',           label: 'вагітні, а також жінки у післяпологовому періоді' },
  { key: 'oncology',            label: 'особи з захворюваннями, що призводять до зниження імунітету (злоякісні новоутворення, цукровий діабет, отримання імуносупресивної терапії, отримання терапії інгібітором ФНП-а, гемодіаліз, готуються до трансплантації органів чи кісткового мозку)' },
  { key: 'diabetes',            label: 'особи з захворюваннями, що призводять до зниження імунітету (злоякісні новоутворення, цукровий діабет, отримання імуносупресивної терапії, отримання терапії інгібітором ФНП-а, гемодіаліз, готуються до трансплантації органів чи кісткового мозку)' },
  { key: 'medical_worker',      label: 'медичні працівники' },
  { key: 'displaced',           label: 'ВПО' },
  { key: 'low_income',          label: 'малозабезпечені' },
  { key: 'shelters',            label: 'особи, які живуть в притулках' },
  { key: 'alcohol_abuse',       label: 'особи, які зловживають алкоголем чи вживають наркотики' },
  { key: 'drug_abuse',          label: 'особи, які зловживають алкоголем чи вживають наркотики' },
  { key: 'chronic_respiratory', label: 'особи з хронічними респіраторними захворюваннями' },
  { key: 'pneumonia_history',   label: 'особи із захворюваннями на пневмонію' },
  { key: 'tobacco_use',         label: 'курці' },
  { key: 'nutrition_problem',   label: 'особи із дефіцитом харчування або особи з індексом маси тіла <=18' },
  { key: 'weight_loss',         label: 'особи із дефіцитом харчування або особи з індексом маси тіла <=18' },
  { key: 'psychiatric',         label: 'особи які перебувають у ЗОЗ психо-неврологічного профілю' },
  { key: 'elderly_60',          label: 'особи старші 60 років' },
];

function pickReportRiskGroup(p: Patient): string {
  const groups = new Set<string>([...p.medical_risk_groups, ...p.social_risk_groups]);
  for (const r of REPORT_RISK_GROUPS) {
    if (groups.has(r.key)) return r.label;
  }
  return '';
}

const QUESTIONNAIRE_RESULT_TO_BINARY: Record<string, string> = {
  low_risk: 'негативний',
  needs_xray: 'позитивний',
  needs_referral: 'позитивний',
};
const QUANTIFERON_RESULT_TO_BINARY: Record<string, string> = {
  positive: 'позитивний',
  negative: 'негативний',
  indeterminate: 'невизначений',
  unknown: '',
};
const FLUORO_CODE_TO_LABEL: Record<string, string> = {
  normal: 'норма',
  pathology: 'зміни',
  pending: 'очікує результат',
  refused: 'відмова',
  unknown: '',
};

function fluoroOfYear(records: ReportRow['fluoro'], year: number): string {
  const prefix = `${year}-`;
  const inYear = records.filter((r) => r.date.startsWith(prefix));
  if (inYear.length === 0) return '';
  // Records come from API in DESC order; first match = latest in year.
  const latest = inYear[0];
  const label = FLUORO_CODE_TO_LABEL[latest.result_code] ?? '';
  return [formatDateUk(latest.date), label].filter(Boolean).join(' — ');
}

export function exportReportXlsx(rows: ReportRow[], filename: string): void {
  const data = rows.map((r, i) => ({
    '№': i + 1,
    'Група ризику': pickReportRiskGroup(r),
    'Прізвище': r.surname,
    "Імʼя": r.first_name,
    'По батькові': r.patronymic ?? '',
    'Дата народження': formatDateUk(r.birth_date),
    'Дата анкетування': r.questionnaire ? formatDateUk(r.questionnaire.filled_at) : '',
    'Результат анкетування': r.questionnaire ? QUESTIONNAIRE_RESULT_TO_BINARY[r.questionnaire.result] ?? '' : '',
    'Туберкулінодіагностика 2024р': '',
    'Туберкулінодіагностика 2025р': '',
    'Туберкулінодіагностика 2026р': '',
    'Квантифероновий тест': r.quantiferon ? QUANTIFERON_RESULT_TO_BINARY[r.quantiferon.result_code] ?? '' : '',
    'Рентген 2024р': fluoroOfYear(r.fluoro, 2024),
    'Рентген 2025р': fluoroOfYear(r.fluoro, 2025),
    'Рентген 2026р': fluoroOfYear(r.fluoro, 2026),
    'GeneXpert дата': r.xpert ? formatDateUk(r.xpert.date) : '',
    'GeneXpert результат': r.xpert?.result ?? '',
    'Дата консультації фтизіатра': '',
    'Схема ХП': '',
    'Сімейний лікар': '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Звіт');
  XLSX.writeFile(wb, filename);
}

export function exportAdpmXlsx(patients: Patient[], filename: string): void {
  const rows = patients.map((p) => ({
    'Medics ID': p.medics_id ?? '',
    'Прізвище': p.surname,
    "Ім'я": p.first_name,
    'По батькові': p.patronymic ?? '',
    'Дата народження': formatDateUk(p.birth_date),
    'Вік': calcAge(p.birth_date) ?? '',
    'Телефон': p.phone ?? '',
    'Населений пункт': p.village ?? '',
    'Адреса': p.address ?? '',
    'Амбулаторія': p.location_id ? LOCATION_LABELS[p.location_id] : '',
    'Остання АДП-М': p.last_adpm_date ? formatDateUk(p.last_adpm_date) : '',
    'Наступна АДП-М': p.next_adpm_date ? formatDateUk(p.next_adpm_date) : '',
    'Протипоказання': p.adpm_contraindication ? 'так' : '',
    'Причина протипоказання': p.adpm_contraindication_reason ?? '',
    'Відмова': p.adpm_refused ? 'так' : '',
    'Дата відмови': p.adpm_refusal_date ? formatDateUk(p.adpm_refusal_date) : '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Вакцинація АДП-М');
  XLSX.writeFile(wb, filename);
}

export function exportPatientsXlsx(patients: Patient[], filename: string): void {
  const rows = patients.map((p) => ({
    'Medics ID': p.medics_id ?? '',
    'Прізвище': p.surname,
    "Ім'я": p.first_name,
    'По батькові': p.patronymic ?? '',
    'Стать': p.gender === 'M' ? 'Чоловіча' : p.gender === 'F' ? 'Жіноча' : '',
    'Дата народження': formatDateUk(p.birth_date),
    'Вік': calcAge(p.birth_date) ?? '',
    'Телефон': p.phone ?? '',
    'Населений пункт': p.village ?? '',
    'Адреса': p.address ?? '',
    'Амбулаторія': p.location_id ? LOCATION_LABELS[p.location_id] : '',
    'Статус': TB_STATUS_LABELS[p.tb_status],
    'Медичні групи ризику': p.medical_risk_groups.map(labelOf).join(', '),
    'Соціальні групи ризику': p.social_risk_groups.map(labelOf).join(', '),
    'Остання флюоро': p.last_fluoro_date ? formatDateUk(p.last_fluoro_date) : '',
    'Наступна флюоро': p.next_planned_date ? formatDateUk(p.next_planned_date) : '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Пацієнти');
  XLSX.writeFile(wb, filename);
}
