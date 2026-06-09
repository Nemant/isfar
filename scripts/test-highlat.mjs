// Node assertion harness for the high-latitude fallback. Run: node scripts/test-highlat.mjs
import { compute } from '../src/lib/engine.js';
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
