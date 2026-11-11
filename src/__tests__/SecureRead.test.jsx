import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let viewMissing = false;
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn((name) => {
      calls.push(name);
      const result = name.endsWith('_public') && viewMissing
        ? { data: null, error: { code: 'PGRST205', message: 'Could not find the table public.bills_public' } }
        : { data: [{ from: name }], error: null };
      const b = { select: () => b, eq: () => b, then: (res, rej) => Promise.resolve(result).then(res, rej) };
      return b;
    }),
  },
}));

import { readRows } from '../services/secureRead';

describe('cost-protected reads', () => {
  beforeEach(() => { calls.length = 0; viewMissing = false; });

  it('staff read the cost-free view; the owner reads the full table', async () => {
    const staff = await readRows('bills', (q) => q.select('*'), { owner: false });
    expect(staff.data[0].from).toBe('bills_public');
    const owner = await readRows('bills', (q) => q.select('*'), { owner: true });
    expect(owner.data[0].from).toBe('bills');
  });

  it('falls back to the table while the view does not exist yet, and remembers it', async () => {
    viewMissing = true;
    const res = await readRows('bills', (q) => q.select('*'), { owner: false });
    expect(res.data[0].from).toBe('bills');
    expect(calls).toEqual(['bills_public', 'bills']);
    calls.length = 0;
    await readRows('bills', (q) => q.select('*'), { owner: false });
    expect(calls).toEqual(['bills']); // no second attempt at the missing view
  });

  it('tables without a staff view are read directly', async () => {
    const res = await readRows('expenses', (q) => q.select('*'), { owner: false });
    expect(res.data[0].from).toBe('expenses');
  });
});
