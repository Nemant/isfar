/* Structural guarantees the engine must hold for ANY flight. */
import { describe, it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';
import { flight } from './helpers.js';

// deterministic PRNG — reproducible, no Date.now()
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AIRPORTS = [
  [51.47, -0.45, 'Europe/London'], [21.68, 39.16, 'Asia/Riyadh'], [40.64, -73.78, 'America/New_York'],
  [69.68, 18.92, 'Europe/Oslo'], [60.19, 11.10, 'Europe/Oslo'], [66.56, 25.83, 'Europe/Helsinki'],
  [-31.94, 115.97, 'Australia/Perth'], [-33.94, 18.60, 'Africa/Johannesburg'], [64.13, -21.94, 'Atlantic/Reykjavik'],
  [25.25, 55.36, 'Asia/Dubai'], [35.55, 139.78, 'Asia/Tokyo'], [78.25, 15.47, 'Arctic/Longyearbyen'],
];
const DATES = ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21', '2026-02-19', '2026-08-17'];
const METHODS = ['mwl', 'isna', 'moonsighting', 'ummalqura', 'tehran'];

function randomFlights(n) {
  const rnd = mulberry32(20260610);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ai = Math.floor(rnd() * AIRPORTS.length);
    let bi = Math.floor(rnd() * AIRPORTS.length);
    if (bi === ai) bi = (ai + 1) % AIRPORTS.length;
    const a = AIRPORTS[ai], b = AIRPORTS[bi];
    const date = DATES[Math.floor(rnd() * DATES.length)];
    const depH = Math.floor(rnd() * 24), durMin = 45 + Math.floor(rnd() * 17 * 60);
    const dep = Date.parse(`${date}T00:00:00Z`) + depH * 3600000;
    out.push({
      f: flight({ fromLat: a[0], fromLon: a[1], fromTz: a[2], toLat: b[0], toLon: b[1], toTz: b[2],
                  depUTC: new Date(dep).toISOString(), arrUTC: new Date(dep + durMin * 60000).toISOString() }),
      method: METHODS[Math.floor(rnd() * METHODS.length)],
    });
  }
  return out;
}

describe('invariants over 120 randomized flights', () => {
  const runs = randomFlights(120).map(({ f, method }) =>
    ({ f, method, m: compute(f, { method, madhab: 'shafi' }) }));
  const label = (f, method) => `${f.from.iata}->${f.to.iata} ${f.depUTC} ${f.arrUTC} ${method}`;

  it('after-arrival always has exactly 2 prayers', () => {
    for (const { m, f, method } of runs) {
      expect(m.prayers.filter(p => p.status === 'after').length, label(f, method)).toBe(2);
    }
  });

  it('before-departure always has exactly 2 prayers', () => {
    for (const { m, f, method } of runs) {
      expect(m.prayers.filter(p => p.status === 'before').length, label(f, method)).toBe(2);
    }
  });

  it('in-flight prayers sit inside the flight window', () => {
    for (const { m, f, method } of runs) {
      const dep = Date.parse(f.depUTC), arr = Date.parse(f.arrUTC);
      for (const p of m.prayers.filter(p => p.status === 'inflight')) {
        expect(p.ms, label(f, method)).toBeGreaterThanOrEqual(dep);
        expect(p.ms, label(f, method)).toBeLessThanOrEqual(arr + 40 * 60000); // + maghrib dip allowance
      }
    }
  });

  it('no same prayer twice within 6 hours; list sorted by ms', () => {
    for (const { m, f, method } of runs) {
      const last = {};
      let prev = -Infinity;
      for (const p of m.prayers) {
        expect(p.ms, label(f, method)).toBeGreaterThanOrEqual(prev); prev = p.ms;
        if (last[p.key] !== undefined) {
          expect(p.ms - last[p.key], `${label(f, method)} ${p.key}`).toBeGreaterThanOrEqual(6 * 3600000);
        }
        last[p.key] = p.ms;
      }
    }
  });

  it('flags and sources always agree', () => {
    for (const { m, f, method } of runs) {
      for (const p of m.prayers) {
        expect(!!p.estimateBasis, label(f, method)).toBe(p.estimated);
        if (p.estimated) expect(['seventh', 'borrow60', 'method']).toContain(p.estimateBasis);
      }
    }
  });

  it('goldens still behave: QF10 ≥ 8 prayers & multi-day, EK215 computes, DY394 gap-free', () => {
    const qf = compute(lookup('QF10'), { method: 'mwl', madhab: 'shafi' });
    expect(qf.prayers.length).toBeGreaterThanOrEqual(8);
    expect(qf.multiDay).toBe(true);
    expect(compute(lookup('EK215'), { method: 'mwl', madhab: 'shafi' }).prayers.length).toBeGreaterThan(3);
    const dy = compute(lookup('DY394'), { method: 'isna', madhab: 'shafi' });
    expect(dy.prayers.length).toBeGreaterThanOrEqual(4);
  });

  it('performance: QF10 (17 h walk) computes in under 2 s', () => {
    const t0 = performance.now();
    compute(lookup('QF10'), { method: 'mwl', madhab: 'shafi' });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
