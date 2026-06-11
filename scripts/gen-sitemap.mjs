// Generate dist/sitemap.xml from the built output. Runs after `astro build`
// (see package.json "build") — pages are never hand-listed. Each en/ar pair
// carries xhtml:link hreflang alternates (Google's preferred bidirectional
// annotation). Fails loudly if the page count looks wrong.
import { readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DIST = 'dist';
const ORIGIN = 'https://isfar.app';

// lastmod per section — bump when a section's content meaningfully changes.
const GUIDE_LASTMOD = '2026-06-10';
const WAVE1_LASTMOD = '2026-06-11';

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(p));
    else if (ent.name === 'index.html') out.push(p);
  }
  return out;
}

const pages = (await walk(DIST))
  .map((f) => relative(DIST, join(f, '..')).split('\\').join('/'))
  .map((rel) => (rel === '' ? '/' : `/${rel}/`))
  .sort();

const lastmodOf = (p) => p.startsWith('/guide/') ? GUIDE_LASTMOD : WAVE1_LASTMOD;
const alternateOf = (p) => {
  // localized pair: /x ↔ /ar/x — only emitted when both sides exist
  const other = p.startsWith('/ar/') ? p.slice(3) || '/' : '/ar' + (p === '/' ? '/' : p);
  return pages.includes(other) ? other : null;
};

const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
for (const p of pages) {
  xml.push('  <url>');
  xml.push(`    <loc>${ORIGIN}${p}</loc>`);
  xml.push(`    <lastmod>${lastmodOf(p)}</lastmod>`);
  const other = alternateOf(p);
  if (other) {
    const [en, ar] = p.startsWith('/ar/') ? [other, p] : [p, other];
    xml.push(`    <xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}${en}"/>`);
    xml.push(`    <xhtml:link rel="alternate" hreflang="ar" href="${ORIGIN}${ar}"/>`);
    xml.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${en}"/>`);
  }
  xml.push('  </url>');
}
xml.push('</urlset>');

if (pages.length < 50) {
  throw new Error(`gen-sitemap: only ${pages.length} pages found — expected the full wave-1 surface (>=50)`);
}
if (!pages.includes('/')) throw new Error('gen-sitemap: homepage missing from walk');

await writeFile(join(DIST, 'sitemap.xml'), xml.join('\n') + '\n');
console.log(`gen-sitemap: wrote ${pages.length} URLs to dist/sitemap.xml`);
