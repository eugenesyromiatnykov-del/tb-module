// ============================================================================
// PARSER.JS - v3
// Виправлення: parseDiagnoses читає ТІЛЬКИ секції "Діагнози:"
// (не "Дії:", не "Причини звернення:") + білий список ICPC-2
// ============================================================================

class MedicsParser {
  constructor() {
    this.patientData = null;
  }

  parseAll() {
    try {
      this.patientData = {
        birthDate: this.parseBirthDate(),
        age: null,
        gender: this.parseGender(),
        diagnoses: this.parseDiagnoses(),
        hasRiskFactors: false,
      };

      if (this.patientData.birthDate) {
        this.patientData.age = calculateAge(this.patientData.birthDate);
      }

      this.patientData.hasRiskFactors = this.checkRiskFactors(this.patientData.diagnoses);

      log('Парсинг завершено', 'success');
      log(`Вік=${this.patientData.age}, Стать=${this.patientData.gender}, Діагнозів=${this.patientData.diagnoses.length}`, 'info');

      return this.patientData;
    } catch (error) {
      log(`Помилка парсингу: ${error.message}`, 'error');
      console.error(error);
      return null;
    }
  }

  parseBirthDate() {
    const label = findElementByText('Дата народження');
    if (!label) return null;
    let el = label.parentElement;
    for (let i = 0; i < 5 && el; i++) {
      const m = el.textContent.match(/(\d{2}\.\d{2}\.\d{4})/);
      if (m) return parseDate(m[1]);
      el = el.parentElement;
    }
    return null;
  }

  parseGender() {
    if (typeof GENDER_DETECTOR !== 'undefined') {
      const g = GENDER_DETECTOR.detectGender();
      if (g) return g;
    }
    const label = findElementByText('Стать');
    if (!label) return null;
    let el = label.parentElement;
    for (let i = 0; i < 5 && el; i++) {
      const t = el.textContent.toLowerCase();
      if (t.includes('чоловіча') || t.includes('male')) return 'M';
      if (t.includes('жіноча') || t.includes('female')) return 'F';
      el = el.parentElement;
    }
    return null;
  }

  parseDiagnoses() {
    const diagnoses = [];
    const seen = new Set();

    console.log('[Parser] parseDiagnoses v3 — тільки секції "Діагнози:"');

    // ── Джерело 1: блоки "Діагнози:" у взаємодіях ───────────────────────────
    // Структура:
    //   div.c-collapse--output-item > p.c-collapse--output-title "Причини звернення:" ← пропускаємо
    //   div.c-collapse--output-item > p.c-collapse--output-title "Діагнози:"          ← беремо
    //     div.c-collapse--output-text > p.output-text--bold  "основний : K86 - ..."
    //   div.c-collapse--output-item > p.c-collapse--output-title "Дії:"               ← пропускаємо
    // ─────────────────────────────────────────────────────────────────────────

    const texts = [];

    document.querySelectorAll('p.c-collapse--output-title').forEach(title => {
      if (title.textContent.trim() !== 'Діагнози:') return;
      const block = title.closest('.c-collapse--output-item') || title.parentElement;
      if (!block) return;
      block.querySelectorAll('.c-collapse--output-text p.output-text--bold').forEach(p => {
        const t = p.textContent.trim();
        if (t) texts.push(t);
      });
    });

    // ── Джерело 2: первинний діагноз з заголовка епізоду ─────────────────────
    document.querySelectorAll(
      'p.c-collapse--item-info span[ng-bind="item.$primary_diagnose.text"]'
    ).forEach(span => {
      const t = span.textContent.trim();
      if (t) texts.push(t);
    });

    console.log(`[Parser] Рядків для парсингу: ${texts.length}`);

    // ── Білий список ICPC-2: тільки медичні діагнози ─────────────────────────
    // Адміністративні коди (A62, A67, A97, R45, R46, R50, R62, R31, X31 тощо)
    // відсутні тут і будуть відхилені.
    const VALID_ICPC = new Set([
      // Епізоди (A98 = Підтримання здоров'я — ОБОВ'ЯЗКОВО!)
      'A98',
      // Серцево-судинні
      'K22','K85','K86','K87','K74','K76',
      // Діабет / метаболізм
      'T07','T82','T83','T89','T90','W85',
      // Онкологія
      'D12','D75','K50','K51','N97',
      // ТБ-ризик (ICPC-2)
      'B90','A79','B72','B74',
      'D74','D76','D77','D78',
      'L71','N74','R84','R85',
      'U75','U76','U77',
      'T71','W72',
      'X75','X76','X77','Y77','Y78',
      'R95','R96','R79','R81','R82',
      'T05','T08','U28',
      'W78','W84','W90','W91','W92','W93',
      'Z06','Z01','Z02','Z03',
      'P15','P16','P17','P19',
      // ВІЛ-ризик (ICPC-2)
      'D72',
      'W71','W75','W76','W79','W80','W81','W82','W83',
      'X70','X71','X72','X73','X74','X90','X91','X92',
      'Y70','Y71','Y72','Y73','Y74','Y75','Y76',
    ]);

    const re = /\b([A-Z]\d{2}(?:\.\d{1,2})?)\b/g;

    texts.forEach(text => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const code = m[1];
        if (seen.has(code)) continue;

        // Чистий ICPC-2 (3 символи без крапки) — перевіряємо білий список
        if (/^[A-Z]\d{2}$/.test(code) && !VALID_ICPC.has(code)) {
          console.log(`[Parser] ⛔ ICPC відхилено: ${code} — "${text}"`);
          continue;
        }

        seen.add(code);
        diagnoses.push({ code, name: text });
        console.log(`[Parser] ✅ ${code} — "${text}"`);
      }
    });

    console.log(`[Parser] Знайдено діагнозів: ${diagnoses.length}`);
    return diagnoses;
  }

  checkRiskFactors(diagnoses) {
    const codes = [
      'K22','K85','P15','P16','P17',
      'T07','T82','T83','T89','T90',
      'Z80.3','Z80.4','Z80.0',
      'N97','W85','O24.4','Z83.3',
      'D12','K50','K51',
    ];
    return diagnoses.some(d => codes.includes(typeof d === 'string' ? d : d.code));
  }

  getData() {
    return this.patientData;
  }
}

console.log('[Medics Indicators] Parser.js завантажено (v3 — фільтрація ICPC-2)');
