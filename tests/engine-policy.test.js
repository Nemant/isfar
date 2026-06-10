/* The 3-rule high-latitude policy, tested at the daySchedule level.
   Rule 1: the method's real angle wherever the sky reaches it (any latitude).
   Rule 2: angle unreachable but the sun still rises and sets — ANY latitude →
           1/7 of the LOCAL night (Isha after the real sunset, Fajr before the
           real sunrise, by construction).
   Rule 3: no day/night cycle at all (midnight sun / polar night) → the whole
           night cluster (maghrib, isha, fajr, sunrise) from the 60° sky. */
import { describe, it, expect } from 'vitest';
import { ISFAR_TEST } from '../src/lib/engine.js';
import { angleReachable, rawPT, validMs } from './helpers.js';

const { daySchedule, makeParams } = ISFAR_TEST;
const T = (iso) => Date.parse(iso);
const KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

function sched(lat, lon, iso, method = 'mwl', madhab = 'shafi') {
  return daySchedule(lat, lon, T(iso), makeParams(method, madhab), method);
}

describe('rule 1 — real angle at the true position', () => {
  it('mid-latitude equinox: everything real, times = adhan', () => {
    const s = sched(51.47, -0.45, '2026-03-20T12:00:00Z');
    const pt = rawPT(51.47, -0.45, T('2026-03-20T12:00:00Z'), makeParams('mwl', 'shafi'));
    for (const k of KEYS) {
      expect(s[k].estimated, k).toBe(false);
      expect(s[k].ms, k).toBe(validMs(pt[k]));
    }
  });

  it('62°N in December (guide worked example): isha is real', () => {
    const s = sched(62.0, 6.0, '2026-12-21T12:00:00Z');
    expect(s.isha.source).toBe('angle');
    expect(s.isha.estimated).toBe(false);
  });
});

describe('rule 2 — 1/7 of the local night (any latitude with a cycle)', () => {
  it('London June: fajr+isha portioned, flagged, sun events real', () => {
    const s = sched(51.47, -0.45, '2026-06-06T12:00:00Z');
    expect(s.fajr.source).toBe('seventh');
    expect(s.isha.source).toBe('seventh');
    expect(s.fajr.estimated).toBe(true);
    expect(s.maghrib.source).toBe('method');
    expect(s.maghrib.estimated).toBe(false);
  });

  it('64°N June (the audited band): LOCAL sevenths, sun events real — never a daylight Maghrib', () => {
    const s = sched(64.0, 18.0, '2026-06-21T12:00:00Z');
    expect(s.fajr.source).toBe('seventh');
    expect(s.isha.source).toBe('seventh');
    expect(s.maghrib.source).toBe('method');
    expect(s.maghrib.estimated).toBe(false);
    expect(s.sunrise.estimated).toBe(false);
    // the coherence the 60° cluster could not give: true to the visible sky
    expect(s.isha.ms).toBeGreaterThan(s.maghrib.ms);       // never before the real sunset
    expect(s.fajr.ms).toBeLessThan(s.sunrise.ms);          // never after the real sunrise
  });

  it('Akureyri 65.66°N at solstice (37-min night, the worst airport case): coherent and prayable', () => {
    const s = sched(65.659, -18.072, '2026-06-21T12:00:00Z');
    expect(s.kind).toBe('normal');
    expect(s.isha.source).toBe('seventh');
    expect(s.isha.ms).toBeGreaterThan(s.maghrib.ms);
    expect(s.fajr.ms).toBeLessThan(s.sunrise.ms);
  });
});

describe('rule 3 — the 60° floor, ONLY where no day/night cycle exists', () => {
  it('67°N June (no sunset): whole night cluster from 60°, dhuhr/asr local real', () => {
    const s = sched(67.0, 18.0, '2026-06-21T12:00:00Z');
    expect(s.kind).toBe('midnightsun');
    for (const k of ['fajr', 'isha', 'maghrib', 'sunrise']) {
      expect(s[k].source, k).toBe('borrow60');
      expect(s[k].estimated, k).toBe(true);
    }
    expect(s.dhuhr.estimated).toBe(false);
    expect(s.asr.estimated).toBe(false);
    expect(s.isha.ms).toBeGreaterThan(s.maghrib.ms);
    expect(s.fajr.ms).toBeLessThan(s.sunrise.ms);
  });

  it('cluster times equal the 60° seventh-rule schedule at the same longitude', () => {
    const s = sched(67.0, 18.0, '2026-06-21T12:00:00Z');
    const s60 = sched(60.0, 18.0, '2026-06-21T12:00:00Z');
    expect(s.maghrib.ms).toBe(s60.maghrib.ms);
    expect(s.isha.ms).toBe(s60.isha.ms);
  });
});

describe('no-cycle override (observed from adhan, not geometry)', () => {
  it('Tromsø midnight sun: cluster borrowed, dhuhr+asr real local', () => {
    const s = sched(69.65, 18.92, '2026-06-06T12:00:00Z');
    expect(s.kind).toBe('midnightsun');
    expect(s.maghrib.source).toBe('borrow60');
    expect(s.dhuhr.estimated).toBe(false);
    expect(s.asr.estimated).toBe(false);
  });

  it('Tromsø polar night: dhuhr keeps local transit but is flagged; asr borrowed', () => {
    const s = sched(69.65, 18.92, '2026-12-21T12:00:00Z');
    expect(s.kind).toBe('polarnight');
    expect(s.dhuhr.source).toBe('method');
    expect(s.dhuhr.estimated).toBe(true);
    expect(s.asr.source).toBe('borrow60');
  });

  it('refraction fringe (Rovaniemi June): adhan has no sunset → borrowed, NOT dropped', () => {
    const s = sched(66.56, 25.83, '2026-06-21T12:00:00Z');
    expect(s.maghrib.ms).not.toBeNull();          // the audit's silently-vanished Maghrib
    expect(s.maghrib.estimated).toBe(true);
  });
});

describe('method specials', () => {
  it('moonsighting ≥55° trusted: adhan output verbatim, unflagged', () => {
    const ref = T('2026-01-15T12:00:00Z');
    const s = sched(55.68, 12.57, '2026-01-15T12:00:00Z', 'moonsighting');
    const pt = rawPT(55.68, 12.57, ref, makeParams('moonsighting', 'shafi'));
    expect(s.fajr.ms).toBe(validMs(pt.fajr));
    expect(s.fajr.estimated).toBe(false);
    expect(s.fajr.source).toBe('method');
  });

  it('ummalqura interval isha: real wherever a cycle exists; joins the cluster without one', () => {
    const low = sched(58.0, 18.0, '2026-06-21T12:00:00Z', 'ummalqura');
    expect(low.isha.source).toBe('method');                  // sunset + 90, real
    expect(low.isha.ms - low.maghrib.ms).toBe(90 * 60000);
    const band = sched(64.0, 18.0, '2026-06-21T12:00:00Z', 'ummalqura');
    expect(band.isha.source).toBe('method');                 // local sunset + 90, still real
    expect(band.isha.ms - band.maghrib.ms).toBe(90 * 60000);
    const polar = sched(67.0, 18.0, '2026-06-21T12:00:00Z', 'ummalqura');
    expect(polar.isha.source).toBe('borrow60');              // whole cluster
    expect(polar.isha.ms - polar.maghrib.ms).toBe(90 * 60000); // 90 min after the borrowed sunset
  });
});

describe('methods with sunrise adjustments (Turkey −7, Dubai −3) — detection must strip them', () => {
  it('Turkey at 55°N midsummer: fajr+isha are flagged seventh, not fake "angle"', () => {
    const s = sched(55.0, 10.0, '2026-06-21T12:00:00Z', 'turkey');
    expect(s.fajr.source).toBe('seventh');
    expect(s.isha.source).toBe('seventh');
    expect(s.fajr.estimated).toBe(true);
  });
  it('Dubai at 51.5°N midsummer: substitution detected', () => {
    const s = sched(51.5, 10.0, '2026-06-21T12:00:00Z', 'dubai');
    expect(s.fajr.source).toBe('seventh');
    expect(s.fajr.estimated).toBe(true);
  });
  it('Turkey detection matches adhan ground truth across the grid', () => {
    const params = makeParams('turkey', 'shafi');
    const bad = [];
    for (let lat = 42; lat <= 60; lat += 1.5) {
      for (let m = 0; m < 12; m++) {
        const iso = `2026-${String(m + 1).padStart(2, '0')}-15T12:00:00Z`;
        const s = daySchedule(lat, 10, T(iso), params, 'turkey');
        for (const [k, angle] of [['fajr', 18], ['isha', 17]]) {
          const truth = angleReachable(lat, 10, new Date(iso), angle);
          if (truth !== (s[k].source === 'angle')) bad.push(`${lat} ${iso} ${k}`);
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe('ordering holds for every method, both madhabs, including fringe latitudes', () => {
  // Tehran's angle-based maghrib (4.5°) lands after sunset; the seventh isha and
  // the borrowed cluster must stay after it. Fringe lats target the bands where
  // borrowed/local mixing once inverted Asr/Maghrib.
  const LATS = [-85.5, -85, -80.5, -72.5, -66.3, -60.5, -59.5, -58.5, -40, 0, 40,
                58.5, 59, 59.5, 60, 60.5, 64, 66.3, 72.5, 80.5, 85, 85.5];
  const DATES = ['2026-03-20', '2026-05-10', '2026-06-21', '2026-09-22', '2026-11-10', '2026-12-21'];
  for (const method of ['mwl', 'isna', 'ummalqura', 'tehran', 'moonsighting', 'turkey']) {
    for (const madhab of ['shafi', 'hanafi']) {
      it(`${method}/${madhab}`, () => {
        const params = makeParams(method, madhab);
        for (const lat of LATS) {
          for (const iso of DATES) {
            const s = daySchedule(lat, 18, T(iso + 'T12:00:00Z'), params, method);
            const msg = `lat=${lat} ${iso}`;
            expect(s.fajr.ms, msg).toBeLessThan(s.sunrise.ms);
            expect(s.sunrise.ms, msg).toBeLessThanOrEqual(s.dhuhr.ms);
            expect(s.dhuhr.ms, msg).toBeLessThan(s.asr.ms);
            expect(s.asr.ms, msg).toBeLessThan(s.maghrib.ms);
            expect(s.maghrib.ms, msg).toBeLessThan(s.isha.ms);
          }
        }
      });
    }
  }
});

describe('hanafi asr', () => {
  it('is later than the standard asr and stays real at mid-latitudes', () => {
    const shafi = sched(51.47, -0.45, '2026-03-20T12:00:00Z', 'mwl', 'shafi');
    const hanafi = sched(51.47, -0.45, '2026-03-20T12:00:00Z', 'mwl', 'hanafi');
    expect(hanafi.asr.ms).toBeGreaterThan(shafi.asr.ms);
    expect(hanafi.asr.estimated).toBe(false);
  });
});

describe('hemisphere mirror', () => {
  it('−70° in southern summer behaves like +70° in northern summer', () => {
    const south = sched(-70.0, 0.0, '2026-12-21T12:00:00Z');
    expect(south.kind).toBe('midnightsun');
    expect(south.maghrib.source).toBe('borrow60');
    const south60 = sched(-60.0, 0.0, '2026-12-21T12:00:00Z');
    expect(south.maghrib.ms).toBe(south60.maghrib.ms); // borrows −60, not +60
  });
});

describe('detection agrees with adhan ground truth across a grid', () => {
  it('fajr/isha source is "angle" iff the angle is reachable', () => {
    const params = makeParams('mwl', 'shafi');
    const bad = [];
    let cells = 0;
    for (let lat = 42; lat <= 60; lat += 1.5) {
      for (let m = 0; m < 12; m++) {
        const iso = `2026-${String(m + 1).padStart(2, '0')}-15T12:00:00Z`;
        const s = daySchedule(lat, 10, T(iso), params, 'mwl');
        for (const [k, angle] of [['fajr', 18], ['isha', 17]]) {
          cells++;
          const truth = angleReachable(lat, 10, new Date(iso), angle);
          const claimed = s[k].source === 'angle';
          if (truth !== claimed) bad.push(`${lat} ${iso} ${k}: truth=${truth} claimed=${claimed}`);
        }
      }
    }
    // mid-month samples sit days away from the seasonal boundary; demand near-perfect agreement
    expect(bad.length / cells, bad.slice(0, 10).join('\n')).toBeLessThan(0.02);
  });
});

describe('the non-null guarantee', () => {
  it('all six instants exist at every latitude, season, method', () => {
    for (const method of ['mwl', 'isna', 'moonsighting', 'ummalqura', 'tehran']) {
      const params = makeParams(method, 'shafi');
      for (let lat = -88; lat <= 88; lat += 8) {
        for (const iso of ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21']) {
          const s = daySchedule(lat, 18, T(iso + 'T12:00:00Z'), params, method);
          for (const k of KEYS) {
            expect(s[k].ms, `${method} lat=${lat} ${iso} ${k}`).toBeTypeOf('number');
          }
        }
      }
    }
  });

  it('within-day ordering holds everywhere', () => {
    const params = makeParams('mwl', 'shafi');
    for (let lat = -88; lat <= 88; lat += 4) {
      for (const iso of ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21']) {
        const s = daySchedule(lat, 18, T(iso + 'T12:00:00Z'), params, 'mwl');
        const msg = `lat=${lat} ${iso}`;
        expect(s.fajr.ms, msg).toBeLessThan(s.sunrise.ms);
        expect(s.sunrise.ms, msg).toBeLessThanOrEqual(s.dhuhr.ms);
        expect(s.dhuhr.ms, msg).toBeLessThan(s.asr.ms);
        expect(s.asr.ms, msg).toBeLessThan(s.maghrib.ms);
        expect(s.maghrib.ms, msg).toBeLessThan(s.isha.ms);
      }
    }
  });
});
