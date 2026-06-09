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

const OPTS = { method: 'isna', madhab: 'shafi', highLat: 'seventhnight' };

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
  const isna = makeParams('isna', 'shafi', 'seventhnight');   // fajr/isha angle 15
  const ms = Date.parse('2026-06-21T12:00:00Z');               // solstice
  ok('45N Isha is real (15deg reached)',  estimateBasisFor('isha', 45, ms, isna) === 'real');
  ok('60N Isha is portioned',             estimateBasisFor('isha', 60, ms, isna) === 'portioned');
  ok('70N Isha is substituted (no night)',estimateBasisFor('isha', 70, ms, isna) === 'substituted');
  ok('70N Dhuhr is real (noon always)',   estimateBasisFor('dhuhr', 70, ms, isna) === 'real');
  ok('70N Maghrib is substituted',        estimateBasisFor('maghrib', 70, ms, isna) === 'substituted');
  const uaq = makeParams('ummalqura', 'shafi', 'seventhnight'); // interval Isha
  ok('60N UmmAlQura Isha real (interval)',estimateBasisFor('isha', 60, ms, uaq) === 'real');
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
  ok('DY394 after-arrival prayers are substituted estimates',
     dyAfter.length > 0 && dyAfter.every(p => p.estimated === true && p.estimateBasis === 'substituted'));
  ok('DY394 after-arrival estimates carry times in both zones',
     dyAfter.every(p => p.zones && Object.values(p.zones).every(z => typeof z.time === 'string' && z.time.length)));
  // each substituted prayer appears exactly once (no in-flight + after duplicate)
  const subCounts = {}; dy.prayers.forEach(p => { if (p.estimateBasis === 'substituted') subCounts[p.key] = (subCounts[p.key] || 0) + 1; });
  ok('DY394 each substituted key appears once', Object.values(subCounts).every(n => n === 1));
  // after-arrival estimates are chronological (order fix)
  for (let i = 1; i < dyAfter.length; i++) ok('DY394 after-arrival estimates chronological', dyAfter[i].ms >= dyAfter[i-1].ms);
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
}

// --- Task 8: switching the high-lat rule changes portioned times ---
{
  const seven = compute(BA48, { method: 'isna', madhab: 'shafi', highLat: 'seventhnight' });
  const twi   = compute(BA48, { method: 'isna', madhab: 'shafi', highLat: 'twilightangle' });
  const iS = seven.prayers.find(p => p.key === 'isha' && p.status === 'inflight');
  const iT = twi.prayers.find(p => p.key === 'isha' && p.status === 'inflight');
  ok('twilight-angle changes the portioned Isha time', iS && iT && iS.ms !== iT.ms);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
