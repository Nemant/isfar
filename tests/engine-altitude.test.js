/* Cruise-altitude estimate: aircraft type (the dominant signal) + trip distance
   (short legs never reach the ceiling) → the dip's altitude input when the
   record carries no real per-flight value. The turboprop case is the one the
   bare 38k default got badly wrong (Fajr-ending sunrise shown minutes early). */
import { describe, it, expect } from 'vitest';
import { compute, ISFAR_TEST } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';

const { estimateCruiseFt } = ISFAR_TEST;
const C = (rec, method = 'mwl') => compute(rec, { method, madhab: 'shafi' });

describe('estimateCruiseFt(aircraftModel, distanceNm)', () => {
  it('long-haul widebodies cruise high (≈41k)', () => {
    expect(estimateCruiseFt('Boeing 787-9', 4000)).toBe(41000);
    expect(estimateCruiseFt('Airbus A350-900', 5000)).toBe(41000);
    expect(estimateCruiseFt('Airbus A380-800', 6000)).toBe(41000);
    expect(estimateCruiseFt('Boeing 777-300ER', 5000)).toBe(41000);
  });

  it('turboprops cruise low (≈25k) — the case 38k got badly wrong', () => {
    expect(estimateCruiseFt('De Havilland Canada DHC-8-400', 600)).toBe(25000);
    expect(estimateCruiseFt('ATR 72-600', 700)).toBe(25000);
  });

  it('regional jets sit just below narrowbody (≈37k)', () => {
    expect(estimateCruiseFt('Embraer E175', 1200)).toBe(37000);
    expect(estimateCruiseFt('Bombardier CRJ900', 1100)).toBe(37000);
  });

  it('narrowbodies and unknown models fall back to the 38k default at cruise range', () => {
    expect(estimateCruiseFt('Airbus A320', 1500)).toBe(38000);
    expect(estimateCruiseFt('Boeing 737-800', 1500)).toBe(38000);
    expect(estimateCruiseFt('—', 4000)).toBe(38000);
    expect(estimateCruiseFt(undefined, 4000)).toBe(38000);
  });

  it('short legs are clamped — no aircraft reaches its ceiling on a brief hop', () => {
    expect(estimateCruiseFt('Boeing 777-300ER', 200)).toBe(28000); // widebody, <250 nm
    expect(estimateCruiseFt('Airbus A320', 400)).toBe(33000);      // narrowbody, <500 nm
    expect(estimateCruiseFt('Airbus A320', 800)).toBe(36000);      // narrowbody, <1000 nm
  });
});

describe('compute() wires the estimate into the dip', () => {
  it('uses the estimate when the record has no explicit cruiseAltFt (SV124 787 → 41000)', () => {
    expect(C(lookup('SV124')).cruiseAltFt).toBe(41000);
  });

  it('an explicit record cruiseAltFt still overrides the estimate', () => {
    expect(C(Object.assign({}, lookup('SV124'), { cruiseAltFt: 45000 })).cruiseAltFt).toBe(45000);
  });
});
