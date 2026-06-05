// ============================================================================
// UI.JS - ФИНАЛЬНАЯ ВЕРСИЯ С ПРОГРЕСС-БАРОМ И УЛУЧШЕНИЯМИ
// ============================================================================

function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

class MedicsIndicatorUI {
    constructor() {
        this.widget = null;
        this.isExpanded = true;
        this.isAnalyzing = false;
        this.analysisProgress = 0;
        // Масштаб: 'S'=0.72, 'M'=1.0, 'L'=1.18.
        // Якщо користувач сам не вибрав — підбираємо за шириною вьюпорту,
        // щоб на ноутбуках 13-14" не вилазив за межі і не зливався.
        const scaleMap = { S: 0.72, M: 1.0, L: 1.18 };
        const saved = localStorage.getItem('mi-scale');
        if (saved && scaleMap[saved]) {
            this.scaleKey = saved;
        } else {
            const vw = window.innerWidth || 1400;
            this.scaleKey = vw < 1280 ? 'S' : vw < 1680 ? 'M' : 'L';
        }
        this.scaleMap = scaleMap;
    }

    init() {
        log('Ініціалізація UI віджета...', 'info');
        if (document.getElementById('medics-indicators-widget')) {
            log('Віджет вже існує', 'warning');
            return;
        }
        this.createWidget();
        this.attachEventListeners();
        this.addInfoIconStyles();
        this.applyScale(this.scaleKey);
        this.restorePosition();
        // Базова інформація про пацієнта одразу — без розкриття секцій
        setTimeout(() => this.updatePatientBanner(), 200);
        log('UI віджет створено', 'success');
    }

    applyScale(key) {
        this.scaleKey = key;
        localStorage.setItem('mi-scale', key);
        // Масштаб змінює ширину і базовий font-size; усе всередині задано
        // в em, тому паддинги/іконки масштабуються разом з font-size.
        const widthMap = { S: '320px', M: '420px', L: '520px' };
        const fontMap  = { S: '12px',  M: '14px',  L: '16px'  };
        if (this.widget) {
            this.widget.style.setProperty('width',     widthMap[key],  'important');
            this.widget.style.setProperty('font-size', fontMap[key],   'important');
        }
        // На S — заголовок коротший і дрібніший, але не зникає, щоб юзер
        // бачив що відкрите взагалі.
        const title = document.querySelector('.mi-title-text');
        if (title) {
            title.textContent = key === 'S' ? 'Indicators' : 'Medics Indicators';
            title.style.fontSize = key === 'S' ? '0.88em' : '';
        }
        // Підсвітка кнопок масштабу
        ['S','M','L'].forEach(k => {
            const btn = document.getElementById(`mi-scale-${k}`);
            if (!btn) return;
            btn.style.background  = k === key ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.15)';
            btn.style.fontWeight  = k === key ? '700' : '400';
        });
    }

    addInfoIconStyles() {
        if (document.getElementById('mi-info-icon-styles')) return;

        const styleTag = document.createElement('style');
        styleTag.id = 'mi-info-icon-styles';
        styleTag.textContent = `
            .mi-info-icon {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 16px !important;
                height: 16px !important;
                min-width: 16px !important;
                min-height: 16px !important;
                border-radius: 50% !important;
                background: #cbd5e1 !important;
                color: #475569 !important;
                font-size: 10px !important;
                font-weight: 700 !important;
                font-style: italic !important;
                font-family: Georgia, serif !important;
                cursor: help !important;
                position: relative !important;
                flex-shrink: 0 !important;
                transition: background 0.15s ease, color 0.15s ease !important;
            }
            .mi-info-icon:hover {
                background: #64748b !important;
                color: white !important;
            }
            .mi-info-icon-absolute {
                position: absolute !important;
                top: 12px !important;
                right: 12px !important;
                z-index: 10 !important;
            }
            .mi-info-tooltip {
                visibility: hidden !important;
                position: fixed !important;
                background: #333 !important;
                color: white !important;
                padding: 10px 14px !important;
                border-radius: 6px !important;
                font-size: 12px !important;
                font-weight: normal !important;
                white-space: pre-line !important;
                z-index: 1000000 !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
                pointer-events: none !important;
                max-width: 320px !important;
                text-align: left !important;
                line-height: 1.5 !important;
            }
            .mi-info-icon:hover .mi-info-tooltip {
                visibility: visible !important;
            }
            /* Підсумкові плитки (фільтри) — звичайний скрол, без sticky */
            .mi-summary-sticky {
                padding: 0 0 8px 0 !important;
                margin: 0 0 12px 0 !important;
            }
            .mi-tiles {
                display: grid !important;
                grid-template-columns: repeat(5, 1fr) !important;
                gap: 4px !important;
                margin: 0 0 6px 0 !important;
            }
            .mi-tile {
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 2px !important;
                padding: 8px 2px !important;
                border: 2px solid transparent !important;
                border-radius: 8px !important;
                background: #f5f6f8 !important;
                cursor: pointer !important;
                transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease !important;
                font-family: inherit !important;
                color: inherit !important;
                outline: none !important;
            }
            .mi-tile:hover {
                transform: translateY(-1px) !important;
                background: #eef0f4 !important;
            }
            .mi-tile.is-active {
                background: #fff !important;
                box-shadow: 0 2px 6px rgba(0,0,0,0.08) !important;
            }
            .mi-tile-count {
                font-size: 18px !important;
                font-weight: 700 !important;
                line-height: 1 !important;
            }
            .mi-tile-label {
                font-size: 10px !important;
                line-height: 1.1 !important;
                color: #666 !important;
                text-align: center !important;
                white-space: nowrap !important;
            }
            .mi-legend {
                font-size: 10px !important;
                color: #888 !important;
                line-height: 1.4 !important;
                padding: 2px 4px !important;
                margin: 0 !important;
            }
            .mi-filter-empty {
                padding: 16px !important;
                background: #f8f9fa !important;
                border: 1px dashed #ced4da !important;
                border-radius: 8px !important;
                text-align: center !important;
                color: #6c757d !important;
                font-size: 13px !important;
                margin: 0 0 12px 0 !important;
            }
            /* Картка індикатора */
            .mi-indicator-card { transition: box-shadow 0.15s ease, transform 0.15s ease !important; }
            .mi-indicator-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.1) !important; }
            /* ── Analyze loading state (v5.0.1) ───────────────────────────── */
            /* Indeterminate top strip — replaces the old #mi-progress-container.
               Lives just under the patient banner; ~2px so it doesn't add
               visual height when off, but is clearly noticeable when on. */
            #mi-loading-strip {
                position: relative !important;
                height: 0 !important;
                overflow: hidden !important;
                background: #e2e8f0 !important;
                transition: height 0.15s ease !important;
                flex-shrink: 0 !important;
            }
            #mi-loading-strip.is-on { height: 2px !important; }
            #mi-loading-strip::before {
                content: '' !important;
                position: absolute !important;
                left: -40% !important;
                top: 0 !important;
                height: 100% !important;
                width: 40% !important;
                background: linear-gradient(90deg, transparent 0%, #0f172a 50%, transparent 100%) !important;
                animation: mi-loading-slide 1.2s ease-in-out infinite !important;
            }
            @keyframes mi-loading-slide {
                0%   { left: -40%; }
                100% { left: 100%; }
            }
            /* In-button spinner */
            .mi-spinner {
                display: inline-block !important;
                width: 12px !important;
                height: 12px !important;
                border: 2px solid rgba(255, 255, 255, 0.35) !important;
                border-top-color: #ffffff !important;
                border-radius: 50% !important;
                animation: mi-spin 0.7s linear infinite !important;
                vertical-align: middle !important;
                margin-right: 6px !important;
            }
            @keyframes mi-spin { to { transform: rotate(360deg); } }
            #mi-analyze-btn.is-loading,
            #mi-form027-btn.is-loading {
                opacity: 0.85 !important;
                cursor: progress !important;
                pointer-events: none !important;
            }

            /* Patient banner — slim single-row strip under header (v5.0.0) */
            .mi-patient-banner {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                padding: 6px 12px !important;
                background: #f8fafc !important;
                border-bottom: 1px solid #e2e8f0 !important;
                font-size: 12px !important;
                color: #475569 !important;
                line-height: 1.3 !important;
                margin: 0 !important;
                flex-shrink: 0 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            .mi-patient-banner-name {
                font-weight: 600 !important;
                color: #0f172a !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            .mi-patient-banner-meta {
                color: #94a3b8 !important;
                font-size: 11px !important;
            }
        `;
        document.head.appendChild(styleTag);
    }

    // ─── Швидкий збір базової інформації про пацієнта без розкриття секцій ──
    getQuickPatientInfo() {
        const nameEl = document.querySelector('.c-patient-info-card--user-name');
        const name = nameEl ? nameEl.textContent.trim() : '';

        let age = null;
        try {
            const label = typeof findElementByText === 'function' ? findElementByText('Дата народження') : null;
            if (label) {
                let el = label.parentElement;
                for (let i = 0; i < 5 && el; i++) {
                    const m = el.textContent.match(/(\d{2}\.\d{2}\.\d{4})/);
                    if (m) {
                        const d = parseDate(m[1]);
                        if (d) age = calculateAge(d);
                        break;
                    }
                    el = el.parentElement;
                }
            }
        } catch (_) {}

        let gender = null;
        try {
            if (typeof GENDER_DETECTOR !== 'undefined' && GENDER_DETECTOR.detectGender) {
                gender = GENDER_DETECTOR.detectGender();
            }
        } catch (_) {}

        return { name, age, gender };
    }

    updatePatientBanner(info) {
        const banner = document.getElementById('mi-patient-banner');
        const nameSpan = document.getElementById('mi-patient-name');
        const metaSpan = document.getElementById('mi-patient-meta');
        if (!banner || !nameSpan || !metaSpan) return;

        const data = info || this.getQuickPatientInfo();
        if (!data.name) {
            banner.style.setProperty('display', 'none', 'important');
            return;
        }

        nameSpan.textContent = data.name;
        const meta = [];
        if (data.age != null) meta.push(`${data.age} років`);
        if (data.gender === 'M') meta.push('♂ чол.');
        else if (data.gender === 'F') meta.push('♀ жін.');
        metaSpan.textContent = meta.length ? '• ' + meta.join(', ') : '';

        banner.style.setProperty('display', 'flex', 'important');
    }

    // ─── Збереження/відновлення позиції віджета ─────────────────────────────
    savePosition() {
        if (!this.widget) return;
        try {
            const rect = this.widget.getBoundingClientRect();
            const pos = {
                left: Math.round(rect.left),
                bottom: Math.round(window.innerHeight - rect.bottom)
            };
            localStorage.setItem('mi-position', JSON.stringify(pos));
        } catch (_) {}
    }

    restorePosition() {
        if (!this.widget) return;
        try {
            const raw = localStorage.getItem('mi-position');
            if (!raw) return;
            const pos = JSON.parse(raw);
            if (typeof pos.left !== 'number' || typeof pos.bottom !== 'number') return;
            const clamped = this.clampPosition(pos.left, pos.bottom);
            this.widget.style.left = `${clamped.left}px`;
            this.widget.style.bottom = `${clamped.bottom}px`;
            this.widget.style.right = 'auto';
            this.widget.style.top = 'auto';
        } catch (_) {}
    }

    // ─── Сводна секція (плитки + легенда + фільтр) ──────────────────────────
    renderSummarySection(results) {
        // Виключаємо «Результат»-індикатори з підрахунку (як у completion bar)
        const actionable = results.filter(r => !r.rule.name.includes('Результат'));
        const counts = { completed: 0, overdue: 0, partial: 0, not_done: 0 };
        actionable.forEach(r => {
            if (counts[r.status] !== undefined) counts[r.status]++;
        });
        const total = actionable.length;

        const tiles = [
            { key: 'all',       count: total,            color: '#334155', icon: '📊', label: 'Усі' },
            { key: 'completed', count: counts.completed, color: '#10b981', icon: '✅', label: 'Виконано' },
            { key: 'overdue',   count: counts.overdue,   color: '#f59e0b', icon: '⏰', label: 'Прострочено' },
            { key: 'partial',   count: counts.partial,   color: '#eab308', icon: '⚠️', label: 'Частково' },
            { key: 'not_done',  count: counts.not_done,  color: '#ef4444', icon: '❌', label: 'Не виконано' }
        ];

        let html = `<div class="mi-summary-sticky"><div class="mi-tiles">`;
        tiles.forEach(t => {
            const isActive = t.key === 'all';
            const activeBorder = isActive ? `border-color: ${t.color} !important;` : '';
            html += `<button class="mi-tile ${isActive ? 'is-active' : ''}" data-filter="${t.key}" type="button" style="${activeBorder}">
                <span class="mi-tile-count" style="color: ${t.color} !important;">${t.count}</span>
                <span class="mi-tile-label">${t.icon} ${escapeHtml(t.label)}</span>
            </button>`;
        });
        html += `</div>`;
        html += `<p class="mi-legend">✅ виконано в строк&nbsp;&nbsp;•&nbsp;&nbsp;⏰ потребує оновлення&nbsp;&nbsp;•&nbsp;&nbsp;⚠️ частково&nbsp;&nbsp;•&nbsp;&nbsp;❌ не виконано</p>`;
        html += `</div>`;
        html += `<div id="mi-filter-empty" class="mi-filter-empty" style="display: none;">Немає індикаторів у цьому фільтрі</div>`;
        return html;
    }

    applyFilter(filterKey) {
        const tiles = document.querySelectorAll('.mi-tile');
        tiles.forEach(t => {
            const active = t.dataset.filter === filterKey;
            t.classList.toggle('is-active', active);
            // Підсвічуємо рамку плитки активним кольором (з її ж count-span)
            const countEl = t.querySelector('.mi-tile-count');
            const color = countEl ? countEl.style.color : '';
            t.style.setProperty('border-color', active && color ? color : 'transparent', 'important');
        });

        let visibleCount = 0;
        document.querySelectorAll('.mi-indicator-card').forEach(card => {
            const status = card.dataset.status;
            const show = (filterKey === 'all') || (status === filterKey);
            card.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });

        // Ховаємо порожні категорії
        document.querySelectorAll('.mi-category-block').forEach(block => {
            const hasVisible = Array.from(block.querySelectorAll('.mi-indicator-card'))
                .some(c => c.style.display !== 'none');
            block.style.display = hasVisible ? '' : 'none';
        });

        const empty = document.getElementById('mi-filter-empty');
        if (empty) empty.style.display = visibleCount === 0 ? 'block' : 'none';
    }

    attachFilterListeners() {
        document.querySelectorAll('.mi-tile').forEach(tile => {
            tile.addEventListener('click', () => {
                const filter = tile.dataset.filter;
                // Повторний клік на активну плитку → повернутись до «Усі»
                if (tile.classList.contains('is-active') && filter !== 'all') {
                    this.applyFilter('all');
                } else {
                    this.applyFilter(filter);
                }
            });
        });
    }

    createInfoIcon(tooltip, isAbsolute = false) {
        const className = isAbsolute ? 'mi-info-icon mi-info-icon-absolute' : 'mi-info-icon';
        return `<span class="${className}">i<span class="mi-info-tooltip">${escapeHtml(tooltip)}</span></span>`;
    }

    createWidget() {
        const widget = document.createElement('div');
        widget.id = 'medics-indicators-widget';
        // v5.0.1: max-height auto-expands up to 67vh (2/3 screen) when content
        // overflows; height stays at auto so small content gives small widget.
        widget.style.cssText = `position: fixed !important; bottom: 16px !important; right: 16px !important; width: 420px !important; max-width: min(33vw, calc(100vw - 32px)) !important; height: auto !important; max-height: 67vh !important; background: #ffffff !important; border-radius: 10px !important; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.06) !important; z-index: 999999 !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important; font-size: 13px !important; line-height: 1.45 !important; color: #0f172a !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; border: 1px solid #e2e8f0 !important; margin: 0 !important; padding: 0 !important; transition: max-height 0.2s ease !important;`;

        widget.innerHTML = `
            <div id="mi-header" style="display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 8px !important; padding: 8px 12px !important; background: #0f172a !important; color: white !important; border-radius: 10px 10px 0 0 !important; cursor: move !important; flex-shrink: 0 !important; margin: 0 !important;">
                <div style="display: flex !important; align-items: center !important; gap: 6px !important; font-weight: 600 !important; font-size: 13px !important; margin: 0 !important; min-width: 0 !important;">
                    <span class="mi-title-text" style="overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; letter-spacing: 0.2px !important;">Indicators</span>
                </div>
                <div id="mi-header-actions" style="display: flex !important; gap: 4px !important; align-items: center !important; margin: 0 !important; flex-shrink: 0 !important;">
                    <div style="display: flex !important; gap: 0 !important; background: rgba(255,255,255,0.08) !important; border-radius: 4px !important; padding: 1px !important;">
                        <button id="mi-scale-S" style="padding: 1px 6px !important; background: transparent !important; color: rgba(255,255,255,0.65) !important; border: none !important; border-radius: 3px !important; cursor: pointer !important; font-size: 10px !important; font-weight: 600 !important; margin: 0 !important; transition: all 0.15s !important; line-height: 1.4 !important;">S</button>
                        <button id="mi-scale-M" style="padding: 1px 6px !important; background: transparent !important; color: rgba(255,255,255,0.65) !important; border: none !important; border-radius: 3px !important; cursor: pointer !important; font-size: 10px !important; font-weight: 600 !important; margin: 0 !important; transition: all 0.15s !important; line-height: 1.4 !important;">M</button>
                        <button id="mi-scale-L" style="padding: 1px 6px !important; background: transparent !important; color: rgba(255,255,255,0.65) !important; border: none !important; border-radius: 3px !important; cursor: pointer !important; font-size: 10px !important; font-weight: 600 !important; margin: 0 !important; transition: all 0.15s !important; line-height: 1.4 !important;">L</button>
                    </div>
                    <button id="mi-toggle-btn" style="padding: 1px 8px !important; background: rgba(255, 255, 255, 0.12) !important; color: white !important; border: none !important; border-radius: 4px !important; cursor: pointer !important; font-size: 14px !important; line-height: 1 !important; margin: 0 !important; transition: background 0.2s !important; flex-shrink: 0 !important;">−</button>
                </div>
            </div>

            <div id="mi-patient-banner" class="mi-patient-banner" style="display: none !important;">
                <span id="mi-patient-name" class="mi-patient-banner-name"></span>
                <span id="mi-patient-meta" class="mi-patient-banner-meta"></span>
            </div>

            <div id="mi-loading-strip"></div>

            <div id="mi-widget-body" style="padding: 10px !important; overflow-y: auto !important; overflow-x: hidden !important; flex: 1 !important; background: #ffffff !important; margin: 0 !important; min-height: 0 !important;">
                <div id="mi-results" style="display: none !important; margin: 0 !important;"></div>
                <div id="mi-form027-section" style="display: none !important; margin: 12px 0 0 0 !important; padding: 10px !important; background: #fffbeb !important; border: 1px solid #fde68a !important; border-radius: 8px !important;">
                    <div style="display: flex !important; align-items: center !important; gap: 8px !important; margin: 0 0 8px 0 !important;">
                        <span style="font-weight: 600 !important; color: #92400e !important; flex: 1 !important; font-size: 12px !important;">Виписка для форми 027/о</span>
                        <button id="mi-form027-copy-btn" style="background: #10b981 !important; color: white !important; border: none !important; border-radius: 6px !important; padding: 4px 10px !important; font-size: 11px !important; font-weight: 600 !important; cursor: pointer !important; margin: 0 !important; transition: background 0.15s ease !important;">Копіювати</button>
                    </div>
                    <textarea id="mi-form027-textarea" readonly style="width: 100% !important; min-height: 160px !important; max-height: 40vh !important; padding: 8px !important; border: 1px solid #e2e8f0 !important; border-radius: 6px !important; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace !important; font-size: 11px !important; line-height: 1.45 !important; resize: vertical !important; box-sizing: border-box !important; background: white !important; color: #0f172a !important; margin: 0 !important;"></textarea>
                </div>
            </div>

            <div id="mi-footer" style="display: flex !important; align-items: center !important; gap: 6px !important; padding: 8px 10px !important; background: #f8fafc !important; border-top: 1px solid #e2e8f0 !important; border-radius: 0 0 10px 10px !important; flex-shrink: 0 !important; margin: 0 !important;">
                <button id="mi-analyze-btn" style="background: #0f172a !important; color: white !important; border: none !important; border-radius: 7px !important; padding: 8px 14px !important; font-size: 13px !important; font-weight: 600 !important; cursor: pointer !important; flex: 1 !important; transition: all 0.15s ease !important; margin: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; gap: 6px !important;">
                    <span class="mi-btn-text">Проаналізувати</span>
                </button>
                <button id="mi-form027-btn" style="background: #fff !important; color: #92400e !important; border: 1px solid #fde68a !important; border-radius: 7px !important; padding: 8px 12px !important; font-size: 12px !important; font-weight: 600 !important; cursor: pointer !important; flex: 0 0 auto !important; transition: all 0.15s ease !important; margin: 0 !important; white-space: nowrap !important;">027/о</button>
            </div>
        `;

        document.body.appendChild(widget);
        this.widget = widget;

        if (!document.getElementById('mi-scrollbar-styles')) {
            const styleTag = document.createElement('style');
            styleTag.id = 'mi-scrollbar-styles';
            styleTag.textContent = `#mi-widget-body::-webkit-scrollbar { width: 6px !important; } #mi-widget-body::-webkit-scrollbar-track { background: #f1f1f1 !important; border-radius: 3px !important; } #mi-widget-body::-webkit-scrollbar-thumb { background: #888 !important; border-radius: 3px !important; } #mi-widget-body::-webkit-scrollbar-thumb:hover { background: #555 !important; }`;
            document.head.appendChild(styleTag);
        }
    }

    // v5.0.1: progress bar replaced by indeterminate top strip. Method
    // kept as a no-op so handleAnalyze/handleForm027 stage callbacks
    // don't need to change. Stage text is shown in the button via the
    // existing "Аналізуємо…" label.
    updateProgress(_percent, _stage) { /* no-op */ }

    // v5.0.1: showProgressBar now drives the slim loading strip + the
    // in-button spinner instead of the old labeled progress container.
    // Method names kept so callers (handleAnalyze, handleForm027) don't change.
    showProgressBar() {
        const strip = document.getElementById('mi-loading-strip');
        if (strip) strip.classList.add('is-on');
        this._setButtonsLoading(true);
    }

    hideProgressBar() {
        const strip = document.getElementById('mi-loading-strip');
        if (strip) strip.classList.remove('is-on');
        this._setButtonsLoading(false);
    }

    _setButtonsLoading(on) {
        const btn = document.getElementById('mi-analyze-btn');
        const f027 = document.getElementById('mi-form027-btn');
        if (btn) {
            if (on) {
                if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.innerHTML;
                btn.classList.add('is-loading');
                btn.innerHTML = '<span class="mi-spinner"></span><span class="mi-btn-text">Аналізуємо…</span>';
            } else {
                btn.classList.remove('is-loading');
                if (btn.dataset.origLabel) {
                    btn.innerHTML = btn.dataset.origLabel;
                    delete btn.dataset.origLabel;
                } else {
                    btn.innerHTML = '<span class="mi-btn-text">Проаналізувати</span>';
                }
            }
        }
        if (f027) f027.classList.toggle('is-loading', on);
    }

    updateCompletionBar(results) {
        // Виключаємо індикатори "Результат"
        const actionableResults = results.filter(r => !r.rule.name.includes('Результат'));
        
        if (actionableResults.length === 0) {
            document.getElementById('mi-completion-bar').style.display = 'none';
            return;
        }

        let completedCount = 0;
        actionableResults.forEach(r => {
            if (r.isCompleted) {
                completedCount++;
                return;
            }
            // Спецправило: індикатор просрочено, але є рекомендоване направлення
            // яке виписано і ще не прострочено → вважаємо виконаним у прогрес-барі
            if (r.status === 'overdue' && r.rule.recommendedReferrals && r.rule.recommendedReferrals.length > 0) {
                const hasActiveReferral = r.requiredActions.some(
                    a => a.isRecommendedReferral && a.isCompleted && !a.isExpired
                );
                if (hasActiveReferral) completedCount++;
            }
        });

        const totalCount = actionableResults.length;
        const percentage = Math.round((completedCount / totalCount) * 100);

        const completionBar = document.getElementById('mi-completion-bar');
        const completionBarFill = document.getElementById('mi-completion-bar-fill');
        const completionPercent = document.getElementById('mi-completion-percent');

        if (completionBar) completionBar.style.display = 'block';
        if (completionBarFill) completionBarFill.style.width = `${percentage}%`;
        if (completionPercent) completionPercent.textContent = `${percentage}% (${completedCount}/${totalCount})`;
    }

    attachEventListeners() {
        const analyzeBtn = document.getElementById('mi-analyze-btn');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', () => this.handleAnalyze());
            analyzeBtn.addEventListener('mouseover', (e) => { e.currentTarget.style.background = '#475569'; });
            analyzeBtn.addEventListener('mouseout', (e) => { e.currentTarget.style.background = '#334155'; });
        }
        const form027Btn = document.getElementById('mi-form027-btn');
        if (form027Btn) {
            form027Btn.addEventListener('click', () => this.handleForm027());
            form027Btn.addEventListener('mouseover', (e) => { e.currentTarget.style.background = '#d97706'; });
            form027Btn.addEventListener('mouseout', (e) => { e.currentTarget.style.background = '#f59e0b'; });
        }
        const copyBtn = document.getElementById('mi-form027-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.handleCopyForm027());
            copyBtn.addEventListener('mouseover', (e) => { e.currentTarget.style.background = '#059669'; });
            copyBtn.addEventListener('mouseout', (e) => { e.currentTarget.style.background = '#10b981'; });
        }
        const toggleBtn = document.getElementById('mi-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleWidget());
            toggleBtn.addEventListener('mouseover', (e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)'; });
            toggleBtn.addEventListener('mouseout', (e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'; });
        }
        ['S','M','L'].forEach(key => {
            const btn = document.getElementById(`mi-scale-${key}`);
            if (btn) btn.addEventListener('click', () => this.applyScale(key));
        });
        this.makeDraggable();
    }

    async handleAnalyze() {
        if (this.isAnalyzing) return;
        this.isAnalyzing = true;
        this.showProgressBar();
        this.updateProgress(0, 'Підготовка...');

        try {
            this.updateProgress(10, 'Розкриття списків...');
            
            const collectedData = await DATA_COLLECTOR.collectData();
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('[UI] 🔍 КРИТИЧНО: Збір направлень ОКРЕМО перед аналізом');
            console.log('[UI] analyzer до parseReferrals:', collectedData.analyzer);
            console.log('[UI] analyzer.referrals ДО:', Object.keys(collectedData.analyzer.referrals || {}));
            
            this.updateProgress(40, 'Збір направлень...');
            await collectedData.analyzer.parseReferrals();
            
            console.log('[UI] analyzer.referrals ПІСЛЯ:', Object.keys(collectedData.analyzer.referrals || {}));
            console.log('[UI] ✅ Направлення зібрано, передаю в indicator-matcher');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
            this.updateProgress(70, 'Збір даних...');
            await new Promise(resolve => setTimeout(resolve, 300));
            
            this.updateProgress(85, 'Аналіз індикаторів...');
            const results = INDICATOR_MATCHER.matchRules(collectedData);
            
            this.updateProgress(100, 'Завершено');
            await new Promise(resolve => setTimeout(resolve, 200));
            
            this.hideProgressBar();
            this.displayResults(results, collectedData);
        } catch (error) {
            this.hideProgressBar();
            this.showError(error.message);
        } finally {
            this.isAnalyzing = false;
        }
    }

    async handleForm027() {
        if (this.isAnalyzing) return;
        if (typeof FORM_027_COLLECTOR === 'undefined') {
            this.showError('FORM_027_COLLECTOR не визначено');
            return;
        }
        this.isAnalyzing = true;
        this.showProgressBar();
        this.updateProgress(0, 'Підготовка...');

        // Ховаємо результати аналізу та секцію 027 на час збору
        const resultsDiv = document.getElementById('mi-results');
        if (resultsDiv) resultsDiv.style.display = 'none';
        const section = document.getElementById('mi-form027-section');
        if (section) section.style.display = 'none';

        try {
            const text = await FORM_027_COLLECTOR.collect((percent, stage) => {
                this.updateProgress(percent, stage);
            });

            await new Promise(resolve => setTimeout(resolve, 200));
            this.hideProgressBar();
            this.showForm027(text);
        } catch (error) {
            this.hideProgressBar();
            this.showError(error.message);
        } finally {
            this.isAnalyzing = false;
        }
    }

    showForm027(text) {
        const section = document.getElementById('mi-form027-section');
        const textarea = document.getElementById('mi-form027-textarea');
        if (!section || !textarea) return;
        textarea.value = text;
        section.style.display = 'block';
        this.expandToFullHeight();
        // Прокручуємо до секції
        setTimeout(() => {
            const body = document.getElementById('mi-widget-body');
            if (body) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    }

    async handleCopyForm027() {
        const textarea = document.getElementById('mi-form027-textarea');
        const copyBtn = document.getElementById('mi-form027-copy-btn');
        if (!textarea || !textarea.value) return;

        const setBtnText = (txt, color) => {
            if (!copyBtn) return;
            copyBtn.textContent = txt;
            if (color) copyBtn.style.setProperty('background', color, 'important');
        };

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(textarea.value);
            } else {
                // Запасний варіант через select+execCommand
                textarea.removeAttribute('readonly');
                textarea.select();
                document.execCommand('copy');
                textarea.setAttribute('readonly', 'readonly');
                window.getSelection().removeAllRanges();
            }
            setBtnText('✓ Скопійовано', '#059669');
            setTimeout(() => setBtnText('Копіювати', '#10b981'), 1500);
        } catch (e) {
            console.error('[Form027] Помилка копіювання:', e);
            setBtnText('✗ Помилка', '#ef4444');
            setTimeout(() => setBtnText('Копіювати', '#10b981'), 1500);
        }
    }

    expandToFullHeight() {
        if (!this.widget || !this.isExpanded) return;
        // v5.0.1: cap at 67vh (2/3 screen); widget auto-grows up to that.
        this.widget.style.setProperty('max-height', '67vh', 'important');
        this.widget.style.bottom = '16px';
        this.widget.style.top = 'auto';
    }

    displayResults(results, data) {
        const resultsDiv = document.getElementById('mi-results');
        if (!resultsDiv) return;

        // Ховаємо інструкцію — вона не потрібна після аналізу
        const instruction = document.getElementById('mi-instruction');
        if (instruction) instruction.style.setProperty('display', 'none', 'important');

        // Оновлюємо плашку пацієнта повними даними
        this.updatePatientBanner({
            name: this.getQuickPatientInfo().name,
            age: data.patient.age,
            gender: data.patient.gender
        });

        resultsDiv.style.display = 'block';
        if (results.length === 0) {
            resultsDiv.innerHTML = `<div style="padding: 14px !important; background: #f0f9ff !important; border: 1px solid #bae6fd !important; border-radius: 10px !important; color: #075985 !important; margin: 0 !important;"><p style="margin: 0 !important;">ℹ️ Не знайдено застосовних індикаторів.</p></div>`;
            return;
        }

        this.updateCompletionBar(results);
        this.expandToFullHeight();

        const grouped = this.groupByCategory(results);
        // v5.4.0: diagnostic-report TODOs hidden — doctor sees them in МІС
        // anyway, they aren't actionable from here.
        const todoActions = this.collectTodoActions(results).filter(
            (a) => !a.isDiagnosticReport,
        );

        // v5.0.0: TODO list is the main thing. Indicator cards moved behind
        // a collapsible "Деталі індикаторів" toggle below — doctor said he
        // doesn't normally inspect per-indicator state. Summary tiles +
        // standalone gender selector dropped (gender lives inline in the
        // patient banner via decorateBannerMeta).
        let html = '';
        if (todoActions.length > 0) {
            html += this.renderTodoList(todoActions);
        } else {
            html += `<div style="margin:0 0 12px 0!important;padding:10px 12px!important;background:#f0fdf4!important;border:1px solid #bbf7d0!important;border-radius:8px!important;color:#065f46!important;font-size:12px!important;">Усі застосовні індикатори виконані 🎉</div>`;
        }

        // Indicators — collapsed by default.
        const totalRules = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
        if (totalRules > 0) {
            html += `<div class="mi-indicators-collapse" data-open="false" style="margin:0 0 8px 0!important;border:1px solid #e2e8f0!important;border-radius:8px!important;background:#fff!important;overflow:hidden!important;">
                <button type="button" id="mi-indicators-toggle" style="display:flex!important;align-items:center!important;gap:6px!important;width:100%!important;padding:8px 12px!important;background:#f8fafc!important;border:0!important;border-bottom:1px solid transparent!important;cursor:pointer!important;font-family:inherit!important;font-size:12px!important;font-weight:600!important;color:#475569!important;text-align:left!important;margin:0!important;">
                    <span class="mi-indicators-toggle-caret" style="display:inline-block!important;width:10px!important;transition:transform 0.15s!important;">▸</span>
                    <span>Деталі індикаторів</span>
                    <span style="margin-left:auto!important;padding:1px 7px!important;background:#e2e8f0!important;color:#475569!important;border-radius:999px!important;font-size:10px!important;font-weight:700!important;">${totalRules}</span>
                </button>
                <div id="mi-indicators-content" style="display:none!important;padding:8px 10px!important;background:#fff!important;margin:0!important;">`;
            for (const [category, categoryResults] of Object.entries(grouped)) {
                const categoryObj = typeof INDICATOR_CATEGORIES !== 'undefined' ? INDICATOR_CATEGORIES[category] : { name: category, icon: '' };
                html += `<div class="mi-category-block" data-category="${escapeHtml(category)}" style="margin:0 0 10px 0!important;">
                    <div style="padding:4px 0 6px 0!important;color:#64748b!important;font-weight:600!important;font-size:10px!important;text-transform:uppercase!important;letter-spacing:0.5px!important;">${categoryObj.name} <span style="color:#94a3b8!important;font-weight:500!important;">· ${categoryResults.length}</span></div>
                    <div style="margin:0!important;">`;
                categoryResults.forEach(result => { html += this.renderIndicatorCard(result); });
                html += `</div></div>`;
            }
            html += `</div></div>`;
        }

        resultsDiv.innerHTML = html;
        this.attachIndicatorListeners();
        this.positionTooltips();

        // Wire up indicators collapse.
        const toggle = document.getElementById('mi-indicators-toggle');
        const content = document.getElementById('mi-indicators-content');
        if (toggle && content) {
            toggle.addEventListener('click', () => {
                const wrap = toggle.closest('.mi-indicators-collapse');
                const open = wrap.getAttribute('data-open') === 'true';
                wrap.setAttribute('data-open', open ? 'false' : 'true');
                content.style.setProperty('display', open ? 'none' : 'block', 'important');
                const caret = toggle.querySelector('.mi-indicators-toggle-caret');
                if (caret) caret.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
                toggle.style.borderBottomColor = open ? 'transparent' : '#e2e8f0';
            });
        }
    }

    positionTooltips() {
        document.querySelectorAll('.mi-info-icon').forEach(icon => {
            icon.addEventListener('mouseenter', (e) => {
                const tooltip = icon.querySelector('.mi-info-tooltip');
                if (!tooltip) return;
                
                const iconRect = icon.getBoundingClientRect();
                const widgetRect = this.widget.getBoundingClientRect();
                
                const left = iconRect.left + iconRect.width / 2;
                const top = iconRect.top - 10;
                
                tooltip.style.left = `${left}px`;
                tooltip.style.top = `${top}px`;
                tooltip.style.transform = 'translate(-50%, -100%)';
                
                setTimeout(() => {
                    const tooltipRect = tooltip.getBoundingClientRect();
                    if (tooltipRect.right > window.innerWidth - 10) {
                        tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
                        tooltip.style.transform = 'translateY(-100%)';
                    }
                    if (tooltipRect.left < 10) {
                        tooltip.style.left = '10px';
                        tooltip.style.transform = 'translateY(-100%)';
                    }
                }, 10);
            });
        });
    }

    renderGenderSelector(currentGender) {
        const genderText = currentGender === 'M' ? '♂️ Чоловік' : currentGender === 'F' ? '♀️ Жінка' : 'Не визначено';
        const isDetected = currentGender !== null;
        const bgColor    = isDetected ? '#f0f9ff' : '#fffbeb';
        const borderCol  = isDetected ? '#bae6fd' : '#fde68a';
        const textCol    = isDetected ? '#075985' : '#92400e';
        const maleActive   = currentGender === 'M';
        const femaleActive = currentGender === 'F';
        return `<div style="margin-bottom: 16px !important; padding: 14px !important; background: ${bgColor} !important; border: 1px solid ${borderCol} !important; border-radius: 12px !important; margin: 0 0 16px 0 !important;"><div style="display: flex !important; align-items: center !important; justify-content: space-between !important; margin-bottom: 10px !important;"><div><p style="margin: 0 0 2px 0 !important; font-weight: 600 !important; color: ${textCol} !important; font-size: 13px !important;">${isDetected ? '✓' : '⚠️'} Стать пацієнта</p><p style="margin: 0 !important; font-size: 12px !important; color: ${textCol} !important;">Поточна: <strong>${genderText}</strong></p></div></div><div style="display: flex !important; gap: 8px !important; margin: 0 !important;"><button id="mi-gender-male" style="flex: 1 !important; padding: 8px 12px !important; background: ${maleActive ? '#0284c7' : 'white'} !important; color: ${maleActive ? 'white' : '#0f172a'} !important; border: 1px solid ${maleActive ? '#0284c7' : '#cbd5e1'} !important; border-radius: 8px !important; cursor: pointer !important; font-size: 13px !important; font-weight: 600 !important; margin: 0 !important; transition: all 0.15s ease !important;">👨 Чоловік ${maleActive ? '✓' : ''}</button><button id="mi-gender-female" style="flex: 1 !important; padding: 8px 12px !important; background: ${femaleActive ? '#db2777' : 'white'} !important; color: ${femaleActive ? 'white' : '#0f172a'} !important; border: 1px solid ${femaleActive ? '#db2777' : '#cbd5e1'} !important; border-radius: 8px !important; cursor: pointer !important; font-size: 13px !important; font-weight: 600 !important; margin: 0 !important; transition: all 0.15s ease !important;">👩 Жінка ${femaleActive ? '✓' : ''}</button></div></div>`;
    }

    renderTodoList(todoActions) {
        // v5.0.0: flat, scannable list. Each TODO is one row: dot (urgency
        // colour) + name + tiny meta. Type/category dropped from the main
        // view — it's available in the info tooltip if needed.
        // Sort: overdue first, then by name.
        const sorted = [...todoActions].sort((a, b) => {
            if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
            return (a.name || '').localeCompare(b.name || '', 'uk');
        });

        let html = `<div style="margin:0 0 10px 0!important;border:1px solid #e2e8f0!important;border-radius:8px!important;overflow:hidden!important;background:#fff!important;">
            <div style="display:flex!important;align-items:center!important;gap:8px!important;padding:8px 12px!important;background:#fef3c7!important;color:#92400e!important;font-weight:600!important;font-size:12px!important;margin:0!important;">
                <span>Необхідні дії</span>
                <span style="margin-left:auto!important;padding:1px 8px!important;background:#fff!important;color:#92400e!important;border-radius:999px!important;font-size:11px!important;font-weight:700!important;border:1px solid #fde68a!important;">${todoActions.length}</span>
            </div>
            <div id="mi-todo-content" style="padding:6px 0!important;background:#fff!important;margin:0!important;">`;

        sorted.forEach((action, idx) => {
            const tooltip = 'Індикатори:\n' + action.indicators.join('\n');
            const sep = idx > 0 ? 'border-top:1px solid #f1f5f9!important;' : '';
            const dotColor = action.isOverdue ? '#ef4444' : '#f59e0b';

            if (action.isOrGroup) {
                const altsHtml = action.alternatives.map((alt) => {
                    const done = alt.isCompleted && !alt.isExpired;
                    const sym = done ? '✓' : (alt.isExpired ? '⏰' : '·');
                    const color = done ? '#10b981' : (alt.isExpired ? '#f59e0b' : '#94a3b8');
                    return `<div style="display:flex!important;align-items:center!important;gap:6px!important;padding:1px 0!important;color:#475569!important;font-size:11px!important;"><span style="display:inline-block!important;width:10px!important;color:${color}!important;font-weight:700!important;text-align:center!important;">${sym}</span><span>${escapeHtml(alt.name)}</span></div>`;
                }).join('');
                html += `<div class="mi-todo-row" style="display:flex!important;gap:8px!important;padding:8px 12px!important;${sep}margin:0!important;">
                    <span style="display:inline-block!important;width:8px!important;height:8px!important;border-radius:50%!important;background:${dotColor}!important;margin-top:5px!important;flex-shrink:0!important;"></span>
                    <div style="flex:1!important;min-width:0!important;">
                        <div style="display:flex!important;align-items:center!important;gap:6px!important;">
                            <span style="font-weight:600!important;color:#0f172a!important;font-size:12px!important;">Виконати одне з</span>
                            ${action.isOverdue ? '<span style="font-size:9px!important;font-weight:700!important;color:#dc2626!important;letter-spacing:0.4px!important;">ПРОСТРОЧЕНО</span>' : ''}
                            ${this.createInfoIcon(tooltip, false)}
                        </div>
                        <div style="margin-top:2px!important;">${altsHtml}</div>
                    </div>
                </div>`;
            } else {
                const note = action.indicators.length > 1
                    ? `Для ${action.indicators.length} індикаторів`
                    : escapeHtml(action.indicators[0]);
                html += `<div class="mi-todo-row" style="display:flex!important;gap:8px!important;align-items:flex-start!important;padding:7px 12px!important;${sep}margin:0!important;">
                    <span style="display:inline-block!important;width:8px!important;height:8px!important;border-radius:50%!important;background:${dotColor}!important;margin-top:5px!important;flex-shrink:0!important;"></span>
                    <div style="flex:1!important;min-width:0!important;">
                        <div style="display:flex!important;align-items:center!important;gap:6px!important;">
                            <span style="font-weight:500!important;color:#0f172a!important;font-size:12px!important;line-height:1.35!important;">${escapeHtml(action.name)}</span>
                            ${action.isOverdue ? '<span style="font-size:9px!important;font-weight:700!important;color:#dc2626!important;letter-spacing:0.4px!important;white-space:nowrap!important;">ПРОСТРОЧЕНО</span>' : ''}
                            ${this.createInfoIcon(tooltip, false)}
                        </div>
                        <div style="font-size:10.5px!important;color:#94a3b8!important;margin-top:1px!important;line-height:1.3!important;">${note}</div>
                    </div>
                </div>`;
            }
        });

        html += `</div></div>`;
        return html;
    }

    collectTodoActions(results) {
        // Map: ключ → запис в TODO
        // Для OR-груп — ключ = `${ruleId}::OR::${orGroupId}`, запис містить масив альтернатив
        const todoMap = new Map();

        results.forEach(result => {
            const needsAction = result.status === 'not_done'
                || result.status === 'partial'
                || result.status === 'overdue';
            if (!needsAction) return;

            const isOverdueResult = result.status === 'overdue';
            const isReferral = result.rule.type === 'НАПРАВЛЕННЯ';
            const isDiagnosticReport = result.rule.type === 'ДІАГНОСТИЧНИЙ_ЗВІТ';

            // Групуємо дії по orGroupId
            const orGroups = {};
            const soloActions = [];

            result.requiredActions.forEach(action => {
                if (action.isConditional) return; // умовні вже відфільтровані
                if (action.orGroupId) {
                    if (!orGroups[action.orGroupId]) orGroups[action.orGroupId] = [];
                    orGroups[action.orGroupId].push(action);
                } else {
                    soloActions.push(action);
                }
            });

            // Обробляємо OR-групи
            Object.entries(orGroups).forEach(([gId, groupActions]) => {
                // Група "виконана" тільки якщо є не прострочений виконаний елемент
                const groupDone = groupActions.some(a => a.isCompleted && !a.isAlternative && !a.isExpired);
                if (groupDone) return; // реально виконано — не потрібно

                // Ключ дедупликації: відсортовані коди OR-групи (незалежно від rule.id)
                const key = 'OR::' + groupActions.map(a => a.code).sort().join('|');
                if (todoMap.has(key)) {
                    todoMap.get(key).indicators.push(result.rule.name);
                } else {
                    todoMap.set(key, {
                        isOrGroup: true,
                        orGroupId: gId,
                        alternatives: groupActions.map(a => ({
                            name: a.name,
                            code: a.code,
                            isCompleted: a.isCompleted && !a.isAlternative,
                            isExpired: a.isExpired || false
                        })),
                        indicators: [result.rule.name],
                        isEpisode: false,
                        isEncounterAction: groupActions[0]?.isEncounterAction || false,
                        isReferral: isReferral,
                        isDiagnosticReport: isDiagnosticReport,
                        isOverdue: isOverdueResult,
                        // Для відображення заголовка беремо перший елемент
                        name: groupActions.map(a => a.name).join(' / '),
                        code: gId
                    });
                }
            });

            // Обробляємо звичайні (solo) дії
            soloActions.forEach(action => {
                // Рекомендовані направлення — додаємо в TODO якщо не виписано АБО виписано але прострочено
                if (action.isRecommendedReferral) {
                    if (action.isCompleted && !action.isExpired) return; // виписано і актуально — не треба нагадувати
                    const key = `recommended-referral::${action.code}`;
                    if (!todoMap.has(key)) {
                        todoMap.set(key, {
                            isOrGroup: false,
                            name: action.name,
                            code: action.code,
                            indicators: [result.rule.name],
                            isEpisode: false,
                            isEncounterAction: false,
                            isReferral: true,
                            isDiagnosticReport: false,
                            isRecommendedReferral: true,
                            isOverdue: action.isExpired === true
                        });
                    } else {
                        todoMap.get(key).indicators.push(result.rule.name);
                    }
                    return;
                }
                // Дія потрапляє в TODO якщо:
                // 1. Вона не виконана (і не альтернативна)
                // 2. АБО вона виконана, але прострочена (isExpired) — незалежно від статусу індикатора
                const isActionExpired = action.isExpired === true;
                const needsThisAction = (!action.isAlternative) && (
                    !action.isCompleted || isActionExpired
                );
                if (!needsThisAction) return;

                // Ключ дедупликації: тільки код дії (одне і те ж обстеження для кількох правил — один запис)
                const key = `action::${action.code}`;
                if (todoMap.has(key)) {
                    todoMap.get(key).indicators.push(result.rule.name);
                } else {
                    todoMap.set(key, {
                        isOrGroup: false,
                        name: action.name,
                        code: action.code,
                        indicators: [result.rule.name],
                        isEpisode: action.isEpisode || false,
                        isEncounterAction: action.isEncounterAction || false,
                        isReferral: isReferral,
                        isDiagnosticReport: isDiagnosticReport,
                        isOverdue: isOverdueResult
                    });
                }
            });
        });

        return Array.from(todoMap.values());
    }

    renderIndicatorCard(result) {
        const isResultIndicator = result.rule.name.includes('Результат');
        let statusColor, statusText, statusIcon;
        if (result.status === 'completed') { statusColor = isResultIndicator ? '#94a3b8' : '#10b981'; statusText = 'Виконано'; statusIcon = '✅'; } else if (result.status === 'overdue') { statusColor = isResultIndicator ? '#94a3b8' : '#f59e0b'; statusText = 'Протерміновано'; statusIcon = '⏰'; } else if (result.status === 'partial') { statusColor = isResultIndicator ? '#94a3b8' : '#eab308'; statusText = 'Частково'; statusIcon = '⚠️'; } else { statusColor = isResultIndicator ? '#94a3b8' : '#ef4444'; statusText = 'Не виконано'; statusIcon = '❌'; }
        const requiredActions = result.requiredActions || [];
        const formatDate = (d) => { if (!d) return ''; try { return new Date(d).toLocaleDateString('uk-UA'); } catch { return d; } };
        const cardOpacity = isResultIndicator ? '0.55' : '1';
        const applicabilityInfo = result.applicabilityReason || '';
        let html = `<div class="mi-indicator-card" data-status="${result.status}" data-rule-id="${escapeHtml(result.rule.id)}" style="margin-bottom: 10px !important; padding: 14px 14px 14px 16px !important; border-radius: 10px !important; border: 1px solid #e2e8f0 !important; border-left: 3px solid ${statusColor} !important; background: white !important; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04) !important; margin: 0 0 10px 0 !important; opacity: ${cardOpacity} !important; position: relative !important;">${this.createInfoIcon(applicabilityInfo, true)}<div style="display: flex !important; align-items: center !important; gap: 10px !important; cursor: pointer !important; margin: 0 !important; padding-right: 30px !important;" class="indicator-header" data-id="expand-${result.rule.id}"><span style="font-size: 18px !important;">${statusIcon}</span><span style="flex: 1 !important; font-weight: 600 !important; font-size: 14px !important; color: ${isResultIndicator ? '#64748b' : '#0f172a'} !important; line-height: 1.35 !important;">${escapeHtml(result.rule.name)}</span><span style="padding: 3px 9px !important; border-radius: 999px !important; background: ${statusColor}1a !important; font-size: 10px !important; font-weight: 600 !important; text-transform: uppercase !important; letter-spacing: 0.4px !important; color: ${statusColor} !important; white-space: nowrap !important;">${statusText}</span><span style="display: inline-block !important; width: 18px !important; height: 18px !important; line-height: 18px !important; text-align: center !important; color: #94a3b8 !important; font-size: 12px !important; transition: transform 0.2s !important; margin: 0 !important;" class="indicator-toggle">▼</span></div><div id="expand-${result.rule.id}" style="display: none !important; padding-top: 12px !important; border-top: 1px solid #e2e8f0 !important; margin: 12px 0 0 0 !important;"><div style="font-size: 12px !important; color: #475569 !important; margin: 0 !important;"><div style="margin-bottom: 8px !important; font-weight: 600 !important; color: #0f172a !important; margin: 0 0 8px 0 !important;">Вимоги:</div>`;
        html += this.renderActionsList(requiredActions, formatDate);
        html += `</div></div></div>`;
        return html;
    }

    // Рендер списку дій з підтримкою OR-груп (візуальне об'єднання)
    renderActionsList(actions, formatDate) {
        if (!formatDate) formatDate = (d) => { if (!d) return ''; try { return new Date(d).toLocaleDateString('uk-UA'); } catch { return d; } };
        let html = '';
        const rendered = new Set();
        actions.forEach((action, idx) => {
            if (rendered.has(idx)) return;
            if (action.orGroupId) {
                // Збираємо всю OR-групу разом
                const groupItems = actions.map((a, i) => ({ a, i })).filter(({ a }) => a.orGroupId === action.orGroupId);
                groupItems.forEach(({ i }) => rendered.add(i));
                // Група "виконана" тільки якщо є виконаний і НЕ прострочений елемент
                const groupDone = groupItems.some(({ a }) => a.isCompleted && !a.isAlternative && !a.isExpired);
                const groupExpired = !groupDone && groupItems.some(({ a }) => a.isCompleted && !a.isAlternative && a.isExpired);
                const bc = groupDone ? '#10b981' : (groupExpired ? '#f59e0b' : '#ef4444');
                const bg = groupDone ? '#ecfdf5' : (groupExpired ? '#fffbeb' : '#fef2f2');
                html += `<div style="border-left: 3px solid ${bc} !important; border-radius: 8px !important; margin: 0 0 8px 0 !important; overflow: hidden !important; background: ${bg} !important; border: 1px solid ${bc}33 !important; border-left-width: 3px !important;">`;
                html += `<div style="padding: 4px 10px !important; background: ${bc}14 !important; font-size: 10px !important; font-weight: 700 !important; color: ${bc} !important; text-transform: uppercase !important; letter-spacing: 0.5px !important;">↔ Виконати одне з</div>`;
                groupItems.forEach(({ a }) => {
                    const done = a.isCompleted && !a.isAlternative;
                    const expired = done && a.isExpired;
                    const ic = expired ? '⏰' : (done ? '✅' : (a.isAlternative ? '↔️' : '❌'));
                    const dt = a.date ? formatDate(a.date) : '';
                    const da = a.daysAgo != null ? `(${a.daysAgo} дн.)` : '';
                    html += `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;"><span style="font-size:13px;">${ic}</span><div style="flex:1;"><div style="font-weight:500;color:#0f172a;font-size:12px;">${escapeHtml(a.name)}</div><div style="font-size:11px;color:#94a3b8;">${dt} ${da}</div></div></div>`;
                });
                html += `</div>`;
            } else {
                rendered.add(idx);
                const done = action.isCompleted;
                // Визначаємо чи прострочено: для направлень — якщо є expirationDate і вона в минулому
                // Для обстежень/звітів — якщо daysAgo перевищує допустимий ліміт (зазвичай 365 дн.)
                const isExpired = done && action.isExpired;
                const ic = isExpired ? '⏰' : (done ? '✅' : '❌');
                const dt = action.date ? formatDate(action.date) : '';
                const da = action.daysAgo != null ? `(${action.daysAgo} дн.)` : '';
                const ep = action.isEpisode ? ` <span style="font-size:10px;color:#6366f1;font-weight:600;">[ЕПІЗОД]</span>` : '';
                const enc = action.isEncounterAction ? ` <span style="font-size:10px;color:#8b5cf6;font-weight:600;">[ВЗАЄМОДІЯ]</span>` : '';
                // Рекомендовані направлення — окремий стиль, не впливають на статус
                if (action.isRecommendedReferral) {
                    const refExpired = done && action.isExpired;
                    const refIc = refExpired ? '⏰' : (done ? '✅' : '📋');
                    const refBg = refExpired ? '#fffbeb' : (done ? '#ecfdf5' : '#fffbeb');
                    const refBorder = refExpired ? '#f59e0b' : (done ? '#10b981' : '#f59e0b');
                    html += `<div style="display:flex;align-items:center;gap:8px;margin:0 0 8px 0;padding:8px 10px;background:${refBg};border-radius:8px;border-left:3px solid ${refBorder};"><span style="font-size:16px;">${refIc}</span><div style="flex:1;"><div style="font-weight:500;color:#0f172a;font-size:12px;">${escapeHtml(action.name)}</div><div style="font-size:11px;color:#94a3b8;">${dt} ${da}</div></div></div>`;
                    return;
                }
                // Для спостережень (не епізодів, не взаємодій) — показуємо значення
                const isObs = !action.isEpisode && !action.isEncounterAction && !action.isOrLogic;
                const valHtml = isObs && action.value
                    ? `<span style="font-size:10px;color:#475569;font-weight:600;margin-left:6px;background:#eef2ff;padding:1px 6px;border-radius:999px;">${escapeHtml(action.value)}</span>`
                    : '';
                html += `<div style="display:flex;align-items:center;gap:8px;margin:0 0 8px 0;padding:8px 10px;background:${done ? '#ecfdf5' : '#fef2f2'};border-radius:8px;"><span style="font-size:16px;">${ic}</span><div style="flex:1;"><div style="font-weight:500;color:#0f172a;">${escapeHtml(action.name)}${ep}${enc}${valHtml}</div><div style="font-size:11px;color:#94a3b8;">${dt} ${da}</div></div></div>`;
            }
        });
        return html;
    }

    groupByCategory(results) { const grouped = {}; results.forEach(result => { const category = result.rule.category; if (!grouped[category]) grouped[category] = []; grouped[category].push(result); }); return grouped; }

    attachIndicatorListeners() {
        document.querySelectorAll('.indicator-header').forEach(header => { header.addEventListener('click', () => { const expandId = header.getAttribute('data-id'); const expandDiv = document.getElementById(expandId); const toggle = header.querySelector('.indicator-toggle'); if (expandDiv.style.display === 'none') { expandDiv.style.display = 'block'; toggle.style.transform = 'rotate(180deg)'; } else { expandDiv.style.display = 'none'; toggle.style.transform = 'rotate(0deg)'; } }); });
        document.querySelectorAll('.todo-header').forEach(header => { header.addEventListener('click', () => { const contentDiv = document.getElementById('mi-todo-content'); const toggle = header.querySelector('.todo-toggle'); if (contentDiv.style.display === 'none') { contentDiv.style.display = 'block'; toggle.style.transform = 'rotate(180deg)'; } else { contentDiv.style.display = 'none'; toggle.style.transform = 'rotate(0deg)'; } }); });
    }

    attachGenderSelectorListeners() {
        const maleBtn = document.getElementById('mi-gender-male');
        const femaleBtn = document.getElementById('mi-gender-female');
        if (maleBtn) { maleBtn.addEventListener('click', () => { if (typeof GENDER_DETECTOR !== 'undefined') { GENDER_DETECTOR.setManualGender('M'); this.handleAnalyze(); } }); }
        if (femaleBtn) { femaleBtn.addEventListener('click', () => { if (typeof GENDER_DETECTOR !== 'undefined') { GENDER_DETECTOR.setManualGender('F'); this.handleAnalyze(); } }); }
    }

    showError(message) {
        const resultsDiv = document.getElementById('mi-results');
        if (!resultsDiv) return;
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = `<div style="padding: 14px !important; background: #fef2f2 !important; border: 1px solid #fecaca !important; border-radius: 10px !important; color: #991b1b !important; margin: 0 !important;"><p style="margin: 0 !important; font-weight: 500 !important;">❌ ${message}</p></div>`;
    }

    toggleWidget() {
        const body        = document.getElementById('mi-widget-body');
        const footer      = document.getElementById('mi-footer');
        const progressC   = document.getElementById('mi-progress-container');
        const completionB = document.getElementById('mi-completion-bar');
        const toggleBtn   = document.getElementById('mi-toggle-btn');
        if (!body || !toggleBtn) return;

        this.isExpanded = !this.isExpanded;

        if (this.isExpanded) {
            // Розгортаємо: показуємо тіло/футер, виджет росте вгору від низу
            body.style.display = 'block';
            if (footer) footer.style.display = 'flex';
            this.widget.style.setProperty('height', '80vh', 'important');
            toggleBtn.textContent = '_';
        } else {
            // Згортаємо: ховаємо тіло/футер, висота стискається до хедера
            // Залишаємо bottom/left без змін — виджет залишається на своєму місці внизу,
            // просто стає меньшим (тільки хедер видно)
            body.style.display = 'none';
            if (footer)      footer.style.display      = 'none';
            if (progressC)   progressC.style.display   = 'none';
            if (completionB) completionB.style.display = 'none';
            this.widget.style.setProperty('height', 'auto', 'important');
            toggleBtn.textContent = '□';
        }
    }

    clampPosition(left, bottom) {
        const w  = this.widget.offsetWidth;
        const h  = this.widget.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
            left:   Math.max(10, Math.min(left,   vw - w - 10)),
            bottom: Math.max(10, Math.min(bottom, vh - h - 10)),
        };
    }

    getSnapAnchors() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // 4 якоря зліва і 4 справа по вертикалі (bottom від низу екрану: 2%, 20%, 40%, 60%)
        return [0.02, 0.20, 0.40, 0.60].flatMap(bFrac => [
            { side: 'left',  x: 10,      bottom: Math.round(vh * bFrac) },
            { side: 'right', x: vw - 10, bottom: Math.round(vh * bFrac) },
        ]);
    }

    trySnap(widgetLeft, widgetBottom) {
        const w = this.widget.offsetWidth;
        const h = this.widget.offsetHeight;
        const cx = widgetLeft   + w / 2;
        const cy = widgetBottom + h / 2;   // умовний центр у bottom-координатах
        const SNAP_DIST = 100;
        let best = null, bestD = Infinity;

        this.getSnapAnchors().forEach(anchor => {
            const targetLeft   = anchor.side === 'left' ? anchor.x : anchor.x - w;
            const targetBottom = anchor.bottom;
            const d = Math.hypot(cx - (targetLeft + w / 2), cy - (targetBottom + h / 2));
            if (d < SNAP_DIST && d < bestD) { bestD = d; best = { left: targetLeft, bottom: targetBottom }; }
        });
        return best;
    }

    makeDraggable() {
        const header = document.getElementById('mi-header');
        let isDragging = false;
        let offsetX = 0, offsetFromBottom = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();

            // Нормалізуємо позицію до left + bottom (знімаємо right/top якщо є)
            const rect = this.widget.getBoundingClientRect();
            const currentLeft   = rect.left;
            const currentBottom = window.innerHeight - rect.bottom;

            this.widget.style.left   = `${currentLeft}px`;
            this.widget.style.bottom = `${currentBottom}px`;
            this.widget.style.right  = 'auto';
            this.widget.style.top    = 'auto';

            // Зміщення курсору від лівого краю і від нижнього краю
            offsetX            = e.clientX - rect.left;
            offsetFromBottom   = window.innerHeight - e.clientY - currentBottom;
            isDragging = true;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const newLeft   = e.clientX - offsetX;
            const newBottom = window.innerHeight - e.clientY - offsetFromBottom;
            const clamped   = this.clampPosition(newLeft, newBottom);
            this.widget.style.left   = `${clamped.left}px`;
            this.widget.style.bottom = `${clamped.bottom}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;

            // Примагнічування — тільки у свернутому стані
            if (!this.isExpanded) {
                const rect         = this.widget.getBoundingClientRect();
                const widgetLeft   = rect.left;
                const widgetBottom = window.innerHeight - rect.bottom;
                const snap         = this.trySnap(widgetLeft, widgetBottom);
                if (snap) {
                    const clamped = this.clampPosition(snap.left, snap.bottom);
                    this.widget.style.transition = 'left 0.2s ease, bottom 0.2s ease';
                    this.widget.style.left   = `${clamped.left}px`;
                    this.widget.style.bottom = `${clamped.bottom}px`;
                    setTimeout(() => {
                        if (this.widget) this.widget.style.transition = 'height 0.25s ease';
                        this.savePosition();
                    }, 220);
                    return;
                }
            }
            // Без снапу — зберігаємо одразу
            this.savePosition();
        });
    }
}

console.log('[Medics Indicators] ui.js (фінальна версія з прогрес-баром)');
