/* The engine must compute identical prayer instants regardless of the DEVICE
   timezone. adhan reads the calendar day off the Date with LOCAL getters, so a
   UTC-built noon can tip to the adjacent solar day on devices past a ±12 h
   offset (e.g. Pacific/Auckland), drifting every prayer by a day's solar change
   (~1–4 min). Guards engine.js ptFor()'s local-component date construction.
   NOTE: CI runs in UTC, where the bug is invisible — this test FORCES the tz. */
import { describe, it, expect, afterEach } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { flight } from './helpers.js';

// Equinox date: day length changes fastest, so a one-day calendar drift moves
// the times by the largest, most unambiguous amount.
const REC = flight({
  fromLat: 51.47, fromLon: -0.45, fromTz: 'Europe/London', fromIata: 'LHR',
  toLat: 21.68, toLon: 39.16, toTz: 'Asia/Riyadh', toIata: 'JED',
  depUTC: '2026-03-20T10:00:00Z', arrUTC: '2026-03-20T16:30:00Z',
});

const ORIG_TZ = process.env.TZ;
afterEach(() => {
  if (ORIG_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIG_TZ;
});

function prayerMsUnder(tz) {
  process.env.TZ = tz;
  return compute(REC, { method: 'mwl', madhab: 'shafi' }).prayers.map(p => p.ms);
}

describe('device-timezone independence (adhan local-getter date drift)', () => {
  it('Pacific/Auckland (UTC+12/13) computes the same prayer instants as UTC', () => {
    const utc = prayerMsUnder('UTC');
    const auckland = prayerMsUnder('Pacific/Auckland');
    expect(auckland).toEqual(utc);
  });
});
