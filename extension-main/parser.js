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
        immunizations: this.parseImmunizations(),
        lastAdpM: null,
        hasRiskFactors: false,
      };

      if (this.patientData.birthDate) {
        this.patientData.age = calculateAge(this.patientData.birthDate);
      }

      this.patientData.hasRiskFactors = this.checkRiskFactors(this.patientData.diagnoses);
      this.patientData.lastAdpM = this.getLastAdpM();

      log('Парсинг завершено', 'success');
      log(`Вік=${this.patientData.age}, Стать=${this.patientData.gender}, Діагнозів=${this.patientData.diagnoses.length}, Імунізацій=${this.patientData.immunizations.length}`, 'info');

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

  // ── Імунізації ─────────────────────────────────────────────────────────
  // Структура у деталях взаємодії:
  //   div.c-collapse--output-item[ng-repeat="immunization in encounter.immunizations"]
  //     [Статус:][Назва вакцини:][Виробник:][...][Дата проведення вакцинації:]
  //     div[ng-repeat*="protocol"]  ← вкладені описи протоколів (парсимо окремо)
  parseImmunizations() {
    const blocks = document.querySelectorAll(
      'div.c-collapse--output-item[ng-repeat*="immunization"]'
    );
    console.log(`[Parser] parseImmunizations — блоків ${blocks.length}`);

    const immunizations = [];
    blocks.forEach((block) => {
      const main = this._parseImmFields(block, { skipProtocols: true });
      const protocols = Array.from(
        block.querySelectorAll('div[ng-repeat*="protocol"]')
      ).map((pb) => this._parseImmFields(pb, { skipProtocols: false }));

      const imm = {
        performer: main['Виконав:'] || null,
        status: main['Статус:'] || null,
        vaccine_name: main['Назва вакцини:'] || null,
        manufacturer: main['Виробник:'] || null,
        lot_number: main['Серія вакцини:'] || null,
        expiration_date: parseDate(main['Термін придатності:'] || ''),
        dose_quantity: main['Доза:'] || null,
        site: main['Місце введення:'] || null,
        route: main['Шлях введення вакцини:'] || null,
        result: main['Результат:'] || null,
        reasons: main['Причини вакцинації:'] || null,
        date: parseDate(main['Дата проведення вакцинації:'] || ''),
        protocols: protocols.map((p) => ({
          dose_sequence: p['Порядковий номер дози:'] || null,
          description: p['Опис протоколу:'] || null,
          authority: p['Автор протоколу:'] || null,
          series: p['Етап вакцинації:'] || null,
          series_doses: p['Кількість доз по протоколу:'] || null,
          target_diseases: p['Протидія загрозам:'] || null,
        })),
      };

      if (!imm.vaccine_name && !imm.date) return;
      immunizations.push(imm);
      console.log(
        `[Parser] ✅ Імунізація: ${imm.vaccine_name ?? '?'} — ${main['Дата проведення вакцинації:'] || '?'}`
      );
    });

    immunizations.sort((a, b) => {
      const ta = a.date ? a.date.getTime() : -Infinity;
      const tb = b.date ? b.date.getTime() : -Infinity;
      return tb - ta;
    });

    return immunizations;
  }

  // Збираємо пари «output-title : output-text» в межах root. Якщо skipProtocols —
  // ігноруємо титли, що сидять усередині вкладених protocol-блоків (інакше
  // поля протоколу затирали б основні поля імунізації).
  _parseImmFields(root, { skipProtocols }) {
    const pairs = {};
    root.querySelectorAll('.c-collapse--output-title').forEach((title) => {
      if (skipProtocols) {
        const proto = title.closest('div[ng-repeat*="protocol"]');
        if (proto && root.contains(proto)) return;
      }
      const label = title.textContent.trim();
      if (
        !label ||
        label === 'Імунізації:' ||
        label === 'Опис протоколу вакцинації:'
      ) {
        return;
      }
      const values = [];
      let sib = title.nextElementSibling;
      while (sib && !sib.classList?.contains?.('c-collapse--output-title')) {
        if (sib.classList?.contains?.('c-collapse--output-text')) {
          const t = sib.textContent
            .replace(/ /g, ' ')
            .trim()
            .replace(/;\s*$/, '')
            .trim();
          if (t) values.push(t);
        }
        sib = sib.nextElementSibling;
      }
      if (values.length > 0) {
        pairs[label] = values.length === 1 ? values[0] : values;
      }
    });
    return pairs;
  }

  // Остання валідна АДП-М (вакцина проти дифтерії та правця, зменшений вміст
  // антигену). entered_in_error пропускаємо: на сторінці такий запис має
  // інший текст статусу та клас text-orange — фільтруємо за status === 'Виконана'.
  getLastAdpM() {
    const list = this.patientData?.immunizations ?? [];
    const re = /АДП[\s\-]?[Мм]/i;
    for (const imm of list) {
      if (!imm.date) continue;
      if (!imm.vaccine_name || !re.test(imm.vaccine_name)) continue;
      if (imm.status && imm.status !== 'Виконана') continue;
      return imm;
    }
    return null;
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
