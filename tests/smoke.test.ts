import { describe, it, expect } from 'vitest';
import type { Cost } from '../src/lib/types';

describe('toolchain', () => {
  it('runs vitest with TypeScript types', () => {
    const c: Cost = { core: 5, gold: 0 };
    expect(c.core).toBe(5);
  });
});
