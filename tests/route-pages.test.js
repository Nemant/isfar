// Route-page build data — wave-1 list integrity + computed content for the SEO pages.
// The LHR→JED pins mirror REAL engine output (observed, never forced).
import { describe, it, expect } from 'vitest';
import { CORRIDORS, WAVE1_ROUTES } from '../src/lib/routes-wave1.js';
import {
  resolveAirport, cityEn, estimateDurationMin, routeFacts, seasonalSchedule,
  routeSlug, SEASON_DATES, DEP_TIMES, ROUTE_METHOD
} from '../src/lib/route-pages.js';

describe('routes-wave1 list', () => {
  it('has 48 directional routes — every corridor both ways, all airports resolve, slugs unique', () => {
    expect(WAVE1_ROUTES.length).toBe(48);
    expect(CORRIDORS.length * 2).toBe(WAVE1_ROUTES.length);
    const slugs = new Set();
    for (const r of WAVE1_ROUTES) {
      expect(resolveAirport(r.from), `missing airport ${r.from}`).toBeTruthy();
      expect(resolveAirport(r.to), `missing airport ${r.to}`).toBeTruthy();
      slugs.add(routeSlug(r.from, r.to));
    }
    expect(slugs.size).toBe(48);
  });

  it('every wave-1 airport has a clean display-city override or sane dataset city', () => {
    for (const r of WAVE1_ROUTES) {
      for (const code of [r.from, r.to]) {
        const c = cityEn(resolveAirport(code));
        expect(c, code).toBeTruthy();
        expect(c, code).not.toMatch(/\(|,/); // no "Paris (Roissy…)" / "Manchester, Greater…"
      }
    }
  });
});

describe('route facts — LHR→JED', () => {
  const from = resolveAirport('LHR'), to = resolveAirport('JED');
  const f = routeFacts(from, to);

  it('distance and duration are sane', () => {
    expect(f.distanceKm).toBeGreaterThan(4500);
    expect(f.distanceKm).toBeLessThan(5100);
    expect(f.durationMin).toBe(estimateDurationMin(from, to));
    expect(f.durationMin).toBeGreaterThan(5 * 60);
    expect(f.durationMin).toBeLessThan(8 * 60);
    expect(f.durationMin % 5).toBe(0);
  });

  it('summer tz shift is +2 (BST → AST) and qibla bearings point sensibly', () => {
    expect(f.tzShiftHours).toBe(2);
    expect(f.qiblaFrom).toBeGreaterThan(100); // London ≈ 119°
    expect(f.qiblaFrom).toBeLessThan(130);
    expect(f.qiblaTo).toBeGreaterThan(80);    // Jeddah faces ~E toward Makkah (observed 112°)
    expect(f.qiblaTo).toBeLessThan(130);
  });
});

describe('seasonal schedule — LHR→JED', () => {
  const from = resolveAirport('LHR'), to = resolveAirport('JED');
  const s = seasonalSchedule(from, to);

  it('covers every season × departure cell', () => {
    expect(s.length).toBe(SEASON_DATES.length * DEP_TIMES.length);
    for (const cell of s) {
      expect(SEASON_DATES).toContain(cell.dateISO);
      expect(DEP_TIMES).toContain(cell.depTime);
    }
  });

  it('June morning departure prays Dhuhr and Asr aloft (pinned to engine output)', () => {
    const juneAM = s.find((c) => c.dateISO === '2026-06-21' && c.depTime === '09:00');
    expect(juneAM.inflight).toEqual(['Dhuhr', 'Asr']);
  });

  it('uses the stated method', () => {
    expect(ROUTE_METHOD.key).toBe('mwl');
  });
});

describe('all-route invariants', () => {
  it('every route × cell yields a coherent window — the display model caps before/after at ~2', () => {
    for (const r of WAVE1_ROUTES) {
      const s = seasonalSchedule(resolveAirport(r.from), resolveAirport(r.to));
      for (const cell of s) {
        const label = `${r.from}-${r.to} ${cell.dateISO} ${cell.depTime}`;
        // an empty inflight list is legitimate (e.g. JED→LHR red-eye departs
        // after Isha, lands before Fajr) — but the window around the flight
        // must always be there
        expect(cell.before.length, label).toBeGreaterThanOrEqual(1);
        expect(cell.after.length, label).toBeGreaterThanOrEqual(1);
        expect(cell.before.length + cell.inflight.length + cell.after.length, label).toBeGreaterThanOrEqual(4);
        for (const name of [...cell.before, ...cell.inflight, ...cell.after]) {
          expect(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'], label).toContain(name);
        }
      }
    }
  });
});
