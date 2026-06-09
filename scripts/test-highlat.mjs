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

  // DY394 (OSL->TOS, midnight sun) — no-sunset screen still triggers AND now carries times
  const dy = compute(lookup('DY394'), OPTS);
  ok('DY394 noSunset still true', dy.noSunset === true);
  ok('DY394 undefinedPrayers carry a time', (dy.undefinedPrayers || []).every(p => typeof p.time === 'string' && p.time.length));
  ok('DY394 undefinedPrayers flagged substituted', (dy.undefinedPrayers || []).every(p => p.estimated === true && p.estimateBasis === 'substituted'));
  // no prayer appears in BOTH the defined list and the estimates (no duplicate Maghrib)
  const defKeys = new Set((dy.defined || []).map(p => p.key));
  ok('DY394 defined and undefined lists are disjoint', (dy.undefinedPrayers || []).every(p => !defKeys.has(p.key)));
}

// --- Task 3b: estimates are sane (in-flight prayers chronological) ---
{
  const m = compute(BA48, OPTS);
  const infl = m.prayers.filter(p => p.status === 'inflight');
  for (let i = 1; i < infl.length; i++) ok('in-flight prayers chronological', infl[i].ms >= infl[i-1].ms);
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
