// ============================================================================
// DATA-COLLECTOR.JS
// Улучшения: убраны избыточные логи при сворачивании,
// подчищен вывод parseData
// ============================================================================

class DataCollector {
  constructor() {
    this.collectedData = null;
    this.expandedButtons = [];
  }

  async collectData() {
    console.log('[DataCollector] ── Початок збору даних ──');
    try {
      await this.expandAllSections();
      // КРИТИЧНО: блок "Дії:" має ng-if="encounter.actions_display" і
      // завантажується асинхронно через API після кліку на взаємодію.
      // Чекаємо поки DOM повністю перестане мутувати — гарантія що всі
      // async-рендери Angular завершені і код K45/D45/T45 точно у DOM.
      await this.waitForDomStable(450, 5000);
      const data = await this.parseData();
      await this.collapseAllSections();
      console.log('[DataCollector] ── Збір завершено ──');
      this.collectedData = data;
      return data;
    } catch (error) {
      console.error('[DataCollector] Помилка:', error);
      await this.collapseAllSections();
      throw error;
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Чекає поки DOM не буде "тихим" протягом quietMs мс підряд (або до maxMs).
   * Дебансовий MutationObserver: кожна мутація скидає таймер тиші.
   * Так ми гарантовано дочекаємось завершення всіх async-рендерів Angular
   * (зокрема ng-if блоків що залежать від API-відповідей).
   */
  waitForDomStable(quietMs = 450, maxMs = 5000) {
    return new Promise(resolve => {
      let lastMutation = Date.now();
      const observer = new MutationObserver(() => {
        lastMutation = Date.now();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'ng-hide']
      });
      const start = Date.now();
      const tick = setInterval(() => {
        const quiet = Date.now() - lastMutation;
        const total = Date.now() - start;
        if (quiet >= quietMs || total >= maxMs) {
          clearInterval(tick);
          observer.disconnect();
          const reason = quiet >= quietMs ? 'stable' : 'timeout';
          console.log(`[DataCollector] DOM ${reason} (${total}мс, тиша ${quiet}мс)`);
          resolve(reason);
        }
      }, 100);
    });
  }

  async expandAllSections() {
    this.expandedButtons = [];

    const findButtons = () => {
      const result = [];

      // "Показати всі / більше"
      document.querySelectorAll('button[ng-click*="closed_limit"], button[ng-click*="limit"], button[ng-click*="showlimit"]').forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        if ((text.includes('показати всі') || text.includes('показати більше')) &&
            !text.includes('сховати') && btn.offsetParent !== null &&
            !result.some(b => b.element === btn)) {
          result.push({ element: btn, type: 'show_all' });
        }
      });

      // Епізоди
      document.querySelectorAll('button.c-collapse--item-toggle[ng-click*="open_episode"]').forEach(btn => {
        if (btn.offsetParent !== null && !btn.classList.contains('is-opened'))
          result.push({ element: btn, type: 'open_episode' });
      });

      // Взаємодії
      document.querySelectorAll('button.c-collapse--item-toggle[ng-click*="toggle_encounter"]').forEach(btn => {
        if (btn.offsetParent !== null && !btn.classList.contains('is-opened'))
          result.push({ element: btn, type: 'toggle_encounter' });
      });

      return result;
    };

    // Паралельні кліки: всі кнопки одного типу за раз — Angular поглине digest
    // одним пакетом замість N послідовних. Зовнішній цикл потрібен бо клік
    // show_all/open_episode може додати нові кнопки в DOM.
    const clickAll = async (type) => {
      for (let i = 0; i < 20; i++) {
        const btns = findButtons().filter(b => b.type === type);
        if (btns.length === 0) break;
        btns.forEach(b => {
          b.element.click();
          this.expandedButtons.push(b);
        });
        await this.wait(500);
      }
    };

    console.log('[DataCollector] Розкриваю секції...');
    await clickAll('show_all');
    await clickAll('open_episode');
    await clickAll('toggle_encounter');

    // Вкладки направлень (Активні / Погашені)
    const tabs = document.querySelectorAll('button[ng-click*="set_active_tab"]');
    for (const tab of tabs) {
      if (tab.offsetParent === null) continue;
      tab.click();
      await this.wait(400);
      await clickAll('show_all');
      await clickAll('open_episode');
      await clickAll('toggle_encounter');
    }

    console.log(`[DataCollector] Розкрито кнопок: ${this.expandedButtons.length}`);
  }

  async collapseAllSections() {
    if (this.expandedButtons.length === 0) return;

    // Згортаємо групами в зворотньому порядку: спочатку взаємодії, потім
    // епізоди, потім show_all. Всередині групи кліки паралельні —
    // незалежні елементи можуть закриватися одночасно.
    const groups = ['toggle_encounter', 'open_episode', 'show_all'];
    for (const type of groups) {
      const group = this.expandedButtons.filter(b => b.type === type);
      if (group.length === 0) continue;
      group.forEach(({ element }) => {
        try {
          if (element && document.body.contains(element) && element.offsetParent !== null) {
            element.click();
          }
        } catch (e) { /* ігноруємо */ }
      });
      await this.wait(200);
    }
    this.expandedButtons = [];
    console.log('[DataCollector] Секції згорнуто');
  }

  async parseData() {
    console.log('[DataCollector] Парсинг даних...');

    if (typeof MedicsParser === 'undefined') throw new Error('MedicsParser не визначено');
    const parser = new MedicsParser();
    const patientData = parser.parseAll();
    if (!patientData) throw new Error('Не вдалось розпарсити дані пацієнта');

    if (typeof IndicatorAnalyzer === 'undefined') throw new Error('IndicatorAnalyzer не визначено');
    if (typeof INDICATORS_RULES === 'undefined') throw new Error('INDICATORS_RULES не визначено');

    const analyzer = new IndicatorAnalyzer(patientData, INDICATORS_RULES);
    analyzer.parseEpisodes();
    analyzer.parseObservations();
    // КРИТИЧНО: parseReferrals НЕ викликаємо тут — викличемо окремо в UI ПЕРЕД matchRules
    analyzer.parseDiagnosticReports();
    analyzer.parseEncounterActions();

    console.log('[DataCollector] Дані зібрано (БЕЗ направлень — вони будуть зібрані окремо)');

    return {
      patient: patientData,
      analyzer,
      observations: analyzer.observations,
      referrals: analyzer.referrals, // поки що пусто
      diagnosticReports: analyzer.diagnosticReports,
      episodes: analyzer.episodes,
      encounterActions: analyzer.encounterActions
    };
  }

  getData() {
    return this.collectedData;
  }
}

const DATA_COLLECTOR = new DataCollector();
console.log('[Medics Indicators] Data-collector.js завантажено');
