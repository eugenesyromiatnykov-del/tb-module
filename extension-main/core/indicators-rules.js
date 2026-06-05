// ============================================================================
// INDICATORS-RULES.JS - v5.0
// Виправлення: A62 видалено з RISK_FACTORS_HIV (це ICPC-2 адмін, не МКХ-10)
// ============================================================================

function extractDiagnosisCodes(diagnoses) {
  if (!diagnoses) return [];
  return diagnoses.map(d => (typeof d === 'string' ? d : d?.code)).filter(Boolean);
}

function checkRiskFactors(diagnosisCodes, riskFactors) {
  if (!diagnosisCodes || !riskFactors) return false;
  return diagnosisCodes.some(code => riskFactors.includes(code));
}

function calculateAge(birthDate) {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

// ── Фактори ризику ─────────────────────────────────────────────────────────

const RISK_FACTORS_CVD = [
  "K22","K85","P15","P16","P17","T07","T82","T83","T89","T90",
  "R03.0","F10","G31.2","F17","T65.2","Z58.7","Z72.0","Z86.43",
  "R63.5","E66","E10","E11","E13","E14","Z82.4"
];

const RISK_FACTORS_DIABETES = [
  "P15","P16","T07","T82","T83","W85",
  "R63.5","E66","F10","G31.2","O24.4","Z83.3"
];

const RISK_FACTORS_COLORECTAL = ["D12","K50","K51","Z80.0"];

const RISK_FACTORS_BREAST = [
  "P15","P16","P17","Z80.3","N97","F10","G31.2","F17",
  "T65.2","Z58.7","Z72.0","Z86.43"
];

const RISK_FACTORS_TB = [
  "B90","A79","B72","B74","D74","D75","D76","D77","D78",
  "L71","N74","R84","R85","U75","U76","U77",
  "T71","W72","X75","X76","X77","Y77","Y78",
  "T89","T90","P15","P17","P19",
  "R95","R96","R79","R81","R82","T05","T08","U28",
  "W78","W84","W90","W91","W92","W93",
  "Z06","Z01","Z02","Z03"
];

// ВИПРАВЛЕНО: A62 видалено! A62 — це ICPC-2 «Адміністративні послуги»,
// а не МКХ-10 A62. У документі його немає в списку ВІЛ-ризиків.
const RISK_FACTORS_HIV = [
  // ICPC-2
  "D72",
  "W71","W75","W76","W78","W79","W80","W81","W82","W83","W84",
  "X70","X71","X72","X73","X74","X90","X91","X92",
  "Y70","Y71","Y72","Y73","Y74","Y75","Y76",
  // МКХ-10
  "A15","A16","A17","A18","A19","M01","M49","M90","A30.1","A30.2",
  "J65","K23.0","K67.3","N33.0","N74.0","N74.1","O98.0","P37.0","Z03.0",
  "B16.0","B16.1","B16.2","B16.9","B17.1","B18.0","B18.1","B18.2",
  "A50","A51","A52","A53","A54","A55","A56","A57","A58","A59",
  "A60","A61","A63","A64",
  // A62 — ВИДАЛЕНО (ICPC-2 адмін, не МКХ-10)
  "O00","O01","O02","O03","O04","O05","O06","O07","O08","O09","O30",
  "Z20.6","Z72.5"
];

// ── Індикатор 1: ССЗ ризик ─────────────────────────────────────────────────

const cvdRiskCombined = {
  id: "cvd-risk-combined",
  name: "Повне оцінювання серцево-судинного ризику",
  category: "Профілактика",
  type: "ОБСТЕЖЕННЯ",
  gender: "BOTH",
  applies: (patient) => {
    if (!patient.gender || !patient.age) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    if (codes.includes("K86") || codes.includes("K87")) return false;
    if (patient.gender === "M" && patient.age >= 40) return true;
    if (patient.gender === "F" && patient.age >= 50) return true;
    return false;
  },
  frequency: (patient) => {
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return checkRiskFactors(codes, RISK_FACTORS_CVD) ? 12 : 24;
  },
  requiredActions: [
    { code: "8480-6",  name: "8480-6 Систолічний артеріальний тиск" },
    { code: "8462-4",  name: "8462-4 Діастолічний артеріальний тиск" },
    { code: "39156-5", name: "39156-5 Індекс маси тіла (ІМТ)" },
    { code: "56086-2", name: "56086-2 Окружність талії" },
    { code: "14647-2", name: "14647-2 Холестерин" }
  ],
  riskFactors: RISK_FACTORS_CVD,
  exclusionCodes: ["K86","K87"],
};

// ── Індикатор 2: Гіпертонія ────────────────────────────────────────────────

const hypertensionCompensation = {
  id: "hypertension-compensation",
  name: "Оцінювання компенсації гіпертонії",
  category: "Моніторинг",
  type: "ОБСТЕЖЕННЯ",
  gender: "BOTH",
  applies: (patient) => {
    if (!patient.age || patient.age < 18 || !patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return codes.includes("K86") || codes.includes("K87");
  },
  frequency: () => 3,
  requiredActions: [
    { code: "8480-6", name: "8480-6 Систолічний артеріальний тиск", maxValue: 140 },
    { code: "8462-4", name: "8462-4 Діастолічний артеріальний тиск", maxValue: 90 }
  ],
  riskFactors: [],
  exclusionCodes: [],
};

// ── Індикатор 3: Діабет ────────────────────────────────────────────────────

const diabetesScreening = {
  id: "diabetes-screening",
  name: "Скринінг на виявлення цукрового діабету",
  category: "Профілактика",
  type: "ОБСТЕЖЕННЯ",
  gender: "BOTH",
  applies: (patient) => {
    if (!patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    if (codes.includes("T89") || codes.includes("T90")) return false;
    if (checkRiskFactors(codes, RISK_FACTORS_DIABETES)) return true;
    return patient.age >= 45;
  },
  frequency: () => 12,
  requiredActions: [
    { code: "39156-5", name: "39156-5 Індекс маси тіла (ІМТ)" },
    { code: "56086-2", name: "56086-2 Окружність талії" },
    { code: "14647-2", name: "14647-2 Холестерин" },
    { code: "14743-9", name: "14743-9 Глюкоза (глюкометр)" }
  ],
  riskFactors: RISK_FACTORS_DIABETES,
  exclusionCodes: ["T89","T90"],
};

// ── Індикатор 4: РПЗ Направлення ──────────────────────────────────────────

const prostateCancerScreeningReferral = {
  id: "prostate-cancer-screening-referral",
  name: "Скринінг на рак простати (Направлення)",
  category: "Онкопрофілактика",
  type: "НАПРАВЛЕННЯ",
  gender: "M",
  applies: (patient) => {
    if (patient.gender !== "M" || !patient.age || !patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    if (codes.includes("Y77")) return false;
    if (codes.includes("Z80.4") && patient.age >= 40) return true;
    return patient.age >= 50;
  },
  frequency: () => 24,
  requiredActions: [
    { code: "Y34003", name: "Y34003 Аналіз ПСА", isOrLogic: true },
    { code: "Y34011", name: "Y34011 Аналіз загальний/вільний ПСА", isOrLogic: true }
  ],
  riskFactors: ["Z80.4"],
  exclusionCodes: ["Y77"],
};

// ── Індикатор 5: РПЗ Результат ────────────────────────────────────────────

const prostateCancerScreeningResult = {
  id: "prostate-cancer-screening-result",
  name: "Скринінг на рак простати (Результат)",
  category: "Онкопрофілактика",
  type: "ДІАГНОСТИЧНИЙ_ЗВІТ",
  gender: "M",
  applies: (patient) => {
    if (patient.gender !== "M" || !patient.age || !patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    if (codes.includes("Y77")) return false;
    if (codes.includes("Z80.4") && patient.age >= 40) return true;
    return patient.age >= 50;
  },
  frequency: () => 24,
  requiredActions: [
    { code: "Y34003", name: "Y34003 Аналіз ПСА", isOrLogic: true },
    { code: "Y34011", name: "Y34011 Аналіз загальний/вільний ПСА", isOrLogic: true }
  ],
  riskFactors: ["Z80.4"],
  exclusionCodes: ["Y77"],
};

// ── Індикатор 6: Колоректальний рак Направлення ────────────────────────────

const colorectalCancerScreeningReferral = {
  id: "colorectal-cancer-screening-referral",
  name: "Скринінг колоректального раку (Направлення)",
  category: "Онкопрофілактика",
  type: "НАПРАВЛЕННЯ",
  gender: "BOTH",
  applies: (patient) => {
    if (!patient.age || patient.age < 50 || patient.age > 75 || !patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return !codes.includes("D75");
  },
  frequency: (patient) => {
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return checkRiskFactors(codes, RISK_FACTORS_COLORECTAL) ? 12 : 24;
  },
  requiredActions: [
    { code: "D36003", name: "D36003 Аналіз прихована кров" }
  ],
  riskFactors: RISK_FACTORS_COLORECTAL,
  exclusionCodes: ["D75"],
};

// ── Індикатор 7: Колоректальний рак Результат ──────────────────────────────

const colorectalCancerScreeningResult = {
  id: "colorectal-cancer-screening-result",
  name: "Скринінг колоректального раку (Результат)",
  category: "Онкопрофілактика",
  type: "ДІАГНОСТИЧНИЙ_ЗВІТ",
  gender: "BOTH",
  applies: (patient) => {
    if (!patient.age || patient.age < 50 || patient.age > 75 || !patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return !codes.includes("D75");
  },
  frequency: (patient) => {
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return checkRiskFactors(codes, RISK_FACTORS_COLORECTAL) ? 12 : 24;
  },
  requiredActions: [
    { code: "D36003", name: "D36003 Аналіз прихована кров" }
  ],
  riskFactors: RISK_FACTORS_COLORECTAL,
  exclusionCodes: ["D75"],
};

// ── Індикатор 8: РМЗ Направлення ──────────────────────────────────────────

const breastCancerScreeningReferral = {
  id: "breast-cancer-screening-referral",
  name: "Скринінг раку молочної залози (Направлення)",
  category: "Онкопрофілактика",
  type: "НАПРАВЛЕННЯ",
  gender: "F",
  applies: (patient) => {
    if (patient.gender !== "F" || !patient.age || !patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    if (codes.includes("X76")) return false;
    const hasRF = checkRiskFactors(codes, RISK_FACTORS_BREAST);
    if (hasRF && patient.age >= 40 && patient.age <= 69) return true;
    if (!hasRF && patient.age >= 50 && patient.age <= 69) return true;
    return false;
  },
  frequency: (patient) => {
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return checkRiskFactors(codes, RISK_FACTORS_BREAST) ? 12 : 24;
  },
  requiredActions: [
    { code: "X41973",   name: "X41973 Маммографія", isOrLogic: true },
    { code: "59300-00", name: "59300-00 Рентгенографія молочної залози, двобічна", isOrLogic: true }
  ],
  riskFactors: RISK_FACTORS_BREAST,
  exclusionCodes: ["X76"],
};

// ── Індикатор 9: РМЗ Результат ────────────────────────────────────────────

const breastCancerScreeningResult = {
  id: "breast-cancer-screening-result",
  name: "Скринінг раку молочної залози (Результат)",
  category: "Онкопрофілактика",
  type: "ДІАГНОСТИЧНИЙ_ЗВІТ",
  gender: "F",
  applies: (patient) => {
    if (patient.gender !== "F" || !patient.age || !patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    if (codes.includes("X76")) return false;
    const hasRF = checkRiskFactors(codes, RISK_FACTORS_BREAST);
    if (hasRF && patient.age >= 40 && patient.age <= 69) return true;
    if (!hasRF && patient.age >= 50 && patient.age <= 69) return true;
    return false;
  },
  frequency: (patient) => {
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return checkRiskFactors(codes, RISK_FACTORS_BREAST) ? 12 : 24;
  },
  requiredActions: [
    { code: "X41973",   name: "X41973 Маммографія", isOrLogic: true },
    { code: "59300-00", name: "59300-00 Рентгенографія молочної залози, двобічна", isOrLogic: true }
  ],
  riskFactors: RISK_FACTORS_BREAST,
  exclusionCodes: ["X76"],
};

// ── Індикатор 10: ТБ ──────────────────────────────────────────────────────

const tuberculosisScreening = {
  id: "tuberculosis-screening",
  name: "Скринінг на наявність туберкульозу",
  category: "Інфекційні захворювання",
  type: "ДІАГНОСТИЧНИЙ_ЗВІТ",
  gender: "BOTH",
  applies: (patient) => {
    if (!patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return checkRiskFactors(codes, RISK_FACTORS_TB);
  },
  frequency: () => 12,
  requiredActions: [
    { code: "56301-00", name: "56301-00 КТ грудної клітки", isOrLogic: true },
    { code: "58500-00", name: "58500-00 Рентгенографія грудної клітки", isOrLogic: true }
  ],
  // Рекомендовані направлення — відображаються в TODO як допоміжні дії,
  // але НЕ впливають на підрахунок виконання індикатора.
  // Якщо індикатор не виконано (немає діагностичного звіту), лікар повинен
  // виписати направлення на рентген — ми відстежуємо це окремо.
  recommendedReferrals: [
    { code: "58500-00", name: "58500-00 Рентгенографія грудної клітки" }
  ],
  riskFactors: RISK_FACTORS_TB,
  exclusionCodes: [],
};

// ── Індикатор 11: ВІЛ ─────────────────────────────────────────────────────

const hivScreening = {
  id: "hiv-screening",
  name: "Виявлення ВІЛ у пацієнтів з індикаторними станами",
  category: "Інфекційні захворювання",
  type: "ДІАГНОСТИЧНИЙ_ЗВІТ",
  gender: "BOTH",
  applies: (patient) => {
    if (!patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return checkRiskFactors(codes, RISK_FACTORS_HIV);
  },
  frequency: () => 12,
  requiredActions: [
    { code: "В33006", name: "В33006 Аналіз ВІЛ" }
  ],
  riskFactors: RISK_FACTORS_HIV,
  exclusionCodes: [],
};

// ── Індикатор 12: Профогляд 40-64 ─────────────────────────────────────────

const preventiveExam4064 = {
  id: "preventive-exam-40-64",
  name: "Профілактичний огляд 40–64 років",
  category: "Профілактика",
  type: "КОМПЛЕКСНА",
  gender: "BOTH",
  applies: (patient) => patient.age >= 40 && patient.age <= 64,
  frequency: () => 12,
  requiredActions: [
    { code: "A98",     name: "A98 — Підтримання здоров'я", searchIn: "episodes",     isEpisode: true },
    { code: "8480-6",  name: "8480-6 Систолічний артеріальний тиск",                   searchIn: "observations" },
    { code: "8462-4",  name: "8462-4 Діастолічний артеріальний тиск",                  searchIn: "observations" },
    { code: "39156-5", name: "39156-39156-5 Індекс маси тіла (ІМТ)",                              searchIn: "observations" },
    { code: "56086-2", name: "56086-2 Окружність талії",                 searchIn: "observations" },
    { code: "14647-2", name: "14647-2 Холестерин",                       searchIn: "observations" },
    { code: "14743-9", name: "14743-9 Глюкоза (глюкометр)",                    searchIn: "observations" }
  ],
  riskFactors: [],
  exclusionCodes: [],
};

// ── Індикатор 13: Профогляд 65+ ───────────────────────────────────────────

const preventiveExam65Plus = {
  id: "preventive-exam-65-plus",
  name: "Профілактичний огляд 65+ років",
  category: "Профілактика",
  type: "КОМПЛЕКСНА",
  gender: "BOTH",
  applies: (patient) => {
    if (!patient.age || patient.age < 65 || !patient.diagnoses) return false;
    const codes = extractDiagnosisCodes(patient.diagnoses);
    return codes.includes("K86") || codes.includes("K87")
        || codes.includes("K74") || codes.includes("K76")
        || codes.includes("T89") || codes.includes("T90");
  },
  frequency: () => 12,
  requiredActions: [
    { code: "A98",     name: "Епізод A98 — Підтримання здоров'я",   searchIn: "episodes",     isEpisode: true },
    { code: "D45",     name: "Взаємодія D45",                        searchIn: "encounters",   isOrLogic: true },
    { code: "K45",     name: "Взаємодія K45",                        searchIn: "encounters",   isOrLogic: true },
    { code: "T45",     name: "Взаємодія T45",                        searchIn: "encounters",   isOrLogic: true },
    { code: "8480-6",  name: "8480-6 Систолічний артеріальний тиск",                       searchIn: "observations" },
    { code: "8462-4",  name: "8462-4 Діастолічний артеріальний тиск",                      searchIn: "observations" },
    { code: "39156-5", name: "39156-5 Індекс маси тіла (ІМТ)",                                  searchIn: "observations" },
    { code: "56086-2", name: "56086-2 Окружність талії",                     searchIn: "observations" },
    { code: "14647-2", name: "14647-2 Холестерин",                           searchIn: "observations" },
    { code: "14743-9", name: "14743-9 Глюкоза (глюкометр)",                        searchIn: "observations" },
    { code: "4548-4",  name: "4548-4 HbA1c (лише для T89/T90)",            searchIn: "observations", isConditional: true, conditionalCodes: ["T89","T90"] }
  ],
  riskFactors: ["K86","K87","K74","K76","T89","T90"],
  exclusionCodes: [],
};

// ── Масив індикаторів ──────────────────────────────────────────────────────

const INDICATORS_RULES = [
  cvdRiskCombined,
  hypertensionCompensation,
  diabetesScreening,
  prostateCancerScreeningReferral,
  prostateCancerScreeningResult,
  colorectalCancerScreeningReferral,
  colorectalCancerScreeningResult,
  breastCancerScreeningReferral,
  breastCancerScreeningResult,
  tuberculosisScreening,
  hivScreening,
  preventiveExam4064,
  preventiveExam65Plus
];

console.log(`[Medics Indicators] indicators-rules.js v5.0 — ${INDICATORS_RULES.length} індикаторів`);

if (typeof window !== 'undefined') window.INDICATORS_RULES = INDICATORS_RULES;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = INDICATORS_RULES;
  module.exports.INDICATORS_RULES = INDICATORS_RULES;
}
