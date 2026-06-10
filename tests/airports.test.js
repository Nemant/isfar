/* Route mode — airport search + record synthesis. The synthesized record must
   be byte-compatible with the /api/flight success shape (worker/CONTRACT.md)
   so engine.compute() consumes it unchanged. */
import { describe, it, expect } from 'vitest';
import { searchAirports, civilToUTC, routeRecord, airportFromRow } from '../src/lib/airports.js';
import data from '../src/assets/airports.json';

const LIST = data.airports;
const find = (iata) => airportFromRow(LIST.find((a) => a[0] === iata));

describe('searchAirports', () => {
  it('exact IATA match ranks first', () => {
    expect(searchAirports(LIST, 'jed')[0][0]).toBe('JED');
  });
  it('city prefix works', () => {
    expect(searchAirports(LIST, 'jeddah').some((a) => a[0] === 'JED')).toBe(true);
  });
  it('caps results', () => {
    expect(searchAirports(LIST, 'a').length).toBeLessThanOrEqual(6);
  });
  it('empty query → empty', () => {
    expect(searchAirports(LIST, ' ')).toEqual([]);
  });
});

describe('civilToUTC', () => {
  it('plain conversion with DST offset (London BST)', () => {
    expect(civilToUTC('2026-06-06', '14:20', 'Europe/London')).toBe(Date.parse('2026-06-06T13:20:00Z'));
  });
  it('winter offset (London GMT)', () => {
    expect(civilToUTC('2026-01-10', '14:20', 'Europe/London')).toBe(Date.parse('2026-01-10T14:20:00Z'));
  });
  it('US spring-forward gap resolves within an hour of intent', () => {
    const ms = civilToUTC('2026-03-08', '02:30', 'America/New_York'); // nonexistent local time
    expect(Math.abs(ms - Date.parse('2026-03-08T07:00:00Z'))).toBeLessThanOrEqual(3600000);
  });
});

describe('routeRecord', () => {
  const LHR = find('LHR'), JED = find('JED'), LAX = find('LAX'), NRT = find('NRT'), PER = find('PER');

  it('reproduces SV124 from its itinerary times', () => {
    const r = routeRecord({ from: LHR, to: JED, dateISO: '2026-06-06', depTime: '14:20', arrTime: '23:05' });
    expect(r.found).toBe(true);
    expect(r.routeMode).toBe(true);
    expect(r.code).toBe('LHR→JED');
    expect(r.depUTC).toBe('2026-06-06T13:20:00.000Z');
    expect(r.arrUTC).toBe('2026-06-06T20:05:00.000Z');
    expect(r.from.tz).toBe('Europe/London');
    expect(r.from.zone).toBe('BST');
    expect(r.to.gmt).toMatch(/GMT\+3/);
    expect(r.date).toContain('June 2026');
  });

  it('red-eye rolls the arrival to the next day', () => {
    const r = routeRecord({ from: LHR, to: JED, dateISO: '2026-06-06', depTime: '22:00', arrTime: '04:45' });
    expect(Date.parse(r.arrUTC)).toBeGreaterThan(Date.parse(r.depUTC));
    expect(r.arrUTC.slice(0, 10)).toBe('2026-06-07');
  });

  it('westbound across the date line can land the previous civil day', () => {
    // dep Tokyo 00:30 local 6 Jun (= 5 Jun 15:30Z); arr LA 17:00 local on 5 Jun (= 6 Jun 00:00Z)
    const r = routeRecord({ from: NRT, to: LAX, dateISO: '2026-06-06', depTime: '00:30', arrTime: '17:00' });
    expect(Date.parse(r.arrUTC)).toBeGreaterThan(Date.parse(r.depUTC));
    expect(Date.parse(r.arrUTC) - Date.parse(r.depUTC)).toBeLessThan(20 * 3600000);
  });

  it('long eastbound (LHR→PER style) keeps a sane 17h duration', () => {
    const r = routeRecord({ from: LHR, to: PER, dateISO: '2026-06-06', depTime: '13:00', arrTime: '13:00' });
    expect(Date.parse(r.arrUTC) - Date.parse(r.depUTC)).toBe(17 * 3600000);
  });

  it('flags implausible durations instead of blocking', () => {
    const r = routeRecord({ from: LHR, to: JED, dateISO: '2026-06-06', depTime: '14:20', arrTime: '14:00' });
    expect(r.durationWarn).toBe(true);   // ~23.7h LHR→JED
  });

  it('the engine accepts the synthesized record verbatim', async () => {
    const { compute } = await import('../src/lib/engine.js');
    const r = routeRecord({ from: LHR, to: JED, dateISO: '2026-06-06', depTime: '14:20', arrTime: '23:05' });
    const m = compute(r, { method: 'isna', madhab: 'shafi' });
    expect(m.prayers.length).toBeGreaterThan(0);
    expect(m.prayers.filter((p) => p.status === 'after')).toHaveLength(2);
  });
});
