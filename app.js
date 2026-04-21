(function () {
  "use strict";

  const {
    AUCTION_TAX_RATE,
    CRYSTALS_PER_CRAFT,
    CRYSTAL_TYPES,
    MODES,
    PROFESSIONS,
    SORT_OPTIONS,
    cloneDefaultPrices,
    sanitizeNumber,
    calculateProfession,
    getSortValue,
    formatDuration,
  } = window.CraftCalculator;

  const STORAGE_KEY = "craft-calc-ui-v5";
  const LEGACY_STORAGE_KEYS = ["craft-calc-ui-v4", "craft-calc-ui-v3", "ccalc_v2"];
  const STORAGE_SCHEMA_VERSION = 3;

  // ── Обмен ресурсов ───────────────────────────────────────────────────────────
  // Цепочки (все отношения в единицах "на 1 входящий ресурс"):
  //   5  синих Т3  → 50 белых       → 1 синий Т3  даёт 10 белых
  //   25 зелёных   → 50 белых       → 1 зелёный   даёт 2 белых
  //   100 белых    → 80 пыли        → 1 белый      даёт 0.8 пыли
  //   50 зелёных   → 80 пыли        → 1 зелёный   даёт 1.6 пыли
  //   100 пыли     → 10 синих Т4    → 1 пыль       даёт 0.1 синих Т4
  //
  // Итог цепочек к 1 синему Т4:
  //   A) синий Т3 → белый → пыль → синий Т4:
  //      1 синий Т3 → 10 белых → 8 пыли → 0.8 синих Т4
  //      → нужно 1/0.8 = 1.25 синих Т3 на 1 синий Т4
  //      → нужно 100/80 пыли, каждая пыль = 1/8 белого = 1/80 синего Т3
  //      Считаем сколько синих Т3 нужно на 1 синий Т4:
  //        100 пыли → 10 Т4  → 1 Т4 стоит 10 пыли
  //        1 пыль = 100/80 белых = 1.25 белых
  //        1 белый = 5/50 синих Т3 = 0.1 синих Т3
  //        → 10 пыли = 10 * 1.25 * 0.1 = 1.25 синих Т3 на 1 синий Т4
  //
  //   B) зелёный → белый → пыль → синий Т4:
  //        1 Т4 = 10 пыли = 10 * 1.25 белых = 12.5 белых
  //        1 белый = 25/50 зелёных = 0.5 зелёных
  //        → 12.5 * 0.5 = 6.25 зелёных на 1 синий Т4
  //
  //   C) зелёный → пыль → синий Т4:
  //        1 Т4 = 10 пыли
  //        1 пыль = 50/80 зелёных = 0.625 зелёных
  //        → 10 * 0.625 = 6.25 зелёных на 1 синий Т4  (то же самое!)
  //
  // Функция calcExchange вычисляет стоимость получения 1 синего Т4 каждым путём
  // и сравнивает с прямой покупкой на аукционе.

  const EXCHANGE = {
    // синих Т3 нужно на 1 синий Т4
    blueT3PerBlueT4: (10 * (100 / 80)) * (5 / 50),   // = 1.25
    // зелёных нужно на 1 синий Т4 через белый
    greenViaWhitePerBlueT4: (10 * (100 / 80)) * (25 / 50), // = 6.25
    // зелёных нужно на 1 синий Т4 напрямую через пыль
    greenViaDustPerBlueT4: 10 * (50 / 80),             // = 6.25
  };

  const numberFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const preciseFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const multiplierFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const state = createInitialState();
  const uiState = {
    editLock: null,
    editReleaseTimer: null,
    editCountdownInterval: null,
    editLockEndsAt: null,
    lastVisibleOrder: [],
  };

  const elements = {
    typeSegment:      document.getElementById("type-segment"),
    modeSegment:      document.getElementById("mode-segment"),
    crystalPrice:     document.getElementById("crystal-price"),
    sortSegment:      document.getElementById("sort-segment"),
    profitableToggle: document.getElementById("profitable-toggle"),
    noProcToggle:     document.getElementById("no-proc-toggle"),
    modeInsights:     document.getElementById("mode-insights"),
    heroStats:        document.getElementById("hero-stats"),
    boardCaption:     document.getElementById("board-caption"),
    craftsGrid:       document.getElementById("crafts-grid"),
    emptyState:       document.getElementById("empty-state"),
    summaryContent:   document.getElementById("summary-content"),
  };

  init();

  // ── INIT ─────────────────────────────────────────────────────────────────────

  function init() {
    hydrateState();
    renderControls();
    bindGlobalEvents();
    render();
  }

  function createInitialState() {
    const defaultExchange = {};
    // будет заполнено после того как PROFESSIONS доступны (внутри IIFE)
    return {
      crystalTypeKey: "t45",
      modeKey: "normal",
      crystalPrice: 100,
      sortKey: "manual",
      onlyProfitable: false,
      showNoProc: false,
      professionPrices: cloneDefaultPrices(),
      exchangePrices: buildDefaultExchangePrices(),
    };
  }

  function buildDefaultExchangePrices() {
    const book = {};
    PROFESSIONS.forEach((p) => {
      book[p.id] = { blueT3: 200, greenT3: 150, blueT4: 500 };
    });
    return book;
  }

  // ── STATE PERSISTENCE ────────────────────────────────────────────────────────

  function hydrateState() {
    const saved = readSavedState();
    if (!saved) return;

    if (saved.crystalTypeKey in CRYSTAL_TYPES) state.crystalTypeKey = saved.crystalTypeKey;
    if (saved.modeKey in MODES)               state.modeKey         = saved.modeKey;
    if (saved.sortKey in SORT_OPTIONS)        state.sortKey         = saved.sortKey;

    state.onlyProfitable = Boolean(saved.onlyProfitable);
    state.showNoProc     = Boolean(saved.showNoProc);
    state.crystalPrice   = sanitizeNumber(saved.crystalPrice, state.crystalPrice);

    PROFESSIONS.forEach((prof) => {
      const sp = saved.professionPrices && saved.professionPrices[prof.id];
      if (sp) {
        state.professionPrices[prof.id] = {
          blue:  sanitizeNumber(sp.blue,  state.professionPrices[prof.id].blue),
          green: sanitizeNumber(sp.green, state.professionPrices[prof.id].green),
          white: sanitizeNumber(sp.white, state.professionPrices[prof.id].white),
        };
      }
      const se = saved.exchangePrices && saved.exchangePrices[prof.id];
      if (se) {
        state.exchangePrices[prof.id] = {
          blueT3:  sanitizeNumber(se.blueT3,  state.exchangePrices[prof.id].blueT3),
          greenT3: sanitizeNumber(se.greenT3, state.exchangePrices[prof.id].greenT3),
          blueT4:  sanitizeNumber(se.blueT4,  state.exchangePrices[prof.id].blueT4),
        };
      }
    });

    saveState();
  }

  function readSavedState() {
    const cur = parseStorage(STORAGE_KEY);
    if (cur) return normalizeModernState(cur, true);
    const leg1 = parseStorage(LEGACY_STORAGE_KEYS[0]);
    if (leg1) return normalizeModernState(leg1, false);
    const leg2 = parseStorage(LEGACY_STORAGE_KEYS[1]);
    if (leg2) return normalizeLegacyState(leg2);
    const leg3 = parseStorage(LEGACY_STORAGE_KEYS[2]);
    if (leg3) return normalizeLegacyState(leg3);
    return null;
  }

  function parseStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function normalizeModernState(saved, keepPrefs) {
    return {
      crystalTypeKey:  saved.crystalTypeKey,
      modeKey:         saved.modeKey,
      crystalPrice:    saved.crystalPrice,
      sortKey:         keepPrefs && saved.schemaVersion === STORAGE_SCHEMA_VERSION && saved.sortKey in SORT_OPTIONS ? saved.sortKey : "manual",
      onlyProfitable:  keepPrefs && saved.schemaVersion === STORAGE_SCHEMA_VERSION ? Boolean(saved.onlyProfitable) : false,
      showNoProc:      keepPrefs && saved.schemaVersion === STORAGE_SCHEMA_VERSION ? Boolean(saved.showNoProc) : false,
      professionPrices: saved.professionPrices || {},
      exchangePrices:   saved.exchangePrices   || {},
    };
  }

  function normalizeLegacyState(saved) {
    return {
      crystalTypeKey: saved.cType || "t45",
      modeKey:        saved.premium ? "premium" : "normal",
      crystalPrice:   saved.crystalPrice || 100,
      sortKey:        "manual",
      onlyProfitable: false,
      showNoProc:     false,
      professionPrices: saved.prices || {},
      exchangePrices:   {},
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion:    STORAGE_SCHEMA_VERSION,
      crystalTypeKey:   state.crystalTypeKey,
      modeKey:          state.modeKey,
      crystalPrice:     state.crystalPrice,
      sortKey:          state.sortKey,
      onlyProfitable:   state.onlyProfitable,
      showNoProc:       state.showNoProc,
      professionPrices: state.professionPrices,
      exchangePrices:   state.exchangePrices,
    }));
  }

  // ── CONTROLS & EVENTS ───────────────────────────────────────────────────────

  function renderControls() {
    renderSegment(elements.typeSegment, Object.values(CRYSTAL_TYPES).map((t) => ({
      label:  t.label,
      active: state.crystalTypeKey === t.id,
      action: () => { state.crystalTypeKey = t.id; saveState(); render(); },
    })));

    renderSegment(elements.modeSegment, Object.values(MODES).map((m) => ({
      label:  m.label,
      active: state.modeKey === m.id,
      action: () => { state.modeKey = m.id; saveState(); render(); },
    })));

    renderSortButtons();

    elements.crystalPrice.value   = state.crystalPrice;
    elements.profitableToggle.checked = state.onlyProfitable;
    if (elements.noProcToggle) elements.noProcToggle.checked = state.showNoProc;
  }

  function renderSegment(root, items) {
    root.innerHTML = "";
    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.label;
      btn.className = item.active ? "is-active" : "";
      btn.setAttribute("aria-pressed", item.active ? "true" : "false");
      btn.addEventListener("click", item.action);
      root.appendChild(btn);
    });
  }

  function renderSortButtons() {
    elements.sortSegment.innerHTML = "";
    Object.values(SORT_OPTIONS).forEach((sort) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = sort.label;
      btn.className = [
        "sort-btn",
        state.sortKey === sort.id ? "is-active" : "",
        uiState.editLock && state.sortKey === sort.id ? "is-frozen" : "",
      ].filter(Boolean).join(" ");
      btn.setAttribute("aria-pressed", state.sortKey === sort.id ? "true" : "false");
      btn.addEventListener("click", () => { state.sortKey = sort.id; saveState(); render(); });
      elements.sortSegment.appendChild(btn);
    });
  }

  function bindGlobalEvents() {
    elements.crystalPrice.addEventListener("input", (e) => {
      state.crystalPrice = sanitizeNumber(e.target.value, 0);
      saveState();
      render();
    });

    elements.profitableToggle.addEventListener("change", (e) => {
      state.onlyProfitable = e.target.checked;
      saveState();
      render();
    });

    if (elements.noProcToggle) {
      elements.noProcToggle.addEventListener("change", (e) => {
        state.showNoProc = e.target.checked;
        saveState();
        render();
      });
    }

    // Resource price inputs (delegated — inputs created dynamically)
    elements.craftsGrid.addEventListener("input", (e) => {
      const el = e.target;
      // Exchange price inputs
      if (el.dataset.exchProf && el.dataset.exchField) {
        const prof  = el.dataset.exchProf;
        const field = el.dataset.exchField;
        if (state.exchangePrices[prof]) {
          state.exchangePrices[prof][field] = sanitizeNumber(el.value, 0);
          saveState();
          patchExchangeResult(prof);
        }
        return;
      }
      // Resource price inputs
      if (el.dataset.profession && el.dataset.color) {
        const profId = el.dataset.profession;
        const color  = el.dataset.color;
        if (!state.professionPrices[profId]) return;
        state.professionPrices[profId][color] = sanitizeNumber(el.value, 0);
        saveState();
        lockVisibleOrder();
        scheduleEditUnlock();
        patchCardMetrics(profId);
        // Refresh hero/summary without re-rendering cards
        const results      = buildProfessionViews();
        const visibleResults = getVisibleResults(results);
        const bestView     = getBestView(visibleResults, results);
        renderHero(bestView);
        renderModeInsights();
        renderSummary(bestView);
        patchBadges(visibleResults, bestView);
        const remaining = Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000);
        elements.boardCaption.textContent = `${visibleResults.length} из ${results.length} профессий · Порядок зафиксирован · ${remaining}с`;
      }
    });
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────

  function render() {
    renderControls();
    const results        = buildProfessionViews();
    const visibleResults = getVisibleResults(results);
    const bestView       = getBestView(visibleResults, results);
    renderHero(bestView);
    renderModeInsights();
    renderSummary(bestView);
    renderBoard(visibleResults, results.length, bestView ? bestView.id : null);
  }

  function buildProfessionViews() {
    return PROFESSIONS.map((profession, index) => {
      const shared = {
        professionId:   profession.id,
        crystalTypeKey: state.crystalTypeKey,
        crystalPrice:   state.crystalPrice,
        resourcePrices: state.professionPrices[profession.id],
      };
      const normal  = calculateProfession({ ...shared, modeKey: "normal" });
      const premium = calculateProfession({ ...shared, modeKey: "premium" });
      return { id: profession.id, order: index, profession, normal, premium,
               current: state.modeKey === "premium" ? premium : normal };
    });
  }

  function getBestView(visibleResults, allResults) {
    const pool = visibleResults.length ? visibleResults : allResults;
    return pool.slice().sort((a, b) => b.current.profit.perCycle - a.current.profit.perCycle)[0] || null;
  }

  function compareViews(a, b) {
    if (state.sortKey === "manual") return a.order - b.order;
    return getSortValue(b.current, state.sortKey) - getSortValue(a.current, state.sortKey);
  }

  function getVisibleResults(results) {
    const filtered = results
      .filter((item) => !state.onlyProfitable || item.current.profit.perCycle > 0)
      .sort(compareViews);
    if (!uiState.editLock) return filtered;
    const map = new Map(results.map((item) => [item.id, item]));
    return uiState.editLock.orderIds
      .map((id) => map.get(id))
      .filter((item) => Boolean(item) && (!state.onlyProfitable || item.current.profit.perCycle > 0));
  }

  // ── HERO & INSIGHTS ──────────────────────────────────────────────────────────

  function renderHero(bestView) {
    const mode = MODES[state.modeKey];
    const craftsPerCycle   = mode.queueCount * mode.stacksPerCycle;
    const baseCrystals     = craftsPerCycle * CRYSTALS_PER_CRAFT;
    const crystalsWithPerk = baseCrystals * (1 + mode.perfectResultBonusRate);

    elements.heroStats.innerHTML = [
      { label: "Текущий режим",   value: mode.label },
      { label: "Крафтов за цикл", value: `${craftsPerCycle} × ${CRYSTALS_PER_CRAFT}` },
      { label: "Базовый выпуск",  value: `${formatMoney(baseCrystals)} кр.` },
      { label: `С перком +${Math.round(mode.perfectResultBonusRate * 100)}%`, value: `${formatDecimal(crystalsWithPerk)} кр.` },
      { label: "Лидер сейчас",    value: bestView ? bestView.profession.name : "Нет данных" },
      { label: "После комиссии",  value: `${formatDecimal(state.crystalPrice * (1 - AUCTION_TAX_RATE))} зол./кр.` },
    ].map((c) => `<article class="hero-stat"><div class="hero-stat-label">${c.label}</div><div class="hero-stat-value">${c.value}</div></article>`).join("");
  }

  function renderModeInsights() {
    const mode = MODES[state.modeKey];
    const craftsPerCycle   = mode.queueCount * mode.stacksPerCycle;
    const cycleDurationSec = mode.stackDurationSec * mode.stacksPerCycle;
    const fullCyclesPerDay = Math.floor(86400 / cycleDurationSec);
    const baseCrystals     = craftsPerCycle * CRYSTALS_PER_CRAFT;
    const crystalsWithPerk = baseCrystals * (1 + mode.perfectResultBonusRate);

    elements.modeInsights.innerHTML = [
      { label: "1 стак",               value: formatDuration(mode.stackDurationSec),  note: `${mode.queueCount} параллельных крафта` },
      { label: "1 цикл",               value: formatDuration(cycleDurationSec),        note: `${mode.stacksPerCycle} стаков = ${craftsPerCycle} крафтов` },
      { label: "Полных циклов за 24ч", value: `${fullCyclesPerDay}`,                  note: "с хвостиком" },
      { label: "Результат цикла",      value: `${formatDecimal(crystalsWithPerk)} кр.`, note: `${formatMoney(baseCrystals)} базовых × ${(1 + mode.perfectResultBonusRate).toFixed(2)}` },
    ].map((i) => `<article class="mode-card"><div class="mini-note">${i.label}</div><strong>${i.value}</strong><div class="hero-stat-label">${i.note}</div></article>`).join("");
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────────

  function renderSummary(bestView) {
    if (!bestView) {
      elements.summaryContent.innerHTML = `<div class="summary-hero"><h3>Нет данных для расчёта</h3><p>Добавь цены ресурсов и стоимость кристалла, чтобы увидеть сводку.</p></div>`;
      return;
    }

    const noProcNormal  = bestView.normal.counts.baseCrystalsPerCycle  * state.crystalPrice * (1 - AUCTION_TAX_RATE) - bestView.normal.costs.totalCost;
    const noProcPremium = bestView.premium.counts.baseCrystalsPerCycle * state.crystalPrice * (1 - AUCTION_TAX_RATE) - bestView.premium.costs.totalCost;

    elements.summaryContent.innerHTML = `
      <div class="summary-hero">
        <div class="mini-note">Сейчас лидирует</div>
        <h3>${bestView.profession.icon} ${bestView.profession.name}</h3>
        <p><strong>${bestView.normal.counts.craftsPerCycle}×468</strong> без премиума и <strong>${bestView.premium.counts.craftsPerCycle}×447</strong> с премиумом.</p>
      </div>

      <div class="summary-grid summary-grid-wide" style="margin-top:14px">
        ${renderSummaryCard("За 1 кристалл",         `${formatSigned(bestView.current.profit.perCrystal)} зол.`)}
        ${renderSummaryCard("За 30 крафтов",          `${formatSigned(bestView.normal.profit.perCycle)} зол.`)}
        ${renderSummaryCard("За 40 крафтов",          `${formatSigned(bestView.premium.profit.perCycle)} зол.`)}
        ${renderSummaryCard("Точка безубыточности",   `${formatDecimal(bestView.current.breakEvenCrystalPrice || 0)} зол./кр.`)}
      </div>

      <div class="summary-grid summary-grid-wide" style="margin-top:10px">
        ${renderSummaryCard("Прибыль в час",          `${formatSigned(bestView.current.profit.perHour)} зол./ч`)}
        ${renderSummaryCard("Прибыль за 24ч",         `${formatSigned(bestView.current.profit.perDay)} зол.`)}
        ${renderSummaryCard("ROI",                    formatPercent(bestView.current.profit.roi))}
        ${renderSummaryCard("Кристаллов за цикл",     `${formatDecimal(bestView.current.output.totalExpected)} шт.`)}
      </div>

      ${state.showNoProc ? `
      <p class="section-mini-title" style="margin-top:16px;margin-bottom:8px">Без идеальных проков</p>
      <div class="summary-grid summary-grid-wide">
        ${renderSummaryCard("30 кр. без проков", `${formatSigned(noProcNormal)} зол.`)}
        ${renderSummaryCard("40 кр. без проков", `${formatSigned(noProcPremium)} зол.`)}
      </div>` : ""}

      <div class="kpi" style="margin-top:10px">
        <div>
          <div class="mini-note">Если кристалл подешевеет на 10%</div>
          <strong class="${bestView.current.scenarios[0].profitPerCycle >= 0 ? "value-positive" : "value-negative"}">${formatSigned(bestView.current.scenarios[0].profitPerCycle)} зол./цикл</strong>
        </div>
        <div>
          <div class="mini-note">Если ресурсы подорожают на 15%</div>
          <strong class="${bestView.current.scenarios[1].profitPerCycle >= 0 ? "value-positive" : "value-negative"}">${formatSigned(bestView.current.scenarios[1].profitPerCycle)} зол./цикл</strong>
        </div>
      </div>
    `;
  }

  function renderSummaryCard(label, value) {
    return `<article class="summary-card"><div class="summary-label">${label}</div><div class="summary-value">${value}</div></article>`;
  }

  // ── BOARD ────────────────────────────────────────────────────────────────────

  function renderBoard(visibleResults, totalCount, bestId) {
    uiState.lastVisibleOrder = visibleResults.map((v) => v.id);

    const sortCaption = uiState.editLock
      ? `Порядок зафиксирован · ${Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000)}с`
      : state.sortKey === "manual"
        ? "Ручной порядок включён"
        : `Сортировка: ${SORT_OPTIONS[state.sortKey].label}`;

    elements.boardCaption.textContent = `${visibleResults.length} из ${totalCount} профессий · ${sortCaption}`;
    elements.emptyState.hidden  = visibleResults.length > 0;
    elements.craftsGrid.hidden  = visibleResults.length === 0;

    if (!visibleResults.length) { elements.craftsGrid.innerHTML = ""; return; }

    elements.craftsGrid.innerHTML = visibleResults
      .map((view, index) => renderCraftCard(view, { isBest: view.id === bestId, rank: index + 1 }))
      .join("");
  }

  // ── CRAFT CARD ───────────────────────────────────────────────────────────────

  function renderCraftCard(view, meta) {
    const current          = view.current;
    const currentIsPositive = current.profit.perCycle >= 0;
    const currentTone      = currentIsPositive ? "value-positive" : "value-negative";

    // Profit comparison rows (с/без проков)
    const compRows = [
      { label: "За 1 кристалл",                 value: `${formatSigned(current.profit.perCrystal)} зол.`,       isActive: false,                        tone: current.profit.perCrystal >= 0 ? "value-positive" : "value-negative" },
      { label: `За ${view.normal.counts.craftsPerCycle} крафтов`,  value: `${formatSigned(view.normal.profit.perCycle)} зол.`,  isActive: state.modeKey === "normal",  tone: view.normal.profit.perCycle >= 0  ? "value-positive" : "value-negative" },
      { label: `За ${view.premium.counts.craftsPerCycle} крафтов`, value: `${formatSigned(view.premium.profit.perCycle)} зол.`, isActive: state.modeKey === "premium", tone: view.premium.profit.perCycle >= 0 ? "value-positive" : "value-negative" },
    ];

    // No-proc calculation
    const noProcCrystNorm = view.normal.counts.baseCrystalsPerCycle;
    const noProcCrystPrem = view.premium.counts.baseCrystalsPerCycle;
    const noProcProfNorm  = noProcCrystNorm * state.crystalPrice * (1 - AUCTION_TAX_RATE) - view.normal.costs.totalCost;
    const noProcProfPrem  = noProcCrystPrem * state.crystalPrice * (1 - AUCTION_TAX_RATE) - view.premium.costs.totalCost;

    const noProcSection = state.showNoProc ? `
      <div>
        <p class="section-mini-title" style="margin-top:4px">Без идеальных проков (базовые ${formatMoney(noProcCrystNorm)} / ${formatMoney(noProcCrystPrem)} кр.)</p>
        <div class="results-grid" style="grid-template-columns:1fr 1fr">
          <article class="result-card ${state.modeKey === "normal" ? "emphasis is-active" : ""}">
            <div class="result-label">30 крафтов · без проков</div>
            <div class="result-value ${noProcProfNorm >= 0 ? "value-positive" : "value-negative"}">${formatSigned(noProcProfNorm)} зол.</div>
          </article>
          <article class="result-card ${state.modeKey === "premium" ? "emphasis is-active" : ""}">
            <div class="result-label">40 крафтов · без проков</div>
            <div class="result-value ${noProcProfPrem >= 0 ? "value-positive" : "value-negative"}">${formatSigned(noProcProfPrem)} зол.</div>
          </article>
        </div>
      </div>` : "";

    const craftFeeLabel = `Крафт-сбор (${current.counts.craftsPerCycle}×${current.mode.craftFeePerCraft})`;
    const crystalsHint  = `${formatMoney(current.output.baseCrystals)} базовых × ${formatMultiplier(current.output.multiplier)}`;

    const rankLabel = meta.isBest ? "Лучший вариант"
      : uiState.editLock ? `Зафиксировано · ${Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000)}с`
      : state.sortKey === "manual" ? "Ручной порядок" : `#${meta.rank}`;

    return `
      <article class="craft-card ${meta.isBest ? "is-top" : ""}" data-card-id="${view.id}">
        <div class="craft-head">
          <div class="craft-meta">
            <div class="craft-icon">${view.profession.icon}</div>
            <div>
              <h3>${view.profession.name}</h3>
              <div class="craft-sub">${current.crystalType.shortLabel} · ${current.counts.craftsPerCycle} крафтов за цикл · 1 крафт = ${current.counts.crystalsPerCraft} кристаллов</div>
            </div>
          </div>
          <div>
            <div class="rank-pill ${meta.isBest ? "is-best" : ""} ${uiState.editLock && !meta.isBest ? "is-frozen" : ""}">${rankLabel}</div>
            <div class="profit-pill ${currentIsPositive ? "is-positive" : "is-negative"}">${currentIsPositive ? "В плюс" : "В минус"}</div>
          </div>
        </div>

        <div>
          <p class="section-mini-title">Цены ресурсов за 100 шт.</p>
          <div class="resource-grid">
            ${renderResourceRow(view, "blue",  "Синий",   "swatch-blue")}
            ${renderResourceRow(view, "green", "Зелёный", "swatch-green")}
            ${renderResourceRow(view, "white", "Белый",   "swatch-white")}
          </div>
        </div>

        <div>
          <p class="section-mini-title">Себестоимость текущего режима</p>
          <div class="metrics-grid">
            ${renderMetric("Ресурсы",                                        `${formatMoney(current.costs.resourceCost)} зол.`)}
            ${renderMetric(craftFeeLabel,                                    `${formatMoney(current.costs.craftFee)} зол.`)}
            ${renderMetric("Итого затрат",                                   `${formatMoney(current.costs.totalCost)} зол.`)}
            ${renderMetric(`Кристаллов ×${formatMultiplier(current.output.multiplier)}`, `${formatDecimal(current.output.totalExpected)} шт.`, crystalsHint)}
          </div>
        </div>

        <div>
          <p class="section-mini-title">Чистая прибыль</p>
          <div class="results-grid profit-compare-grid">
            ${compRows.map((row) => `
              <article class="result-card ${row.isActive ? "emphasis is-active" : ""}">
                <div class="result-label">${row.label}</div>
                <div class="result-value ${row.tone}">${row.value}</div>
              </article>`).join("")}
          </div>
        </div>

        ${noProcSection}

        <div>
          <p class="section-mini-title">Дополнительные метрики</p>
          <div class="results-grid">
            ${renderResult("Прибыль в час",         `${formatSigned(current.profit.perHour)} зол./ч`,                       currentTone, false)}
            ${renderResult("Прибыль за 24ч",        `${formatSigned(current.profit.perDay)} зол.`,                          currentTone, false)}
            ${renderResult("ROI",                    formatPercent(current.profit.roi),                                      currentTone, false)}
            ${renderResult("Точка безубыточности",  `${formatDecimal(current.breakEvenCrystalPrice || 0)} зол./кр.`,        "", false)}
          </div>
        </div>

        <div>
          <p class="section-mini-title">Сценарии рынка</p>
          <div class="scenarios-grid">
            ${current.scenarios.map((sc) => `
              <article class="scenario-card">
                <div class="scenario-label">${sc.label}</div>
                <div class="summary-value ${sc.profitPerCycle >= 0 ? "value-positive" : "value-negative"}">${formatSigned(sc.profitPerCycle)} зол./цикл</div>
                <div class="mini-note">${formatSigned(sc.profitPerHour)} зол./ч</div>
              </article>`).join("")}
          </div>
        </div>

        <div class="exchange-section" data-exchange-id="${view.id}">
          <p class="section-mini-title">Обмен ресурсов → Синий Т4</p>
          ${renderExchangeTable(view.id)}
        </div>
      </article>
    `;
  }

  // ── EXCHANGE TABLE ───────────────────────────────────────────────────────────

  // Цепочки:
  //   A) синий Т3 → белый → пыль → синий Т4:   1.25 синих Т3 на 1 синий Т4
  //   B) зелёный  → белый → пыль → синий Т4:   6.25 зелёных на 1 синий Т4
  //   C) зелёный  → пыль  → синий Т4:           6.25 зелёных на 1 синий Т4

  function calcExchange(profId) {
    const ex = state.exchangePrices[profId] || { blueT3: 0, greenT3: 0, blueT4: 0 };
    // цена за 1 шт (вводят за 100)
    const pBlueT3  = ex.blueT3  / 100;
    const pGreenT3 = ex.greenT3 / 100;
    const pBlueT4  = ex.blueT4  / 100;  // прямая покупка

    // Стоимость 1 синего Т4 через цепочки
    const costViaBlueT3  = EXCHANGE.blueT3PerBlueT4        * pBlueT3;   // 1.25 * цена синего Т3
    const costViaGreenT3 = EXCHANGE.greenViaWhitePerBlueT4 * pGreenT3;  // 6.25 * цена зелёного Т3

    return {
      directPrice:   pBlueT4,
      costViaBlueT3,
      costViaGreenT3,
      // выгода = прямая покупка - стоимость через обмен (положительное = выгодно менять)
      savingBlueT3:  pBlueT4 - costViaBlueT3,
      savingGreenT3: pBlueT4 - costViaGreenT3,
    };
  }

  function renderExchangeTable(profId) {
    const ex  = state.exchangePrices[profId] || { blueT3: 200, greenT3: 150, blueT4: 500 };
    const res = calcExchange(profId);

    const chainRow = (label, cost, saving) => {
      const isGood = saving > 0;
      const cls    = isGood ? "value-positive" : "value-negative";
      const verdict = isGood
        ? `Выгодно: экономия ${formatMoney(saving)} зол./шт.`
        : `Невыгодно: переплата ${formatMoney(-saving)} зол./шт.`;
      return `
        <article class="exchange-row">
          <div class="exchange-chain">${label}</div>
          <div class="exchange-cost">${formatMoney(cost)} зол./шт.</div>
          <div class="exchange-verdict ${cls}">${verdict}</div>
        </article>`;
    };

    return `
      <div class="exchange-inputs">
        ${renderExchangeInput(profId, "blueT3",  ex.blueT3,  "Синий Т3",   "swatch-blue")}
        ${renderExchangeInput(profId, "greenT3", ex.greenT3, "Зелёный Т3", "swatch-green")}
        ${renderExchangeInput(profId, "blueT4",  ex.blueT4,  "Синий Т4 (аукцион)", "swatch-blue")}
      </div>
      <div class="exchange-results" data-exres-id="${profId}">
        <div class="exchange-direct">Прямая покупка 1 синего Т4: <strong>${formatMoney(res.directPrice)} зол.</strong></div>
        ${chainRow(
          "Синий Т3 → Белый → Пыль → Синий Т4 (нужно 1.25 синих Т3 на 1 Т4)",
          res.costViaBlueT3,
          res.savingBlueT3
        )}
        ${chainRow(
          "Зелёный → Белый/Пыль → Синий Т4 (нужно 6.25 зелёных на 1 Т4)",
          res.costViaGreenT3,
          res.savingGreenT3
        )}
      </div>
    `;
  }

  function renderExchangeInput(profId, field, value, label, swatchClass) {
    return `
      <label class="resource-row">
        <span class="resource-label">
          <span class="swatch ${swatchClass}"></span>
          <span>${label}</span>
        </span>
        <input type="number" min="0" step="1" value="${value}"
          data-exch-prof="${profId}" data-exch-field="${field}">
        <span class="resource-hint">за 100 шт.</span>
      </label>`;
  }

  function patchExchangeResult(profId) {
    const container = elements.craftsGrid.querySelector(`[data-exres-id="${profId}"]`);
    if (!container) return;
    const res  = calcExchange(profId);
    const rows = container.querySelectorAll(".exchange-row .exchange-cost, .exchange-row .exchange-verdict");
    // row 0 = blueT3 chain, row 1 = greenT3 chain
    // each chain has 2 elements: cost + verdict
    [[res.costViaBlueT3, res.savingBlueT3], [res.costViaGreenT3, res.savingGreenT3]].forEach(([cost, saving], i) => {
      const costEl    = rows[i * 2];
      const verdictEl = rows[i * 2 + 1];
      if (!costEl || !verdictEl) return;
      const isGood = saving > 0;
      costEl.textContent    = `${formatMoney(cost)} зол./шт.`;
      verdictEl.textContent = isGood
        ? `Выгодно: экономия ${formatMoney(saving)} зол./шт.`
        : `Невыгодно: переплата ${formatMoney(-saving)} зол./шт.`;
      verdictEl.className = `exchange-verdict ${isGood ? "value-positive" : "value-negative"}`;
    });
    // update direct price
    const directEl = container.querySelector(".exchange-direct strong");
    if (directEl) directEl.textContent = `${formatMoney(res.directPrice)} зол.`;
  }

  // ── PATCH HELPERS ────────────────────────────────────────────────────────────

  function patchBadges(visibleResults, bestView) {
    const bestId = bestView ? bestView.id : null;
    visibleResults.forEach((view) => {
      const card = elements.craftsGrid.querySelector(`[data-card-id="${view.id}"]`);
      if (!card) return;
      card.classList.toggle("is-top", view.id === bestId);
      const rankPill = card.querySelector(".rank-pill");
      if (rankPill) {
        const remaining = Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000);
        rankPill.className  = `rank-pill ${view.id === bestId ? "is-best" : "is-frozen"}`;
        rankPill.textContent = view.id === bestId ? "Лучший вариант" : `Зафиксировано · ${remaining}с`;
      }
      const profitPill = card.querySelector(".profit-pill");
      if (profitPill) {
        const pos = view.current.profit.perCycle >= 0;
        profitPill.className  = `profit-pill ${pos ? "is-positive" : "is-negative"}`;
        profitPill.textContent = pos ? "В плюс" : "В минус";
      }
    });
  }

  function patchCardMetrics(professionId) {
    const card = elements.craftsGrid.querySelector(`[data-card-id="${professionId}"]`);
    if (!card) return;
    const shared  = { professionId, crystalTypeKey: state.crystalTypeKey, crystalPrice: state.crystalPrice, resourcePrices: state.professionPrices[professionId] };
    const normal  = calculateProfession({ ...shared, modeKey: "normal" });
    const premium = calculateProfession({ ...shared, modeKey: "premium" });
    const current = state.modeKey === "premium" ? premium : normal;

    const mv = card.querySelectorAll(".metric-value");
    if (mv[0]) mv[0].textContent = `${formatMoney(current.costs.resourceCost)} зол.`;
    if (mv[1]) mv[1].textContent = `${formatMoney(current.costs.craftFee)} зол.`;
    if (mv[2]) mv[2].textContent = `${formatMoney(current.costs.totalCost)} зол.`;
    if (mv[3]) {
      mv[3].textContent = `${formatDecimal(current.output.totalExpected)} шт.`;
      const mc = mv[3].closest(".metric-card");
      if (mc) {
        const hl = mc.querySelector(".resource-hint"); if (hl) hl.textContent = `${formatMoney(current.output.baseCrystals)} базовых × ${formatMultiplier(current.output.multiplier)}`;
        const ll = mc.querySelector(".metric-label");  if (ll) ll.textContent = `Кристаллов ×${formatMultiplier(current.output.multiplier)}`;
      }
    }
    const ml = card.querySelectorAll(".metric-label");
    if (ml[1]) ml[1].textContent = `Крафт-сбор (${current.counts.craftsPerCycle}×${current.mode.craftFeePerCraft})`;

    const rv = card.querySelectorAll(".result-value");
    [
      { v: current.profit.perCrystal, fmt: (x) => `${formatSigned(x)} зол.` },
      { v: normal.profit.perCycle,    fmt: (x) => `${formatSigned(x)} зол.` },
      { v: premium.profit.perCycle,   fmt: (x) => `${formatSigned(x)} зол.` },
      { v: current.profit.perHour,    fmt: (x) => `${formatSigned(x)} зол./ч` },
      { v: current.profit.perDay,     fmt: (x) => `${formatSigned(x)} зол.` },
      { v: current.profit.roi,        fmt: formatPercent },
      { v: current.breakEvenCrystalPrice || 0, fmt: (x) => `${formatDecimal(x)} зол./кр.`, noTone: true },
    ].forEach((row, i) => {
      if (!rv[i]) return;
      rv[i].textContent = row.fmt(row.v);
      if (!row.noTone) rv[i].className = `result-value ${row.v >= 0 ? "value-positive" : "value-negative"}`;
    });

    const sv = card.querySelectorAll(".scenario-card .summary-value");
    current.scenarios.forEach((sc, i) => {
      if (!sv[i]) return;
      sv[i].textContent = `${formatSigned(sc.profitPerCycle)} зол./цикл`;
      sv[i].className   = `summary-value ${sc.profitPerCycle >= 0 ? "value-positive" : "value-negative"}`;
    });
  }

  // ── EDIT LOCK ────────────────────────────────────────────────────────────────

  function lockVisibleOrder() {
    if (uiState.editLock || !uiState.lastVisibleOrder.length) return;
    uiState.editLock = { orderIds: [...uiState.lastVisibleOrder] };
  }

  function scheduleEditUnlock() {
    if (uiState.editReleaseTimer)    clearTimeout(uiState.editReleaseTimer);
    if (uiState.editCountdownInterval) clearInterval(uiState.editCountdownInterval);

    uiState.editLockEndsAt = Date.now() + 15000;

    uiState.editCountdownInterval = setInterval(() => {
      const remaining = Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000);
      document.querySelectorAll(".rank-pill.is-frozen").forEach((el) => {
        el.textContent = `Зафиксировано · ${remaining}с`;
      });
    }, 1000);

    uiState.editReleaseTimer = setTimeout(() => {
      uiState.editLock = null;
      uiState.editReleaseTimer = null;
      uiState.editLockEndsAt = null;
      clearInterval(uiState.editCountdownInterval);
      uiState.editCountdownInterval = null;
      render();
    }, 15000);
  }

  // ── RENDER HELPERS ───────────────────────────────────────────────────────────

  function renderResourceRow(view, color, label, swatchClass) {
    return `
      <label class="resource-row">
        <span class="resource-label"><span class="swatch ${swatchClass}"></span><span>${label}</span></span>
        <input type="number" min="0" step="1" value="${view.current.prices[color]}"
          data-profession="${view.id}" data-color="${color}">
        <span class="resource-hint">×${view.current.counts.perCraft[color]} за крафт</span>
      </label>`;
  }

  function renderMetric(label, value, hint) {
    return `<article class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div>${hint ? `<div class="resource-hint">${hint}</div>` : ""}</article>`;
  }

  function renderResult(label, value, toneClass, emphasis) {
    return `<article class="result-card ${emphasis ? "emphasis" : ""}"><div class="result-label">${label}</div><div class="result-value ${toneClass}">${value}</div></article>`;
  }

  // ── FORMATTERS ───────────────────────────────────────────────────────────────

  function formatMoney(value)      { return numberFormatter.format(Math.round(value)); }
  function formatDecimal(value)    { return preciseFormatter.format(value); }
  function formatMultiplier(value) { return multiplierFormatter.format(value); }
  function formatSigned(value) {
    const r = Math.round(value);
    return `${r > 0 ? "+" : ""}${numberFormatter.format(r)}`;
  }
  function formatPercent(value) {
    const p = value * 100;
    return `${p > 0 ? "+" : ""}${preciseFormatter.format(p)}%`;
  }
})();
