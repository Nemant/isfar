/* lookupRemote — the 5 curated sample codes resolve from the local table in prod
   so their edge cases stay reliable, BUT only at their own demo date. A sample
   code looked up for a different date must honor that date via the live API
   (regression: SV124 on any date used to return the canned 2026-06-06 record). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lookupRemote } from '../src/lib/data.js';

describe('lookupRemote — sample date handling (prod origin)', () => {
  beforeEach(() => {
    // Force the "production" branch (real API) regardless of host.
    vi.stubGlobal('window', { ISFAR_USE_REMOTE: true, location: { protocol: 'https:', hostname: 'isfar.app' } });
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns the curated sample record at its own demo date (no network)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await lookupRemote('SV124', '2026-06-06');
    expect(res.found).toBe(true);
    expect(res.code).toBe('SV124');
    expect(res.dateISO).toBe('2026-06-06');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors a different date by hitting the live API for a sample code', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      status: 200,
      json: () => Promise.resolve({ found: true, code: 'SV124', dateISO: '2027-01-06', airline: 'Saudia' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await lookupRemote('SV124', '2027-01-06');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('code=SV124');
    expect(url).toContain('date=2027-01-06');
    expect(res.dateISO).toBe('2027-01-06');
  });
});
