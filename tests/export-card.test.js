/* Save-as-image — the PURE layout model behind the canvas card. Drawing is a
   thin shell (jsdom has no canvas); everything decidable is decided here. */
import { describe, it, expect } from 'vitest';
import { cardLines } from '../src/lib/export-card.js';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';
import { routeRecord, airportFromRow } from '../src/lib/airports.js';
import airportData from '../src/assets/airports.json';

const f = compute(lookup('SV124'), { method: 'isna', madhab: 'shafi' });

describe('cardLines', () => {
  const lines = cardLines(f, { method: 'isna', madhab: 'shafi' });

  it('starts with route + date header', () => {
    expect(lines[0]).toEqual({ kind: 'title', text: 'SV124 · LHR → JED' });
    expect(lines[1].kind).toBe('sub');
    expect(lines[1].text).toContain('6h 45m');
  });

  it('has one row per prayer with both zones', () => {
    const rows = lines.filter((l) => l.kind === 'prayer');
    expect(rows).toHaveLength(f.prayers.length);
    const asr = rows.find((r) => r.en === 'Asr');
    expect(asr.right).toMatch(/LHR \d\d:\d\d · JED \d\d:\d\d/);
  });

  it('groups by section', () => {
    const sections = lines.filter((l) => l.kind === 'section').map((l) => l.text);
    expect(sections).toContain('In flight');
  });

  it('estimated prayers carry ~ and the footnote appears only when needed', () => {
    expect(lines.some((l) => l.kind === 'note')).toBe(f.prayers.some((p) => p.estimated));
    const tos = compute(lookup('DY394'), { method: 'isna', madhab: 'shafi' });
    const tl = cardLines(tos, { method: 'isna', madhab: 'shafi' });
    expect(tl.some((l) => l.kind === 'note')).toBe(true);
    const est = tl.find((l) => l.kind === 'prayer' && l.estimated);
    expect(est.right).toContain('~');
  });

  it('footer names the method and the app', () => {
    const foot = lines[lines.length - 1];
    expect(foot.kind).toBe('footer');
    expect(foot.text).toContain('ISNA');
    expect(foot.text).toContain('isfar.app');
  });

  it('repeated prayers on multi-day flights carry no sequence marker', () => {
    const m = compute(lookup('QF10'), { method: 'isna', madhab: 'shafi' });
    const rows = cardLines(m, { method: 'isna', madhab: 'shafi' }).filter((l) => l.kind === 'prayer');
    expect(rows).toHaveLength(m.prayers.length);
    expect(rows.some((r) => /\(\d\)/.test(r.en))).toBe(false);
  });

  it('route-mode card titles the route once, no code repeat', () => {
    const find = (i) => airportFromRow(airportData.airports.find((a) => a[0] === i));
    const r = routeRecord({ from: find('LHR'), to: find('JED'), dateISO: '2026-06-06', depTime: '14:20', arrTime: '23:05' });
    const m = compute(r, { method: 'isna', madhab: 'shafi' });
    const tl = cardLines(m, { method: 'isna', madhab: 'shafi' });
    expect(tl[0].text).toBe('LHR → JED');
  });
});
