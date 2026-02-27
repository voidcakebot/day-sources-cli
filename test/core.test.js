import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, runLookup } from '../src/core.js';

describe('parseArgs', () => {
  it('parses date and sources', () => {
    const a = parseArgs(['--date', '2026-02-28', '--sources', '1,3', '--json']);
    expect(a.date).toBe('2026-02-28');
    expect(a.sources).toEqual(['1', '3']);
    expect(a.json).toBe(true);
  });
});

describe('runLookup', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async (url) => {
      const body = String(url).includes('un.org')
        ? 'International Day text\nFebruary 28 Rare Disease Day'
        : 'World Something\nFebruary 28 Space Science Day';
      return { ok: true, text: async () => body };
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns only sources 1 and 3', async () => {
    const out = await runLookup({ date: '2026-02-28', sources: ['1', '3'] });
    expect(out.results.length).toBe(2);
    expect(out.results[0].source).toBe('1');
    expect(out.results[1].source).toBe('3');
  });
});
