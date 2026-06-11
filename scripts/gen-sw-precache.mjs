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
let urls = files
  .map((f) => '/' + relative(DIST, f).split('\\').join('/'))
  .filter((u) => u !== '/sw.js')            // never precache the SW itself
  // The static SEO surface (route pages, Arabic pages, 404, sitemap) is not
  // part of the offline app shell — precaching it would make every install
  // download the whole marketing site.
  .filter((u) => !u.startsWith('/prayer-times/') && !u.startsWith('/ar/'))
  .filter((u) => u !== '/404.html' && u !== '/sitemap.xml')
  .sort();

// Unlisted (noindex) pages are not part of the offline app shell either: drop
// their HTML, plus any /_assets/ chunk referenced ONLY by dropped pages (a
// chunk shared with a kept page stays). Mirrors gen-sitemap's noindex rule.
const NOINDEX = /<meta\s+name="robots"\s+content="[^"]*noindex[^"]*"/i;
const ASSET_REF = /_assets\/[A-Za-z0-9._-]+/g;
const keptRefs = new Set(), droppedRefs = new Set(), noindexPages = new Set();
for (const u of urls.filter((u) => u.endsWith('.html'))) {
  const html = await readFile(join(DIST, u), 'utf8');
  const refs = html.match(ASSET_REF) || [];
  if (NOINDEX.test(html)) {
    noindexPages.add(u);
    refs.forEach((r) => droppedRefs.add('/' + r));
  } else {
    refs.forEach((r) => keptRefs.add('/' + r));
  }
}
urls = urls.filter((u) => !noindexPages.has(u) &&
  !(droppedRefs.has(u) && !keptRefs.has(u)));
if (noindexPages.size) {
  console.log(`gen-sw-precache: excluded ${noindexPages.size} noindex page(s) from the precache`);
}

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
