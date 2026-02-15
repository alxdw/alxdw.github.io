# Endurance Fuel Planner (Static Web App)

A single-page local web app for planning homemade endurance fuel recipes using your fixed rules:

- `CARB_RATIO = 0.60`
- `WATER_RATIO = 0.40`
- `CARB_DENSITY_G_PER_ML = 0.7`
- `ELECTROLYTE_G_PER_1000MG_SODIUM = 4.8`

## What It Does

- Lets you set carbs/hour, duration, pouch size, and optional electrolytes.
- Includes a `Recipes` tab with per-serving templates and a `Number of servings` control.
- Recipe math is `per-serving -> target servings`, with a common reference base of `10 servings`.
- Applies duration-based carb defaults (`0 / 30 / 60 / 90 g/h`) as editable starting points.
- Calculates:
  - per-pouch carbs, water, electrolyte mix
  - session totals
  - pouches needed
- Warns if a one-pouch-per-hour strategy would exceed pouch capacity at `0.7 g/ml`.

## Run Locally

No build step is required.

1. Open `/Users/adw/dev/fuel/index.html` directly in a browser.
2. Or serve locally:
   - `python -m http.server 8000`
   - visit `http://localhost:8000`

## Constants And Formulas

Constants are in `/Users/adw/dev/fuel/script.js` at the top.

Core formulas:

- `maxCarbsPerPouch = pouchSizeMl * CARB_DENSITY_G_PER_ML`
- `water = carbs * (WATER_RATIO / CARB_RATIO)` (for 60/40, this is `2/3 * carbs`)
- `electrolyte_g = sodium_mg / 1000 * ELECTROLYTE_G_PER_1000MG_SODIUM`
- `pouchesNeeded = ceil(totalCarbs / maxCarbsPerPouch)`

To customize behavior, edit those constants and recommendation bands in `recommendationFromDuration()`.

## Evidence Basis For Carb Defaults

The app uses practical defaults by session duration, consistent with consensus guidance that carbohydrate intake during exercise should scale with event length and that higher intakes (up to about `90 g/h`) can benefit longer events when tolerated.

Primary sources:

1. Burke LM, Hawley JA, Wong SHS, Jeukendrup AE. *Carbohydrates for training and competition*. J Sports Sci. 2011;29 Suppl 1:S17-S27. DOI: [10.1080/02640414.2011.585473](https://doi.org/10.1080/02640414.2011.585473), PubMed: [21660838](https://pubmed.ncbi.nlm.nih.gov/21660838/)
2. Thomas DT, Erdman KA, Burke LM. *Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the ACSM: Nutrition and Athletic Performance*. J Acad Nutr Diet. 2016;116(3):501-528. DOI: [10.1016/j.jand.2015.12.006](https://doi.org/10.1016/j.jand.2015.12.006), PubMed: [26920240](https://pubmed.ncbi.nlm.nih.gov/26920240/)

Notes:

- The app defaults are intentionally easy to override for individual gut training/tolerance.

## Static Hosting (Free Tier)

This app can be deployed as-is to:

- [GitHub Pages](https://pages.github.com/)
- [Vercel](https://vercel.com/)
- [Cloudflare Pages](https://pages.cloudflare.com/)

Because it is plain HTML/CSS/JS with no backend, no framework-specific setup is required.
