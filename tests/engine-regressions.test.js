/* One test per confirmed bug from the 2026-06-10 high-latitude audit.
   Each names the failure mode it kills. */
import { it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';
import { flight } from './helpers.js';

const C = (f, method = 'mwl') => compute(f, { method, madhab: 'shafi' });

it('refraction fringe: evening HEL→RVN mid-June keeps Maghrib (was silently dropped)', () => {
  // Arrive Rovaniemi (66.56°N — adhan sees no sunset there in mid-June even
  // though the geometric test says a cycle exists) just before the evening:
  // Maghrib must appear among the next prayers, as a flagged borrow.
  const m = C(flight({ fromLat: 60.32, fromLon: 24.96, fromTz: 'Europe/Helsinki', fromIata: 'HEL',
                       toLat: 66.56, toLon: 25.83, toTz: 'Europe/Helsinki', toIata: 'RVN',
                       depUTC: '2026-06-15T16:00:00Z', arrUTC: '2026-06-15T17:20:00Z' }));
  const all = m.prayers.map(p => p.key);
  expect(all).toContain('maghrib');
  const maghrib = m.prayers.find(p => p.key === 'maghrib');
  expect(maghrib.estimated).toBe(true);
});

it('late-evening arrival: SV124 (arr 23:05) shows 2 after-arrival prayers incl. next-day Fajr', () => {
  const m = C(lookup('SV124'));
  const after = m.prayers.filter(p => p.status === 'after');
  expect(after.length).toBe(2);
  expect(after.map(p => p.key)).toContain('fajr');
});

it('northbound evening cliff: FRA→CPH keeps Isha somewhere in the journey', () => {
  const m = C(flight({ fromLat: 50.03, fromLon: 8.56, fromTz: 'Europe/Berlin', fromIata: 'FRA',
                       toLat: 55.62, toLon: 12.65, toTz: 'Europe/Copenhagen', toIata: 'CPH',
                       depUTC: '2026-06-06T21:30:00Z', arrUTC: '2026-06-06T22:50:00Z' }));
  expect(m.prayers.map(p => p.key)).toContain('isha');
});

it('pre-dawn southbound cliff: LHR→MAD red-eye keeps Fajr', () => {
  const m = C(flight({ fromLat: 51.47, fromLon: -0.45, fromTz: 'Europe/London', fromIata: 'LHR',
                       toLat: 40.47, toLon: -3.57, toTz: 'Europe/Madrid', toIata: 'MAD',
                       depUTC: '2026-06-06T01:00:00Z', arrUTC: '2026-06-06T03:25:00Z' }));
  expect(m.prayers.map(p => p.key)).toContain('fajr');
});

it('polar winter: no middle-of-night Asr capture; an Asr survives (TRD→TOS)', () => {
  const m = C(flight({ fromLat: 63.46, fromLon: 10.92, fromTz: 'Europe/Oslo', fromIata: 'TRD',
                       toLat: 69.68, toLon: 18.92, toTz: 'Europe/Oslo', toIata: 'TOS',
                       depUTC: '2026-12-26T08:00:00Z', arrUTC: '2026-12-26T09:55:00Z' }));
  const asrs = m.prayers.filter(p => p.key === 'asr');
  expect(asrs.length).toBeGreaterThan(0);
  const dhuhr = m.prayers.find(p => p.key === 'dhuhr');
  if (dhuhr) {
    for (const a of asrs) {
      expect(Math.abs(a.ms - dhuhr.ms)).toBeLessThan(8 * 3600000);
    }
  }
});

it('red-eye departure: JED 01:00 local still shows before-departure prayers', () => {
  const m = C(flight({ fromLat: 21.68, fromLon: 39.16, fromTz: 'Asia/Riyadh', fromIata: 'JED',
                       toLat: 51.47, toLon: -0.45, toTz: 'Europe/London', toIata: 'LHR',
                       depUTC: '2026-06-06T22:00:00Z', arrUTC: '2026-06-07T05:00:00Z' }));
  expect(m.prayers.filter(p => p.status === 'before').length).toBe(2);
});

it('origin no-cycle gets a skyNote banner (TOS→OSL June)', () => {
  const m = C(flight({ fromLat: 69.68, fromLon: 18.92, fromTz: 'Europe/Oslo', fromIata: 'TOS',
                       toLat: 60.19, toLon: 11.10, toTz: 'Europe/Oslo', toIata: 'OSL',
                       depUTC: '2026-06-06T10:00:00Z', arrUTC: '2026-06-06T11:55:00Z' }));
  expect(m.skyNotes.length).toBe(1);
  expect(m.skyNotes[0].place).toBe('origin');
  expect(m.skyNotes[0].kind).toBe('midnightsun');
});

it('destination no-cycle skyNote + no dip on a borrowed maghrib (DY394)', () => {
  const m = compute(lookup('DY394'), { method: 'isna', madhab: 'shafi' });
  expect(m.skyNotes.length).toBe(1);
  expect(m.skyNotes[0].place).toBe('destination');
  expect(m.skyNotes[0].kind).toBe('midnightsun');
  // no horizon dip on a borrowed maghrib: shown ms stays a whole adhan minute
  const maghrib = m.prayers.find(p => p.key === 'maghrib' && p.status === 'inflight');
  if (maghrib && maghrib.estimated) expect(maghrib.ms % 60000).toBe(0);
});

it('61–66.5°N June ordering: never Isha before Maghrib (OSL→TRD)', () => {
  const m = C(flight({ fromLat: 60.19, fromLon: 11.10, fromTz: 'Europe/Oslo', fromIata: 'OSL',
                       toLat: 63.46, toLon: 10.92, toTz: 'Europe/Oslo', toIata: 'TRD',
                       depUTC: '2026-06-21T14:00:00Z', arrUTC: '2026-06-21T15:00:00Z' }));
  const isha = m.prayers.find(p => p.key === 'isha');
  const maghrib = m.prayers.find(p => p.key === 'maghrib');
  if (isha && maghrib) expect(isha.ms).toBeGreaterThan(maghrib.ms);
});

it('boundary-date flag consistency: estimated ⇔ estimateBasis (OSL→LYR polar edge)', () => {
  const m = C(flight({ fromLat: 60.19, fromLon: 11.10, fromTz: 'Europe/Oslo', fromIata: 'OSL',
                       toLat: 78.25, toLon: 15.47, toTz: 'Arctic/Longyearbyen', toIata: 'LYR',
                       depUTC: '2026-02-19T19:30:00Z', arrUTC: '2026-02-19T22:30:00Z' }));
  for (const p of m.prayers) {
    expect(!!p.estimateBasis).toBe(p.estimated);
  }
});

it("moonsighting at CPH winter: unflagged (the method's own rule)", () => {
  const m = C(flight({ fromLat: 55.68, fromLon: 12.57, fromTz: 'Europe/Copenhagen', fromIata: 'CPH',
                       toLat: 51.47, toLon: -0.45, toTz: 'Europe/London', toIata: 'LHR',
                       depUTC: '2026-01-15T10:00:00Z', arrUTC: '2026-01-15T12:00:00Z' }), 'moonsighting');
  const before = m.prayers.filter(p => p.status === 'before');
  expect(before.length).toBeGreaterThan(0);
  for (const p of before) expect(p.estimated).toBe(false);
});
