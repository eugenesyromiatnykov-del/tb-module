// ============================================================================
// INDICATOR-MATCHER.JS - С ДЕТАЛЬНЫМИ ИНФОРМАЦИОННЫМИ ПОДСКАЗКАМИ
// ============================================================================

class IndicatorMatcher {
  constructor() {
    this.rules = null;
  }

  init(rules) {
    this.rules = rules;
    console.log('[IndicatorMatcher] Инициализирован с правилами:', rules ? rules.length : 0);
  }

  matchRules(collectedData) {
    console.log('[IndicatorMatcher] Начинаю сопоставление правил...');
    
    if (!this.rules) {
      if (typeof INDICATORS_RULES !== 'undefined') {
        this.rules = INDICATORS_RULES;
      } else {
        throw new Error('Правила индикаторов не загружены');
      }
    }

    if (!collectedData || !collectedData.patient) {
      throw new Error('Данные пациента не найдены');
    }

    if (!collectedData.analyzer) {
      throw new Error('Анализатор не найден в собранных данных');
    }

    const results = [];
    const patient = collectedData.patient;
    const analyzer = collectedData.analyzer;

    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      
      if (!rule.applies || typeof rule.applies !== 'function') {
        continue;
      }

      const isApplicable = rule.applies(patient);
      
      if (!isApplicable) {
        continue;
      }

      try {
        const ruleAnalysis = this.analyzeRuleManually(rule, patient, analyzer);

        if (!ruleAnalysis) {
          continue;
        }

        // КРИТИЧНО: логування для preventive-exam-65-plus
        if (rule.id === 'preventive-exam-65-plus') {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('[IndicatorMatcher] 🔍 ДІАГНОСТИКА: preventive-exam-65-plus');
          console.log('  status:', ruleAnalysis.status);
          console.log('  completed/total:', ruleAnalysis.completedCount, '/', ruleAnalysis.totalCount);
          console.log('  requiredActions:', ruleAnalysis.requiredActions.map(a => ({
            code: a.code,
            name: a.name.substring(0, 30),
            isCompleted: a.isCompleted,
            isConditional: a.isConditional
          })));
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }

        // Генерируем детальную причину применимости
        const applicabilityReason = this.getDetailedApplicabilityReason(rule, patient);

        const result = {
          rule: rule,
          status: ruleAnalysis.status,
          requiredActions: ruleAnalysis.requiredActions,
          isCompleted: ruleAnalysis.isCompleted,
          isPartial: ruleAnalysis.isPartial,
          isOverdue: ruleAnalysis.isOverdue,
          lastDate: ruleAnalysis.lastDate,
          nextDate: ruleAnalysis.nextDate,
          details: ruleAnalysis.details,
          applicabilityReason: applicabilityReason
        };

        results.push(result);
      } catch (error) {
        console.error(`[IndicatorMatcher] Ошибка при анализе правила ${i}:`, error);
      }
    }

    return results;
  }

  /**
   * Генерирует ДЕТАЛЬНОЕ объяснение почему индикатор применим
   */
  getDetailedApplicabilityReason(rule, patient) {
    const reasons = [];
    const diagnosisCodes = extractDiagnosisCodes(patient.diagnoses);

    // Возраст и пол
    if (rule.id === 'cvd-risk-combined') {
      if (patient.gender === 'M') {
        reasons.push(`✓ Вік: ${patient.age} років (чоловіки 40+)`);
      } else {
        reasons.push(`✓ Вік: ${patient.age} років (жінки 50+)`);
      }
      const hasRiskFactor = checkRiskFactors(diagnosisCodes, rule.riskFactors || []);
      if (hasRiskFactor) {
        const foundCodes = diagnosisCodes.filter(code => rule.riskFactors.includes(code));
        reasons.push(`✓ Фактори ризику: ${foundCodes.join(', ')}`);
      }
    } else if (rule.id === 'hypertension-compensation') {
      const foundCodes = diagnosisCodes.filter(code => ['K86', 'K87'].includes(code));
      reasons.push(`✓ Діагноз гіпертонії: ${foundCodes.join(', ')}`);
    } else if (rule.id === 'diabetes-screening') {
      const hasRiskFactor = checkRiskFactors(diagnosisCodes, rule.riskFactors || []);
      if (hasRiskFactor) {
        const foundCodes = diagnosisCodes.filter(code => rule.riskFactors.includes(code));
        reasons.push(`✓ Фактори ризику діабету: ${foundCodes.join(', ')}`);
      } else {
        reasons.push(`✓ Вік: ${patient.age} років (скринінг 45+)`);
      }
    } else if (rule.id.includes('prostate-cancer')) {
      reasons.push(`✓ Стать: чоловіча`);
      if (diagnosisCodes.includes('Z80.4')) {
        reasons.push(`✓ Вік: ${patient.age} років (40+ при Z80.4)`);
        reasons.push(`✓ Сімейний анамнез: Z80.4`);
      } else {
        reasons.push(`✓ Вік: ${patient.age} років (50+ без ФР)`);
      }
    } else if (rule.id.includes('colorectal-cancer')) {
      reasons.push(`✓ Вік: ${patient.age} років (50-75)`);
      const hasRiskFactor = checkRiskFactors(diagnosisCodes, rule.riskFactors || []);
      if (hasRiskFactor) {
        const foundCodes = diagnosisCodes.filter(code => rule.riskFactors.includes(code));
        reasons.push(`✓ Фактори ризику: ${foundCodes.join(', ')}`);
      }
    } else if (rule.id.includes('breast-cancer')) {
      reasons.push(`✓ Стать: жіноча`);
      const hasRiskFactor = checkRiskFactors(diagnosisCodes, rule.riskFactors || []);
      if (hasRiskFactor) {
        const foundCodes = diagnosisCodes.filter(code => rule.riskFactors.includes(code));
        reasons.push(`✓ Вік: ${patient.age} років (40-69 при ФР)`);
        reasons.push(`✓ Фактори ризику: ${foundCodes.join(', ')}`);
      } else {
        reasons.push(`✓ Вік: ${patient.age} років (50-69)`);
      }
    } else if (rule.id === 'tuberculosis-screening') {
      const foundCodes = diagnosisCodes.filter(code => rule.riskFactors.includes(code));
      reasons.push(`✓ Фактори ризику ТБ:`);
      reasons.push(foundCodes.slice(0, 5).join(', ') + (foundCodes.length > 5 ? '...' : ''));
    } else if (rule.id === 'hiv-screening') {
      const foundCodes = diagnosisCodes.filter(code => rule.riskFactors.includes(code));
      reasons.push(`✓ Індикаторні стани ВІЛ:`);
      reasons.push(foundCodes.slice(0, 5).join(', ') + (foundCodes.length > 5 ? '...' : ''));
    } else if (rule.id === 'preventive-exam-40-64') {
      reasons.push(`✓ Вік: ${patient.age} років (40-64)`);
    } else if (rule.id === 'preventive-exam-65-plus') {
      reasons.push(`✓ Вік: ${patient.age} років (65+)`);
      const conditions = [];
      const conditionCodes = [];
      if (diagnosisCodes.includes('K86') || diagnosisCodes.includes('K87')) {
        conditions.push('гіпертонія');
        conditionCodes.push(...diagnosisCodes.filter(code => ['K86', 'K87'].includes(code)));
      }
      if (diagnosisCodes.includes('K74') || diagnosisCodes.includes('K76')) {
        conditions.push('ССЗ');
        conditionCodes.push(...diagnosisCodes.filter(code => ['K74', 'K76'].includes(code)));
      }
      if (diagnosisCodes.includes('T89') || diagnosisCodes.includes('T90')) {
        conditions.push('діабет');
        conditionCodes.push(...diagnosisCodes.filter(code => ['T89', 'T90'].includes(code)));
      }
      if (conditions.length > 0) {
        reasons.push(`✓ Хронічні стани: ${conditions.join(', ')}`);
        reasons.push(`✓ Коди діагнозів: ${conditionCodes.join(', ')}`);
      }
    }

    // Периодичность
    const freq = rule.frequency ? rule.frequency(patient) : 12;
    if (freq === 3) {
      reasons.push('📅 Періодичність: раз на квартал');
    } else if (freq === 12) {
      reasons.push('📅 Періодичність: раз на рік');
    } else if (freq === 24) {
      reasons.push('📅 Періодичність: раз на 2 роки');
    }

    return reasons.join('\n');
  }

  analyzeRuleManually(rule, patient, analyzer) {
    const requiredActions = [];
    let completedCount = 0;
    let totalCount = 0;
    let allDates = [];

    if (rule.type === 'ОБСТЕЖЕННЯ' || rule.type === 'КОМПЛЕКСНА' || rule.type === 'ПРОФІЛАКТИЧНИЙ_ОГЛЯД') {
      const diagnosisCodes = extractDiagnosisCodes(patient.diagnoses);

      rule.requiredActions.forEach(action => {
        // ВИПРАВЛЕНО: якщо дія умовна — перевіряємо умову перед обробкою
        // Якщо умова не виконана — повністю пропускаємо дію (не додаємо в список)
        if (action.isConditional && action.conditionalCodes) {
          const conditionMet = action.conditionalCodes.some(c => diagnosisCodes.includes(c));
          if (!conditionMet) return; // пропускаємо HbA1c якщо немає T89/T90
        }

        let isCompleted = false;
        let date = null;
        let daysAgo = null;
        let value = null;

        if (action.searchIn === 'encounters') {
          const encounterKey = `ENCOUNTER_${action.code}`;
          const encounterAction = analyzer.encounterActions[encounterKey];
          isCompleted = !!encounterAction;
          
          if (isCompleted) {
            date = new Date();
            daysAgo = 0;
          }
        } else if (action.isEpisode || action.searchIn === 'episodes') {
          const episode = analyzer.episodes[action.code];
          isCompleted = !!episode;
          date = episode ? episode.date : null;
          daysAgo = episode ? episode.daysAgo : null;
        } else {
          const obs = analyzer.observations[action.code];
          isCompleted = !!(obs && obs.lastDate);
          date = obs ? obs.lastDate : null;
          daysAgo = obs ? obs.daysAgo : null;
          value = obs && obs.values && obs.values.length > 0 ? obs.values[0] : null;
        }

        if (isCompleted && date) {
          allDates.push({ date, daysAgo });
        }

        if (!action.isConditional && !action.isOrLogic) {
          totalCount++;
          if (isCompleted) completedCount++;
        }

        requiredActions.push({
          code: action.code,
          name: action.name,
          isCompleted: isCompleted,
          date: date,
          daysAgo: daysAgo,
          value: value,
          isConditional: action.isConditional || false,
          isEpisode: action.isEpisode || action.searchIn === 'episodes' || false,
          isEncounterAction: action.searchIn === 'encounters' || false,
          isOrLogic: action.isOrLogic || false
        });
      });
      
      const encounterActions = requiredActions.filter(a => a.isEncounterAction && a.isOrLogic);
      
      if (encounterActions.length > 0) {
        // Позначаємо всі як одну OR-групу
        const orGroupId = `or-group-${rule.id}-encounters`;
        encounterActions.forEach(a => { a.orGroupId = orGroupId; });

        const hasAnyCompleted = encounterActions.some(a => a.isCompleted);
        
        if (hasAnyCompleted) {
          encounterActions.forEach(a => {
            if (!a.isCompleted) {
              a.isAlternative = true;
            }
            a.isCompleted = true;
          });
        }

        // OR-група вносить рівно 1 у totalCount та completedCount
        // (дії з isOrLogic не були додані раніше через умову !action.isOrLogic)
        totalCount += 1;
        if (hasAnyCompleted) completedCount += 1;
        encounterActions.forEach(a => a.wasCountedInOrGroup = true);
      }
    } else if (rule.type === 'НАПРАВЛЕННЯ') {
      console.log(`[IndicatorMatcher] Аналіз НАПРАВЛЕННЯ для ${rule.id}`);
      console.log(`  → analyzer.referrals:`, Object.keys(analyzer.referrals || {}));
      
      const hasMultipleActions = rule.requiredActions.length > 1;
      const orGroupId = hasMultipleActions ? `or-group-${rule.id}-referrals` : null;
      const hasAny = rule.requiredActions.some(action => {
        const ref = analyzer.referrals[action.code];
        console.log(`  → Перевірка ${action.code}: ${ref ? 'знайдено' : 'немає'}, дата: ${ref?.date}`);
        return ref && ref.date;
      });

      rule.requiredActions.forEach(action => {
        const ref = analyzer.referrals[action.code];
        const isCompleted = !!(ref && ref.date);

        if (isCompleted && ref.date) {
          allDates.push({ date: ref.date, daysAgo: ref.daysAgo });
        }

        requiredActions.push({
          code: action.code,
          name: action.name,
          isCompleted: hasMultipleActions ? hasAny : isCompleted,
          date: ref ? ref.date : null,
          daysAgo: ref ? ref.daysAgo : null,
          isOrLogic: hasMultipleActions,
          isAlternative: hasMultipleActions && hasAny && !isCompleted,
          orGroupId: orGroupId
        });
      });

      totalCount = 1;
      completedCount = hasAny ? 1 : 0;
    } else if (rule.type === 'ДІАГНОСТИЧНИЙ_ЗВІТ') {
      const hasMultipleActions = rule.requiredActions.length > 1;
      const orGroupId = hasMultipleActions ? `or-group-${rule.id}-reports` : null;
      const hasAny = rule.requiredActions.some(action => {
        const report = analyzer.diagnosticReports[action.code];
        return report && report.date;
      });

      rule.requiredActions.forEach(action => {
        const report = analyzer.diagnosticReports[action.code];
        const isCompleted = !!(report && report.date);

        if (isCompleted && report.date) {
          allDates.push({ date: report.date, daysAgo: report.daysAgo });
        }

        requiredActions.push({
          code: action.code,
          name: action.name,
          isCompleted: hasMultipleActions ? hasAny : isCompleted,
          date: report ? report.date : null,
          daysAgo: report ? report.daysAgo : null,
          isOrLogic: hasMultipleActions,
          isAlternative: hasMultipleActions && hasAny && !isCompleted,
          orGroupId: orGroupId
        });
      });

      totalCount = 1;
      completedCount = hasAny ? 1 : 0;
    }

    const frequencyMonths = rule.frequency ? rule.frequency(patient) : 12;
    const frequencyDays = frequencyMonths * 30;

    // Проставляємо isExpired для кожного action
    // A98 — бессрочний епізод, ніколи не протерміновується
    const ETERNAL_CODES = ['A98'];
    requiredActions.forEach(a => {
      if (ETERNAL_CODES.includes(a.code)) {
        a.isExpired = false;
      } else if (a.isCompleted && a.daysAgo != null && a.daysAgo > frequencyDays) {
        a.isExpired = true;
      } else {
        a.isExpired = false;
      }
    });

    let isOverdue = false;
    let maxDaysAgo = 0;

    // Перевіряємо прострочення: якщо хоча б одна виконана дія протермінована
    const hasAnyExpired = requiredActions.some(a => a.isExpired === true);

    if (completedCount === totalCount && allDates.length > 0) {
      const mostRecentDate = allDates.sort((a, b) => a.daysAgo - b.daysAgo)[0];
      maxDaysAgo = mostRecentDate.daysAgo || 0;
      if (maxDaysAgo > frequencyDays) {
        isOverdue = true;
      }
    } else if (hasAnyExpired) {
      // Частково виконано, але деякі вже прострочені — теж overdue
      isOverdue = true;
      const expiredDays = allDates.map(d => d.daysAgo || 0);
      maxDaysAgo = expiredDays.length > 0 ? Math.max(...expiredDays) : 0;
    }

    let status = 'not_done';
    let isCompleted = false;
    let isPartial = false;

    if (completedCount === totalCount && totalCount > 0) {
      if (isOverdue) {
        status = 'overdue';
        isCompleted = false;
      } else {
        status = 'completed';
        isCompleted = true;
      }
    } else if (completedCount > 0) {
      // Якщо є хоча б одне прострочення — статус overdue, а не partial
      if (isOverdue) {
        status = 'overdue';
      } else {
        status = 'partial';
        isPartial = true;
      }
    }

    const lastDate = allDates.length > 0
      ? allDates.sort((a, b) => a.daysAgo - b.daysAgo)[0].date
      : null;

    // ==========================================================================
    // РЕКОМЕНДОВАНІ НАПРАВЛЕННЯ (recommendedReferrals)
    // Відображаються в картці та TODO якщо індикатор не виконано АБО просрочено.
    // НЕ впливають на completedCount / totalCount / статус індикатора.
    // ==========================================================================
    if (rule.recommendedReferrals && rule.recommendedReferrals.length > 0 && status !== 'completed') {
      rule.recommendedReferrals.forEach(ref => {
        const existingReferral = analyzer.referrals[ref.code];
        const refCompleted = !!(existingReferral && existingReferral.date);
        const refDaysAgo = existingReferral?.daysAgo ?? null;
        const refExpired = refCompleted && refDaysAgo != null && refDaysAgo > frequencyDays;
        requiredActions.push({
          code: ref.code,
          name: ref.name,
          isCompleted: refCompleted,
          date: existingReferral?.date || null,
          daysAgo: refDaysAgo,
          isExpired: refExpired,
          isRecommendedReferral: true,
          isOrLogic: false,
          isConditional: false,
          isEpisode: false,
          isEncounterAction: false
        });
      });
    }

    const nextDate = lastDate 
      ? new Date(lastDate.getTime() + frequencyMonths * 30 * 24 * 60 * 60 * 1000) 
      : null;

    return {
      status: status,
      requiredActions: requiredActions,
      isCompleted: isCompleted,
      isPartial: isPartial,
      isOverdue: isOverdue,
      lastDate: lastDate,
      nextDate: nextDate,
      completedCount: completedCount,
      totalCount: totalCount,
      details: isOverdue 
        ? [`Виконано ${completedCount} з ${totalCount}, але протерміновано (${Math.floor(maxDaysAgo / 30)} міс. тому)`]
        : [`Виконано ${completedCount} з ${totalCount}`]
    };
  }
}

function extractDiagnosisCodes(diagnoses) {
  if (!diagnoses) return [];
  return diagnoses
    .map(d => {
      if (typeof d === "string") return d;
      return d && d.code ? d.code : null;
    })
    .filter(d => d !== null);
}

function checkRiskFactors(diagnosisCodes, riskFactors) {
  if (!diagnosisCodes || !riskFactors) return false;
  return diagnosisCodes.some(code => riskFactors.includes(code));
}

const INDICATOR_MATCHER = new IndicatorMatcher();

console.log('[Medics Indicators] indicator-matcher.js (детальні підказки)');
