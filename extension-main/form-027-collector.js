// ============================================================================
// FORM-027-COLLECTOR.JS
// Збирає дані для форми 027/о: епізоди (назва + діагноз) + взаємодії в межах
// епізоду (дата + місце надання послуг). Сортує епізоди за датою початку
// від найновіших до найстаріших; взаємодії всередині — так само.
// ============================================================================

class Form027Collector {
  constructor() {
    this.text = '';
  }

  async collect(progressCallback) {
    if (typeof DATA_COLLECTOR === 'undefined') {
      throw new Error('DATA_COLLECTOR не визначено');
    }

    try {
      if (progressCallback) progressCallback(10, 'Розкриття секцій...');
      await DATA_COLLECTOR.expandAllSections();
      await DATA_COLLECTOR.wait(800);

      if (progressCallback) progressCallback(60, 'Збір даних...');
      const episodes = this.parseEpisodes();

      if (progressCallback) progressCallback(85, 'Формування тексту...');
      this.text = this.buildText(episodes);

      if (progressCallback) progressCallback(95, 'Згортання секцій...');
      await DATA_COLLECTOR.collapseAllSections();

      if (progressCallback) progressCallback(100, 'Готово');
      return this.text;
    } catch (e) {
      try { await DATA_COLLECTOR.collapseAllSections(); } catch (_) {}
      throw e;
    }
  }

  parseEpisodes() {
    const items = document.querySelectorAll(
      '.c-collapse--item[collapse^="episode_"], .c-collapse--item[ng-attr-collapse^="episode_"]'
    );

    console.log(`[Form027] Знайдено DOM-епізодів: ${items.length}`);

    const episodes = [];
    items.forEach(item => {
      const diagnosisText = this.extractDiagnosisText(item);
      const startDate = this.extractStartDate(item);
      const encounters = this.extractEncounters(item);
      episodes.push({ diagnosisText, startDate, encounters });
      console.log(`[Form027] Епізод: ${diagnosisText} | ${startDate ? formatDate(startDate) : '?'} | взаємодій: ${encounters.length}`);
    });

    episodes.sort((a, b) => {
      const at = a.startDate ? a.startDate.getTime() : 0;
      const bt = b.startDate ? b.startDate.getTime() : 0;
      return bt - at;
    });

    return episodes;
  }

  extractDiagnosisText(episodeItem) {
    // <p class="c-collapse--item-info" ng-if="item.$primary_diagnose">
    //   <span ng-bind="item.$primary_diagnose.text">основний : R74 - ... | [МКХ10-АМ: J06.9 - ...]</span>
    // </p>
    const span = episodeItem.querySelector(
      'p.c-collapse--item-info span[ng-bind="item.$primary_diagnose.text"]'
    );
    if (span) {
      const t = span.textContent.trim();
      if (t) return t;
    }
    const nameEl = episodeItem.querySelector('p.c-collapse--item-name');
    if (nameEl) return nameEl.textContent.trim();
    return 'Невідомий епізод';
  }

  extractStartDate(episodeItem) {
    let date = null;
    episodeItem.querySelectorAll('p.c-collapse--item-info').forEach(p => {
      if (date) return;
      if (!p.textContent.includes('Дата початку:')) return;
      p.querySelectorAll('span').forEach(span => {
        if (date) return;
        const t = span.textContent.trim();
        if (t.length < 5 || t === 'Дата початку:') return;
        const d = parseDate(t);
        if (d) date = d;
      });
    });
    return date;
  }

  extractEncounters(episodeItem) {
    let containers = Array.from(episodeItem.querySelectorAll(
      '.c-collapse--item[collapse^="encounter_"], .c-collapse--item[ng-attr-collapse^="encounter_"]'
    ));

    if (containers.length === 0) {
      // Запасний варіант: знаходимо через кнопки toggle_encounter
      const buttons = episodeItem.querySelectorAll(
        'button.c-collapse--item-toggle[ng-click*="toggle_encounter"]'
      );
      const set = new Set();
      buttons.forEach(btn => {
        let el = btn.parentElement;
        while (el && el !== episodeItem) {
          if (el.classList && el.classList.contains('c-collapse--item') && el !== episodeItem) {
            set.add(el);
            break;
          }
          el = el.parentElement;
        }
      });
      containers = Array.from(set);
    }

    const encounters = [];
    containers.forEach(c => {
      const date = this.extractEncounterDate(c);
      const place = this.extractEncounterPlace(c);
      encounters.push({ date, place });
    });

    encounters.sort((a, b) => {
      const at = a.date ? a.date.getTime() : 0;
      const bt = b.date ? b.date.getTime() : 0;
      return bt - at;
    });

    return encounters;
  }

  extractEncounterDate(encEl) {
    let date = null;
    // 1) item-info / item-name у заголовку взаємодії
    encEl.querySelectorAll('p.c-collapse--item-info, p.c-collapse--item-name').forEach(p => {
      if (date) return;
      const t = p.textContent;
      const m = t.match(/(\d{1,2}\.\d{1,2}\.\d{4})/) ||
                t.match(/(\d{1,2}\s+[а-яА-ЯіІїЇєЄ]+\.?\s+\d{4})/);
      if (m) {
        const d = parseDate(m[1]);
        if (d) date = d;
      }
    });
    // 2) запасний — будь-який <span> у заголовку
    if (!date) {
      const head = encEl.querySelector('.c-collapse--item-head, .c-collapse--head, .c-collapse--item-info');
      if (head) {
        head.querySelectorAll('span').forEach(s => {
          if (date) return;
          const t = s.textContent.trim();
          const m = t.match(/(\d{1,2}\.\d{1,2}\.\d{4})/) ||
                    t.match(/(\d{1,2}\s+[а-яА-ЯіІїЇєЄ]+\.?\s+\d{4})/);
          if (m) {
            const d = parseDate(m[1]);
            if (d) date = d;
          }
        });
      }
    }
    return date;
  }

  extractEncounterPlace(encEl) {
    const text = encEl.textContent;
    // Порядок важливий: специфічні фрази раніше за загальні
    const patterns = [
      /візит за місцем проживання(?:\s+пацієнта)?/i,
      /за місцем проживання/i,
      /консультація онлайн/i,
      /телемедичн[аіої]+(?:\s+консультац[іяю])?/i,
      /(?:в|у)\s+закладі охорони здоров[яʼ'`]я/i,
      /амбулаторн[оі]/i,
      /стаціонар(?:но|ні)?/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[0].trim();
    }
    return '';
  }

  buildText(episodes) {
    if (episodes.length === 0) return 'Епізодів не знайдено';
    const lines = [];
    episodes.forEach(ep => {
      lines.push(`Епізод: ${ep.diagnosisText}`);
      if (ep.encounters.length === 0) {
        lines.push('  (взаємодій не знайдено)');
      } else {
        ep.encounters.forEach(enc => {
          const d = enc.date ? formatDate(enc.date) : 'дата невідома';
          const place = enc.place || 'місце не вказано';
          lines.push(`  ${d} — ${place}`);
        });
      }
      lines.push('');
    });
    return lines.join('\n').trim();
  }
}

const FORM_027_COLLECTOR = new Form027Collector();
console.log('[Medics Indicators] form-027-collector.js завантажено');
