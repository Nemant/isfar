// Node assertion harness for the high-latitude fallback. Run: node scripts/test-highlat.mjs
import { compute } from '../src/lib/engine.js';
import { ISFAR_TEST } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  FAIL:', name); } };

// BA48 SEA->LHR (the triggering case) — real record from the live API
const BA48 = {
  code: 'BA48', airline: 'British Airways',
  depUTC: '2026-06-09T03:20:00Z', arrUTC: '2026-06-09T12:45:00Z',
  from: { iata: 'SEA', city: 'Seattle', lat: 47.449, lon: -122.309, tz: 'America/Los_Angeles' },
  to:   { iata: 'LHR', city: 'London',  lat: 51.4706, lon: -0.461941, tz: 'Europe/London' },
};

const OPTS = { method: 'isna', madhab: 'shafi' };

// --- Task 1: prayers no longer vanish ---
{
  const m = compute(BA48, OPTS);
  const keys = m.prayers.map(p => p.key);
  ok('BA48 includes an in-flight Isha', m.prayers.some(p => p.key === 'isha' && p.status === 'inflight'));
  ok('BA48 includes a Fajr somewhere', keys.includes('fajr'));
}

// --- Task 2: detection gate ---
{
  const { estimateBasisFor, makeParams } = ISFAR_TEST;
  const isna = makeParams('isna', 'shafi');                    // fajr/isha angle 15
  const sols = Date.parse('2026-06-21T12:00:00Z');             // June solstice
  const dec  = Date.parse('2026-12-21T12:00:00Z');             // December solstice
  ok('45N Isha is real (15deg reached)',   estimateBasisFor('isha', 45, sols, isna) === 'real');
  ok('60N Isha is portioned (<=60 floor)', estimateBasisFor('isha', 60, sols, isna) === 'portioned');
  ok('60.19N June Fajr is substituted (>60)', estimateBasisFor('fajr', 60.19, sols, isna) === 'substituted');
  ok('64N June Fajr is substituted (>60)', estimateBasisFor('fajr', 64, sols, isna) === 'substituted');
  ok('64N December Fajr is real (winter night)', estimateBasisFor('fajr', 64, dec, isna) === 'real');
  ok('70N Isha is substituted (no night)', estimateBasisFor('isha', 70, sols, isna) === 'substituted');
  ok('70N Dhuhr is real (noon always)',    estimateBasisFor('dhuhr', 70, sols, isna) === 'real');
  ok('70N Maghrib is substituted',         estimateBasisFor('maghrib', 70, sols, isna) === 'substituted');
  // Asr is real while the sun rises (incl. midnight sun) but substituted in polar night (no shadow)
  ok('70N Asr is real in midnight sun (Jun)', estimateBasisFor('asr', 70, sols, isna) === 'real');
  ok('70N Asr is substituted in polar night (Dec)', estimateBasisFor('asr', 70, dec, isna) === 'substituted');
  ok('70N Dhuhr stays real in polar night (Dec)', estimateBasisFor('dhuhr', 70, dec, isna) === 'real');
  const uaq = makeParams('ummalqura', 'shafi');                // interval Isha
  ok('60N UmmAlQura Isha real (interval)', estimateBasisFor('isha', 60, sols, uaq) === 'real');
}

// --- latitude-60 borrow: above 60 the twilight prayers come from lat 60, Asr stays local ---
{
  const { instantsAt, makeParams } = ISFAR_TEST;
  const p = makeParams('isna', 'shafi');
  const lon = 18.92, ref = Date.parse('2026-06-21T12:00:00Z');
  const at69 = instantsAt(69.68, lon, ref, p);
  const at60 = instantsAt(60, lon, ref, p);
  ok('69N June Fajr is borrowed from lat 60', at69.fajr && at60.fajr && at69.fajr.getTime() === at60.fajr.getTime());
  ok('69N June Isha is borrowed from lat 60', at69.isha && at60.isha && at69.isha.getTime() === at60.isha.getTime());
  ok('69N June Asr stays local (sun is up; differs from 60)', at69.asr && at60.asr && at69.asr.getTime() !== at60.asr.getTime());
  // polar night: Asr has no shadow locally, so it too is borrowed from lat 60
  const decRef = Date.parse('2026-12-21T12:00:00Z');
  const d69 = instantsAt(69.68, lon, decRef, p);
  const d60 = instantsAt(60, lon, decRef, p);
  ok('69N Dec Asr is borrowed from lat 60 (polar night)', d69.asr && d60.asr && d69.asr.getTime() === d60.asr.getTime());
}

// --- Task 3: model fields + no-sunset path ---
{
  const m = compute(BA48, OPTS);
  const isha = m.prayers.find(p => p.key === 'isha' && p.status === 'inflight');
  ok('in-flight Isha tagged estimated', isha && isha.estimated === true);
  ok('in-flight Isha basis portioned', isha && isha.estimateBasis === 'portioned');
  const dhuhr = m.prayers.find(p => p.key === 'dhuhr');
  ok('Dhuhr not estimated', dhuhr && dhuhr.estimated === false && dhuhr.estimateBasis === null);

  // a normal mid-latitude flight is unchanged (no estimates)
  const sv = compute(lookup('SV124'), OPTS);
  ok('SV124 has no estimated prayers', sv.prayers.every(p => p.estimated === false));

  // DY394 (OSL->TOS, midnight sun) — folds into normal results: after-arrival estimates + a banner
  const dy = compute(lookup('DY394'), OPTS);
  ok('DY394 sets a midnightSun banner', !!(dy.midnightSun && dy.midnightSun.names && dy.midnightSun.names.length));
  ok('DY394 no longer uses the noSunset screen', !dy.noSunset && !dy.undefinedPrayers);
  const dyAfter = dy.prayers.filter(p => p.status === 'after');
  ok('DY394 after-arrival shows the next few prayers (capped, not a whole day)',
     dyAfter.length > 0 && dyAfter.length <= 2);
  ok('DY394 after-arrival leads with an estimated Fajr',
     dyAfter[0] && dyAfter[0].key === 'fajr' && dyAfter[0].estimated === true && dyAfter[0].estimateBasis === 'substituted');
  ok('DY394 after-arrival prayers carry times in both zones',
     dyAfter.every(p => p.zones && Object.values(p.zones).every(z => typeof z.time === 'string' && z.time.length)));
  // each prayer appears at most once after arrival, in chronological order
  const dyAfterCounts = {}; dyAfter.forEach(p => dyAfterCounts[p.key] = (dyAfterCounts[p.key] || 0) + 1);
  ok('DY394 each prayer appears at most once after arrival', Object.values(dyAfterCounts).every(n => n === 1));
  for (let i = 1; i < dyAfter.length; i++) ok('DY394 after-arrival chronological', dyAfter[i].ms >= dyAfter[i-1].ms);
}

// --- midnight-sun MORNING arrival: the next prayers after landing are the real Dhuhr/Asr ---
{
  const morning = {
    code: 'TEST2', airline: 'Test',
    depUTC: '2026-06-21T03:30:00Z', arrUTC: '2026-06-21T06:00:00Z',  // arrive Tromsø morning, midnight sun
    from: { iata: 'OSL', city: 'Oslo',   lat: 60.19, lon: 11.10, tz: 'Europe/Oslo' },
    to:   { iata: 'TOS', city: 'Tromsø', lat: 69.68, lon: 18.92, tz: 'Europe/Oslo' },
  };
  const m = compute(morning, OPTS);
  const realAfter = m.prayers.filter(p => p.status === 'after' && p.estimated === false).map(p => p.key);
  ok('midnight-sun morning arrival keeps real Dhuhr after arrival', realAfter.includes('dhuhr'));
  ok('midnight-sun morning arrival keeps real Asr after arrival (not crowded out)', realAfter.includes('asr'));
  ok('midnight-sun morning arrival flags polar kind as midnightsun', m.midnightSun && m.midnightSun.kind === 'midnightsun');
}

// --- Task 3b: estimates are sane (in-flight prayers chronological) ---
{
  const m = compute(BA48, OPTS);
  const infl = m.prayers.filter(p => p.status === 'inflight');
  for (let i = 1; i < infl.length; i++) ok('in-flight prayers chronological', infl[i].ms >= infl[i-1].ms);
}

// --- winter polar night: real before-departure prayers are kept (not dropped) ---
{
  const winter = {
    code: 'TEST', airline: 'Test',
    depUTC: '2026-12-21T16:00:00Z', arrUTC: '2026-12-21T17:35:00Z',  // after Oslo sunset, into Tromsø polar night
    from: { iata: 'OSL', city: 'Oslo',    lat: 60.19, lon: 11.10, tz: 'Europe/Oslo' },
    to:   { iata: 'TOS', city: 'Tromsø',  lat: 69.68, lon: 18.92, tz: 'Europe/Oslo' },
  };
  const w = compute(winter, OPTS);
  ok('winter polar night sets a midnightSun banner', !!(w.midnightSun && w.midnightSun.names.length));
  const subSet = new Set(w.midnightSun.names);
  const before = w.prayers.filter(p => p.status === 'before');
  // a REAL before-departure prayer at Oslo whose key is ALSO substituted at the destination must still appear
  ok('winter keeps a real before-departure prayer sharing a substituted name',
     before.some(p => p.estimated === false && subSet.has(p.en)));
  ok('winter before-departure prayers are real (not estimated)', before.every(p => p.estimated === false));
  // the destination shows the next few prayers after arrival (capped, rolled forward)
  const wAfter = w.prayers.filter(p => p.status === 'after');
  ok('winter polar night after-arrival shows the next few prayers (capped)',
     wAfter.length > 0 && wAfter.length <= 2);
  ok('winter polar night after-arrival prayers are rolled to at/after arrival',
     wAfter.every(p => p.ms >= Date.parse('2026-12-21T17:35:00Z')));
  for (let i = 1; i < wAfter.length; i++) ok('winter after-arrival chronological', wAfter[i].ms >= wAfter[i-1].ms);
}

// --- polar-night MIDDAY arrival: Asr is among the next prayers, as a substituted estimate ---
{
  const middayPolar = {
    code: 'TEST3', airline: 'Test',
    depUTC: '2026-12-21T08:30:00Z', arrUTC: '2026-12-21T10:00:00Z',  // arrive Tromsø ~11:00 local, polar night
    from: { iata: 'OSL', city: 'Oslo',   lat: 60.19, lon: 11.10, tz: 'Europe/Oslo' },
    to:   { iata: 'TOS', city: 'Tromsø', lat: 69.68, lon: 18.92, tz: 'Europe/Oslo' },
  };
  const m = compute(middayPolar, OPTS);
  const asr = m.prayers.find(p => p.key === 'asr' && p.status === 'after');
  ok('polar-night midday arrival surfaces Asr as a substituted estimate',
     asr && asr.estimated === true && asr.estimateBasis === 'substituted');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
