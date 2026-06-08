/* ===========================================================================
   Isfar — service-worker precache generator
   Runs AFTER `astro build` (see package.json "build" script). It walks the
   built dist/ output, collects every emitted asset (the shell HTML, hashed
   JS/CSS chunks, self-hosted font woff2, manifest, icons, og-cover, etc.), and
   rewrites dist/sw.js so its CORE precache list is the real, fingerprinted set
   — never hand-maintained. This is the "regenerate the SW precache list from
   the build manifest" step from ROADMAP Phase C.
   =========================================================================== */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

// Walk dist/ recursively → web paths ("/_astro/x.hash.js", "/index.html", …).
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push("/" + relative(dist, full).split(sep).join("/"));
  }
  return out;
}

let assets;
try {
  assets = walk(dist);
} catch (e) {
  console.error("[gen-sw-precache] dist/ not found — run `astro build` first.");
  process.exit(1);
}

// Precache everything needed for a cold offline boot. Exclude sw.js itself
// (the browser fetches it directly) and source maps (dev only, large).
const precache = assets
  .filter((p) => p !== "/sw.js")
  .filter((p) => !p.endsWith(".map"));

// Ensure the bare root navigation target is present (served by index.html).
if (!precache.includes("/")) precache.unshift("/");

const swPath = join(dist, "sw.js");
let sw = readFileSync(swPath, "utf8");

const list = JSON.stringify(precache, null, 2);
const replacement = `// __PRECACHE__ (generated from the build output — do not hand-edit)\nconst CORE = ${list};`;

// Replace the placeholder CORE declaration with the generated list.
const re = /\/\/ __PRECACHE__[\s\S]*?const CORE = \[[\s\S]*?\];/;
if (!re.test(sw)) {
  console.error("[gen-sw-precache] could not find the CORE placeholder in dist/sw.js");
  process.exit(1);
}
sw = sw.replace(re, replacement);
writeFileSync(swPath, sw);

console.log(`[gen-sw-precache] precached ${precache.length} assets into dist/sw.js (cache isfar-v3).`);
