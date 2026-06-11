/* ===========================================================================
   Isfar — SEO wave-1 route list (Phase D).
   24 curated corridors × both directions = 48 programmatic route pages.
   Curation rule: Hajj/Umrah trunk routes + the largest Muslim-diaspora
   corridors. Expansion beyond this list is DATA-GATED — add corridors only
   where Search Console shows impressions (see the Phase-D design doc).
   =========================================================================== */

// [a, b, group] — pages are generated for a→b AND b→a.
export const CORRIDORS = [
  // — Umrah / Hajj trunk routes into Jeddah —
  ['LHR', 'JED', 'umrah'],
  ['MAN', 'JED', 'umrah'],
  ['JFK', 'JED', 'umrah'],
  ['YYZ', 'JED', 'umrah'],
  ['CDG', 'JED', 'umrah'],
  ['IST', 'JED', 'umrah'],
  ['KUL', 'JED', 'umrah'],
  ['CGK', 'JED', 'umrah'],
  ['KHI', 'JED', 'umrah'],
  ['LHE', 'JED', 'umrah'],
  ['ISB', 'JED', 'umrah'],
  ['DAC', 'JED', 'umrah'],
  ['CAI', 'JED', 'umrah'],
  ['LOS', 'JED', 'umrah'],
  // — Gulf hubs —
  ['LHR', 'DXB', 'gulf'],
  ['JFK', 'DXB', 'gulf'],
  ['DXB', 'LAX', 'gulf'],
  // — South-Asia diaspora —
  ['LHR', 'ISB', 'southasia'],
  ['LHR', 'LHE', 'southasia'],
  ['YYZ', 'ISB', 'southasia'],
  // — Türkiye / South-East Asia / Maghreb —
  ['LHR', 'IST', 'other'],
  ['JFK', 'IST', 'other'],
  ['LHR', 'KUL', 'other'],
  ['CDG', 'CMN', 'other'],
];

export const GROUP_LABELS = {
  umrah: 'Umrah & Hajj routes',
  gulf: 'Gulf hub routes',
  southasia: 'South Asia routes',
  other: 'Türkiye, South-East Asia & Maghreb',
};

export const WAVE1_ROUTES = CORRIDORS.flatMap(([a, b, group]) => [
  { from: a, to: b, group },
  { from: b, to: a, group },
]);
