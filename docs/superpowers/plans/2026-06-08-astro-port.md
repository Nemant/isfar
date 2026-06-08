# Isfar Astro Port (Phase C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Isfar from the no-build (Babel-in-browser + `window.*` globals) stack to an Astro SSG app with the calculator as one `client:only="react"` island, ending in a full cutover on the `astro-port` branch.

**Architecture:** Astro emits a static `index.astro` shell carrying all SEO `<head>` + the verbatim pre-paint `<html data-theme>` script; the entire calculator (the former `#root` tree) is one `client:only="react"` React island so there is **no SSR and therefore no hydration mismatch** — the exact bug class that reverted the prior port. The `window.*` globals become ES module imports; Babel/CDN React/CDN adhan are deleted and replaced by pinned npm deps compiled by Vite.

**Tech Stack:** Astro 4.16.18, @astrojs/react 3.6.3, react/react-dom 18.3.1, adhan 4.4.3 (all already in `node_modules`). Static output, no SSR.

**Verification model:** This is a mechanical port of *frozen* logic — `engine.js compute()` and the `data.js` records are unchanged. There is no unit-test harness in this repo and we are not adding one. The verification oracle at each step is **`npm run build` succeeding with no warnings/errors** (Vite errors on any unresolved import — it will name every missed symbol) plus **Playwright render checks** at the gates. "Make it fail / make it pass" maps to "build red → build green".

**Branch:** `astro-port` (already created; design spec committed at `docs/superpowers/specs/2026-06-08-astro-port-design.md`).

---

## File Structure (created / moved)

```
astro.config.mjs              NEW  — static output + react integration
package.json                  NEW  — pinned deps + build/preview scripts
tsconfig.json                 NEW  — astro/tsconfigs/base
.gitignore                    MOD  — add dist/ and .astro/
scripts/gen-sw-precache.mjs   NEW  — generate SW CORE list from dist/
src/pages/index.astro         NEW  — static shell + SEO head + island mount
src/components/Calculator.jsx  was app.jsx (default-exported island root)
src/components/components.jsx  was components.jsx
src/components/arc.jsx         was arc.jsx
src/components/cards.jsx       was cards.jsx
src/components/tweaks-panel.jsx was tweaks-panel.jsx (dev bridge removed)
src/lib/data.js                was data.js (named exports)
src/lib/engine.js              was engine.js (named exports + adhan import)
src/styles/styles.css          was styles.css (font urls → /fonts/)
public/fonts/*.woff2           moved from fonts/
public/sw.js                   was sw.js (CORE list generated; isfar-v18)
public/manifest.webmanifest    moved
public/favicon.ico, icon-*.png, og-cover.png, robots.txt, sitemap.xml  moved
```

**Cross-reference / import map** (drives the import block in every module):

| Module | Imports it needs | Exports |
|---|---|---|
| `lib/data.js` | none | `lookup, lookupRemote, COLOR, META, METHODS, GUIDANCE, SAMPLE` |
| `lib/engine.js` | `import * as adhan from 'adhan'`; `import { META } from './data.js'` | `compute, greatCircle` |
| `components/tweaks-panel.jsx` | `import React, { useState, useEffect, useRef } from 'react'` | `useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton` |
| `components/components.jsx` | `import React, { useState, useEffect, useRef } from 'react'`; `import { METHODS, GUIDANCE, COLOR } from '../lib/data.js'` | `Ic, PRAYER_GLYPH, Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, TzBanner, QiblaCompass, PlaneQibla, NextPrayer, cardinalOf` |
| `components/arc.jsx` | `import React from 'react'`; `import { COLOR } from '../lib/data.js'` | `ArcTimeline` |
| `components/cards.jsx` | `import React from 'react'`; `import { COLOR, GUIDANCE } from '../lib/data.js'`; `import { PRAYER_GLYPH, Ic, PlaneQibla } from './components.jsx'` | `PrayerList, Guidance` |
| `components/Calculator.jsx` | `import React, { useState, useEffect, useRef } from 'react'`; `import { lookupRemote } from '../lib/data.js'`; `import { compute } from '../lib/engine.js'`; `import { Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, TzBanner, NextPrayer, Ic } from './components.jsx'`; `import { ArcTimeline } from './arc.jsx'`; `import { PrayerList, Guidance } from './cards.jsx'`; `import { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio } from './tweaks-panel.jsx'` | `default` (the `App` component, renamed `Calculator`) |

> **Import completeness rule:** the tables above are derived from a grep of current `window.*`/bare references and may miss an internal symbol. After each conversion, `npm run build` will name any unresolved reference (`"X" is not exported` / `X is not defined`). Add the missing import from the producing module per the table and rebuild. Do **not** guess — the build tells you.

---

## Task 1: Scaffold Astro alongside the no-build app

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "isfar",
  "type": "module",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build && node scripts/gen-sw-precache.mjs",
    "preview": "astro preview",
    "astro": "astro"
  },
  "dependencies": {
    "@astrojs/react": "3.6.3",
    "adhan": "4.4.3",
    "astro": "4.16.18",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}
```

- [ ] **Step 2: Create `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static (SSG) output. The calculator is a client:only island, so nothing is
// server-rendered beyond the static shell in index.astro.
export default defineConfig({
  site: 'https://isfar.app',
  output: 'static',
  integrations: [react()],
  build: { assets: '_assets' },
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/base",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

- [ ] **Step 4: Add build artifacts to `.gitignore`**

Append these lines to `.gitignore` (under the existing `# Node` section):

```
# Astro build output
dist/
.astro/
```

- [ ] **Step 5: Install (refresh lockfile against already-present node_modules)**

Run: `npm install`
Expected: completes, writes `package-lock.json`, `node_modules` already populated so it's fast. No errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tsconfig.json .gitignore
git commit -m "Astro scaffold: config, pinned deps, gitignore dist/ (Phase C)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Convert `data.js` and `engine.js` to ES modules

These have no JSX and no UI; converting them first lets every later module import from them.

**Files:**
- Create: `src/lib/data.js` (from `data.js`), `src/lib/engine.js` (from `engine.js`)
- Root `data.js` / `engine.js` stay in place for now (no-build app still runs).

- [ ] **Step 1: Copy `data.js` → `src/lib/data.js`**

Run: `mkdir -p src/lib && cp data.js src/lib/data.js`

- [ ] **Step 2: Convert `src/lib/data.js` wrapper to named exports**

Change the IIFE open (line 8):
```js
window.ISFAR_DATA = (function () {
```
to:
```js
const ISFAR_DATA = (function () {
```
Change the IIFE close + return (last 2 lines):
```js
  return { lookup, lookupRemote, COLOR, META, METHODS, GUIDANCE, SAMPLE: "SV124" };
})();
```
to:
```js
  return { lookup, lookupRemote, COLOR, META, METHODS, GUIDANCE, SAMPLE: "SV124" };
})();

export const { lookup, lookupRemote, COLOR, META, METHODS, GUIDANCE, SAMPLE } = ISFAR_DATA;
```
Leave the internal `window.ISFAR_API_BASE` / `window.ISFAR_USE_REMOTE` reads as-is — they are `typeof window`-guarded and harmless in the browser island; they keep the prod hostname switch working.

- [ ] **Step 3: Copy `engine.js` → `src/lib/engine.js`**

Run: `cp engine.js src/lib/engine.js`

- [ ] **Step 4: Convert `src/lib/engine.js` to a module**

Add at the very top of the file (line 1), before the comment block:
```js
import * as adhan from 'adhan';
import { META } from './data.js';
```
Change the IIFE open (was line 21):
```js
window.ISFAR_ENGINE = (function () {
```
to:
```js
const ISFAR_ENGINE = (function () {
```
Delete the line inside `compute` (was line 230) that re-reads META from the global:
```js
    const META = window.ISFAR_DATA.META;
```
(It now comes from the top-level `import { META }`.)
Change the IIFE close + return (last 2 lines):
```js
  return { compute, greatCircle };
})();
```
to:
```js
  return { compute, greatCircle };
})();

export const { compute, greatCircle } = ISFAR_ENGINE;
```

- [ ] **Step 5: Verify the modules parse**

Run: `node --input-type=module -e "import('./src/lib/engine.js').then(m=>console.log('engine ok:', typeof m.compute, typeof m.greatCircle)).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `engine ok: function function` (adhan is npm-resolvable from Node, so the import chain loads).

- [ ] **Step 6: Commit**

```bash
git add src/lib/data.js src/lib/engine.js
git commit -m "Astro port: data.js + engine.js → ES modules (named exports, adhan npm import)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Convert the leaf UI modules (tweaks, components, arc, cards)

Order matters: `tweaks-panel` and `components` have no intra-UI deps among this set except `cards` → `components`. Convert all four; they import only from `react` and `lib/`, plus cards → components.

**Files:**
- Create: `src/components/tweaks-panel.jsx`, `src/components/components.jsx`, `src/components/arc.jsx`, `src/components/cards.jsx`

- [ ] **Step 1: Copy all four into `src/components/`**

Run:
```bash
mkdir -p src/components
cp tweaks-panel.jsx components.jsx arc.jsx cards.jsx src/components/
```

- [ ] **Step 2: Convert `src/components/tweaks-panel.jsx`**

Add at the very top (line 1):
```js
import React, { useState, useEffect, useRef } from 'react';
```
Remove the dev-only host bridge: delete any `__edit_mode_*` `postMessage` / `window.addEventListener("message", …)` block (the `/* BEGIN USAGE */` header documents it as the editor scaffold; the user-facing `useTweaks`/`TweaksPanel`/`Tweak*` controls stay). If a bare `React` was relied on as a global, it is now imported.
Replace the trailing export block:
```js
Object.assign(window, {
  useTweaks, TweaksPanel, TweakSection, TweakRow,
  TweakSlider, TweakToggle, TweakRadio, TweakSelect,
  TweakText, TweakNumber, TweakColor, TweakButton,
});
```
with:
```js
export {
  useTweaks, TweaksPanel, TweakSection, TweakRow,
  TweakSlider, TweakToggle, TweakRadio, TweakSelect,
  TweakText, TweakNumber, TweakColor, TweakButton,
};
```

- [ ] **Step 3: Convert `src/components/components.jsx`**

Replace the head line `const { useState, useEffect, useRef } = React;` (line 5) with imports at the very top:
```js
import React, { useState, useEffect, useRef } from 'react';
import { METHODS, GUIDANCE, COLOR } from '../lib/data.js';
```
Replace the in-body global reads:
- `window.ISFAR_DATA.METHODS` → `METHODS`
- `window.ISFAR_DATA.GUIDANCE` → `GUIDANCE`
- `window.ISFAR_DATA.COLOR` → `COLOR`
Replace the two trailing export lines:
```js
Object.assign(window, { Ic, PRAYER_GLYPH, Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, TzBanner });
...
Object.assign(window, { QiblaCompass, PlaneQibla, NextPrayer, cardinalOf });
```
with a single export at end of file:
```js
export { Ic, PRAYER_GLYPH, Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, TzBanner, QiblaCompass, PlaneQibla, NextPrayer, cardinalOf };
```

- [ ] **Step 4: Convert `src/components/arc.jsx`**

Add at the very top (line 1):
```js
import React from 'react';
import { COLOR } from '../lib/data.js';
```
Replace `window.ISFAR_DATA.COLOR` → `COLOR`.
Replace the trailing `window.ArcTimeline = ArcTimeline;` with:
```js
export { ArcTimeline };
```

- [ ] **Step 5: Convert `src/components/cards.jsx`**

Replace the head line `const { useRef: useRefCards } = React;` with imports at the very top:
```js
import React from 'react';
import { COLOR, GUIDANCE } from '../lib/data.js';
import { PRAYER_GLYPH, Ic, PlaneQibla } from './components.jsx';
const { useRef: useRefCards } = React;
```
Replace the in-body global reads:
- `window.PRAYER_GLYPH` → `PRAYER_GLYPH`
- `window.Ic` → `Ic`
- `window.PlaneQibla` (used as `<window.PlaneQibla …>`) → `PlaneQibla` (`<PlaneQibla …>`)
- `window.ISFAR_DATA.COLOR` → `COLOR`
- `window.ISFAR_DATA.GUIDANCE` → `GUIDANCE`
Replace the trailing:
```js
window.PrayerList = PrayerList;
window.Guidance = Guidance;
```
with:
```js
export { PrayerList, Guidance };
```

- [ ] **Step 6: Commit**

```bash
git add src/components/tweaks-panel.jsx src/components/components.jsx src/components/arc.jsx src/components/cards.jsx
git commit -m "Astro port: UI modules → ES imports/exports; drop tweaks dev host bridge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Convert `app.jsx` → `src/components/Calculator.jsx` (the island root)

**Files:**
- Create: `src/components/Calculator.jsx` (from `app.jsx`)

- [ ] **Step 1: Copy `app.jsx` → `src/components/Calculator.jsx`**

Run: `cp app.jsx src/components/Calculator.jsx`

- [ ] **Step 2: Add the import block at the very top (line 1)**

```js
import React, { useState, useEffect, useRef } from 'react';
import { lookupRemote } from '../lib/data.js';
import { compute } from '../lib/engine.js';
import { Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, TzBanner, NextPrayer, Ic } from './components.jsx';
import { ArcTimeline } from './arc.jsx';
import { PrayerList, Guidance } from './cards.jsx';
import { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio } from './tweaks-panel.jsx';
```

- [ ] **Step 3: Keep the hook aliases, sourced from the import**

The existing line `const { useState: useS, useEffect: useE, useRef: useR } = React;` now works because `React` is imported. Leave it as-is.

- [ ] **Step 4: Replace the global engine/data reads**

- `window.ISFAR_ENGINE.compute(` → `compute(` (two call sites)
- `window.ISFAR_DATA.lookupRemote(` → `lookupRemote(`

- [ ] **Step 5: Convert the root component to a default export, drop `createRoot`**

Rename the top-level `function App(` to `function Calculator(` (and its `<App />` self-references if any are inside its own JSX — there are none; `App` is only referenced by the `createRoot` line).
Delete the final line:
```js
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
```
Add at end of file:
```js
export default Calculator;
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Calculator.jsx
git commit -m "Astro port: app.jsx → Calculator.jsx (default-export island root, no createRoot)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Styles, fonts, and the `index.astro` shell

**Files:**
- Create: `src/styles/styles.css` (from `styles.css`, font urls fixed)
- Move: `fonts/*.woff2` → `public/fonts/`
- Move: `manifest.webmanifest`, `favicon.ico`, `icon-192.png`, `icon-512.png`, `og-cover.png`, `robots.txt`, `sitemap.xml` → `public/`
- Create: `src/pages/index.astro`

- [ ] **Step 1: Move static assets into `public/`**

Run:
```bash
mkdir -p public/fonts src/styles
git mv fonts/*.woff2 public/fonts/
git mv manifest.webmanifest favicon.ico icon-192.png icon-512.png og-cover.png robots.txt sitemap.xml public/
cp styles.css src/styles/styles.css
```

- [ ] **Step 2: Make font URLs root-absolute in `src/styles/styles.css`**

The 23 `@font-face` rules reference `url('fonts/<name>.woff2')` (relative). Astro serves `public/fonts/` at `/fonts/`. Replace all occurrences:
`url('fonts/` → `url('/fonts/`
Run to verify zero relative refs remain: `grep -c "url('fonts/" src/styles/styles.css` → expect `0`.

- [ ] **Step 3: Create `src/pages/index.astro`**

This carries the verbatim `<head>` from the current root `index.html` (lines 1–153: charset, viewport, the theme-color comment, the **pre-paint theme script verbatim**, title/description, canonical, OG, Twitter, both JSON-LD blocks, favicons, manifest, apple/mobile meta, the two font preloads) — but with the stylesheet imported via Astro and the island as the body. Asset paths become root-absolute (`/favicon.ico`, `/icon-192.png`, `/og-cover.png?v=2`, `/manifest.webmanifest`, `/fonts/…`).

```astro
---
import Calculator from '../components/Calculator.jsx';
import '../styles/styles.css';
---
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<!-- Deliberately NO <meta name="theme-color">. Setting it makes iOS Safari paint
     the status bar + address bar as SOLID opaque blocks, so the page can't scroll
     visibly behind them. Leaving it unset keeps Safari's native translucent bars. -->

<!-- Pre-paint theme bootstrap: set <html data-theme> from the saved choice
     (localStorage isfar.theme, resolving "auto" via the OS) BEFORE first paint so
     the themed canvas is correct immediately — no white flash. The client:only
     island keeps it in sync on later toggles / live OS flips. -->
<script is:inline>
  (function () {
    try {
      var saved = localStorage.getItem("isfar.theme");
      var pref = (saved === "light" || saved === "dark") ? saved
        : (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", pref);
    } catch (e) {}
  })();
</script>

<title>Isfar — Prayer times across your flight (Fajr to Isha)</title>
<meta name="description" content="Enter your flight number and see every prayer — Fajr, Dhuhr, Asr, Maghrib, Isha — mapped before departure, in the air, and after arrival, shown in both origin and destination time zones." />
<link rel="canonical" href="https://isfar.app/" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="Isfar" />
<meta property="og:title" content="Isfar — Prayer times across your flight (Fajr to Isha)" />
<meta property="og:description" content="Enter your flight number and see every prayer — Fajr, Dhuhr, Asr, Maghrib, Isha — mapped before departure, in the air, and after arrival, shown in both origin and destination time zones." />
<meta property="og:url" content="https://isfar.app/" />
<meta property="og:image" content="https://isfar.app/og-cover.png?v=2" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Isfar — Prayer times across your flight (Fajr to Isha)" />
<meta name="twitter:description" content="Enter your flight number and see every prayer — Fajr, Dhuhr, Asr, Maghrib, Isha — mapped before departure, in the air, and after arrival, shown in both origin and destination time zones." />
<meta name="twitter:image" content="https://isfar.app/og-cover.png?v=2" />

<script type="application/ld+json" set:html={JSON.stringify({
  "@context":"https://schema.org","@type":"WebApplication","name":"Isfar",
  "description":"Enter your flight number and see every prayer — Fajr, Dhuhr, Asr, Maghrib, Isha — mapped before departure, in the air, and after arrival, shown in both origin and destination time zones.",
  "url":"https://isfar.app/","applicationCategory":"TravelApplication","operatingSystem":"Web",
  "browserRequirements":"Requires JavaScript",
  "offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},
  "featureList":["Five daily prayer times mapped across any flight","Dual time-zone display (origin and destination)","Qasr and jam' guidance for travelling Muslims","Qibla direction relative to the aircraft heading","Offline support for saved flights"]
})} />
<script type="application/ld+json" set:html={JSON.stringify({
  "@context":"https://schema.org","@type":"FAQPage","mainEntity":[
    {"@type":"Question","name":"Can you pray on an airplane?","acceptedAnswer":{"@type":"Answer","text":"Yes. The majority of scholars hold that a Muslim must pray on the aircraft if the prayer time passes during the flight and there is no prospect of landing in time. You pray as best you can — standing if space allows, otherwise seated — facing the qibla if possible, or at least the general direction. Isfar shows which prayers fall before departure, during the flight, and after arrival so you can plan ahead."}},
    {"@type":"Question","name":"What is qasr (shortening prayers) when travelling?","acceptedAnswer":{"@type":"Answer","text":"Qasr means shortening the four-unit (rak'ah) prayers — Dhuhr, Asr, and Isha — to two units while travelling. It is established in the Quran and Sunnah and is agreed upon across the major legal schools, though they differ on the minimum travel distance that triggers it and on whether it is obligatory or merely permitted. Consult a scholar familiar with your madhhab for personal rulings."}},
    {"@type":"Question","name":"What is jam' (combining prayers) when travelling?","acceptedAnswer":{"@type":"Answer","text":"Jam' means combining Dhuhr with Asr (praying both together) and Maghrib with Isha (praying both together). This is permitted during travel according to the Hanbali, Shafi'i, and Maliki schools; the Hanafi school generally does not permit combining except at Arafah and Muzdalifah. Isfar highlights which prayers fall in the air so you can decide, with your scholar's guidance, whether to combine or keep them separate."}},
    {"@type":"Question","name":"How do I face the qibla on a plane?","acceptedAnswer":{"@type":"Answer","text":"Isfar calculates the qibla bearing from your aircraft's position at each prayer time and expresses it as a clock position relative to the nose — for example, '3 o'clock' means face right. Because the aircraft turns and the position changes throughout the flight, the qibla direction at prayer time is shown individually for each prayer. Most scholars hold that a traveller who cannot determine or maintain the exact direction should face as close to it as they can; standing prayer is preferred if there is space and stability."}},
    {"@type":"Question","name":"When does Maghrib begin at altitude?","acceptedAnswer":{"@type":"Answer","text":"At cruising altitude the horizon is lower than at sea level, so the sun appears to set a few minutes later than it would on the ground. Isfar applies a horizon-dip correction based on altitude so the in-flight Maghrib time is slightly later — erring on the side of caution. Similarly, the end of Fajr (the Fajr-ending sunrise) is calculated a little earlier at altitude. These are modest adjustments of a few minutes at typical cruise levels."}},
    {"@type":"Question","name":"Which prayer-time calculation method should I use?","acceptedAnswer":{"@type":"Answer","text":"Isfar offers the same calculation methods as adhan.js — including Muslim World League, ISNA, Egyptian General Authority, Umm Al-Qura (used for Saudi Arabia), and others. The right choice depends on the convention used by your community or country of origin. If you are unsure, the Muslim World League method is widely accepted globally, and Umm Al-Qura is standard for travellers departing from or arriving into Saudi Arabia."}}
  ]
})} />

<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Isfar" />
<meta name="mobile-web-app-capable" content="yes" />

<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/newsreader-latin-400.woff2" />
<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/hanken-grotesk-latin-400.woff2" />
</head>
<body>
<div id="root"><Calculator client:only="react" /></div>
<script is:inline>
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
</script>
</body>
</html>
```

- [ ] **Step 4: First full build (the integration gate for Tasks 2–5)**

Run: `npm run build`
Expected: `astro build` completes; output written to `dist/`. The `gen-sw-precache.mjs` step (created next task) does not exist yet, so **for this step only** run just the Astro build to gate the port: `npx astro build`.
Expected: **no unresolved-import errors.** If Vite reports `"X" is not exported by …` or `X is not defined`, add the missing import per the cross-reference map (Import completeness rule) and rebuild until green.

- [ ] **Step 5: Commit**

```bash
git add src/styles/styles.css src/pages/index.astro public/
git commit -m "Astro port: index.astro shell (verbatim SEO head + pre-paint script), styles/fonts moved

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Service worker — generated precache, `isfar-v18`

**Files:**
- Create: `scripts/gen-sw-precache.mjs`
- Create: `public/sw.js` (from root `sw.js`, CORE list replaced by a generated marker; cross-origin CDN entries removed since libs are now bundled)

- [ ] **Step 1: Create `public/sw.js`**

Copy the current root `sw.js` to `public/sw.js`, then make two changes:
1. Bump the cache name: `const CACHE = "isfar-v17";` → `const CACHE = "isfar-v18";`
2. Replace the entire hand-maintained `const CORE = [ … ];` array (the `index.html`/`*.jsx`/CDN-React/CDN-adhan/font entries) with a single placeholder line that the generator rewrites:

```js
// __ISFAR_PRECACHE__ (generated by scripts/gen-sw-precache.mjs at build time)
const CORE = [];
```

The `install`/`activate`/`fetch` handlers are unchanged — network-first same-origin, cache-first cross-origin still applies (fonts are now same-origin under `/fonts/`, so they fall under network-first, which is fine: they're cached on first fetch and the version bump purges stale ones).

- [ ] **Step 2: Create `scripts/gen-sw-precache.mjs`**

```js
// Regenerate the service-worker precache list from the built dist/ output.
// Runs after `astro build` (see package.json "build"). Walks dist/, collects
// every emitted asset as a root-absolute URL, and injects it into the CORE
// array of dist/sw.js — so hashed asset names are never hand-maintained.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DIST = 'dist';

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

const files = await walk(DIST);
const urls = files
  .map((f) => '/' + relative(DIST, f).split('\\').join('/'))
  .filter((u) => u !== '/sw.js')            // never precache the SW itself
  .sort();

const swPath = join(DIST, 'sw.js');
let sw = await readFile(swPath, 'utf8');
const list = 'const CORE = ' + JSON.stringify(urls, null, 2) + ';';
sw = sw.replace(/const CORE = \[\];/, list);
await writeFile(swPath, sw);
console.log(`gen-sw-precache: wrote ${urls.length} entries into dist/sw.js (${swPath})`);
```

- [ ] **Step 3: Full build with precache generation**

Run: `npm run build`
Expected: `astro build` then `gen-sw-precache: wrote N entries into dist/sw.js`. Confirm the list is populated: `grep -c '"/_assets' dist/sw.js` → expect ≥ 1; `grep '"/index.html"' dist/sw.js` → present.

- [ ] **Step 4: Commit**

```bash
git add public/sw.js scripts/gen-sw-precache.mjs
git commit -m "Astro port: SW precache generated from build manifest; bump isfar-v18

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Local verification gate (HAND OFF TO USER)

No code. This is the **stop point for local verification** before cutover.

- [ ] **Step 1: Build + preview**

Run: `npm run build && npm run preview`
Expected: preview server on `http://localhost:4321/` (note the port it prints).

- [ ] **Step 2: Playwright smoke across the 5 sample flights**

Drive the preview URL with Playwright MCP. For each of `SV124`, `BA286`, `QF10`, `EK215`, `DY394`: enter the code, submit, confirm prayers render with **both** origin + destination times, the arc renders, no console errors. Confirm:
- Theme toggle light/dark/auto flips with **no white flash** and the canvas re-themes.
- Recents persist across reload (`isfar.recents`).
- `DY394` shows the no-sunset state.
- Offline: load once, go offline, reload → a saved flight still displays; a *new* code shows the `offline` copy.

- [ ] **Step 3: HAND OFF**

Tell the user: build is green and the preview is verified on desktop; ask them to check `npm run preview` locally themselves, **including on a real iOS Safari device** (the required gate from the spec — theme-FOUC/iOS-chrome is not reproducible on desktop). Do **not** proceed to cutover until the user confirms.

---

## Task 8: Cutover — remove the no-build app (AFTER user confirms)

**Files:**
- Delete: root `index.html`, `app.jsx`, `arc.jsx`, `cards.jsx`, `components.jsx`, `tweaks-panel.jsx`, `data.js`, `engine.js`, `styles.css`, `sw.js`, root `manifest.webmanifest`/`favicon.ico`/icons/og/robots/sitemap if any remain at root, empty `fonts/`.
- Update: `CLAUDE.md`, `ROADMAP.md` (mark Phase C shipped, update file map).

- [ ] **Step 1: Delete the no-build root files**

Run:
```bash
git rm index.html app.jsx arc.jsx cards.jsx components.jsx tweaks-panel.jsx data.js engine.js styles.css sw.js
git rm -r --ignore-unmatch fonts
```
(The static assets — manifest/icons/og/robots/sitemap — were already `git mv`'d into `public/` in Task 5, so they are not at root anymore.)

- [ ] **Step 2: Verify the tree builds clean with only the Astro app**

Run: `npm run build`
Expected: green, `dist/` produced, precache populated. No references to deleted root files (the SW CORE is generated from `dist/`, not the old hand list).

- [ ] **Step 3: Preview once more post-deletion**

Run: `npm run preview` and re-confirm the app loads (no 404s for moved assets — check the Playwright console is clean).

- [ ] **Step 4: Update docs**

In `CLAUDE.md`: update "What this is" (no longer "no build step" — now Astro SSG, one client:only island), the file map (root `*.jsx`/`*.js` → `src/`), conventions (drop the `window.*`/Babel-scope rules, the integrity-pin rule for CDN React; add `npm run build`/`preview`). Keep the entire **iOS mobile chrome** section verbatim — it still applies. In `ROADMAP.md`: mark Phase C shipped in the Status block and the phase list.

- [ ] **Step 5: Commit the cutover**

```bash
git add -A
git commit -m "Astro port: production cutover — remove no-build app; docs updated (Phase C)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Merge readiness (deploy notes — NOT executed here)

No code. Capture what the **merge to `main`** requires so go-live isn't a surprise. Do not merge until the user has done the real-iOS check.

- [ ] **Step 1: Document the Cloudflare build-config change the user owns**

The `isfar` static-asset Worker currently serves the repo root as flat files. After cutover it must **build**: set the Worker's build command to `npm run build` and output directory to `dist/`. Surface this to the user as the one dashboard setting they must flip at/just-before merge (Claude cannot click it). Note it in the PR/merge description. The `isfar-flight` `/api/*` Worker is untouched.

- [ ] **Step 2: Offer the merge**

Once the user confirms the real-iOS check passes, merge `astro-port` → `main` (per the branch plan, the merge is go-live; the static Worker auto-deploys on push to `main`).

---

## Self-Review

**Spec coverage:**
- §A client:only island → Task 5 Step 3 (`<Calculator client:only="react" />`) + Task 4 (default-export root, no createRoot). ✓
- §A verbatim pre-paint script + no theme-color + SEO head → Task 5 Step 3. ✓
- §B module conversions (data/engine/components/arc/cards/tweaks/app) → Tasks 2–4 with exact import map. ✓
- §B drop `__edit_mode_*` bridge → Task 3 Step 2. ✓
- §C static output + react integration → Task 1 Step 2. ✓
- §C fonts reused as-is (no @fontsource), url fix → Task 5 Steps 1–2. ✓
- §C SW generated precache + isfar-v18 → Task 6. ✓
- §C dist/ gitignored, Worker runs build → Task 1 Step 4 + Task 9 Step 1. ✓
- §C /api Worker untouched → Task 9 Step 1 (noted, no task modifies worker/). ✓
- §D 6-commit incremental plan → Tasks 1–6 then 8 cutover (one extra commit-per-task granularity; matches intent). ✓
- §E local Playwright gate + real-iOS gate before merge → Task 7 + Task 9 Step 2. ✓

**Placeholder scan:** No TBD/TODO; the `__ISFAR_PRECACHE__` marker is an intentional generated-content anchor with its generator fully specified in Task 6 Step 2. ✓

**Type/name consistency:** Export names match the cross-reference table across producer and consumer modules (`PlaneQibla`, `PRAYER_GLYPH`, `Ic`, `compute`, `lookupRemote`, `ArcTimeline`, `PrayerList`, `Guidance`, `Tweak*`). `App`→`Calculator` rename is consistent (Task 4 Step 5 + import in Task 5 Step 3). SW `CORE`/`CACHE` names consistent between `public/sw.js` and `gen-sw-precache.mjs`. ✓
