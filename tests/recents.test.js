/* Saved flights ("recents") — entries must carry the full record so replay
   needs zero network (airplane-mode-proof), while legacy code-only entries
   keep working. */
import { describe, it, expect } from 'vitest';
import { upsertRecent, recentLabel } from '../src/lib/recents.js';
import { lookup } from '../src/lib/data.js';

const RAW = lookup('SV124');

describe('upsertRecent', () => {
  it('stores the full record for offline replay', () => {
    const list = upsertRecent([], RAW);
    expect(list).toHaveLength(1);
    expect(list[0].rec).toEqual(RAW);
    expect(list[0].code).toBe('SV124');
    expect(list[0].dateISO).toBe('2026-06-06');
  });

  it('dedups by code+dateISO, newest first, caps at 6', () => {
    let list = [];
    for (let i = 0; i < 8; i++) {
      list = upsertRecent(list, { ...RAW, code: 'XX' + i });
    }
    expect(list).toHaveLength(6);
    expect(list[0].code).toBe('XX7');
    list = upsertRecent(list, { ...RAW, code: 'XX7' });   // same code+date → moves up, no dup
    expect(list.filter(r => r.code === 'XX7')).toHaveLength(1);
    const other = upsertRecent(list, { ...RAW, code: 'XX7', dateISO: '2026-06-08' });
    expect(other.filter(r => r.code === 'XX7')).toHaveLength(2);  // new date = new entry
  });

  it('tolerates legacy code-only entries', () => {
    const legacy = { code: 'BA286', fromIata: 'LHR', toIata: 'JED', ts: 1 };
    const list = upsertRecent([legacy], RAW);
    expect(list).toContainEqual(legacy);
  });
});

describe('recentLabel', () => {
  it('formats route + date', () => {
    const list = upsertRecent([], RAW);
    expect(recentLabel(list[0])).toBe('LHR → JED · 6 Jun');
  });

  it('survives a legacy entry with no dateISO', () => {
    expect(recentLabel({ fromIata: 'LHR', toIata: 'JED' })).toBe('LHR → JED');
  });
});
