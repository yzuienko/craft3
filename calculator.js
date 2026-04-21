(function (global) {
  "use strict";

  const DAY_SECONDS = 24 * 60 * 60;
  const AUCTION_TAX_RATE = 0.05;
  const CRYSTALS_PER_CRAFT = 10;

  const CRYSTAL_TYPES = {
    t45: {
      id: "t45",
      label: "Т4.5 — огромный",
      shortLabel: "Т4.5",
      recipe: { blue: 43, green: 59, white: 112 },
    },
    t4: {
      id: "t4",
      label: "Т4 — судьбы",
      shortLabel: "Т4",
      recipe: { blue: 33, green: 45, white: 86 },
    },
  };

  const MODES = {
    normal: {
      id: "normal",
      label: "Без Нинав",
      shortLabel: "Без премиума",
      queueCount: 3,
      stacksPerCycle: 10,
      stackDurationSec: 4095,
      craftFeePerCraft: 468,
      perfectResultBonusRate: 0.15,
    },
    premium: {
      id: "premium",
      label: "Премиум Нинав",
      shortLabel: "С премиумом",
      queueCount: 4,
      stacksPerCycle: 10,
      stackDurationSec: 3465,
      craftFeePerCraft: 447,
      perfectResultBonusRate: 0.16,
    },
  };

  const PROFESSIONS = [
    { id: "hunt", name: "Охота", icon: "🏹" },
    { id: "fish", name: "Рыбалка", icon: "🎣" },
    { id: "arch", name: "Археология", icon: "🏺" },
    { id: "herb", name: "Травничество", icon: "🌿" },
    { id: "wood", name: "Лесозаготовка", icon: "🪵" },
    { id: "mine", name: "Горное дело", icon: "⛏" },
  ];

  const RESOURCE_COLORS = ["blue", "green", "white"];

  const DEFAULT_RESOURCE_PRICES = {
    blue: 500,
    green: 300,
    white: 150,
  };

  const SORT_OPTIONS = {
    manual: { id: "manual", label: "Ручной порядок" },
    profitPerCycle: { id: "profitPerCycle", label: "По прибыли за цикл" },
    profitPerHour: { id: "profitPerHour", label: "По прибыли в час" },
    roi: { id: "roi", label: "По ROI" },
    breakEven: { id: "breakEven", label: "По точке безубыточности" },
  };

  function cloneDefaultPrices() {
    const priceBook = {};
    PROFESSIONS.forEach((profession) => {
      priceBook[profession.id] = { ...DEFAULT_RESOURCE_PRICES };
    });
    return priceBook;
  }

  function sanitizeNumber(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return fallback;
    }
    return numeric;
  }

  function getMode(modeKey) {
    return MODES[modeKey] || MODES.normal;
  }

  function getCrystalType(typeKey) {
    return CRYSTAL_TYPES[typeKey] || CRYSTAL_TYPES.t45;
  }

  function getCycleCraftCount(mode) {
    return mode.queueCount * mode.stacksPerCycle;
  }

  function getCycleDurationSec(mode) {
    return mode.stackDurationSec * mode.stacksPerCycle;
  }

  function getExpectedOutput(mode) {
    const craftsPerCycle = getCycleCraftCount(mode);
    const baseCrystals = craftsPerCycle * CRYSTALS_PER_CRAFT;
    const bonusExpected = baseCrystals * mode.perfectResultBonusRate;

    return {
      craftsPerCycle,
      baseCrystals,
      bonusExpected,
      totalExpected: baseCrystals + bonusExpected,
      multiplier: 1 + mode.perfectResultBonusRate,
    };
  }

  function calculateResourceCost(recipe, resourcePrices, craftCount) {
    return RESOURCE_COLORS.reduce((total, color) => {
      const unitPricePerHundred = sanitizeNumber(resourcePrices[color], 0);
      const pricePerOne = unitPricePerHundred / 100;
      return total + recipe[color] * pricePerOne * craftCount;
    }, 0);
  }

  function calculateBreakEven(totalCost, expectedOutput) {
    const netMultiplier = expectedOutput * (1 - AUCTION_TAX_RATE);
    if (!netMultiplier) {
      return null;
    }
    return totalCost / netMultiplier;
  }

  function calculateScenarioMetrics(baseMetrics, scenario) {
    const saleMultiplier = scenario.saleMultiplier || 1;
    const resourceMultiplier = scenario.resourceMultiplier || 1;
    const resourceCost = baseMetrics.costs.resourceCost * resourceMultiplier;
    const totalCost = resourceCost + baseMetrics.costs.craftFee;
    const netRevenue = baseMetrics.revenue.net * saleMultiplier;
    const profitPerCycle = netRevenue - totalCost;

    return {
      id: scenario.id,
      label: scenario.label,
      profitPerCycle,
      profitPerHour: baseMetrics.time.cycleHours > 0 ? profitPerCycle / baseMetrics.time.cycleHours : 0,
      dayProfit: profitPerCycle * baseMetrics.time.fullCyclesPerDay,
    };
  }

  function calculateProfession(input) {
    const profession = PROFESSIONS.find((item) => item.id === input.professionId);
    const crystalType = getCrystalType(input.crystalTypeKey);
    const mode = getMode(input.modeKey);
    const cycleDurationSec = getCycleDurationSec(mode);
    const cycleHours = cycleDurationSec / 3600;
    const fullCyclesPerDay = Math.floor(DAY_SECONDS / cycleDurationSec);
    const output = getExpectedOutput(mode);
    const crystalPrice = sanitizeNumber(input.crystalPrice, 0);
    const prices = input.resourcePrices || DEFAULT_RESOURCE_PRICES;

    const resourceCost = calculateResourceCost(crystalType.recipe, prices, output.craftsPerCycle);
    const craftFee = mode.craftFeePerCraft * output.craftsPerCycle;
    const totalCost = resourceCost + craftFee;
    const grossRevenue = output.totalExpected * crystalPrice;
    const netRevenue = grossRevenue * (1 - AUCTION_TAX_RATE);
    const profitPerCycle = netRevenue - totalCost;
    const profitPerCrystal = output.totalExpected > 0 ? profitPerCycle / output.totalExpected : 0;
    const roi = totalCost > 0 ? profitPerCycle / totalCost : 0;
    const breakEvenCrystalPrice = calculateBreakEven(totalCost, output.totalExpected);

    const metrics = {
      profession,
      crystalType,
      mode,
      prices: RESOURCE_COLORS.reduce((acc, color) => {
        acc[color] = sanitizeNumber(prices[color], DEFAULT_RESOURCE_PRICES[color]);
        return acc;
      }, {}),
      counts: {
        perCraft: crystalType.recipe,
        craftsPerCycle: output.craftsPerCycle,
        crystalsPerCraft: CRYSTALS_PER_CRAFT,
        baseCrystalsPerCycle: output.baseCrystals,
      },
      costs: {
        resourceCost,
        craftFee,
        totalCost,
      },
      output: {
        perfectResultBonusRate: mode.perfectResultBonusRate,
        multiplier: output.multiplier,
        baseCrystals: output.baseCrystals,
        bonusExpected: output.bonusExpected,
        totalExpected: output.totalExpected,
      },
      revenue: {
        gross: grossRevenue,
        net: netRevenue,
        netPerCrystal: crystalPrice * (1 - AUCTION_TAX_RATE),
      },
      profit: {
        perCrystal: profitPerCrystal,
        perCycle: profitPerCycle,
        perHour: cycleHours > 0 ? profitPerCycle / cycleHours : 0,
        perDay: profitPerCycle * fullCyclesPerDay,
        roi,
      },
      breakEvenCrystalPrice,
      time: {
        stackDurationSec: mode.stackDurationSec,
        cycleDurationSec,
        cycleHours,
        fullCyclesPerDay,
      },
      scenarios: [],
    };

    metrics.scenarios = [
      calculateScenarioMetrics(metrics, {
        id: "crystalDown",
        label: "Если кристалл подешевеет на 10%",
        saleMultiplier: 0.9,
      }),
      calculateScenarioMetrics(metrics, {
        id: "resourcesUp",
        label: "Если ресурсы подорожают на 15%",
        resourceMultiplier: 1.15,
      }),
    ];

    return metrics;
  }

  function getSortValue(metrics, sortKey) {
    switch (sortKey) {
      case "profitPerCycle":
        return metrics.profit.perCycle;
      case "profitPerHour":
        return metrics.profit.perHour;
      case "roi":
        return metrics.profit.roi;
      case "breakEven":
        return metrics.breakEvenCrystalPrice === null ? Number.POSITIVE_INFINITY : -metrics.breakEvenCrystalPrice;
      case "manual":
      default:
        return 0;
    }
  }

  function calculateAllProfessions(input) {
    return PROFESSIONS.map((profession) =>
      calculateProfession({
        professionId: profession.id,
        crystalTypeKey: input.crystalTypeKey,
        modeKey: input.modeKey,
        crystalPrice: input.crystalPrice,
        resourcePrices: input.professionPrices[profession.id],
      })
    );
  }

  function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.round(seconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;

    if (hours > 0) {
      return `${hours}ч ${String(minutes).padStart(2, "0")}м ${String(secs).padStart(2, "0")}с`;
    }

    return `${minutes}м ${String(secs).padStart(2, "0")}с`;
  }

  const api = {
    DAY_SECONDS,
    AUCTION_TAX_RATE,
    CRYSTALS_PER_CRAFT,
    CRYSTAL_TYPES,
    MODES,
    PROFESSIONS,
    DEFAULT_RESOURCE_PRICES,
    SORT_OPTIONS,
    cloneDefaultPrices,
    sanitizeNumber,
    getMode,
    getCrystalType,
    getCycleCraftCount,
    getCycleDurationSec,
    calculateResourceCost,
    calculateBreakEven,
    calculateProfession,
    calculateAllProfessions,
    getSortValue,
    formatDuration,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.CraftCalculator = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
