import { describe, it, expect } from 'vitest';
import { parseBCBP, julianToDateISO } from '../src/lib/bcbp.js';

// Canonical IATA BCBP "M" string, single leg, built to exact field offsets:
// M | legs=1 | name(20) | E | PNR(7)=ABC123␠ | from=YUL | to=FRA | carrier=AC␠
// | flight=0834␠ | julian=226 | F | seat=001A | seq=0025␠ | status=1 | varsize=00
const M1 =
  'M' + '1' + 'DESMARAIS/LUC       ' + 'E' + 'ABC123 ' +
  'YUL' + 'FRA' + 'AC ' + '0834 ' + '226' + 'F' + '001A' + '0025 ' + '1' + '00';

describe('julianToDateISO', () => {
  it('maps day-of-year to this year when still upcoming', () => {
    expect(julianToDateISO(226, new Date(2026, 0, 1))).toBe('2026-08-14');
  });
  it('rolls to next year when the day already passed', () => {
    // today = 28 Dec 2026; day 5 → 5 Jan 2027
    expect(julianToDateISO(5, new Date(2026, 11, 28))).toBe('2027-01-05');
  });
  it('stays this year for a still-future late day', () => {
    // today = 3 Jan 2026; day 360 → 26 Dec 2026
    expect(julianToDateISO(360, new Date(2026, 0, 3))).toBe('2026-12-26');
  });
  it('is leap-year aware (day 366 in a leap year)', () => {
    expect(julianToDateISO(366, new Date(2024, 0, 1))).toBe('2024-12-31');
  });
  it('rejects out-of-range days', () => {
    expect(julianToDateISO(0)).toBe(null);
    expect(julianToDateISO(400)).toBe(null);
  });
});

describe('parseBCBP', () => {
  it('parses a single-leg M pass', () => {
    expect(parseBCBP(M1, new Date(2026, 0, 1))).toEqual({
      code: 'AC834', dateISO: '2026-08-14', fromIata: 'YUL', toIata: 'FRA',
    });
  });
  it('uses the first leg of a multi-leg pass', () => {
    const multi = 'M' + '2' + M1.slice(2); // flip the leg count, same first-leg bytes
    expect(parseBCBP(multi, new Date(2026, 0, 1)).code).toBe('AC834');
  });
  it('strips leading zeros and keeps an alpha flight suffix', () => {
    // replace flight field "0834 " (offsets 40-44) with "0835A"
    const suffix = M1.slice(0, 39) + '0835A' + M1.slice(44);
    expect(parseBCBP(suffix, new Date(2026, 0, 1)).code).toBe('AC835A');
  });
  it('returns null for non-M / too-short / malformed input', () => {
    expect(parseBCBP('')).toBe(null);
    expect(parseBCBP('X1' + M1.slice(2))).toBe(null);            // not format M
    expect(parseBCBP(M1.slice(0, 40))).toBe(null);               // too short
    const badFrom = M1.slice(0, 30) + '1UL' + M1.slice(33);       // from not IATA
    expect(parseBCBP(badFrom)).toBe(null);
  });
});
