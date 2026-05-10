export type LocationId = 'bilohirska' | 'zaluzhe';

export type TbStatus = 'risk' | 'detected' | 'contact' | 'cleared' | 'external' | 'archived';
export type FluoroResultCode = 'normal' | 'pathology' | 'pending' | 'refused' | 'unknown';
export type SputumTestType = 'xpert' | 'microscopy' | 'culture' | 'pcr';
export type DataSource = 'manual' | 'extension' | 'imported_xlsx' | 'mis_sync';

export type Patient = {
  id: string;
  medics_id: string | null;
  surname: string;
  first_name: string;
  patronymic: string | null;
  birth_date: string;        // ISO date 'YYYY-MM-DD'
  gender: 'M' | 'F' | null;
  phone: string | null;
  address: string | null;
  location_id: LocationId | null;

  tb_status: TbStatus;
  contact_of: string | null;

  medical_risk_groups: string[];
  social_risk_groups: string[];
  diagnoses_codes: string[];
  diagnoses_synced_at: string | null;

  notes: string | null;
  archived: boolean;
  archived_reason: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;

  // Derived from latest fluoro record (via patient_dashboard view).
  last_fluoro_date: string | null;
  next_planned_date: string | null;
  last_result_code: FluoroResultCode | null;
};

export type PatientForDiff = Pick<
  Patient,
  | 'id' | 'medics_id' | 'surname' | 'first_name' | 'patronymic' | 'birth_date'
  | 'gender' | 'phone' | 'address' | 'location_id' | 'archived'
>;

export type IncomingPatient = {
  medics_id: string;
  surname: string;
  first_name: string;
  patronymic: string | null;
  birth_date: string;
  gender: 'M' | 'F' | null;
  phone: string | null;
  address: string | null;
  location_id: LocationId;
};

export type DeclarantsDiff = {
  add: IncomingPatient[];
  update: { id: string; patch: Partial<IncomingPatient> }[];
  archive: { id: string; medics_id: string | null; surname: string; first_name: string }[];
  unchanged: number;
  totalInFile: number;
};

export const LOCATION_LABELS: Record<LocationId, string> = {
  bilohirska: 'Білогірська амбулаторія',
  zaluzhe: 'Залужжя',
};

export const TB_STATUS_LABELS: Record<TbStatus, string> = {
  risk: 'На ризику',
  detected: 'Виявлений',
  contact: 'Контактний',
  cleared: 'Знятий з обліку',
  external: 'Не декларант',
  archived: 'Архівний',
};

export type FluoroRecord = {
  id: string;
  patient_id: string;
  date: string;
  result: string | null;
  result_code: FluoroResultCode;
  next_planned_date: string | null;
  source: DataSource;
  notes: string | null;
  created_at: string;
};

export type SputumTest = {
  id: string;
  patient_id: string;
  date: string;
  result: string | null;
  test_type: SputumTestType;
  notes: string | null;
  created_at: string;
};

export const FLUORO_RESULT_LABELS: Record<FluoroResultCode, string> = {
  normal: 'Без патології',
  pathology: 'Патологія',
  pending: 'Очікує результат',
  refused: 'Відмова',
  unknown: 'Невідомо',
};

export const SPUTUM_TEST_LABELS: Record<SputumTestType, string> = {
  xpert: 'GeneXpert',
  microscopy: 'Мікроскопія',
  culture: 'Посів',
  pcr: 'ПЛР',
};
