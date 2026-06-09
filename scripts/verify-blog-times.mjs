// Re-verify every time quoted in docs/blog/2026-06-09-prayer-times-far-north.md
// against adhan-js + the engine (publication-checklist requirement). Run:
//   node scripts/verify-blog-times.mjs
import * as adhan from 'adhan';
import { compute, ISFAR_TEST } from '../src/lib/engine.js';

const { makeParams, instantsAt } = ISFAR_TEST;

const fmt = (d, tz) => d && !isNaN(d) ? new Intl.DateTimeFormat('en-GB',
  { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d) : 'n/a';
const fmtD = (d, tz) => d && !isNaN(d) ? new Intl.DateTimeFormat('en-GB',
  { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d) : 'n/a';

console.log('=== 1. London (51.5074, -0.1278), June 21 2026 ===');
{
  const c = new adhan.Coordinates(51.5074, -0.1278);
  const isna = adhan.CalculationMethod.NorthAmerica();        // 15°
  isna.highLatitudeRule = adhan.HighLatitudeRule.MiddleOfTheNight;
  const ptIsna21 = new adhan.PrayerTimes(c, new Date(Date.UTC(2026, 5, 21, 12)), isna);
  const ptIsna22 = new adhan.PrayerTimes(c, new Date(Date.UTC(2026, 5, 22, 12)), isna);
  console.log('ISNA 15° — Isha (night of Jun 21):', fmtD(ptIsna21.isha, 'Europe/London'),
              '| Fajr (Jun 22):', fmtD(ptIsna22.fajr, 'Europe/London'),
              '| window min:', Math.round((ptIsna22.fajr - ptIsna21.isha) / 60000));

  const mwl = adhan.CalculationMethod.MuslimWorldLeague();    // 18°/17°
  mwl.highLatitudeRule = adhan.HighLatitudeRule.MiddleOfTheNight;
  const ptMwl21 = new adhan.PrayerTimes(c, new Date(Date.UTC(2026, 5, 21, 12)), mwl);
  const ptMwl22 = new adhan.PrayerTimes(c, new Date(Date.UTC(2026, 5, 22, 12)), mwl);
  console.log('MWL 18° — Isha Jun21:', fmtD(ptMwl21.isha, 'Europe/London'),
              '| Fajr Jun22:', fmtD(ptMwl22.fajr, 'Europe/London'),
              '| Fajr Jun21:', fmtD(ptMwl21.fajr, 'Europe/London'),
              '(UTC Isha:', fmt(ptMwl21.isha, 'UTC'), 'UTC Fajr22:', fmt(ptMwl22.fajr, 'UTC'), ')');
}

console.log('\n=== 2. Stockholm (59.3293, 18.0686), June 21 2026, ISNA ===');
{
  const c = new adhan.Coordinates(59.3293, 18.0686);
  const d = new Date(Date.UTC(2026, 5, 21, 12));
  const mid = adhan.CalculationMethod.NorthAmerica();
  mid.highLatitudeRule = adhan.HighLatitudeRule.MiddleOfTheNight;
  const ptM = new adhan.PrayerTimes(c, d, mid);
  const d22 = new Date(Date.UTC(2026, 5, 22, 12));
  const ptM22 = new adhan.PrayerTimes(c, d22, mid);
  console.log('sunset (maghrib):', fmtD(ptM.maghrib, 'Europe/Stockholm'),
              '| sunrise next:', fmtD(ptM22.sunrise, 'Europe/Stockholm'));
  console.log('MiddleOfTheNight — Isha:', fmtD(ptM.isha, 'Europe/Stockholm'),
              '| Fajr (Jun22):', fmtD(ptM22.fajr, 'Europe/Stockholm'));
  const sev = adhan.CalculationMethod.NorthAmerica();
  sev.highLatitudeRule = adhan.HighLatitudeRule.SeventhOfTheNight;
  const ptS = new adhan.PrayerTimes(c, d, sev);
  const ptS22 = new adhan.PrayerTimes(c, d22, sev);
  console.log('SeventhOfTheNight — Isha:', fmtD(ptS.isha, 'Europe/Stockholm'),
              '| Fajr (Jun22):', fmtD(ptS22.fajr, 'Europe/Stockholm'));
  const night = (ptM22.sunrise - ptM.maghrib) / 60000;
  console.log('night length:', Math.floor(night / 60) + 'h ' + Math.round(night % 60) + 'm');
}

console.log('\n=== 3. Lat-60 night length, June 21 (the "almost five hours" claim) ===');
{
  const c = new adhan.Coordinates(60, 18.92);
  const p = adhan.CalculationMethod.NorthAmerica();
  const pt = new adhan.PrayerTimes(c, new Date(Date.UTC(2026, 5, 21, 12)), p);
  const pt22 = new adhan.PrayerTimes(c, new Date(Date.UTC(2026, 5, 22, 12)), p);
  const night = (pt22.sunrise - pt.maghrib) / 60000;
  console.log('lat 60 June: sunset', fmt(pt.maghrib, 'Europe/Stockholm'),
              'sunrise', fmt(pt22.sunrise, 'Europe/Stockholm'),
              '→ night', Math.floor(night / 60) + 'h ' + Math.round(night % 60) + 'm');
}

console.log('\n=== 4. Tromsø Dec 21 borrowed-60 via engine instantsAt(69.68, 18.92) ===');
{
  const p = makeParams('isna', 'shafi');
  const dec = Date.parse('2026-12-21T12:00:00Z');
  const at = instantsAt(69.6833, 18.9189, dec, p);
  for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'])
    console.log(' ', k, fmtD(at[k], 'Europe/Oslo'));
}

console.log('\n=== 5. Worked example: Oslo→Tromsø Dec 21, isna/shafi, dep 16:00Z arr 17:35Z ===');
{
  const rec = {
    code: 'TEST', airline: 'Test',
    depUTC: '2026-12-21T16:00:00Z', arrUTC: '2026-12-21T17:35:00Z',
    from: { iata: 'OSL', city: 'Oslo',   lat: 60.1939, lon: 11.1004, tz: 'Europe/Oslo' },
    to:   { iata: 'TOS', city: 'Tromsø', lat: 69.6833, lon: 18.9189, tz: 'Europe/Oslo' },
  };
  const m = compute(rec, { method: 'isna', madhab: 'shafi' });
  m.prayers.forEach(pr => console.log(' ', pr.status.padEnd(8), pr.en.padEnd(8),
    'OSL', pr.zones.OSL.time, '| TOS', pr.zones.TOS.time,
    pr.estimated ? `~ (${pr.estimateBasis})` : 'real'));
  console.log('  banner:', JSON.stringify(m.midnightSun));
}

console.log('\n=== 6. Tromsø midnight-sun / polar-night date windows (sunrise validity) ===');
{
  const c = new adhan.Coordinates(69.6833, 18.9189);
  const p = adhan.CalculationMethod.NorthAmerica();
  const valid = [];
  for (let day = 0; day < 366; day++) {
    const d = new Date(Date.UTC(2026, 0, 1 + day, 12));
    const pt = new adhan.PrayerTimes(c, d, p);
    const hasSunrise = pt.sunrise && !isNaN(pt.sunrise.getTime());
    const hasSunset = pt.maghrib && !isNaN(pt.maghrib.getTime());
    valid.push({ d, hasSunrise, hasSunset });
  }
  const f = (x) => x.d.toISOString().slice(0, 10);
  let msStart = null, msEnd = null, pnStart = null, pnEnd = null;
  for (let i = 1; i < valid.length; i++) {
    if (valid[i - 1].hasSunset && !valid[i].hasSunset && valid[i].hasSunrise !== false) {
      if (valid[i].d.getUTCMonth() < 8 && !msStart) msStart = f(valid[i]);
    }
    if (!valid[i - 1].hasSunset && valid[i].hasSunset && valid[i - 1].d.getUTCMonth() > 3 && valid[i - 1].d.getUTCMonth() < 9 && !msEnd) msEnd = f(valid[i - 1]);
    if (valid[i - 1].hasSunrise && !valid[i].hasSunrise && valid[i].d.getUTCMonth() > 8 && !pnStart) pnStart = f(valid[i]);
    if (!valid[i - 1].hasSunrise && valid[i].hasSunrise && valid[i].d.getUTCMonth() < 3 && !pnEnd) pnEnd = f(valid[i - 1]);
  }
  console.log('midnight sun ≈', msStart, '→', msEnd, '| polar night: ends', pnEnd, ', starts', pnStart);
}

console.log('\n=== 7. Angle-reachability latitude ceilings at June solstice (decl 23.44) ===');
{
  for (const angle of [18, 15]) {
    console.log(`  ${angle}° unreachable above lat ≈ ${(90 - 23.44 - angle).toFixed(1)}°N`);
  }
  console.log('  London min sun depth Jun 21:', (90 - 23.44 - 51.5074).toFixed(1) + '°',
              '| Stockholm:', (90 - 23.44 - 59.3293).toFixed(1) + '°');
}
