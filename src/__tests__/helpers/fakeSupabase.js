/**
 * In-memory stand-in for the Supabase client's query builder, for component tests.
 * Behaves like the real database where it matters for the screens: eq/neq/gte/lte/lt/gt/in
 * filters, order, limit/range, and at most 1,000 rows per request.
 * Inserts, updates and deletes are recorded in `writes` and change nothing.
 */
const MAX_ROWS = 1000;

export function createFakeSupabase(tables) {
  const writes = [];
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  function from(rawTable) {
    const table = String(rawTable);
    const rows = () => tables[table] || tables[table.replace(/_public$/, '')] || [];
    const filters = [];
    const orders = [];
    let from_ = 0;
    let to = null;
    let mode = 'select';
    let headCount = false;

    const run = () => {
      if (mode !== 'select') return { data: null, error: null };
      let out = rows().filter((r) => filters.every((f) => f(r)));
      if (orders.length) {
        out = [...out].sort((a, b) => {
          for (const [col, asc] of orders) { const c = cmp(a[col], b[col]) * (asc ? 1 : -1); if (c) return c; }
          return 0;
        });
      }
      const count = out.length;
      const end = to === null ? from_ + MAX_ROWS - 1 : Math.min(to, from_ + MAX_ROWS - 1);
      out = out.slice(from_, end + 1);
      return { data: headCount ? null : out, count, error: null };
    };

    const b = {
      select: (_cols, opts) => { if (opts?.head) headCount = true; return b; },
      eq: (c, v) => { filters.push((r) => r[c] === v); return b; },
      neq: (c, v) => { filters.push((r) => r[c] !== v); return b; },
      gte: (c, v) => { filters.push((r) => r[c] >= v); return b; },
      lte: (c, v) => { filters.push((r) => r[c] <= v); return b; },
      gt: (c, v) => { filters.push((r) => r[c] > v); return b; },
      lt: (c, v) => { filters.push((r) => r[c] < v); return b; },
      in: (c, list) => { const s = new Set(list); filters.push((r) => s.has(r[c])); return b; },
      is: (c, v) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      or: () => b,
      ilike: () => b,
      not: () => b,
      order: (c, opts = {}) => { orders.push([c, opts.ascending !== false]); return b; },
      limit: (n) => { to = from_ + n - 1; return b; },
      range: (f, t) => { from_ = f; to = t; return b; },
      single: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
      insert: (payload) => { mode = 'insert'; writes.push({ table, op: 'insert', payload }); return b; },
      update: (payload) => { mode = 'update'; writes.push({ table, op: 'update', payload }); return b; },
      upsert: (payload) => { mode = 'upsert'; writes.push({ table, op: 'upsert', payload }); return b; },
      delete: () => { mode = 'delete'; writes.push({ table, op: 'delete' }); return b; },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  }

  return {
    from,
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getUser: () => Promise.resolve({ data: { user: { email: 'owner@example.com' } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
    writes,
  };
}
