// Parse a date string from MIS xlsx export. Numbers/Excel exports use mixed
// formats: "M/D/YY", "MM/DD/YYYY", "DD.MM.YYYY", "29 вер. 2025", or a raw
// JS Date object (when XLSX is read with cellDates: true). Returns ISO
// 'YYYY-MM-DD' or null.

const UA_MONTHS: Record<string, number> = {
  'січ': 1, 'січня': 1,
  'лют': 2, 'лютого': 2,
  'бер': 3, 'березня': 3,
  'кві': 4, 'квітня': 4,
  'тра': 5, 'травня': 5,
  'чер': 6, 'червня': 6,
  'лип': 7, 'липня': 7,
  'сер': 8, 'серпня': 8,
  'вер': 9, 'вересня': 9,
  'жов': 10, 'жовтня': 10,
  'лис': 11, 'листопада': 11,
  'гру': 12, 'грудня': 12,
};

export function parseDateLoose(input: unknown): string | null {
  if (input == null) return null;

  if (input instanceof Date && !isNaN(input.getTime())) {
    return toIso(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }

  const s = String(input).trim();
  if (!s || s === '-') return null;

  // ISO already
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toIso(+m[1], +m[2], +m[3]);

  // M/D/YY or MM/DD/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const month = +m[1];
    const day = +m[2];
    const yr = +m[3];
    const year = yr < 100 ? (yr >= 30 ? 1900 + yr : 2000 + yr) : yr;
    return toIso(year, month, day);
  }

  // DD.MM.YYYY
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const day = +m[1];
    const month = +m[2];
    const yr = +m[3];
    const year = yr < 100 ? (yr >= 30 ? 1900 + yr : 2000 + yr) : yr;
    return toIso(year, month, day);
  }

  // "29 вер. 2025" or "29 вересня 2025"
  m = s.match(/^(\d{1,2})\s+([а-яіїє']+)\.?\s+(\d{4})$/i);
  if (m) {
    const day = +m[1];
    const monthName = m[2].toLowerCase().replace(/\.$/, '').slice(0, 3);
    const month = UA_MONTHS[monthName];
    const year = +m[3];
    if (month) return toIso(year, month, day);
  }

  return null;
}

function toIso(y: number, m: number, d: number): string | null {
  if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }
function pad4(n: number) { return String(n).padStart(4, '0'); }

export function formatDateUk(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function calcAge(birthIso: string | null | undefined, refIso?: string): number | null {
  if (!birthIso) return null;
  const m = birthIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const birth = new Date(+m[1], +m[2] - 1, +m[3]);
  const ref = refIso ? new Date(refIso) : new Date();
  let age = ref.getFullYear() - birth.getFullYear();
  const md = ref.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && ref.getDate() < birth.getDate())) age -= 1;
  return age;
}
