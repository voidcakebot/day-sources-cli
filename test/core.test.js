import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, runLookup } from '../src/core.js';

describe('parseArgs', () => {
  it('parses all-source mode and germany mode', () => {
    const a = parseArgs(['--date', '2026-02-28', '--sources', 'all', '--germany-mode', '--state', 'NW', '--json']);
    expect(a.date).toBe('2026-02-28');
    expect(a.sources).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(a.germanyMode).toBe(true);
    expect(a.state).toBe('NW');
    expect(a.json).toBe(true);
  });
});

describe('runLookup', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (url) => {
      const u = String(url);

      if (u.includes('feiertage-api.de')) {
        return {
          ok: true,
          json: async () => ({
            'Test Holiday': { datum: '2026-02-28' }
          })
        };
      }

      if (u.includes('api.abalin.net')) {
        return {
          ok: true,
          json: async () => ({
            data: { namedays: { de: 'Roman, Hilary' } }
          })
        };
      }

      return {
        ok: true,
        text: async () => 'International Day February 28\nWorld Day\nTag des Tests'
      };
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns sources 1 and 3 only when requested', async () => {
    const out = await runLookup({ date: '2026-02-28', sources: ['1', '3'], state: 'BY', germanyMode: false });
    expect(out.results.length).toBe(2);
    expect(out.results.map(r => r.source)).toEqual(['1', '3']);
  });

  it('builds germany mode payload', async () => {
    const out = await runLookup({ date: '2026-02-28', sources: ['1'], state: 'BY', germanyMode: true });
    expect(out.germanyMode).toBe(true);
    expect(out.germany.publicHolidays[0]).toContain('Test Holiday');
    expect(out.germany.nameDays[0]).toContain('Roman');
  });
});
