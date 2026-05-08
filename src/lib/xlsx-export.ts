import * as XLSX from 'xlsx';
import type { Patient } from '@/types/database';
import { LOCATION_LABELS, TB_STATUS_LABELS } from '@/types/database';
import { calcAge, formatDateUk } from './date-utils';

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
    'Адреса': p.address ?? '',
    'Локація': p.location_id ? LOCATION_LABELS[p.location_id] : '',
    'Статус': TB_STATUS_LABELS[p.tb_status],
    'Медичні групи ризику': p.medical_risk_groups.join(', '),
    'Соціальні групи ризику': p.social_risk_groups.join(', '),
    'Архівний': p.archived ? 'так' : 'ні',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Пацієнти');
  XLSX.writeFile(wb, filename);
}
