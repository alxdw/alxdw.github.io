const CARB_RATIO = 0.6;
const WATER_RATIO = 0.4;
const MIX_CARB_YIELD = 0.875;
const CARB_DENSITY_G_PER_ML = 0.7;
const ELECTROLYTE_G_PER_1000MG_SODIUM = 4.8;
const AMAZON_US_ASSOCIATE_TAG = "w5y01-20";
const GEO_CACHE_KEY = "fuelCountryLookupV1";
const GEO_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const STATIC_AMAZON_LINKS = {
  naturalCordial: {
    default: "https://amzn.to/4u3Ln15",
    US: "https://www.amazon.com/s?k=natural+fruit+cordial+concentrate",
  },
  hydrapak150: {
    default: "https://amzn.to/4cwLcop",
    US: "https://www.amazon.com/s?k=HydraPak+SoftFlask+150ml",
  },
  kidsPouches: {
    default: "https://amzn.to/4bX6xal",
    US: "https://www.amazon.com/s?k=reusable+kids+food+pouches",
  },
};

let activeCountryCode = null;

const RECIPE_TEMPLATES = [
  {
    name: "Carbohydrate mix",
    note: "Approx. 80 g carbs per serving. Gel ratio: 60% mix / 40% water. Yield: 1 g mix = 0.875 g carbs.",
    baseBatchServings: 10,
    perServingIngredients: [
      {
        name: "Maltodextrin",
        amount: 44,
        unit: "g",
        urls: {
          default: "https://amzn.to/4aBpDAC",
          US: "https://www.amazon.com/s?k=maltodextrin+powder",
        },
      },
      {
        name: "Fructose",
        amount: 36,
        unit: "g",
        urls: {
          default: "https://amzn.to/4kAzXxb",
          US: "https://www.amazon.com/s?k=crystalline+fructose",
        },
      },
      {
        name: "Pectin",
        amount: 1.25,
        unit: "g",
        urls: {
          default: "https://amzn.to/3ZzzQbL",
          US: "https://www.amazon.com/s?k=low+methoxyl+pectin",
        },
      },
      {
        name: "Sodium alginate",
        amount: 1.0,
        unit: "g",
        urls: {
          default: "https://amzn.to/4qJr4TF",
          US: "https://www.amazon.com/s?k=sodium+alginate+powder+food+grade",
        },
      },
    ],
  },
  {
    name: "Electrolyte Mix (bulk)",
    note: "Per-serving electrolyte recipe (~4.8 g serving).",
    baseBatchServings: 10,
    perServingIngredients: [
      {
        name: "Sodium citrate",
        amount: 3.67,
        unit: "g",
        urls: {
          default: "https://amzn.to/4cfULrZ",
          US: "https://www.amazon.com/s?k=sodium+citrate+food+grade",
        },
      },
      {
        name: "Saxa so low (lite salt blend)",
        amount: 0.8,
        unit: "g",
        urls: {
          default: "https://amzn.to/4bRkpD3",
          US: "https://www.amazon.com/s?k=Morton+Lite+Salt",
        },
      },
      {
        name: "Magnesium sulphate",
        amount: 0.25,
        unit: "g",
        urls: {
          default: "https://amzn.to/4ayVfGO",
          US: "https://www.amazon.com/s?k=USP+magnesium+sulfate+powder",
        },
      },
      {
        name: "Calcium carbonate",
        amount: 0.08,
        unit: "g",
        urls: {
          default: "https://amzn.to/3OJ8b5H",
          US: "https://www.amazon.com/s?k=calcium+carbonate+powder+food+grade",
        },
      },
    ],
  },
];

const els = {
  tabPlanner: document.getElementById("tabPlanner"),
  tabRecipes: document.getElementById("tabRecipes"),
  panelPlanner: document.getElementById("panelPlanner"),
  panelRecipes: document.getElementById("panelRecipes"),
  durationValue: document.getElementById("durationValue"),
  durationUnit: document.getElementById("durationUnit"),
  durationSlider: document.getElementById("durationSlider"),
  durationHint: document.getElementById("durationHint"),
  carbsPerHour: document.getElementById("carbsPerHour"),
  carbsPerHourSlider: document.getElementById("carbsPerHourSlider"),
  applyDefault: document.getElementById("applyDefault"),
  defaultGuidance: document.getElementById("defaultGuidance"),
  pouchSizeMl: document.getElementById("pouchSizeMl"),
  pouchSizeSlider: document.getElementById("pouchSizeSlider"),
  includeElectrolytes: document.getElementById("includeElectrolytes"),
  electrolytePanel: document.getElementById("electrolytePanel"),
  sodiumControls: document.getElementById("sodiumControls"),
  electrolyteControls: document.getElementById("electrolyteControls"),
  sodiumPerHour: document.getElementById("sodiumPerHour"),
  sodiumPerHourSlider: document.getElementById("sodiumPerHourSlider"),
  electrolytePerHour: document.getElementById("electrolytePerHour"),
  electrolytePerHourSlider: document.getElementById("electrolytePerHourSlider"),
  warning: document.getElementById("warning"),
  outMixPerPouch: document.getElementById("outMixPerPouch"),
  outWaterPerPouch: document.getElementById("outWaterPerPouch"),
  outElectrolytePerPouch: document.getElementById("outElectrolytePerPouch"),
  outTotalCarbs: document.getElementById("outTotalCarbs"),
  outPouchesNeeded: document.getElementById("outPouchesNeeded"),
  outCarbsPerPouchPlanned: document.getElementById("outCarbsPerPouchPlanned"),
  outTotalMix: document.getElementById("outTotalMix"),
  outTotalWater: document.getElementById("outTotalWater"),
  outTotalElectrolyte: document.getElementById("outTotalElectrolyte"),
  recipeScale: document.getElementById("recipeScale"),
  recipeScaleSlider: document.getElementById("recipeScaleSlider"),
  recipeScaleSummary: document.getElementById("recipeScaleSummary"),
  recipeCards: document.getElementById("recipeCards"),
  amazonRegionNote: document.getElementById("amazonRegionNote"),
};

let manualCarbOverride = false;

function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

function round(num, decimals = 1) {
  return Number(num.toFixed(decimals));
}

function fmt(value, unit, decimals = 1) {
  return `${round(value, decimals)} ${unit}`;
}

function getDurationMinutes() {
  const raw = Number(els.durationValue.value) || 0;
  return els.durationUnit.value === "hours" ? raw * 60 : raw;
}

function setDurationFromMinutes(minutes) {
  const m = clamp(minutes, 1, 600);
  if (els.durationUnit.value === "hours") {
    els.durationValue.value = round(m / 60, 2);
  } else {
    els.durationValue.value = Math.round(m);
  }
  els.durationSlider.value = Math.round(m);
}

function recommendationFromDuration(minutes) {
  if (minutes < 45) {
    return {
      carbsPerHour: 0,
      note: "<45 min: carbs often optional; focus on pre-session fueling/hydration.",
    };
  }
  if (minutes < 75) {
    return {
      carbsPerHour: 30,
      note: "45-75 min: small amounts (~30 g/h) are a practical starting point.",
    };
  }
  if (minutes <= 150) {
    return {
      carbsPerHour: 60,
      note: "75-150 min: ~60 g/h is a common endurance target.",
    };
  }
  return {
    carbsPerHour: 90,
    note: ">150 min: up to ~90 g/h may help if trained/tolerated.",
  };
}

function getSelectedElectrolyteMode() {
  const selected = document.querySelector(
    'input[name="electrolyteMode"]:checked',
  );
  return selected ? selected.value : "sodium";
}

function syncPair(numberInput, rangeInput, onChange) {
  numberInput.addEventListener("input", () => {
    rangeInput.value = numberInput.value;
    onChange();
  });
  rangeInput.addEventListener("input", () => {
    numberInput.value = rangeInput.value;
    onChange();
  });
}

function syncElectrolyteDerivedFields(sourceMode) {
  if (sourceMode === "sodium") {
    const sodium = Number(els.sodiumPerHour.value) || 0;
    const electrolyte = (sodium / 1000) * ELECTROLYTE_G_PER_1000MG_SODIUM;
    els.electrolytePerHour.value = round(electrolyte, 2);
    els.electrolytePerHourSlider.value = round(electrolyte, 2);
  } else {
    const electrolyte = Number(els.electrolytePerHour.value) || 0;
    const sodium = (electrolyte / ELECTROLYTE_G_PER_1000MG_SODIUM) * 1000;
    els.sodiumPerHour.value = round(sodium, 0);
    els.sodiumPerHourSlider.value = round(sodium, 0);
  }
}

function showElectrolyteModeControls() {
  const mode = getSelectedElectrolyteMode();
  els.sodiumControls.classList.toggle("hidden", mode !== "sodium");
  els.electrolyteControls.classList.toggle("hidden", mode !== "electrolyte");
}

function updateDefaultsAndGuidance() {
  const durationMinutes = getDurationMinutes();
  const rec = recommendationFromDuration(durationMinutes);
  els.defaultGuidance.textContent = `Duration default: ${rec.carbsPerHour} g/h. ${rec.note}`;
  els.durationHint.textContent = `Duration in minutes: ${Math.round(durationMinutes)} min.`;

  if (!manualCarbOverride) {
    els.carbsPerHour.value = rec.carbsPerHour;
    els.carbsPerHourSlider.value = rec.carbsPerHour;
  }
}

function calculatePlan() {
  const durationMinutes = getDurationMinutes();
  const durationHours = durationMinutes / 60;
  const carbsPerHour = Math.max(0, Number(els.carbsPerHour.value) || 0);
  const pouchSizeMl = Math.max(1, Number(els.pouchSizeMl.value) || 0);

  const totalCarbs = carbsPerHour * durationHours;
  const maxCarbsPerPouch = pouchSizeMl * CARB_DENSITY_G_PER_ML;
  const pouchesNeeded =
    totalCarbs > 0 ? Math.ceil(totalCarbs / maxCarbsPerPouch) : 0;
  const carbsPerPouchPlanned =
    pouchesNeeded > 0 ? totalCarbs / pouchesNeeded : 0;
  const mixPerPouch =
    pouchesNeeded > 0 ? carbsPerPouchPlanned / MIX_CARB_YIELD : 0;
  const waterPerPouch = mixPerPouch * (WATER_RATIO / CARB_RATIO);
  const totalMix = mixPerPouch * pouchesNeeded;
  const totalWater = waterPerPouch * pouchesNeeded;

  const includeElectrolytes = els.includeElectrolytes.checked;
  const mode = getSelectedElectrolyteMode();

  let sodiumPerHour = Number(els.sodiumPerHour.value) || 0;
  let electrolytePerHour = Number(els.electrolytePerHour.value) || 0;

  if (mode === "sodium") {
    electrolytePerHour =
      (sodiumPerHour / 1000) * ELECTROLYTE_G_PER_1000MG_SODIUM;
  } else {
    sodiumPerHour =
      (electrolytePerHour / ELECTROLYTE_G_PER_1000MG_SODIUM) * 1000;
  }

  const totalElectrolyte = includeElectrolytes
    ? electrolytePerHour * durationHours
    : 0;
  const electrolytePerPouch =
    includeElectrolytes && pouchesNeeded > 0
      ? totalElectrolyte / pouchesNeeded
      : 0;

  els.outMixPerPouch.textContent = `${fmt(mixPerPouch, "g", 1)} (${fmt(carbsPerPouchPlanned, "g", 1)} carbs)`;
  els.outWaterPerPouch.textContent = fmt(waterPerPouch, "g", 1);
  els.outElectrolytePerPouch.textContent = includeElectrolytes
    ? fmt(electrolytePerPouch, "g", 2)
    : "off";
  els.outTotalCarbs.textContent = fmt(totalCarbs, "g", 1);
  els.outPouchesNeeded.textContent = String(pouchesNeeded);
  els.outCarbsPerPouchPlanned.textContent = fmt(carbsPerPouchPlanned, "g", 1);
  els.outTotalMix.textContent = fmt(totalMix, "g", 1);
  els.outTotalWater.textContent = fmt(totalWater, "g", 1);
  els.outTotalElectrolyte.textContent = includeElectrolytes
    ? fmt(totalElectrolyte, "g", 2)
    : "off";

  const requiredMlForCurrentCarbsPerHour = carbsPerHour / CARB_DENSITY_G_PER_ML;
  if (carbsPerHour > maxCarbsPerPouch && carbsPerHour > 0) {
    els.warning.classList.remove("hidden");
    els.warning.textContent = `Warning: one pouch per hour at ${fmt(carbsPerHour, "g", 0)} exceeds this pouch's carb capacity (${fmt(maxCarbsPerPouch, "g", 1)} at 0.7 g/ml). You'd need about ${fmt(requiredMlForCurrentCarbsPerHour, "ml", 0)} per pouch if taking one pouch each hour.`;
  } else {
    els.warning.classList.add("hidden");
    els.warning.textContent = "";
  }

  return {
    durationHours,
    durationMinutes,
    carbsPerHour,
    totalCarbs,
    pouchSizeMl,
    maxCarbsPerPouch,
    pouchesNeeded,
    carbsPerPouchPlanned,
    mixPerPouch,
    waterPerPouch,
    totalMix,
    totalWater,
    includeElectrolytes,
    sodiumPerHour,
    electrolytePerHour,
    electrolytePerPouch,
    totalElectrolyte,
    requiredMlForCurrentCarbsPerHour,
  };
}

function formatAmount(amount, unit) {
  if (unit === "g" && amount >= 1000) {
    const kgAmount = amount / 1000;
    const decimals = kgAmount < 10 ? 2 : 1;
    return `${round(kgAmount, decimals)} kg`;
  }
  const decimals = amount < 10 ? 2 : amount < 100 ? 1 : 0;
  return `${round(amount, decimals)} ${unit}`;
}

function getLocalizedUrl(urls) {
  if (!urls) {
    return null;
  }
  if (activeCountryCode === "US" && urls.US) {
    return withAmazonUsTag(urls.US);
  }
  return urls.default || urls.US || null;
}

function withAmazonUsTag(url) {
  if (!url || !AMAZON_US_ASSOCIATE_TAG) {
    return url;
  }
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.includes("amazon.com")) {
      return url;
    }
    parsedUrl.searchParams.set("tag", AMAZON_US_ASSOCIATE_TAG);
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

function applyStaticAmazonLinks() {
  document.querySelectorAll("[data-amazon-key]").forEach((anchor) => {
    const key = anchor.dataset.amazonKey;
    const urls = STATIC_AMAZON_LINKS[key];
    const localizedUrl = getLocalizedUrl(urls);
    if (localizedUrl) {
      anchor.href = localizedUrl;
    }
  });
}

function updateAmazonRegionNote() {
  if (!els.amazonRegionNote) {
    return;
  }
  els.amazonRegionNote.textContent =
    activeCountryCode === "US"
      ? "Includes affiliate links. Showing Amazon US product alternatives."
      : "Includes affiliate links.";
}

async function fetchWithTimeout(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function readCountryFromCache() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.countryCode || !parsed.savedAt) {
      return null;
    }
    if (Date.now() - Number(parsed.savedAt) > GEO_CACHE_MAX_AGE_MS) {
      return null;
    }
    return parsed.countryCode;
  } catch {
    return null;
  }
}

function writeCountryToCache(countryCode) {
  try {
    localStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify({
        countryCode,
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Ignore storage errors (e.g., private mode restrictions).
  }
}

async function detectCountryCodeByIp() {
  const cached = readCountryFromCache();
  if (cached) {
    return cached;
  }

  const ipApi = await fetchWithTimeout("https://ipapi.co/json/");
  if (ipApi?.country_code) {
    const countryCode = String(ipApi.country_code).toUpperCase();
    writeCountryToCache(countryCode);
    return countryCode;
  }

  const ipWhoIs = await fetchWithTimeout("https://ipwho.is/");
  if (ipWhoIs?.success && ipWhoIs?.country_code) {
    const countryCode = String(ipWhoIs.country_code).toUpperCase();
    writeCountryToCache(countryCode);
    return countryCode;
  }

  return null;
}

async function localizeAmazonLinks() {
  activeCountryCode = await detectCountryCodeByIp();
  updateAmazonRegionNote();
  applyStaticAmazonLinks();
  renderRecipes();
}

function renderRecipes() {
  const servings = clamp(Number(els.recipeScale.value) || 1, 1, 1000);
  els.recipeScale.value = Math.round(servings);
  els.recipeScaleSlider.value = Math.round(servings);
  els.recipeScaleSummary.textContent = `Planning amounts for ${Math.round(servings)} servings (base recipe reference is 10 servings).`;

  const cards = RECIPE_TEMPLATES.map((recipe) => {
    const recipeTotalServings = servings;
    const showCarbYield = recipe.name === "Carbohydrate mix";
    const formatCarbYield = (amount, unit) => {
      if (!showCarbYield || unit !== "g") {
        return "";
      }
      return ` (${formatAmount(amount * MIX_CARB_YIELD, "g")} carbs)`;
    };
    const rows = recipe.perServingIngredients
      .map((ingredient) => {
        const batchAmount = ingredient.amount * recipeTotalServings;
        const ingredientUrl = getLocalizedUrl(ingredient.urls);
        const ingredientName = ingredientUrl
          ? `<a class="ingredient-link" href="${ingredientUrl}" target="_blank" rel="noopener noreferrer">${ingredient.name}</a>`
          : ingredient.name;
        return `
          <li>
            <span>${ingredientName}</span>
            <strong class="ingredient-amount">
              <span>${formatAmount(batchAmount, ingredient.unit)}${formatCarbYield(batchAmount, ingredient.unit)} for batch</span>
              <span class="ingredient-total">${formatAmount(ingredient.amount, ingredient.unit)}${formatCarbYield(ingredient.amount, ingredient.unit)} / serving</span>
            </strong>
          </li>
        `;
      })
      .join("");

    return `
      <article class="recipe-card">
        <h3>${recipe.name}</h3>
        <p class="fineprint">${recipe.note}</p>
        <p class="recipe-affiliate-footnote">* Ingredient links are affiliate links.</p>
        <ul class="ingredient-list">${rows}</ul>
      </article>
    `;
  }).join("");

  els.recipeCards.innerHTML = cards;
}

function switchTab(tabName) {
  const planner = tabName === "planner";
  els.tabPlanner.classList.toggle("is-active", planner);
  els.tabRecipes.classList.toggle("is-active", !planner);
  els.panelPlanner.classList.toggle("hidden", !planner);
  els.panelRecipes.classList.toggle("hidden", planner);
}

function handleAnyInput() {
  updateDefaultsAndGuidance();
  calculatePlan();
}

syncPair(els.carbsPerHour, els.carbsPerHourSlider, () => {
  manualCarbOverride = true;
  handleAnyInput();
});

syncPair(els.pouchSizeMl, els.pouchSizeSlider, handleAnyInput);

syncPair(els.sodiumPerHour, els.sodiumPerHourSlider, () => {
  syncElectrolyteDerivedFields("sodium");
  handleAnyInput();
});

syncPair(els.electrolytePerHour, els.electrolytePerHourSlider, () => {
  syncElectrolyteDerivedFields("electrolyte");
  handleAnyInput();
});

syncPair(els.recipeScale, els.recipeScaleSlider, renderRecipes);

els.durationSlider.addEventListener("input", () => {
  setDurationFromMinutes(Number(els.durationSlider.value));
  handleAnyInput();
});

els.durationValue.addEventListener("input", handleAnyInput);

els.durationUnit.addEventListener("change", () => {
  const previousMinutes = Number(els.durationSlider.value);
  els.durationValue.step = els.durationUnit.value === "hours" ? "0.25" : "1";
  setDurationFromMinutes(previousMinutes);
  handleAnyInput();
});

els.applyDefault.addEventListener("click", () => {
  manualCarbOverride = false;
  updateDefaultsAndGuidance();
  calculatePlan();
});

els.includeElectrolytes.addEventListener("change", () => {
  els.electrolytePanel.classList.toggle(
    "hidden",
    !els.includeElectrolytes.checked,
  );
  handleAnyInput();
});

document.querySelectorAll('input[name="electrolyteMode"]').forEach((input) => {
  input.addEventListener("change", () => {
    showElectrolyteModeControls();
    handleAnyInput();
  });
});

els.tabPlanner.addEventListener("click", () => switchTab("planner"));
els.tabRecipes.addEventListener("click", () => switchTab("recipes"));

els.durationValue.step = "1";
switchTab("planner");
showElectrolyteModeControls();
syncElectrolyteDerivedFields("sodium");
updateDefaultsAndGuidance();
calculatePlan();
renderRecipes();
localizeAmazonLinks();
