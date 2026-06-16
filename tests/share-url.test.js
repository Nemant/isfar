/* URL ↔ record codec for shareable results. Round-trip must reproduce an
   equivalent record so compute() renders identically from a shared link. */
import { describe, it, expect } from 'vitest';
import data from '../src/assets/airports.json';
import { airportFromRow, routeRecord } from '../src/lib/airports.js';
import {
  recordToParams, recordToUrl, parseShareParams, routeParamsToRecord
} from '../src/lib/share-url.js';

const LIST = data.airports;
const find = (iata) => airportFromRow(LIST.find((a) => a[0] === iata));

describe('flight records', () => {
  it('encodes flight + date only (no method, no times)', () => {
    const rec = { found: true, code: 'SV124', dateISO: '2026-06-16',
      from: { iata: 'LHR', tz: 'Europe/London' }, to: { iata: 'JED', tz: 'Asia/Riyadh' } };
    expect(recordToParams(rec)).toEqual({ flight: 'SV124', date: '2026-06-16' });
  });

  it('recordToUrl builds an absolute root URL', () => {
    const rec = { found: true, code: 'SV124', dateISO: '2026-06-16', from: {}, to: {} };
    expect(recordToUrl(rec, 'https://isfar.app'))
      .toBe('https://isfar.app/?flight=SV124&date=2026-06-16');
  });

  it('recordToParams returns null for an unresolved record', () => {
    expect(recordToParams({ found: false, code: 'XX1' })).toBeNull();
  });
});

describe('route records round-trip', () => {
  it('params → record reproduces depUTC/arrUTC/iata', () => {
    const orig = routeRecord({
      from: find('LHR'), to: find('JED'),
      dateISO: '2026-06-16', depTime: '09:30', arrTime: '18:05',
    });
    const params = recordToParams(orig);
    expect(params).toEqual({ from: 'LHR', to: 'JED', date: '2026-06-16', dep: '09:30', arr: '18:05' });

    const parsed = parseShareParams('?' + new URLSearchParams(params).toString());
    expect(parsed).toEqual({ kind: 'route', from: 'LHR', to: 'JED', date: '2026-06-16', dep: '09:30', arr: '18:05' });

    const rebuilt = routeParamsToRecord(parsed, LIST);
    expect(rebuilt.from.iata).toBe(orig.from.iata);
    expect(rebuilt.to.iata).toBe(orig.to.iata);
    expect(rebuilt.depUTC).toBe(orig.depUTC);
    expect(rebuilt.arrUTC).toBe(orig.arrUTC);
  });

  it('routeParamsToRecord returns null for an unknown IATA', () => {
    expect(routeParamsToRecord(
      { from: 'ZZZ', to: 'JED', date: '2026-06-16', dep: '09:30', arr: '18:05' }, LIST)).toBeNull();
  });
});

describe('parseShareParams', () => {
  it('parses a flight link', () => {
    expect(parseShareParams('?flight=sv124&date=2026-06-16'))
      .toEqual({ kind: 'flight', code: 'SV124', date: '2026-06-16' });
  });
  it('returns null for legacy from/to-only prefill (no times)', () => {
    expect(parseShareParams('?from=LHR&to=JED')).toBeNull();
  });
  it('returns null for junk', () => {
    expect(parseShareParams('?foo=bar')).toBeNull();
  });
  it('rejects same-airport route', () => {
    expect(parseShareParams('?from=LHR&to=LHR&date=2026-06-16&dep=09:30&arr=10:30')).toBeNull();
  });
});
