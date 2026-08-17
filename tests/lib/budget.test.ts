import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { estimateGzipBytes, GZIP_BUDGET_BYTES } from '../../src/lib/budget';

describe('budget', () => {
  it('估出的 gzip 體積與 node:zlib 的結果相差在 5% 以內', async () => {
    const json = readFileSync('src/generated/tree.json', 'utf8');
    const actual = gzipSync(Buffer.from(json)).length;
    const estimated = await estimateGzipBytes(json);
    expect(Math.abs(estimated - actual) / actual).toBeLessThan(0.05);
  });

  it('目前的 tree.json 仍在預算內', async () => {
    const json = readFileSync('src/generated/tree.json', 'utf8');
    expect(await estimateGzipBytes(json)).toBeLessThan(GZIP_BUDGET_BYTES);
  });
});
