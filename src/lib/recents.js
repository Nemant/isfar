/* ===========================================================================
   Isfar — saved flights ("recents")
   Each entry carries the FULL lookup record so a saved flight replays with
   zero network: airplane-mode-proof by construction. Legacy entries (code
   only, pre-v2) are kept and replayed via the normal lookup as before.
   =========================================================================== */

const CAP = 6;
const keyOf = (r) => (r.code || "") + "·" + (r.dateISO || "");

export function upsertRecent(list, rec) {
  const item = {
    code: rec.code, dateISO: rec.dateISO, airline: rec.airline,
    fromIata: rec.from.iata, fromCity: rec.from.city,
    toIata: rec.to.iata, toCity: rec.to.city,
    ts: Date.now(), rec
  };
  return [item, ...list.filter((r) => keyOf(r) !== keyOf(item))].slice(0, CAP);
}

const _short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function recentLabel(r) {
  const route = `${r.fromIata} → ${r.toIata}`;
  if (!r.dateISO) return route;
  return `${route} · ${_short.format(new Date(r.dateISO + "T12:00:00Z"))}`;
}
