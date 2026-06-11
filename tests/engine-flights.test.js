/* Edge-case flight fleet — full compute() runs over the geometries the other
   suites don't reach: the date line, transpolar routes, the southern
   hemisphere, both-endpoints-polar, DST boundaries, degenerate durations, and
   the two curated samples (EK215, BA286) that had no pins. Values are
   characterization pins of audited behavior — regenerate only for a
   deliberate policy change. */
import { describe, it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';
import { flight } from './helpers.js';

const C = (rec, method = 'mwl', madhab = 'shafi') => compute(rec, { method, madhab });
const strip = (m) => m.prayers.map(p => [p.key, p.status, p.ms, p.estimated, p.estimateBasis]);

/* the structural contract every flight must satisfy, whatever the geometry */
function assertFlightInvariants(m, rec) {
  const dep = Date.parse(rec.depUTC), arr = Date.parse(rec.arrUTC);
  expect(m.prayers.filter(p => p.status === 'before').length).toBe(2);
  expect(m.prayers.filter(p => p.status === 'after').length).toBe(2);
  let prev = -Infinity;
  const lastAt = {};
  for (const p of m.prayers) {
    expect(p.ms).toBeGreaterThanOrEqual(prev); prev = p.ms;
    if (p.status === 'inflight') {
      expect(p.ms).toBeGreaterThanOrEqual(dep);
      expect(p.ms).toBeLessThanOrEqual(arr);
    }
    if (lastAt[p.key] !== undefined) {
      expect(p.ms - lastAt[p.key], p.key).toBeGreaterThanOrEqual(6 * 3600000);
    }
    lastAt[p.key] = p.ms;
    expect(!!p.estimateBasis).toBe(p.estimated);
  }
}

describe('remaining curated samples', () => {
  it('EK215 DXB→LAX (16 h westbound stretched day): exactly ONE in-flight prayer', () => {
    // chasing the sun west stretches the solar day — only Dhuhr falls aloft;
    // the evening prayers wait for the ground at both ends
    const m = C(lookup('EK215'));
    assertFlightInvariants(m, lookup('EK215'));
    expect(strip(m)).toEqual([
      ['isha', 'before', 1780677000000, false, null],
      ['fajr', 'before', 1780703940000, false, null],
      ['dhuhr', 'inflight', 1780735200000, false, null],
      ['asr', 'after', 1780789080000, false, null],
      ['maghrib', 'after', 1780801380000, false, null],
    ]);
  });

  it('BA286 (SV124 codeshare): identical prayers to the operating flight', () => {
    expect(strip(C(lookup('BA286')))).toEqual(strip(C(lookup('SV124'))));
  });
});

describe('the date line', () => {
  const LAX_SYD = flight({
    fromLat: 33.94, fromLon: -118.41, fromTz: 'America/Los_Angeles', fromIata: 'LAX',
    toLat: -33.95, toLon: 151.18, toTz: 'Australia/Sydney', toIata: 'SYD',
    depUTC: '2026-06-21T06:00:00Z', arrUTC: '2026-06-21T20:35:00Z',
  });
  const SYD_LAX = flight({
    fromLat: -33.95, fromLon: 151.18, fromTz: 'Australia/Sydney', fromIata: 'SYD',
    toLat: 33.94, toLon: -118.41, toTz: 'America/Los_Angeles', toIata: 'LAX',
    depUTC: '2026-12-21T23:30:00Z', arrUTC: '2026-12-22T13:00:00Z',
  });

  it('westbound LAX→SYD: the lon sign-flip never double-captures a prayer', () => {
    // crossing ±180° jumps the mean-solar day key by 24 h — the 6 h merge and
    // day-keyed capture must absorb it without repeating or dropping anything
    const m = C(LAX_SYD);
    assertFlightInvariants(m, LAX_SYD);
    expect(strip(m)).toEqual([
      ['maghrib', 'before', 1782011280000, false, null],
      ['isha', 'before', 1782017160000, false, null],
      ['fajr', 'inflight', 1782065100000, false, null],   // the night chased across the Pacific
      ['dhuhr', 'after', 1782093480000, false, null],
      ['asr', 'after', 1782102960000, false, null],
    ]);
  });

  it('eastbound SYD→LAX red-eye: full sweep, real dip-shifted Maghrib aloft', () => {
    const m = C(SYD_LAX);
    assertFlightInvariants(m, SYD_LAX);
    expect(m.prayers.map(p => [p.key, p.status])).toEqual([
      ['isha', 'before'], ['fajr', 'before'],
      ['dhuhr', 'inflight'], ['asr', 'inflight'], ['maghrib', 'inflight'], ['isha', 'inflight'],
      ['fajr', 'after'], ['dhuhr', 'after'],
    ]);
    const maghrib = m.prayers.find(p => p.key === 'maghrib' && p.status === 'inflight');
    expect(maghrib.estimated).toBe(false);
    expect(maghrib.ms % 60000).not.toBe(0);               // altitude dip baked into a real sunset
    expect(m.prayers.every(p => !p.estimated)).toBe(true); // 34°S↔34°N midwinter: all real
  });
});

describe('transpolar EWR→HKG (great circle over the Arctic)', () => {
  const rec = (date) => flight({
    fromLat: 40.69, fromLon: -74.17, fromTz: 'America/New_York', fromIata: 'EWR',
    toLat: 22.31, toLon: 113.91, toTz: 'Asia/Hong_Kong', toIata: 'HKG',
    depUTC: `${date}T02:00:00Z`, arrUTC: `${date}T17:50:00Z`,
  });

  it('June: sweeps two night regimes — seventh near the rim, borrow60 over the top', () => {
    const m = C(rec('2026-06-21'));
    assertFlightInvariants(m, rec('2026-06-21'));
    const bases = m.prayers.filter(p => p.status === 'inflight' && p.estimated).map(p => p.estimateBasis);
    expect(bases).toContain('seventh');                    // the audited band, local night portioned
    expect(bases).toContain('borrow60');                   // the midnight-sun cap, cluster borrowed
    const ishas = m.prayers.filter(p => p.key === 'isha' && p.status === 'inflight');
    expect(ishas.length).toBe(2);                          // two genuine nights aloft, ≥6 h apart
    expect(ishas[1].ms - ishas[0].ms).toBeGreaterThanOrEqual(6 * 3600000);
  });

  it('December: the polar-night cliff captures the whole jumped schedule at one instant', () => {
    // entering polar night, every prayer's schedule JUMPS past the clock; the
    // policy records each at the moment it became due — same instant, all
    // flagged, none from the past, none dropped (the audit's failure mode)
    const m = C(rec('2026-12-21'));
    assertFlightInvariants(m, rec('2026-12-21'));
    const aloft = m.prayers.filter(p => p.status === 'inflight');
    expect(aloft.map(p => p.key)).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    expect(new Set(aloft.map(p => p.ms)).size).toBe(1);    // one cliff instant
    expect(aloft.every(p => p.estimated)).toBe(true);
    expect(aloft.find(p => p.key === 'dhuhr').estimateBasis).toBe('method'); // real transit, flagged
    expect(aloft.filter(p => p.key !== 'dhuhr').every(p => p.estimateBasis === 'borrow60')).toBe(true);
    // the exact instants quoted by /guide/the-skipped-day/ — that page promises
    // these are pinned here, so a policy change cannot silently strand its table
    expect(aloft[0].ms).toBe(Date.parse('2026-12-21T09:01:00Z'));            // the crossing
    const ground = (key, status) => m.prayers.find(p => p.key === key && p.status === status).ms;
    expect(ground('maghrib', 'before')).toBe(Date.parse('2026-12-20T21:32:00Z')); // EWR 16:32 EST
    expect(ground('isha', 'before')).toBe(Date.parse('2026-12-20T23:05:00Z'));    // EWR 18:05 EST
    expect(ground('fajr', 'after')).toBe(Date.parse('2026-12-21T21:40:00Z'));     // HKG 05:40 HKT
    expect(ground('dhuhr', 'after')).toBe(Date.parse('2026-12-22T04:24:00Z'));    // HKG 12:24 HKT
  });
});

describe('both endpoints in polar night (TOS→LYR, December)', () => {
  const rec = flight({
    fromLat: 69.68, fromLon: 18.92, fromTz: 'Europe/Oslo', fromIata: 'TOS',
    toLat: 78.25, toLon: 15.47, toTz: 'Arctic/Longyearbyen', toIata: 'LYR',
    depUTC: '2026-12-21T10:00:00Z', arrUTC: '2026-12-21T11:40:00Z',
  });

  it('one skyNote per endpoint, everything estimated, polar Dhuhr flagged', () => {
    const m = C(rec);
    assertFlightInvariants(m, rec);
    expect(m.skyNotes.map(n => [n.place, n.kind, n.allEstimated])).toEqual([
      ['origin', 'polarnight', true],
      ['destination', 'polarnight', true],
    ]);
    expect(m.prayers.every(p => p.estimated)).toBe(true);
    const dhuhr = m.prayers.find(p => p.key === 'dhuhr');
    expect(dhuhr.estimateBasis).toBe('method');            // local transit kept, honestly flagged
  });
});

describe('southern hemisphere midsummer (AEP→USH, 54.8°S in December)', () => {
  const rec = flight({
    fromLat: -34.56, fromLon: -58.42, fromTz: 'America/Argentina/Buenos_Aires', fromIata: 'AEP',
    toLat: -54.84, toLon: -68.30, toTz: 'America/Argentina/Ushuaia', toIata: 'USH',
    depUTC: '2026-12-21T22:00:00Z', arrUTC: '2026-12-22T01:35:00Z',
  });

  it('rule 2 mirrors south: Ushuaia isha/fajr portioned, coherent with its real sky', () => {
    const m = C(rec);
    assertFlightInvariants(m, rec);
    const maghrib = m.prayers.find(p => p.key === 'maghrib');
    const isha = m.prayers.find(p => p.key === 'isha');
    const fajr = m.prayers.find(p => p.key === 'fajr');
    expect(maghrib.status).toBe('inflight');
    expect(maghrib.estimated).toBe(false);                 // the sun still sets at 54.8°S
    expect(isha.estimateBasis).toBe('seventh');            // 18° never reached in austral midsummer
    expect(fajr.estimateBasis).toBe('seventh');
    expect(isha.ms).toBeGreaterThan(maghrib.ms);           // after the sunset the cabin watched
    expect(fajr.ms).toBeLessThan(fajr.sunriseMs);          // before the real Ushuaia sunrise
  });
});

describe('DST boundary (JFK→LHR red-eye over the UK spring-forward, 2026-03-29)', () => {
  const rec = flight({
    fromLat: 40.64, fromLon: -73.78, fromTz: 'America/New_York', fromIata: 'JFK',
    toLat: 51.47, toLon: -0.45, toTz: 'Europe/London', toIata: 'LHR',
    depUTC: '2026-03-28T23:00:00Z', arrUTC: '2026-03-29T06:30:00Z',
  });

  it('arrival clock lands on the NEW offset (06:30Z → 07:30 BST, not 06:30 GMT)', () => {
    const m = C(rec);
    assertFlightInvariants(m, rec);
    expect(m.dep.local).toBe('19:00');                     // EDT
    expect(m.arr.local).toBe('07:30');                     // BST — clocks jumped at 01:00
  });
});

describe('degenerate durations', () => {
  it('zero-duration record: no crash, ground prayers only', () => {
    const rec = flight({
      fromLat: 51.47, fromLon: -0.45, fromTz: 'Europe/London', fromIata: 'LHR',
      toLat: 51.47, toLon: -0.45, toTz: 'Europe/London', toIata: 'LHR',
      depUTC: '2026-03-20T10:00:00Z', arrUTC: '2026-03-20T10:00:00Z',
    });
    const m = C(rec);
    assertFlightInvariants(m, rec);
    expect(m.prayers.filter(p => p.status === 'inflight').length).toBe(0);
    expect(m.durationMin).toBe(0);
  });

  it('45-minute midday hop (LHR→MAN): nothing falls aloft, lists still full', () => {
    const rec = flight({
      fromLat: 51.47, fromLon: -0.45, fromTz: 'Europe/London', fromIata: 'LHR',
      toLat: 53.35, toLon: -2.27, toTz: 'Europe/London', toIata: 'MAN',
      depUTC: '2026-03-20T14:00:00Z', arrUTC: '2026-03-20T14:45:00Z',
    });
    const m = C(rec);
    assertFlightInvariants(m, rec);
    expect(m.prayers.map(p => [p.key, p.status])).toEqual([
      ['fajr', 'before'], ['dhuhr', 'before'], ['asr', 'after'], ['maghrib', 'after'],
    ]);
  });
});

describe('options plumbing through compute()', () => {
  it('hanafi madhab shifts Asr later end-to-end, not just in daySchedule', () => {
    const shafi = C(lookup('SV124'), 'mwl', 'shafi').prayers.find(p => p.key === 'asr');
    const hanafi = C(lookup('SV124'), 'mwl', 'hanafi').prayers.find(p => p.key === 'asr');
    expect(hanafi.ms).toBeGreaterThan(shafi.ms);
  });

  it('a record cruiseAltFt is respected: higher cruise → later real Maghrib dip', () => {
    const at = (alt) => C(Object.assign({}, lookup('SV124'), { cruiseAltFt: alt }));
    const lo = at(38000), hi = at(45000);
    expect(hi.cruiseAltFt).toBe(45000);
    const mLo = lo.prayers.find(p => p.key === 'maghrib' && p.status === 'inflight');
    const mHi = hi.prayers.find(p => p.key === 'maghrib' && p.status === 'inflight');
    expect(mHi.ms).toBeGreaterThan(mLo.ms);
  });
});
