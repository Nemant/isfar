/* Characterization of compute()'s public display model — the exact contract the
   UI consumes (Calculator banners, arc dots, prayer cards, NextPrayer, export
   card). Pins both the SHAPE (field list, formats, ranges) and the VALUES for
   the curated sample flights, so engine refactors cannot drift behavior. */
import { describe, it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';
import { flight } from './helpers.js';

const C = (code, method = 'mwl') => compute(lookup(code), { method, madhab: 'shafi' });
const HHMM = /^\d{2}:\d{2}$/;

describe('top-level display model', () => {
  const m = C('SV124');

  it('keeps the raw record fields and adds the computed ones', () => {
    expect(m.code).toBe('SV124');
    expect(m.from.iata).toBe('LHR');
    expect(m.to.iata).toBe('JED');
    expect(typeof m.durationMin).toBe('number');
    expect(m.cruiseAltFt).toBe(41000);          // estimated from the 787 (long-haul widebody)
    expect(typeof m.multiDay).toBe('boolean');
    expect(Array.isArray(m.skyNotes)).toBe(true);
    expect(Array.isArray(m.prayers)).toBe(true);
  });

  it('dep/arr local times are HH:MM', () => {
    expect(m.dep.local).toMatch(HHMM);
    expect(m.arr.local).toMatch(HHMM);
  });
});

describe('prayer entry shape — exactly the fields the UI consumes', () => {
  // id/key/en/ar/status (cards, arc), t (arc y-position), ms (NextPrayer),
  // qiblaClock/qiblaRel (PlaneQibla), sunrise/sunriseMs (fajr window),
  // estimated/estimateBasis (~ flag + estimate footnote), zones (both clocks).
  const LIVE_FIELDS = ['ar', 'en', 'estimateBasis', 'estimated', 'id', 'key', 'ms',
                       'qiblaClock', 'qiblaRel', 'status', 'sunrise', 'sunriseMs', 't', 'zones'];

  it('no dead fields ride along (dusk/seq/source were UI leftovers)', () => {
    for (const code of ['SV124', 'QF10', 'DY394']) {
      for (const p of C(code).prayers) {
        expect(Object.keys(p).sort(), `${code} ${p.id}`).toEqual(LIVE_FIELDS);
      }
    }
  });

  it('ids are unique; en/ar names match the key', () => {
    const m = C('QF10');
    expect(new Set(m.prayers.map(p => p.id)).size).toBe(m.prayers.length);
    for (const p of m.prayers) expect(p.id.startsWith(p.key + '-')).toBe(true);
  });

  it('t is a 0..1 sun fraction', () => {
    for (const p of C('QF10').prayers) {
      expect(p.t).toBeGreaterThanOrEqual(0);
      expect(p.t).toBeLessThan(1);
    }
  });

  it('zones carry both endpoints with HH:MM time and a date label', () => {
    const m = C('SV124');
    for (const p of m.prayers) {
      for (const iata of ['LHR', 'JED']) {
        const z = p.zones[iata];
        expect(z.iata).toBe(iata);
        expect(z.time).toMatch(HHMM);
        expect(typeof z.date).toBe('string');
        expect(typeof z.city).toBe('string');
      }
    }
  });

  it('qibla clock only aloft: 1..12 integer + rel bearing in [0,360); null on the ground', () => {
    for (const p of C('QF10').prayers) {
      if (p.status === 'inflight') {
        expect(Number.isInteger(p.qiblaClock)).toBe(true);
        expect(p.qiblaClock).toBeGreaterThanOrEqual(1);
        expect(p.qiblaClock).toBeLessThanOrEqual(12);
        expect(p.qiblaRel).toBeGreaterThanOrEqual(0);
        expect(p.qiblaRel).toBeLessThan(360);
      } else {
        expect(p.qiblaClock).toBeNull();
        expect(p.qiblaRel).toBeNull();
      }
    }
  });

  it('sunrise window only on fajr; ~-prefixed exactly when the window is an estimate', () => {
    for (const code of ['SV124', 'QF10', 'DY394']) {
      const m = compute(lookup(code), { method: code === 'DY394' ? 'isna' : 'mwl', madhab: 'shafi' });
      const order = [m.from.iata, m.to.iata];
      for (const p of m.prayers) {
        if (p.key !== 'fajr') {
          expect(p.sunrise, `${code} ${p.id}`).toBeNull();
          expect(p.sunriseMs, `${code} ${p.id}`).toBeNull();
          continue;
        }
        expect(typeof p.sunriseMs).toBe('number');
        for (const iata of order) {
          expect(p.sunrise[iata], `${code} ${p.id} ${iata}`).toMatch(/^~?\d{2}:\d{2}$/);
        }
        // all-or-nothing: both zone strings agree on the ~
        const tildes = order.map(i => p.sunrise[i].startsWith('~'));
        expect(tildes[0]).toBe(tildes[1]);
      }
    }
  });

  it('estimated ⇔ estimateBasis present, and basis names a policy source', () => {
    for (const code of ['SV124', 'QF10', 'DY394']) {
      for (const p of C(code, code === 'DY394' ? 'isna' : 'mwl').prayers) {
        expect(!!p.estimateBasis, `${code} ${p.id}`).toBe(p.estimated);
        if (p.estimated) expect(['seventh', 'borrow60', 'method']).toContain(p.estimateBasis);
      }
    }
  });
});

describe('value pins — the curated samples compute exactly what they compute today', () => {
  // [key, status, ms, estimated, estimateBasis] per prayer. Regenerate ONLY for a
  // deliberate policy change; a surprise diff here means a refactor broke behavior.
  const strip = (m) => m.prayers.map(p => [p.key, p.status, p.ms, p.estimated, p.estimateBasis]);

  it('SV124 LHR→JED (normal dusk-crossing flight)', () => {
    expect(strip(C('SV124'))).toEqual([
      ['fajr', 'before', 1780713780000, true, 'seventh'],
      ['dhuhr', 'before', 1780747320000, false, null],
      ['asr', 'inflight', 1780758660000, false, null],
      ['maghrib', 'inflight', 1780767540446, false, null],   // dip-shifted real sunset (41k cruise)
      ['isha', 'inflight', 1780770120000, false, null],
      ['fajr', 'after', 1780794900000, false, null],
      ['dhuhr', 'after', 1780824180000, false, null],
    ]);
  });

  it('QF10 LHR→PER (two solar days eastbound, repeated prayers)', () => {
    expect(strip(C('QF10'))).toEqual([
      ['isha', 'before', 1780694280428, true, 'seventh'],
      ['fajr', 'before', 1780713780000, true, 'seventh'],
      ['dhuhr', 'inflight', 1780747260000, false, null],
      ['asr', 'inflight', 1780755780000, false, null],
      ['maghrib', 'inflight', 1780763999586, false, null],
      ['isha', 'inflight', 1780766400000, false, null],
      ['fajr', 'inflight', 1780786740000, false, null],
      ['dhuhr', 'inflight', 1780806540000, false, null],
      ['asr', 'after', 1780815600000, false, null],
      ['maghrib', 'after', 1780823940000, false, null],
    ]);
    expect(C('QF10').multiDay).toBe(true);
  });

  it('DY394 OSL→TOS (midnight-sun destination, borrowed cluster)', () => {
    const m = C('DY394', 'isna');
    expect(strip(m)).toEqual([
      ['dhuhr', 'before', 1780744500000, false, null],
      ['asr', 'before', 1780761240000, false, null],
      ['maghrib', 'inflight', 1780781220000, true, 'borrow60'],
      ['isha', 'inflight', 1780781220000, true, 'borrow60'],
      ['fajr', 'after', 1780792800571, true, 'borrow60'],
      ['dhuhr', 'after', 1780829040000, false, null],
    ]);
    expect(m.skyNotes).toEqual([{
      place: 'destination', city: 'Tromsø', iata: 'TOS', latitude: '69.7° N',
      kind: 'midnightsun', allEstimated: false, names: ['Fajr', 'Maghrib', 'Isha'],
    }]);
  });

  it('synthetic record (flight helper) computes identically through the same path', () => {
    // guards the record-shape assumptions the worker CONTRACT freezes
    const m = compute(flight({
      fromLat: 51.47, fromLon: -0.45, fromTz: 'Europe/London', fromIata: 'LHR',
      toLat: 21.68, toLon: 39.16, toTz: 'Asia/Riyadh', toIata: 'JED',
      depUTC: '2026-03-20T10:00:00Z', arrUTC: '2026-03-20T16:30:00Z',
    }), { method: 'mwl', madhab: 'shafi' });
    expect(m.prayers.length).toBeGreaterThanOrEqual(5);
    expect(m.prayers.every(p => typeof p.ms === 'number')).toBe(true);
  });
});
