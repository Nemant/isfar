import { describe, it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';
import { angleReachable } from './helpers.js';

describe('smoke', () => {
  it('computes the SV124 sample', () => {
    const m = compute(lookup('SV124'), { method: 'mwl', madhab: 'shafi' });
    expect(m.prayers.length).toBeGreaterThan(0);
  });

  it('ground-truth oracle works', () => {
    // London June 6: 18° twilight never reached; equinox: reached
    expect(angleReachable(51.47, -0.45, new Date('2026-06-06T12:00:00Z'), 18)).toBe(false);
    expect(angleReachable(51.47, -0.45, new Date('2026-03-20T12:00:00Z'), 18)).toBe(true);
  });
});
