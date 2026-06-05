// ============================================================================
// ANALYZER.JS - ВЕРСІЯ 4.0
// Виправлення:
//   1. parseEpisodes    — читає реальні DOM-епізоди (p.c-collapse--item-name +
//                         дата з p.c-collapse--item-info "Дата початку:")
//                         ЗАМІСТЬ конвертації діагнозів без дат
//   2. parseReferrals   — перебирає ВСІ вкладки (Активні → Погашені → Активні),
//                         збирає кожну сторінку окремо, знімає обмеження limitTo,
//                         дата створення = термін дії − 1 рік
//   3. parseEncounterActions — шукає тільки всередині секцій "Дії:" конкретного
//                         елемента взаємодії (не по всьому textContent блоку)
// ============================================================================

class IndicatorAnalyzer {
  constructor(patientData, rules) {
    this.patientData = patientData;
    this.rules = rules;
    this.observations = {};
    this.referrals = {};
    this.diagnosticReports = {};
    this.episodes = {};
    this.encounterActions = {};
    this.statistics = {
      total: 0,
      completed: 0,
      partial: 0,
      overdue: 0,
      notDone: 0
    };
  }

  // ==========================================================================
  // ВИПРАВЛЕНО: parseEncounterActions
  // Проблема: .textContent брав весь блок включно з секціями "Діагнози:",
  // "Причини звернення:" — звідти випадково читались ICPC-коди.
  // Виправлення: беремо тільки текст span-а з атрибутом що відповідає "Дії:"
  // ==========================================================================
  parseEncounterActions() {
    const encounterActions = {};
    console.log('[Analyzer] Парсую Взаємодії (дії)...');

    // Шукаємо DOM-елементи "Дії:" — секції c-collapse--output-item
    const titleElements = document.querySelectorAll('p.c-collapse--output-title');
    let actionsFound = 0;

    titleElements.forEach(titleEl => {
      if (titleEl.textContent.trim() !== 'Дії:') return;

      const block = titleEl.closest('.c-collapse--output-item') || titleEl.parentElement;
      if (!block) return;

      // Текст тільки з секції "Дії:" цього конкретного блоку
      const actionsText = block.textContent;

      if (/\bD45\b/.test(actionsText)) {
        encounterActions['ENCOUNTER_D45'] = { code: 'ENCOUNTER_D45', found: true };
        actionsFound++;
      }
      if (/\bK45\b/.test(actionsText)) {
        encounterActions['ENCOUNTER_K45'] = { code: 'ENCOUNTER_K45', found: true };
        actionsFound++;
      }
      if (/\bT45\b/.test(actionsText)) {
        encounterActions['ENCOUNTER_T45'] = { code: 'ENCOUNTER_T45', found: true };
        actionsFound++;
      }
    });

    this.encounterActions = encounterActions;
    console.log(`[Analyzer] Знайдені дії: ${Object.keys(encounterActions).join(', ') || 'немає'}`);
    return encounterActions;
  }

  // ==========================================================================
  // ВИПРАВЛЕНО: parseEpisodes
  // Проблема: читав діагнози з patientData — у них немає дат, тому
  //   indicator-matcher завжди бачив "дата=null" і вважав A98 невиконаним.
  // Виправлення: читаємо реальні DOM-елементи епізодів з датами.
  //
  // Структура сторінки:
  //   div.c-collapse--item[collapse="episode_1"]
  //     p.c-collapse--item-name  → "A98 - Підтримання здоров'я / профілактика"
  //     p.c-collapse--item-info  → "Дата початку:" + span "06 серп. 2025 р."
  // ==========================================================================
  parseEpisodes() {
    const episodes = {};
    console.log('[Analyzer] parseEpisodes — читаю DOM...');

    // Angular рендерить атрибут collapse="episode_N" або ng-attr-collapse="episode_N"
    const episodeItems = document.querySelectorAll(
      '.c-collapse--item[collapse^="episode_"], .c-collapse--item[ng-attr-collapse^="episode_"]'
    );

    episodeItems.forEach(item => {
      const nameEl = item.querySelector('p.c-collapse--item-name');
      if (!nameEl) return;

      const nameText = nameEl.textContent.trim();
      // Код — перший токен до " - " або " – "
      const codeMatch = nameText.match(/^([A-Za-z]\d{2,5}(?:[.-]\d+)?)\s*[-–]/);
      if (!codeMatch) return;

      const code = codeMatch[1];

      // Шукаємо дату в p.c-collapse--item-info з текстом "Дата початку:"
      let episodeDate = null;
      item.querySelectorAll('p.c-collapse--item-info').forEach(p => {
        if (!p.textContent.includes('Дата початку:')) return;
        p.querySelectorAll('span').forEach(span => {
          const t = span.textContent.trim();
          if (t.length < 5 || t === 'Дата початку:') return;
          const d = parseDate(t);
          if (d && !episodeDate) episodeDate = d;
        });
      });

      if (!episodes[code]) {
        episodes[code] = {
          code,
          name: nameText,
          date: episodeDate,
          daysAgo: episodeDate ? this.calculateDaysAgo(episodeDate) : null
        };
        console.log(`[Analyzer] Епізод: ${code} | ${episodeDate ? formatDate(episodeDate) : 'дата невідома'}`);
      }
    });

    this.episodes = episodes;
    const keys = Object.keys(episodes);
    console.log(`[Analyzer] Знайдено епізодів: ${keys.length} | Коди: ${keys.join(', ')}`);
    return episodes;
  }

  // ==========================================================================
  // parseObservations — без змін
  // ==========================================================================
  parseObservations() {
    const observations = {};

    let observationsTitle = document.querySelector('#observations') ||
                            document.querySelector('[id*="observations"]');

    if (!observationsTitle) {
      document.querySelectorAll('p[class*="block-title"]').forEach(title => {
        if (!observationsTitle && title.textContent.includes('Спостереження'))
          observationsTitle = title;
      });
    }

    if (!observationsTitle) {
      console.log('[Analyzer] Блок спостережень не найден');
      return observations;
    }

    console.log('[Analyzer] Блок спостережень найден');

    // Шукаємо всі листові елементи в блоці спостережень і парсимо кожен окремо
    // Щоб уникнути "перетікання" значення одного коду до іншого
    let currentElement = observationsTitle.nextElementSibling;
    const observationElements = [];

    while (currentElement) {
      if (currentElement.classList &&
          (currentElement.classList.contains('block-title') ||
           currentElement.classList.contains('p-doctor-office--block-title'))) break;
      observationElements.push(currentElement);
      currentElement = currentElement.nextElementSibling;
    }

    // Спочатку збираємо всі рядки-рядки спостережень (кожен елемент — окремий запис)
    // Якщо елемент містить кілька кодів — розбиваємо на дочірні елементи
    const parseElementRecursive = (el) => {
      const text = el.textContent;
      const codeMatches = text.match(/\b(\d{4,5}-\d)\b/g);
      if (!codeMatches) return;

      if (codeMatches.length === 1) {
        // Один код — парсимо цей елемент напряму
        const code = codeMatches[0];
        if (!observations[code]) {
          observations[code] = { code, values: [], lastDate: null, daysAgo: null };
        }

        // Значення
        const valueMatch = text.match(/Результат:\s*([\d.,]+(?:\s+[\d.,]+)?)\s*\[/);
        if (valueMatch) {
          const val = valueMatch[1].trim();
          if (!observations[code].values.includes(val)) {
            observations[code].values.push(val);
          }
        }

        // Дата
        const dateMatch = text.match(/(\d{1,2}\s+[а-яА-ЯіІїЇєЄ]+\.?\s+\d{4}\s+р\.)/);
        const date = dateMatch ? parseDate(dateMatch[1]) : null;
        if (date && !isNaN(date.getTime())) {
          if (!observations[code].lastDate || date > observations[code].lastDate) {
            observations[code].lastDate = date;
            observations[code].daysAgo = this.calculateDaysAgo(date);
          }
        }
      } else {
        // Кілька кодів в одному елементі — рекурсивно обробляємо дочірні
        // або розбиваємо текст по рядках
        let processedByChildren = false;
        if (el.children.length > 0) {
          const childrenWithCode = Array.from(el.children).filter(c =>
            /\b\d{4,5}-\d\b/.test(c.textContent)
          );
          if (childrenWithCode.length > 1) {
            childrenWithCode.forEach(child => parseElementRecursive(child));
            processedByChildren = true;
          }
        }

        if (!processedByChildren) {
          // Розбиваємо по рядках і шукаємо код+значення в кожному рядку
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          lines.forEach(line => {
            const lineCode = line.match(/\b(\d{4,5}-\d)\b/);
            if (!lineCode) return;
            const code = lineCode[1];
            if (!observations[code]) {
              observations[code] = { code, values: [], lastDate: null, daysAgo: null };
            }
            const valueMatch = line.match(/Результат:\s*([\d.,]+(?:\s+[\d.,]+)?)\s*\[/);
            if (valueMatch) {
              const val = valueMatch[1].trim();
              if (!observations[code].values.includes(val)) {
                observations[code].values.push(val);
              }
            }
            const dateMatch = line.match(/(\d{1,2}\s+[а-яА-ЯіІїЇєЄ]+\.?\s+\d{4}\s+р\.)/);
            const date = dateMatch ? parseDate(dateMatch[1]) : null;
            if (date && !isNaN(date.getTime())) {
              if (!observations[code].lastDate || date > observations[code].lastDate) {
                observations[code].lastDate = date;
                observations[code].daysAgo = this.calculateDaysAgo(date);
              }
            }
          });
        }
      }
    };

    observationElements.forEach(el => parseElementRecursive(el));

    this.observations = observations;
    console.log(`[Analyzer] Знайдено спостережень: ${Object.keys(observations).length} | Коди: ${Object.keys(observations).join(', ')}`);
    return observations;
  }

  // ==========================================================================
  // parseDiagnosticReports — без змін
  // ==========================================================================
  parseDiagnosticReports() {
    const diagnosticReports = {};

    let diagnosticTitle = document.querySelector('#diagnostic-reports');
    if (!diagnosticTitle) {
      document.querySelectorAll('p[class*="block-title"]').forEach(title => {
        if (!diagnosticTitle && title.textContent.includes('Діагностичні звіти'))
          diagnosticTitle = title;
      });
    }

    if (!diagnosticTitle) {
      console.log('[Analyzer] Блок діагностичних звітів не найден');
      return diagnosticReports;
    }

    console.log('[Analyzer] ✅ Блок діагностичних звітів найден');

    let currentElement = diagnosticTitle.nextElementSibling;
    let blockText = '';

    while (currentElement) {
      if (currentElement.classList &&
          (currentElement.classList.contains('block-title') ||
           currentElement.classList.contains('p-doctor-office--block-title'))) break;
      blockText += currentElement.textContent + '\n';
      currentElement = currentElement.nextElementSibling;
    }

    const servicePatterns = [
      /\b([YXD]\d{5})\b/g,
      /\b(\d{5}-\d{2})\b/g,
      /\b([ВABCDEFGHIJKLMNOPQRSTUVWXYZ]\d{5})\b/g
    ];

    const foundCodes = new Set();
    servicePatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(blockText)) !== null) foundCodes.add(match[1]);
    });

    console.log(`[Analyzer] Знайдено унікальних кодів діагностичних звітів: ${foundCodes.size} | Коди: ${Array.from(foundCodes).join(', ')}`);

    foundCodes.forEach(code => {
      const codeIndex = blockText.indexOf(code);
      if (codeIndex === -1) return;

      const context = blockText.substring(Math.max(0, codeIndex - 200), Math.min(blockText.length, codeIndex + 200));
      const dateMatch = context.match(/(\d{1,2}\s+[а-яА-ЯіІїЇєЄ]+\.\s+\d{4}\s+р\.)/);
      const date = dateMatch ? parseDate(dateMatch[1]) : null;

      if (date) console.log(`[Analyzer] ✅ Діагностичний звіт ${code}: ${formatDate(date)}`);
      else       console.log(`[Analyzer] ⚠️ Діагностичний звіт ${code}: дата не знайдена`);

      diagnosticReports[code] = { code, date, daysAgo: date ? this.calculateDaysAgo(date) : null };
    });

    this.diagnosticReports = diagnosticReports;
    console.log(`[Analyzer] ✅ ВСЬОГО діагностичних звітів: ${Object.keys(diagnosticReports).length}`);
    return diagnosticReports;
  }

  // ==========================================================================
  // ВИПРАВЛЕНО: parseReferrals
  //
  // Проблема 1 — неповний збір: Angular обмежує показ через limitTo.
  //   Після data-collector натискає кнопку "Показати всі" для épізодів,
  //   але для направлень своя кнопка "js-c-directions--btn".
  //   Крім того, код читав тільки поточну вкладку (Активні), не перемикаючись.
  //
  // Проблема 2 — неправильна дата: на сторінці показується "Термін дії"
  //   (= дата закінчення), а не дата виписки. Дата виписки = термін − 1 рік.
  //
  // Виправлення:
  //   а) Перед парсингом клікаємо "Детальніше" та "показати більше" якщо є
  //   б) Збираємо направлення з УСІХ вкладок послідовно:
  //      Активні → Погашені → (повертаємось на) Активні
  //   в) date = expirationDate − 1 рік
  // ==========================================================================
  async parseReferrals() {
    const referrals = {};
    console.log('[Analyzer] 🔍 Починаю парсинг направлень... v0.2');

    // Беремо ОСТАННІЙ service-request-list на сторінці — це секція внизу сторінки
    // з усіма направленнями пацієнта. Перші екземпляри можуть бути всередині
    // розкритих епізодів і містити лише підмножину направлень конкретного епізоду.
    const allServiceRequestLists = document.querySelectorAll('service-request-list');
    if (allServiceRequestLists.length === 0) {
      console.log('[Analyzer] ❌ service-request-list не знайдено');
      return referrals;
    }

    const serviceRequestList = allServiceRequestLists[allServiceRequestLists.length - 1];
    if (allServiceRequestLists.length > 1) {
      console.log(`[Analyzer] ⚠️ Знайдено ${allServiceRequestLists.length} екземплярів service-request-list — використовуємо останній (загальний список)`);
    }

    const container = serviceRequestList.querySelector('.c-directions');
    if (!container) {
      console.log('[Analyzer] ❌ .c-directions не знайдено');
      return referrals;
    }

    console.log('[Analyzer] ✅ Контейнер направлень знайдено');

    // ─── Допоміжна: чекаємо поки Angular завершить завантаження вкладки ──────
    // Умова завершення: лоадер зник І (є .c-directions--item АБО є повідомлення про порожній список)
    // MutationObserver реагує миттєво на зміни DOM замість polling кожні 300мс.
    const waitForTabLoad = (timeoutMs = 10000) => new Promise(resolve => {
      const check = () => {
        const loader = container.querySelector('[ng-show="loading_service_requests"]:not(.ng-hide)');
        if (loader) return null;
        const items = container.querySelectorAll('.c-directions--item');
        if (items.length > 0) return 'items';
        const body = container.querySelector('.c-directions--body');
        const bodyText = body ? body.textContent.trim() : '';
        if (bodyText.length > 5 && !bodyText.includes('loader')) return 'empty';
        return null;
      };

      // Може бути вже готово
      const initial = check();
      if (initial) { resolve(initial); return; }

      const observer = new MutationObserver(() => {
        const result = check();
        if (result) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(result);
        }
      });
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'ng-show']
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve('timeout');
      }, timeoutMs);
    });

    // ─── КРОК 1: чекаємо завантаження АКТИВНОЇ вкладки ──────────────────────
    const activeTabName = (() => {
      const active = container.querySelector('button.c-tab--link.is-active');
      return active ? active.textContent.trim() : 'Активні';
    })();
    console.log(`[Analyzer] ⏳ Чекаю завантаження активної вкладки "${activeTabName}"...`);
    const activeResult = await waitForTabLoad(10000);
    // Розкриваємо список ПЕРЕД читанням (активна вкладка теж може бути обмежена)
    await this.expandDirectionsList(container);
    const activeItems = container.querySelectorAll('.c-directions--item');
    console.log(`[Analyzer] 📋 Активна вкладка "${activeTabName}": ${activeItems.length} елементів (${activeResult})`);
    if (activeItems.length > 0) {
      this.extractReferralsFromItems(activeItems, referrals);
      this.referrals = referrals;
    }

    // ─── КРОК 2: перебираємо неактивні вкладки ───────────────────────────────
    const tabButtons = Array.from(container.querySelectorAll('button.c-tab--link'));
    console.log(`[Analyzer] Знайдено вкладок: ${tabButtons.length}`);

    const initialActiveTab = tabButtons.find(b => b.classList.contains('is-active')) || tabButtons[0];

    for (const tabBtn of tabButtons) {
      const tabName = tabBtn.textContent.trim();
      if (['Шаблони', 'Помилкові'].includes(tabName)) continue;
      if (tabBtn.classList.contains('is-active')) continue; // вже прочитали

      console.log(`[Analyzer] 📑 Перемикаємось на: "${tabName}"`);
      tabBtn.click();

      const result = await waitForTabLoad(10000);
      const items = container.querySelectorAll('.c-directions--item');
      console.log(`[Analyzer]   → "${tabName}": ${items.length} елементів (${result})`);

      if (items.length > 0) {
        await this.expandDirectionsList(container);
        const itemsAfter = container.querySelectorAll('.c-directions--item');
        this.extractReferralsFromItems(itemsAfter, referrals);
        this.referrals = referrals;
      }
    }

    // ─── КРОК 3: повертаємось на початкову вкладку ───────────────────────────
    if (initialActiveTab && !initialActiveTab.classList.contains('is-active')) {
      initialActiveTab.click();
      await this.wait(500);
    }

    // Фінальна затримка для завершення всіх async операцій Angular
    await this.wait(500);

    this.referrals = referrals;
    const keys = Object.keys(referrals);
    console.log(`[Analyzer] ✅ ВСЬОГО направлень: ${keys.length} | Коди: ${keys.join(', ')}`);
    return referrals;
  }

  /**
   * Розкриває список направлень якщо він обмежений через limitTo/пагінацію
   */
  async expandDirectionsList(container) {
    for (let i = 0; i < 10; i++) {
      // Кнопка "показати більше" специфічна для .c-directions
      const moreBtn = container.querySelector('.js-c-directions--btn');
      if (!moreBtn || moreBtn.offsetParent === null) break;
      // Перевіряємо що кнопка видима і активна (не "Детальніше")
      const btnText = moreBtn.textContent.trim().toLowerCase();
      if (!btnText.includes('більше') && !btnText.includes('всі') && !btnText.includes('ще')) break;
      console.log(`[Analyzer]   → Клікаю "${moreBtn.textContent.trim()}"...`);
      moreBtn.click();
      await this.wait(400);
    }
  }

  /**
   * Витягує коди та дати з масиву DOM-елементів направлень
   * Дата виписки = термін дії − 1 рік (бо сторінка показує термін дії)
   */
  extractReferralsFromItems(items, referrals) {
    items.forEach(item => {
      // Код: шукаємо в усіх p.c-directions--item-code (не тільки з fa-medkit)
      // Паттерн: літера(и)+5 цифр (D36003, Y34003, A67003, S67002...)
      //       або 5цифр-2цифри (59300-00, 57512-00)
      const codeParas = item.querySelectorAll('p.c-directions--item-code');
      let code = null;

      for (const p of codeParas) {
        const text = p.textContent.trim();
        const m = text.match(/\b([A-ZАБВГДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ]\d{5})\b/i) ||
                  text.match(/\b([A-Za-z]\d{5})\b/) ||
                  text.match(/\b(\d{5}-\d{2})\b/);
        if (m) { code = m[1]; break; }
      }

      // Запасний варіант: шукаємо код у всьому тексті елемента
      if (!code) {
        const fullText = item.textContent;
        const m = fullText.match(/\b([A-Za-z]\d{5})\b/) ||
                  fullText.match(/\b(\d{5}-\d{2})\b/);
        if (m) code = m[1];
      }

      if (!code) return;

      // Дата: p.c-directions--item-code.date-until або будь-який текст з "Термін дії"
      let expirationDate = null;
      const dateParas = item.querySelectorAll('p.c-directions--item-code.date-until');
      for (const p of dateParas) {
        const spans = p.querySelectorAll('span');
        for (const span of spans) {
          const t = span.textContent.trim();
          if (t.length < 5 || t.includes('Термін')) continue;
          const d = parseDate(t);
          if (d) { expirationDate = d; break; }
        }
        if (!expirationDate) {
          // Пробуємо знайти дату прямо в тексті параграфа
          const d = parseDate(p.textContent);
          if (d) expirationDate = d;
        }
        if (expirationDate) break;
      }

      // Запасний варіант: шукаємо дату в усьому тексті елемента
      if (!expirationDate) {
        const allText = item.textContent;
        const termMatch = allText.match(/Термін дії[^:]*:\s*(.{5,30})/);
        if (termMatch) {
          expirationDate = parseDate(termMatch[1]);
        }
        if (!expirationDate) {
          // Останній варіант: перша дата в тексті
          const dateMatch = allText.match(/(\d{1,2}\s+[а-яА-ЯіІїЇєЄ]+\.?\s+\d{4}\s*р\.?)/);
          if (dateMatch) expirationDate = parseDate(dateMatch[1]);
        }
      }

      // Дата виписки = термін дії − 1 рік
      let creationDate = null;
      if (expirationDate) {
        creationDate = new Date(expirationDate);
        creationDate.setFullYear(creationDate.getFullYear() - 1);
        creationDate.setDate(creationDate.getDate() - 1);
      }

      const daysAgo = creationDate ? this.calculateDaysAgo(creationDate) : null;

      // Якщо дату не вдалось розпарсити — використовуємо сьогодні як запасний варіант
      // (направлення ТОЧНО існує, просто дату не вдалось знайти)
      const effectiveDate = creationDate || new Date();
      const effectiveDaysAgo = daysAgo ?? 0;

      // Зберігаємо; якщо код вже є — залишаємо найсвіжіше
      if (!referrals[code] || (effectiveDaysAgo < (referrals[code].daysAgo ?? Infinity))) {
        referrals[code] = { code, date: effectiveDate, expirationDate, daysAgo: effectiveDaysAgo, dateIsApproximate: !creationDate };
        console.log(`[Analyzer] Направлення: ${code} | виписано: ${creationDate ? formatDate(creationDate) : 'невідомо (≈сьогодні)'} (${effectiveDaysAgo} дн.) | термін до: ${expirationDate ? formatDate(expirationDate) : '?'}`);
      }
    });
  }

  /**
   * Чекаємо появи елементів направлень (Angular рендерить асинхронно)
   */
  waitForDirectionItems(container, timeout = 3000) {
    return new Promise(resolve => {
      if (container.querySelectorAll('.c-directions--item').length > 0) {
        resolve();
        return;
      }
      console.log('[Analyzer] ⏳ Чекаю елементів направлень...');
      const observer = new MutationObserver(() => {
        if (container.querySelectorAll('.c-directions--item').length > 0) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
    });
  }

  /**
   * Проста затримка
   */
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Розрахунок кількості днів від сьогодні
   */
  calculateDaysAgo(date) {
    if (!date || isNaN(date.getTime())) return null;
    return Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
  }

  /**
   * Аналіз всіх індикаторів
   */
  async analyzeAll() {
    console.log('[Analyzer] Початок аналізу індикаторів...');

    this.parseObservations();
    await this.parseReferrals();
    this.parseDiagnosticReports();
    this.parseEpisodes();
    this.parseEncounterActions();

    const results = [];

    this.rules.forEach(rule => {
      if (!rule.applies(this.patientData)) {
        return;
      }

      console.log(`[Analyzer] Аналіз індикатора: ${rule.id}`);

      const requiredStatus = this.analyzeRequiredActions(rule);
      const status = this.determineIndicatorStatus(rule, requiredStatus);

      results.push({ rule, status, requiredActions: requiredStatus });
      this.updateStatistics(status);
    });

    console.log(`[Analyzer] Аналіз завершено. Індикаторів: ${results.length}`);
    return results;
  }

  /**
   * Аналіз необхідних дій для правила
   */
  analyzeRequiredActions(rule) {
    if (!rule.requiredActions) return [];

    if (rule.type === 'ДІАГНОСТИЧНИЙ_ЗВІТ') {
      return this.analyzeDiagnosticReportsWithOrLogic(rule.requiredActions);
    }
    if (rule.type === 'НАПРАВЛЕННЯ') {
      return this.analyzeReferralsWithOrLogic(rule.requiredActions);
    }
    if (rule.type === 'КОМПЛЕКСНА') {
      return this.analyzeComplexIndicator(rule);
    }
    if (rule.type === 'ПРОФІЛАКТИЧНИЙ_ОГЛЯД') {
      return this.analyzePreventiveExam(rule);
    }

    // ОБСТЕЖЕННЯ
    return rule.requiredActions.map(action => {
      if (action.isEpisode) {
        const episode = this.episodes[action.code];
        const found = !!episode;
        console.log(`[Analyzer] Епізод ${action.code}: ${found ? 'ЗНАЙДЕНО' : 'не знайдено'}`);
        return {
          code: action.code,
          name: action.name,
          isCompleted: found,
          date: episode ? episode.date : null,
          daysAgo: episode ? episode.daysAgo : null,
          isEpisode: true
        };
      }

      const obs = this.observations[action.code];
      return {
        code: action.code,
        name: action.name,
        isCompleted: !!(obs && obs.lastDate),
        value: obs?.values[0] || null,
        date: obs?.lastDate || null,
        daysAgo: obs?.daysAgo || null
      };
    });
  }

  /**
   * Аналіз ПРОФІЛАКТИЧНИЙ_ОГЛЯД (індикатор 40–64)
   */
  analyzePreventiveExam(rule) {
    const results = [];

    const a98 = this.episodes['A98'];
    results.push({
      code: 'A98',
      name: 'Епізод з діагнозом A98',
      isCompleted: !!a98,
      isEpisode: true,
      date: a98?.date || null,
      daysAgo: a98?.daysAgo || null
    });

    ['8480-6', '8462-4', '39156-5', '56086-2', '14647-2', '14743-9'].forEach(code => {
      const obs = this.observations[code];
      const def = rule.requiredActions.find(a => a.code === code);
      results.push({
        code,
        name: def?.name || code,
        isCompleted: !!(obs && obs.lastDate),
        date: obs?.lastDate || null,
        daysAgo: obs?.daysAgo || null
      });
    });

    return results;
  }

  /**
   * Аналіз КОМПЛЕКСНА (індикатор 65+)
   */
  analyzeComplexIndicator(rule) {
    const results = [];

    const a98 = this.episodes['A98'];
    results.push({
      code: 'A98',
      name: 'Епізод з діагнозом A98',
      isCompleted: !!a98,
      isEpisode: true,
      date: a98?.date || null,
      daysAgo: a98?.daysAgo || null
    });

    const hasEncounterAction =
      this.encounterActions['ENCOUNTER_D45'] ||
      this.encounterActions['ENCOUNTER_K45'] ||
      this.encounterActions['ENCOUNTER_T45'];

    results.push({
      code: 'ENCOUNTER_ACTIONS',
      name: 'Взаємодія з кодами D45, K45 або T45 в Дії',
      isCompleted: !!hasEncounterAction,
      isEncounterAction: true,
      isOrLogic: true
    });

    ['8480-6', '8462-4', '39156-5', '56086-2', '14647-2', '14743-9'].forEach(code => {
      const obs = this.observations[code];
      const def = rule.requiredActions.find(a => a.code === code);
      results.push({
        code,
        name: def?.name || code,
        isCompleted: !!(obs && obs.lastDate),
        date: obs?.lastDate || null,
        daysAgo: obs?.daysAgo || null
      });
    });

    const diagnosisCodes = (this.patientData.diagnoses || []).map(d =>
      typeof d === 'string' ? d : d?.code
    ).filter(Boolean);
    const hasDiabetes = diagnosisCodes.some(d => ['T89', 'T90'].includes(d));

    if (hasDiabetes) {
      const hba1c = this.observations['4548-4'];
      results.push({
        code: '4548-4',
        name: "Глікований гемоглобін (HbA1c) — обов'язково для T89/T90",
        isCompleted: !!(hba1c && hba1c.lastDate),
        isConditional: true,
        date: hba1c?.lastDate || null,
        daysAgo: hba1c?.daysAgo || null
      });
    }

    return results;
  }

  /**
   * Аналіз діагностичних звітів з логікою АБО
   */
  analyzeDiagnosticReportsWithOrLogic(requiredActions) {
    let completedCode = null;
    let completedData = null;

    for (const action of requiredActions) {
      const report = this.diagnosticReports[action.code];
      if (report && report.date) {
        completedCode = action.code;
        completedData = report;
        break;
      }
    }

    console.log(`[Analyzer] Діагностичні звіти: шукаю один з [${requiredActions.map(a => a.code).join(', ')}] → ${completedCode || 'не знайдено'}`);

    return requiredActions.map(action => ({
      code: action.code,
      name: completedCode && action.code !== completedCode ? action.name + ' (альтернатива)' : action.name,
      isCompleted: !!completedCode,
      date: action.code === completedCode ? completedData.date : null,
      daysAgo: action.code === completedCode ? completedData.daysAgo : null,
      isOrLogic: true,
      isAlternative: !!completedCode && action.code !== completedCode
    }));
  }

  /**
   * Аналіз направлень з логікою АБО
   */
  analyzeReferralsWithOrLogic(requiredActions) {
    let completedCode = null;
    let completedData = null;

    for (const action of requiredActions) {
      const ref = this.referrals[action.code];
      if (ref && ref.date) {
        completedCode = action.code;
        completedData = ref;
        break;
      }
    }

    console.log(`[Analyzer] Направлення: шукаю один з [${requiredActions.map(a => a.code).join(', ')}] → ${completedCode || 'не знайдено'}`);

    return requiredActions.map(action => ({
      code: action.code,
      name: completedCode && action.code !== completedCode ? action.name + ' (альтернатива)' : action.name,
      isCompleted: !!completedCode,
      date: action.code === completedCode ? completedData.date : null,
      daysAgo: action.code === completedCode ? completedData.daysAgo : null,
      isOrLogic: true,
      isAlternative: !!completedCode && action.code !== completedCode
    }));
  }

  /**
   * Визначення статусу індикатора
   */
  determineIndicatorStatus(rule, requiredStatus) {
    const frequency = rule.frequency(this.patientData);
    let completed = 0;

    if (rule.type === 'НАПРАВЛЕННЯ' || rule.type === 'ДІАГНОСТИЧНИЙ_ЗВІТ') {
      completed = requiredStatus.some(r => r.isCompleted && !r.isAlternative) ? 1 : 0;
    } else if (rule.type === 'КОМПЛЕКСНА' || rule.type === 'ПРОФІЛАКТИЧНИЙ_ОГЛЯД') {
      completed = requiredStatus.filter(r => r.isCompleted && !r.isConditional).length;
    } else {
      completed = requiredStatus.filter(r => r.isCompleted).length;
    }

    const total = requiredStatus.filter(r => !r.isConditional && !r.isAlternative).length;

    let isOverdue = false;
    for (const action of requiredStatus) {
      if (action.isCompleted && action.daysAgo != null && !action.isAlternative) {
        if (Math.floor(action.daysAgo / 30) > frequency) {
          isOverdue = true;
          break;
        }
      }
    }

    let state;
    let details;
    if (completed === total && total > 0 && !isOverdue) {
      state = 'COMPLETED';
      details = ['Вимога виконана в строк'];
    } else if (completed === total && total > 0 && isOverdue) {
      state = 'OVERDUE';
      details = [`Потребує оновлення (${frequency} міс.)`];
    } else if (completed > 0) {
      state = 'PARTIAL';
      details = [`Виконано ${completed} з ${total}`];
    } else {
      state = 'NOT_DONE';
      details = ['Потрібна вимога'];
    }

    const lastDate = requiredStatus
      .filter(r => r.date && !r.isAlternative)
      .sort((a, b) => b.date - a.date)[0]?.date || null;

    const nextDueDate = lastDate
      ? new Date(lastDate.getTime() + frequency * 30 * 24 * 60 * 60 * 1000)
      : null;

    return { state, completed, total, isOverdue, lastDate, nextDate: nextDueDate, frequency, details };
  }

  /**
   * Оновлення статистики
   */
  updateStatistics(status) {
    this.statistics.total++;
    switch (status.state) {
      case 'COMPLETED': this.statistics.completed++; break;
      case 'PARTIAL':   this.statistics.partial++;   break;
      case 'OVERDUE':   this.statistics.overdue++;   break;
      case 'NOT_DONE':  this.statistics.notDone++;   break;
    }
  }

  getStatistics() {
    return this.statistics;
  }
}

console.log('[Medics Indicators] Analyzer.js завантажено (v4.0)');
