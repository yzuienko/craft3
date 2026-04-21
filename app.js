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

  const STORAGE_KEY = "craft-calc-ui-v4";
  const LEGACY_STORAGE_KEYS = ["craft-calc-ui-v3", "ccalc_v2"];
  const STORAGE_SCHEMA_VERSION = 2;

  const numberFormatter = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  });
  const preciseFormatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const multiplierFormatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const state = createInitialState();
  const uiState = {
    editLock: null,
    editReleaseTimer: null,
    editCountdownInterval: null,
    editLockEndsAt: null,
    lastVisibleOrder: [],
  };

  const elements = {
    typeSegment: document.getElementById("type-segment"),
    modeSegment: document.getElementById("mode-segment"),
    crystalPrice: document.getElementById("crystal-price"),
    sortSegment: document.getElementById("sort-segment"),
    profitableToggle: document.getElementById("profitable-toggle"),
    modeInsights: document.getElementById("mode-insights"),
    heroStats: document.getElementById("hero-stats"),
    boardCaption: document.getElementById("board-caption"),
    craftsGrid: document.getElementById("crafts-grid"),
    emptyState: document.getElementById("empty-state"),
    summaryContent: document.getElementById("summary-content"),
  };

  init();

  function init() {
    hydrateState();
    renderControls();
    bindGlobalEvents();
    render();
  }

  function createInitialState() {
    return {
      crystalTypeKey: "t45",
      modeKey: "normal",
      crystalPrice: 100,
      sortKey: "manual",
      onlyProfitable: false,
      professionPrices: cloneDefaultPrices(),
    };
  }

  function hydrateState() {
    const migrated = readSavedState();
    if (!migrated) {
      return;
    }

    if (migrated.crystalTypeKey in CRYSTAL_TYPES) {
      state.crystalTypeKey = migrated.crystalTypeKey;
    }
    if (migrated.modeKey in MODES) {
      state.modeKey = migrated.modeKey;
    }
    if (migrated.sortKey in SORT_OPTIONS) {
      state.sortKey = migrated.sortKey;
    }
    state.onlyProfitable = Boolean(migrated.onlyProfitable);
    state.crystalPrice = sanitizeNumber(migrated.crystalPrice, state.crystalPrice);

    PROFESSIONS.forEach((profession) => {
      const savedProfession = migrated.professionPrices && migrated.professionPrices[profession.id];
      if (!savedProfession) {
        return;
      }

      state.professionPrices[profession.id] = {
        blue: sanitizeNumber(savedProfession.blue, state.professionPrices[profession.id].blue),
        green: sanitizeNumber(savedProfession.green, state.professionPrices[profession.id].green),
        white: sanitizeNumber(savedProfession.white, state.professionPrices[profession.id].white),
      };
    });

    saveState();
  }

  function readSavedState() {
    const currentState = parseStorage(STORAGE_KEY);
    if (currentState) {
      return normalizeModernState(currentState, true);
    }

    const legacyState = parseStorage(LEGACY_STORAGE_KEYS[1]);
    if (legacyState) {
      return normalizeLegacyState(legacyState);
    }

    const migratedModernState = parseStorage(LEGACY_STORAGE_KEYS[0]);
    if (migratedModernState) {
      return normalizeModernState(migratedModernState, false);
    }

    return null;
  }

  function parseStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      console.warn("Не удалось прочитать сохранённые данные", error);
      return null;
    }
  }

  function normalizeModernState(saved, keepSortPreferences) {
    return {
      crystalTypeKey: saved.crystalTypeKey,
      modeKey: saved.modeKey,
      crystalPrice: saved.crystalPrice,
      sortKey: keepSortPreferences && saved.schemaVersion === STORAGE_SCHEMA_VERSION && saved.sortKey in SORT_OPTIONS ? saved.sortKey : "manual",
      onlyProfitable: keepSortPreferences && saved.schemaVersion === STORAGE_SCHEMA_VERSION ? Boolean(saved.onlyProfitable) : false,
      professionPrices: saved.professionPrices || {},
    };
  }

  function normalizeLegacyState(saved) {
    return {
      crystalTypeKey: saved.cType,
      modeKey: saved.premium ? "premium" : "normal",
      crystalPrice: saved.crystalPrice,
      sortKey: "manual",
      onlyProfitable: false,
      professionPrices: saved.prices || {},
    };
  }

  function saveState() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: STORAGE_SCHEMA_VERSION,
        crystalTypeKey: state.crystalTypeKey,
        modeKey: state.modeKey,
        crystalPrice: state.crystalPrice,
        sortKey: state.sortKey,
        onlyProfitable: state.onlyProfitable,
        professionPrices: state.professionPrices,
      })
    );
  }

  function renderControls() {
    renderSegment(
      elements.typeSegment,
      Object.values(CRYSTAL_TYPES).map((type) => ({
        label: type.label,
        active: state.crystalTypeKey === type.id,
        action: () => {
          state.crystalTypeKey = type.id;
          saveState();
          render();
        },
      }))
    );

    renderSegment(
      elements.modeSegment,
      Object.values(MODES).map((mode) => ({
        label: mode.label,
        active: state.modeKey === mode.id,
        action: () => {
          state.modeKey = mode.id;
          saveState();
          render();
        },
      }))
    );

    renderSortButtons();

    elements.crystalPrice.value = state.crystalPrice;
    elements.profitableToggle.checked = state.onlyProfitable;
  }

  function renderSegment(root, items) {
    root.innerHTML = "";
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.className = item.active ? "is-active" : "";
      button.setAttribute("aria-pressed", item.active ? "true" : "false");
      button.addEventListener("click", item.action);
      root.appendChild(button);
    });
  }

  function renderSortButtons() {
    elements.sortSegment.innerHTML = "";

    Object.values(SORT_OPTIONS).forEach((sort) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = sort.label;
      button.className = `sort-btn ${state.sortKey === sort.id ? "is-active" : ""} ${uiState.editLock && state.sortKey === sort.id ? "is-frozen" : ""}`.trim();
      button.setAttribute("aria-pressed", state.sortKey === sort.id ? "true" : "false");
      button.addEventListener("click", () => {
        state.sortKey = sort.id;
        saveState();
        render();
      });
      elements.sortSegment.appendChild(button);
    });
  }

  function bindGlobalEvents() {
    elements.crystalPrice.addEventListener("input", (event) => {
      state.crystalPrice = sanitizeNumber(event.target.value, 0);
      saveState();
      render();
    });

    elements.profitableToggle.addEventListener("change", (event) => {
      state.onlyProfitable = event.target.checked;
      saveState();
      render();
    });
  }

  function render() {
    renderControls();

    const results = buildProfessionViews();
    const visibleResults = getVisibleResults(results);

    const bestView = (visibleResults.length ? visibleResults : results)
      .slice()
      .sort((left, right) => right.current.profit.perCycle - left.current.profit.perCycle)[0] || null;

    renderHero(bestView);
    renderModeInsights();
    renderSummary(bestView);
    renderBoard(visibleResults, results.length, bestView ? bestView.id : null);
  }

  function buildProfessionViews() {
    return PROFESSIONS.map((profession, index) => {
      const sharedInput = {
        professionId: profession.id,
        crystalTypeKey: state.crystalTypeKey,
        crystalPrice: state.crystalPrice,
        resourcePrices: state.professionPrices[profession.id],
      };

      const normal = calculateProfession({
        ...sharedInput,
        modeKey: "normal",
      });

      const premium = calculateProfession({
        ...sharedInput,
        modeKey: "premium",
      });

      return {
        id: profession.id,
        order: index,
        profession,
        normal,
        premium,
        current: state.modeKey === "premium" ? premium : normal,
      };
    });
  }

  function compareViews(left, right) {
    if (state.sortKey === "manual") {
      return left.order - right.order;
    }

    return getSortValue(right.current, state.sortKey) - getSortValue(left.current, state.sortKey);
  }

  function getVisibleResults(results) {
    const filteredResults = results
      .filter((item) => !state.onlyProfitable || item.current.profit.perCycle > 0)
      .sort((left, right) => compareViews(left, right));

    if (!uiState.editLock) {
      return filteredResults;
    }

    const lockedMap = new Map(results.map((item) => [item.id, item]));
    return uiState.editLock.orderIds
      .map((id) => lockedMap.get(id))
      .filter((item) => Boolean(item) && (!state.onlyProfitable || item.current.profit.perCycle > 0));
  }

  function renderHero(bestView) {
    const mode = MODES[state.modeKey];
    const craftsPerCycle = mode.queueCount * mode.stacksPerCycle;
    const baseCrystals = craftsPerCycle * CRYSTALS_PER_CRAFT;
    const crystalsWithPerk = baseCrystals * (1 + mode.perfectResultBonusRate);

    elements.heroStats.innerHTML = [
      { label: "Текущий режим", value: mode.label },
      { label: "Крафтов за цикл", value: `${craftsPerCycle} × ${CRYSTALS_PER_CRAFT}` },
      { label: "Базовый выпуск", value: `${formatMoney(baseCrystals)} кр.` },
      { label: `С перком +${Math.round(mode.perfectResultBonusRate * 100)}%`, value: `${formatDecimal(crystalsWithPerk)} кр.` },
      { label: "Лидер сейчас", value: bestView ? bestView.profession.name : "Нет данных" },
      { label: "После комиссии", value: `${formatDecimal(state.crystalPrice * (1 - AUCTION_TAX_RATE))} зол./кр.` },
    ]
      .map(
        (card) => `
          <article class="hero-stat">
            <div class="hero-stat-label">${card.label}</div>
            <div class="hero-stat-value">${card.value}</div>
          </article>
        `
      )
      .join("");
  }

  function renderModeInsights() {
    const mode = MODES[state.modeKey];
    const craftsPerCycle = mode.queueCount * mode.stacksPerCycle;
    const cycleDurationSec = mode.stackDurationSec * mode.stacksPerCycle;
    const fullCyclesPerDay = Math.floor((24 * 60 * 60) / cycleDurationSec);
    const baseCrystals = craftsPerCycle * CRYSTALS_PER_CRAFT;
    const crystalsWithPerk = baseCrystals * (1 + mode.perfectResultBonusRate);

    elements.modeInsights.innerHTML = [
      {
        label: "1 стак",
        value: formatDuration(mode.stackDurationSec),
        note: `${mode.queueCount} параллельных крафта`,
      },
      {
        label: "1 цикл",
        value: formatDuration(cycleDurationSec),
        note: `${mode.stacksPerCycle} стаков = ${craftsPerCycle} крафтов`,
      },
      {
        label: "Полных циклов за 24ч",
        value: `${fullCyclesPerDay}`,
        note: "с хвостиком",
      },
      {
        label: "Результат цикла",
        value: `${formatDecimal(crystalsWithPerk)} кр.`,
        note: `${formatMoney(baseCrystals)} базовых × ${(1 + mode.perfectResultBonusRate).toFixed(2)}`,
      },
    ]
      .map(
        (item) => `
          <article class="mode-card">
            <div class="mini-note">${item.label}</div>
            <strong>${item.value}</strong>
            <div class="hero-stat-label">${item.note}</div>
          </article>
        `
      )
      .join("");
  }

  function renderSummary(bestView) {
    if (!bestView) {
      elements.summaryContent.innerHTML = `
        <div class="summary-hero">
          <h3>Нет данных для расчёта</h3>
          <p>Добавь цены ресурсов и стоимость кристалла, чтобы увидеть сводку.</p>
        </div>
      `;
      return;
    }

    elements.summaryContent.innerHTML = `
      <div class="summary-hero">
        <div class="mini-note">Сейчас лидирует</div>
        <h3>${bestView.profession.icon} ${bestView.profession.name}</h3>
        <p>
         
          <strong>${bestView.normal.counts.craftsPerCycle}×468</strong> без премиума и
          <strong>${bestView.premium.counts.craftsPerCycle}×447</strong> с премиумом.
        </p>
      </div>

      <div class="summary-grid summary-grid-wide">
        ${renderSummaryCard("За 1 кристалл", `${formatSigned(bestView.current.profit.perCrystal)} зол.`)}
        ${renderSummaryCard("За 30 крафтов", `${formatSigned(bestView.normal.profit.perCycle)} зол.`)}
        ${renderSummaryCard("За 40 крафтов", `${formatSigned(bestView.premium.profit.perCycle)} зол.`)}
        ${renderSummaryCard("Точка безубыточности", `${formatDecimal(bestView.current.breakEvenCrystalPrice || 0)} зол./кр.`)}
      </div>

      <div class="summary-grid summary-grid-wide">
        ${renderSummaryCard("Прибыль в час", `${formatSigned(bestView.current.profit.perHour)} зол./ч`)}
        ${renderSummaryCard("Прибыль за 24ч", `${formatSigned(bestView.current.profit.perDay)} зол.`)}
        ${renderSummaryCard("ROI", formatPercent(bestView.current.profit.roi))}
        ${renderSummaryCard("Кристаллов за цикл", `${formatDecimal(bestView.current.output.totalExpected)} шт.`)}
      </div>

      <div class="kpi">
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
    return `
      <article class="summary-card">
        <div class="summary-label">${label}</div>
        <div class="summary-value">${value}</div>
      </article>
    `;
  }

  function renderBoard(visibleResults, totalCount, bestId) {
    uiState.lastVisibleOrder = visibleResults.map((view) => view.id);

    const sortCaption =
      uiState.editLock
        ? `Порядок зафиксирован · ${Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000)}с · выбрано: ${SORT_OPTIONS[state.sortKey].label}`
        : state.sortKey === "manual"
          ? "Ручной порядок включён"
          : `Сортировка: ${SORT_OPTIONS[state.sortKey].label}`;

    elements.boardCaption.textContent = `${visibleResults.length} из ${totalCount} профессий · ${sortCaption}`;
    elements.emptyState.hidden = visibleResults.length > 0;
    elements.craftsGrid.hidden = visibleResults.length === 0;

    if (!visibleResults.length) {
      elements.craftsGrid.innerHTML = "";
      return;
    }

    elements.craftsGrid.innerHTML = visibleResults
      .map((view, index) => renderCraftCard(view, {
        isBest: view.id === bestId,
        rank: index + 1,
      }))
      .join("");

    elements.craftsGrid.querySelectorAll("[data-profession][data-color]").forEach((input) => {
      input.addEventListener("input", handleResourceInput);
    });
  }

  function renderCraftCard(view, meta) {
    const current = view.current;
    const currentIsPositive = current.profit.perCycle >= 0;
    const currentTone = currentIsPositive ? "value-positive" : "value-negative";
    const comparisonRows = [
      {
        label: "За 1 кристалл",
        value: `${formatSigned(current.profit.perCrystal)} зол.`,
        isActive: false,
        tone: current.profit.perCrystal >= 0 ? "value-positive" : "value-negative",
      },
      {
        label: `За ${view.normal.counts.craftsPerCycle} крафтов`,
        value: `${formatSigned(view.normal.profit.perCycle)} зол.`,
        isActive: state.modeKey === "normal",
        tone: view.normal.profit.perCycle >= 0 ? "value-positive" : "value-negative",
      },
      {
        label: `За ${view.premium.counts.craftsPerCycle} крафтов`,
        value: `${formatSigned(view.premium.profit.perCycle)} зол.`,
        isActive: state.modeKey === "premium",
        tone: view.premium.profit.perCycle >= 0 ? "value-positive" : "value-negative",
      },
    ];

    const craftFeeLabel = `Крафт-сбор (${current.counts.craftsPerCycle}×${current.mode.craftFeePerCraft})`;
    const crystalsHint = `${formatMoney(current.output.baseCrystals)} базовых × ${formatMultiplier(current.output.multiplier)}`;

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
            <div class="rank-pill ${meta.isBest ? "is-best" : ""} ${uiState.editLock && !meta.isBest ? "is-frozen" : ""}">${meta.isBest ? "Лучший вариант" : uiState.editLock ? `Зафиксировано · ${Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000)}с` : state.sortKey === "manual" ? "Ручной порядок" : `#${meta.rank}`}</div>
            <div class="profit-pill ${currentIsPositive ? "is-positive" : "is-negative"}">${currentIsPositive ? "В плюс" : "В минус"}</div>
          </div>
        </div>

        <div>
          <p class="section-mini-title">Цены ресурсов за 100 шт.</p>
          <div class="resource-grid">
            ${renderResourceRow(view, "blue", "Синий", "swatch-blue")}
            ${renderResourceRow(view, "green", "Зелёный", "swatch-green")}
            ${renderResourceRow(view, "white", "Белый", "swatch-white")}
          </div>
        </div>

        <div>
          <p class="section-mini-title">Себестоимость текущего режима</p>
          <div class="metrics-grid">
            ${renderMetric("Ресурсы", `${formatMoney(current.costs.resourceCost)} зол.`)}
            ${renderMetric(craftFeeLabel, `${formatMoney(current.costs.craftFee)} зол.`)}
            ${renderMetric("Итого затрат", `${formatMoney(current.costs.totalCost)} зол.`)}
            ${renderMetric(`Кристаллов ×${formatMultiplier(current.output.multiplier)}`, `${formatDecimal(current.output.totalExpected)} шт.`, crystalsHint)}
          </div>
        </div>

        <div>
          <p class="section-mini-title">Чистая прибыль</p>
          <div class="results-grid profit-compare-grid">
            ${comparisonRows
              .map(
                (row) => `
                  <article class="result-card ${row.isActive ? "emphasis is-active" : ""}">
                    <div class="result-label">${row.label}</div>
                    <div class="result-value ${row.tone}">${row.value}</div>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>

        <div>
          <p class="section-mini-title">Дополнительные метрики</p>
          <div class="results-grid">
            ${renderResult("Прибыль в час", `${formatSigned(current.profit.perHour)} зол./ч`, currentTone, false)}
            ${renderResult("Прибыль за 24ч", `${formatSigned(current.profit.perDay)} зол.`, currentTone, false)}
            ${renderResult("ROI", formatPercent(current.profit.roi), currentTone, false)}
            ${renderResult("Точка безубыточности", `${formatDecimal(current.breakEvenCrystalPrice || 0)} зол./кр.`, "", false)}
          </div>
        </div>

        <div>
          <p class="section-mini-title">Сценарии рынка</p>
          <div class="scenarios-grid">
            ${current.scenarios
              .map(
                (scenario) => `
                  <article class="scenario-card">
                    <div class="scenario-label">${scenario.label}</div>
                    <div class="summary-value ${scenario.profitPerCycle >= 0 ? "value-positive" : "value-negative"}">${formatSigned(scenario.profitPerCycle)} зол./цикл</div>
                    <div class="mini-note">${formatSigned(scenario.profitPerHour)} зол./ч</div>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      </article>
    `;
  }

  function renderResourceRow(view, color, label, swatchClass) {
    const current = view.current;
    return `
      <label class="resource-row">
        <span class="resource-label">
          <span class="swatch ${swatchClass}"></span>
          <span>${label}</span>
        </span>
        <input
          type="number"
          min="0"
          step="1"
          value="${current.prices[color]}"
          data-profession="${view.id}"
          data-color="${color}"
        >
        <span class="resource-hint">×${current.counts.perCraft[color]} за крафт</span>
      </label>
    `;
  }

  function renderMetric(label, value, hint) {
    return `
      <article class="metric-card">
        <div class="metric-label">${label}</div>
        <div class="metric-value">${value}</div>
        ${hint ? `<div class="resource-hint">${hint}</div>` : ""}
      </article>
    `;
  }

  function renderResult(label, value, toneClass, emphasis) {
    return `
      <article class="result-card ${emphasis ? "emphasis" : ""}">
        <div class="result-label">${label}</div>
        <div class="result-value ${toneClass}">${value}</div>
      </article>
    `;
  }

  function handleResourceInput(event) {
    const professionId = event.target.dataset.profession;
    const color = event.target.dataset.color;

    if (!professionId || !color || !state.professionPrices[professionId]) {
      return;
    }

    // Update state without touching the DOM of this input at all
    state.professionPrices[professionId][color] = sanitizeNumber(event.target.value, 0);
    saveState();
    lockVisibleOrder();
    scheduleEditUnlock();

    // Patch only the metrics inside the affected card — never re-create inputs
    patchCardMetrics(professionId);

    // Update hero, summary, captions (no cards re-render)
    const results = buildProfessionViews();
    const visibleResults = getVisibleResults(results);
    const bestView = (visibleResults.length ? visibleResults : results)
      .slice()
      .sort((l, r) => r.current.profit.perCycle - l.current.profit.perCycle)[0] || null;

    renderHero(bestView);
    renderModeInsights();
    renderSummary(bestView);

    // Update best/rank badges on cards without re-creating them
    const bestId = bestView ? bestView.id : null;
    visibleResults.forEach((view, index) => {
      const card = elements.craftsGrid.querySelector(`[data-card-id="${view.id}"]`);
      if (!card) return;
      card.classList.toggle("is-top", view.id === bestId);
      const rankPill = card.querySelector(".rank-pill");
      if (rankPill) {
        rankPill.className = `rank-pill ${view.id === bestId ? "is-best" : "is-frozen"}`;
        rankPill.textContent = view.id === bestId
          ? "Лучший вариант"
          : `Зафиксировано · ${Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000)}с`;
      }
      const profitPill = card.querySelector(".profit-pill");
      if (profitPill) {
        const pos = view.current.profit.perCycle >= 0;
        profitPill.className = `profit-pill ${pos ? "is-positive" : "is-negative"}`;
        profitPill.textContent = pos ? "В плюс" : "В минус";
      }
    });

    // Update board caption
    const remaining = Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000);
    elements.boardCaption.textContent = `${visibleResults.length} из ${results.length} профессий · Порядок зафиксирован · ${remaining}с · выбрано: ${SORT_OPTIONS[state.sortKey].label}`;
  }

  function patchCardMetrics(professionId) {
    const card = elements.craftsGrid.querySelector(`[data-card-id="${professionId}"]`);
    if (!card) return;

    // Recalculate for this profession only
    const sharedInput = {
      professionId,
      crystalTypeKey: state.crystalTypeKey,
      crystalPrice: state.crystalPrice,
      resourcePrices: state.professionPrices[professionId],
    };
    const normal = calculateProfession({ ...sharedInput, modeKey: "normal" });
    const premium = calculateProfession({ ...sharedInput, modeKey: "premium" });
    const current = state.modeKey === "premium" ? premium : normal;

    // Patch cost metrics
    const metricValues = card.querySelectorAll(".metric-value");
    // Order matches renderCraftCard: resources, craftFee, totalCost, crystals
    if (metricValues[0]) metricValues[0].textContent = `${formatMoney(current.costs.resourceCost)} зол.`;
    if (metricValues[1]) metricValues[1].textContent = `${formatMoney(current.costs.craftFee)} зол.`;
    if (metricValues[2]) metricValues[2].textContent = `${formatMoney(current.costs.totalCost)} зол.`;
    if (metricValues[3]) {
      metricValues[3].textContent = `${formatDecimal(current.output.totalExpected)} шт.`;
      // update hint
      const hint = metricValues[3].closest(".metric-card").querySelector(".resource-hint");
      if (hint) hint.textContent = `${formatMoney(current.output.baseCrystals)} базовых × ${formatMultiplier(current.output.multiplier)}`;
      // update label
      const lbl = metricValues[3].closest(".metric-card").querySelector(".metric-label");
      if (lbl) lbl.textContent = `Кристаллов ×${formatMultiplier(current.output.multiplier)}`;
    }

    // Patch craft fee label (changes if mode changed, but keep it fresh)
    const metricLabels = card.querySelectorAll(".metric-label");
    if (metricLabels[1]) metricLabels[1].textContent = `Крафт-сбор (${current.counts.craftsPerCycle}×${current.mode.craftFeePerCraft})`;

    // Patch profit comparison rows
    const resultValues = card.querySelectorAll(".result-value");
    const profitRows = [
      { value: current.profit.perCrystal },
      { value: normal.profit.perCycle },
      { value: premium.profit.perCycle },
    ];
    profitRows.forEach((row, i) => {
      if (!resultValues[i]) return;
      resultValues[i].textContent = `${formatSigned(row.value)} зол.`;
      resultValues[i].className = `result-value ${row.value >= 0 ? "value-positive" : "value-negative"}`;
    });

    // Patch additional metrics (perHour, perDay, roi, breakEven)
    if (resultValues[3]) {
      resultValues[3].textContent = `${formatSigned(current.profit.perHour)} зол./ч`;
      resultValues[3].className = `result-value ${current.profit.perHour >= 0 ? "value-positive" : "value-negative"}`;
    }
    if (resultValues[4]) {
      resultValues[4].textContent = `${formatSigned(current.profit.perDay)} зол.`;
      resultValues[4].className = `result-value ${current.profit.perDay >= 0 ? "value-positive" : "value-negative"}`;
    }
    if (resultValues[5]) {
      resultValues[5].textContent = formatPercent(current.profit.roi);
      resultValues[5].className = `result-value ${current.profit.roi >= 0 ? "value-positive" : "value-negative"}`;
    }
    if (resultValues[6]) {
      resultValues[6].textContent = `${formatDecimal(current.breakEvenCrystalPrice || 0)} зол./кр.`;
    }

    // Patch scenario values
    const scenarioValues = card.querySelectorAll(".scenario-card .summary-value");
    current.scenarios.forEach((sc, i) => {
      if (!scenarioValues[i]) return;
      scenarioValues[i].textContent = `${formatSigned(sc.profitPerCycle)} зол./цикл`;
      scenarioValues[i].className = `summary-value ${sc.profitPerCycle >= 0 ? "value-positive" : "value-negative"}`;
    });
  }

  function lockVisibleOrder() {
    if (uiState.editLock || !uiState.lastVisibleOrder.length) {
      return;
    }

    uiState.editLock = {
      orderIds: [...uiState.lastVisibleOrder],
    };
  }

  function scheduleEditUnlock() {
    if (uiState.editReleaseTimer) {
      clearTimeout(uiState.editReleaseTimer);
    }
    if (uiState.editCountdownInterval) {
      clearInterval(uiState.editCountdownInterval);
    }

    uiState.editLockEndsAt = Date.now() + 15000;

    // Update countdown text every second without full re-render
    uiState.editCountdownInterval = setInterval(() => {
      const remaining = Math.ceil((uiState.editLockEndsAt - Date.now()) / 1000);
      document.querySelectorAll(".rank-pill.is-frozen").forEach((el) => {
        el.textContent = `Зафиксировано · ${remaining}с`;
      });
      const caption = elements.boardCaption.textContent;
      if (caption.includes("зафиксирован")) {
        elements.boardCaption.textContent = caption.replace(/\d+с$/, `${remaining}с`).replace("зафиксирован на время ввода", `зафиксирован · ${remaining}с`);
      }
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

  function restoreFocusState(focusState) {
    if (!focusState) {
      return;
    }

    const selector = `input[data-profession="${focusState.professionId}"][data-color="${focusState.color}"]`;
    const input = elements.craftsGrid.querySelector(selector);
    if (!input) {
      return;
    }

    input.focus();
    if (typeof input.setSelectionRange === "function") {
      const start = Math.min(focusState.selectionStart || 0, input.value.length);
      const end = Math.min(focusState.selectionEnd || start, input.value.length);
      input.setSelectionRange(start, end);
    }
  }

  function formatMoney(value) {
    return numberFormatter.format(Math.round(value));
  }

  function formatSigned(value) {
    const rounded = Math.round(value);
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${numberFormatter.format(rounded)}`;
  }

  function formatPercent(value) {
    const percent = value * 100;
    const sign = percent > 0 ? "+" : "";
    return `${sign}${preciseFormatter.format(percent)}%`;
  }

  function formatDecimal(value) {
    return preciseFormatter.format(value);
  }

  function formatMultiplier(value) {
    return multiplierFormatter.format(value);
  }

  // ── Exchange Calculator ───────────────────────────────────────

  const EXCHANGE_STORAGE_KEY = "craft-calc-exchange-v1";

  // Exchange rates (fixed game mechanics):
  // 5 T3 Blue  → 50 White
  // 25 T3 Green → 50 White
  // 100 White   → 80 Dust
  // 50 Green    → 80 Dust
  // 100 Dust    → 10 T4 Blue (target!)
  //
  // Chains to evaluate:
  //  A) T3Blue → White → Dust → T4Blue
  //  B) T3Green → White → Dust → T4Blue
  //  C) T3Green → Dust → T4Blue

  const EXCHANGE_CHAINS = [
    {
      id: "blue_white_dust_t4",
      label: "Синий Т3 → Белый → Пыль → Синий Т4",
      steps: [
        "5 Синих Т3 → 50 Белых",
        "100 Белых → 80 Пыли",
        "100 Пыли → 10 Синих Т4",
      ],
      // How many T3 Blue do we spend to get 1 T4 Blue?
      // 5 T3Blue → 50 White; 100 White → 80 Dust; 100 Dust → 10 T4Blue
      // To get 100 Dust need 100/80 * 100 = 125 White
      // 125 White costs 125/50 * 5 = 12.5 T3Blue
      // 12.5 T3Blue → 10 T4Blue  ⇒  1.25 T3Blue per T4Blue
      costInT3Blue: 1.25,       // T3 Blue per 1 T4 Blue
      costInWhite: 12.5,        // intermediate White per 1 T4 Blue
      costInDust: 10,           // intermediate Dust per 1 T4 Blue
      useBlue: true,
      useGreen: false,
      useWhite: true,
    },
    {
      id: "green_white_dust_t4",
      label: "Зелёный Т3 → Белый → Пыль → Синий Т4",
      steps: [
        "25 Зелёных Т3 → 50 Белых",
        "100 Белых → 80 Пыли",
        "100 Пыли → 10 Синих Т4",
      ],
      // 25 T3Green → 50 White; 100 White → 80 Dust; 100 Dust → 10 T4Blue
      // Same dust calc: 125 White needed per 10 T4Blue
      // 125 White = 125/50 * 25 = 62.5 T3Green → 10 T4Blue
      // So 6.25 T3Green per 1 T4Blue
      costInT3Green: 6.25,
      costInWhite: 12.5,
      costInDust: 10,
      useBlue: false,
      useGreen: true,
      useWhite: true,
    },
    {
      id: "green_dust_t4",
      label: "Зелёный Т3 → Пыль → Синий Т4",
      steps: [
        "50 Зелёных Т3 → 80 Пыли",
        "100 Пыли → 10 Синих Т4",
      ],
      // 50 T3Green → 80 Dust; 100 Dust → 10 T4Blue
      // To get 100 Dust need 100/80 * 50 = 62.5 T3Green → 10 T4Blue
      // 6.25 T3Green per 1 T4Blue
      costInT3Green: 6.25,
      costInDust: 10,
      useBlue: false,
      useGreen: true,
      useWhite: false,
    },
  ];

  const exchangeState = {
    professionId: PROFESSIONS[0].id,
    prices: {}, // per-profession: { t3blue, t3green, t4blue }
  };

  function initExchangeState() {
    // Load from localStorage
    try {
      const raw = localStorage.getItem(EXCHANGE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (parsed.professionId && PROFESSIONS.find(p => p.id === parsed.professionId)) {
            exchangeState.professionId = parsed.professionId;
          }
          if (parsed.prices && typeof parsed.prices === "object") {
            PROFESSIONS.forEach(p => {
              if (parsed.prices[p.id] && typeof parsed.prices[p.id] === "object") {
                exchangeState.prices[p.id] = {
                  t3blue: sanitizeNumber(parsed.prices[p.id].t3blue, 0),
                  t3green: sanitizeNumber(parsed.prices[p.id].t3green, 0),
                  t4blue: sanitizeNumber(parsed.prices[p.id].t4blue, 0),
                };
              }
            });
          }
        }
      }
    } catch (e) { /* ignore */ }

    // Fill defaults
    PROFESSIONS.forEach(p => {
      if (!exchangeState.prices[p.id]) {
        exchangeState.prices[p.id] = { t3blue: 0, t3green: 0, t4blue: 0 };
      }
    });
  }

  function saveExchangeState() {
    localStorage.setItem(EXCHANGE_STORAGE_KEY, JSON.stringify({
      professionId: exchangeState.professionId,
      prices: exchangeState.prices,
    }));
  }

  function renderExchangePanel() {
    const tabsEl = document.getElementById("exchange-profession-tabs");
    const inputsEl = document.getElementById("exchange-inputs");
    const chainsEl = document.getElementById("exchange-chains");

    if (!tabsEl || !inputsEl || !chainsEl) return;

    // Tabs
    tabsEl.innerHTML = PROFESSIONS.map(p => `
      <button type="button" class="exchange-tab ${p.id === exchangeState.professionId ? "is-active" : ""}" data-exprof="${p.id}">
        ${p.icon} ${p.name}
      </button>
    `).join("");

    tabsEl.querySelectorAll(".exchange-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        exchangeState.professionId = btn.dataset.exprof;
        saveExchangeState();
        renderExchangePanel();
      });
    });

    // Inputs for current profession
    const prices = exchangeState.prices[exchangeState.professionId];

    inputsEl.innerHTML = `
      <div class="exchange-chain-title">Цены за 100 шт. на аукционе</div>
      ${renderExchangeInput("t3blue", "🔵 Синий Т3", prices.t3blue)}
      ${renderExchangeInput("t3green", "🟢 Зелёный Т3", prices.t3green)}
      ${renderExchangeInput("t4blue", "💎 Синий Т4", prices.t4blue)}
    `;

    inputsEl.querySelectorAll("input[data-exfield]").forEach(inp => {
      inp.addEventListener("input", () => {
        const field = inp.dataset.exfield;
        exchangeState.prices[exchangeState.professionId][field] = sanitizeNumber(inp.value, 0);
        saveExchangeState();
        renderExchangeChains(chainsEl);
      });
    });

    renderExchangeChains(chainsEl);
  }

  function renderExchangeInput(field, label, value) {
    return `
      <div class="exchange-input-row">
        <label>${label}</label>
        <input type="number" min="0" step="1" value="${value || ""}" placeholder="0" data-exfield="${field}">
        <span class="exchange-input-suffix">зол./100</span>
      </div>
    `;
  }

  function renderExchangeChains(chainsEl) {
    const prices = exchangeState.prices[exchangeState.professionId];
    const t3bluePer1 = (prices.t3blue || 0) / 100;
    const t3greenPer1 = (prices.t3green || 0) / 100;
    const t4bluePer100 = prices.t4blue || 0;
    const t4bluePer1 = t4bluePer100 / 100;

    chainsEl.innerHTML = `<div class="exchange-chain-title">Цепочки обмена</div>` +
      EXCHANGE_CHAINS.map(chain => {
        // Calculate cost of 1 T4 Blue via this chain
        let inputCost = 0;
        let inputDesc = "";

        if (chain.id === "blue_white_dust_t4") {
          // cost = 1.25 T3Blue per T4Blue
          inputCost = chain.costInT3Blue * t3bluePer1;
          inputDesc = `${chain.costInT3Blue} × Синий Т3`;
        } else if (chain.id === "green_white_dust_t4") {
          inputCost = chain.costInT3Green * t3greenPer1;
          inputDesc = `${chain.costInT3Green} × Зелёный Т3`;
        } else if (chain.id === "green_dust_t4") {
          inputCost = chain.costInT3Green * t3greenPer1;
          inputDesc = `${chain.costInT3Green} × Зелёный Т3`;
        }

        const saleValue = t4bluePer1;
        const profit = saleValue - inputCost;
        const profitClass = profit >= 0 ? "value-positive" : "value-negative";
        const cardClass = profit >= 0 ? "is-profit" : "is-loss";
        const profitSign = profit >= 0 ? "+" : "";

        const inputCostFormatted = numberFormatter.format(Math.round(inputCost * 100)) + " зол./100";
        const saleValueFormatted = numberFormatter.format(Math.round(saleValue * 100)) + " зол./100";
        const profitFormatted = profitSign + numberFormatter.format(Math.round(profit * 100)) + " зол. на 100 Т4";

        const hasData = (chain.useBlue ? prices.t3blue > 0 : true)
          && (chain.useGreen ? prices.t3green > 0 : true)
          && prices.t4blue > 0;

        return `
          <article class="exchange-chain-card ${hasData ? cardClass : ""}">
            <div class="exchange-chain-label">${chain.label}</div>
            <div class="exchange-chain-steps">${chain.steps.join(" → ")}</div>
            ${hasData ? `
              <div class="exchange-chain-result ${profitClass}">${profitFormatted}</div>
              <div class="exchange-chain-sub">
                Стоимость: ${inputCostFormatted} · Ценность Т4: ${saleValueFormatted}
                · ${inputDesc} на 1 Т4
              </div>
            ` : `<div class="exchange-chain-sub" style="color:var(--muted)">Введите цены для расчёта</div>`}
          </article>
        `;
      }).join("");
  }

  // Init exchange panel alongside main init
  initExchangeState();
  renderExchangePanel();
})();
