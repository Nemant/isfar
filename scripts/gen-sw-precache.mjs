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
// Fail loudly if the injection marker drifted — a silent no-op would ship an
// empty precache (no offline support) while still logging a success count.
if (!sw.includes('const CORE = [];')) {
  throw new Error('gen-sw-precache: marker "const CORE = [];" not found in dist/sw.js — precache NOT injected');
}
const list = 'const CORE = ' + JSON.stringify(urls, null, 2) + ';';
// Function replacer so `$`-sequences in any path can't be interpreted as
// replacement patterns ($&, $1, …).
sw = sw.replace(/const CORE = \[\];/, () => list);
await writeFile(swPath, sw);
console.log(`gen-sw-precache: wrote ${urls.length} entries into dist/sw.js (${swPath})`);
