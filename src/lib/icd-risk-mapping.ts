// TS port of the diagnosis-code → risk-group mapping that lives in the
// extension (extension-main/tb-module-sync.js). Keep these two copies in
// lockstep: when one changes, copy the rule into the other.
//
// Codes split by dot presence:
//   • ICPC-2 — 3 chars, no dot (B90, T89, X75…)
//   • МКХ-10 / ICD-10 — first letter + ≥2 digits, optional .digits (B20.0, E11.71)
// The SAME 3-char string can mean different things in each system
// (ICPC-2 B90 = HIV; МКХ-10 B90 = sequelae of TB), hence the dot-presence split.

const ICPC_TO_GROUP: Record<string, string> = {
  B90: 'hiv',
  A79: 'oncology', B72: 'oncology', B74: 'oncology',
  D74: 'oncology', D75: 'oncology', D76: 'oncology', D77: 'oncology',
  L71: 'oncology', N74: 'oncology',
  R84: 'oncology', R85: 'oncology',
  U75: 'oncology', U76: 'oncology', U77: 'oncology',
  T71: 'oncology', W72: 'oncology',
  X75: 'oncology', X76: 'oncology', X77: 'oncology',
  Y77: 'oncology', Y78: 'oncology',
  T89: 'diabetes', T90: 'diabetes',
  P15: 'alcohol_abuse', P16: 'alcohol_abuse',
  P17: 'tobacco_use',
  P19: 'drug_abuse',
  R95: 'chronic_respiratory', R96: 'chronic_respiratory', R79: 'chronic_respiratory',
  R81: 'pneumonia_history',
  R82: 'pleurisy',
  T05: 'nutrition_problem',
  T08: 'weight_loss',
  U28: 'urology_disorder',
  W78: 'pregnancy', W84: 'pregnancy',
  W90: 'pregnancy', W91: 'pregnancy', W92: 'pregnancy', W93: 'pregnancy',
};

// First match wins. Prefix-based on the leading ICD-10 form.
const ICD10_PREFIX_RULES: Array<[RegExp, string]> = [
  [/^B2[0-4]\b/, 'hiv'],
  [/^B90(\.|$)/, 'previously_treated'],
  [/^A1[5-9]\b/, 'previously_treated'],
  [/^Z86\.1\b/, 'previously_treated'],
  [/^C\d/, 'oncology'],         // C00–C97
  [/^D0\d/, 'oncology'],        // D00–D09 carcinoma in situ
  [/^D4[567]\b/, 'oncology'],   // D45–D47 hematologic
  [/^E1[0-4]\b/, 'diabetes'],
  [/^J4[0-7]\b/, 'chronic_respiratory'],
  [/^J1[2-8]\b/, 'pneumonia_history'],
  [/^K2[5-8]\b/, 'peptic_ulcer'],
  [/^F10\b/, 'alcohol_abuse'],
  [/^F17\b/, 'tobacco_use'],
  [/^Z72\.0\b/, 'tobacco_use'],
  [/^Z86\.43\b/, 'tobacco_use'],
  [/^G31\.2\b/, 'alcohol_abuse'],
  [/^F\d/, 'psychiatric'],       // generic F-codes catch-all — keep last
];

export function groupForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const isIcd10 = code.includes('.');
  if (isIcd10) {
    for (const [re, group] of ICD10_PREFIX_RULES) {
      if (re.test(code)) return group;
    }
    return null;
  }
  return ICPC_TO_GROUP[code] ?? null;
}
