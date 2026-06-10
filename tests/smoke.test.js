import { describe, it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';

describe('smoke', () => {
  it('computes the SV124 sample', () => {
    const m = compute(lookup('SV124'), { method: 'mwl', madhab: 'shafi' });
    expect(m.prayers.length).toBeGreaterThan(0);
  });
});
