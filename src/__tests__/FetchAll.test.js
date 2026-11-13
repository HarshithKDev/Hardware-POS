import { describe, it, expect } from 'vitest';
import { fetchAllRows, chunk, mapWithLimit } from '../services/fetchAll';

// A stand-in query that behaves like the database: at most 1,000 rows per request
const fakeTable = (n, cap = 1000) => () => ({
  range: async (from, to) => ({ data: Array.from({ length: Math.max(0, Math.min(to, n - 1, from + cap - 1) - from + 1) }, (_, i) => ({ id: from + i })), error: null }),
});

describe('fetchAllRows', () => {
  it('reads every row past the 1,000-row limit', async () => {
    const { data, error } = await fetchAllRows(fakeTable(2500));
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(new Set(data.map(r => r.id)).size).toBe(2500);
  });
  it('stops after a short page and handles exact multiples', async () => {
    expect((await fetchAllRows(fakeTable(1000))).data).toHaveLength(1000);
    expect((await fetchAllRows(fakeTable(0))).data).toHaveLength(0);
  });
  it('returns the rows read so far plus the error when a later page fails', async () => {
    let calls = 0;
    const q = () => ({ range: async (from) => (++calls === 2 ? { data: null, error: { message: 'boom' } } : { data: Array.from({ length: 1000 }, (_, i) => ({ id: from + i })), error: null }) });
    const { data, error } = await fetchAllRows(q);
    expect(error.message).toBe('boom');
    expect(data).toHaveLength(1000);
  });
});

describe('chunk / mapWithLimit', () => {
  it('splits lists and keeps result order with limited parallel work', async () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    let running = 0, peak = 0;
    const out = await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return x * 2; });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
