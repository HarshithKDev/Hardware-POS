/**
 * The database returns at most 1,000 rows per request. Anything that can span many rows
 * (a date range of bills, a year of sales, all expenses) must page through the results,
 * or totals are silently too low.
 *
 * buildQuery() must return a fresh query with a stable order that ends in a unique column
 * (e.g. .order('created_at').order('id')), so pages never overlap or skip rows.
 * Returns { data, error }: on error, data holds the rows read so far (null if none).
 */
export const DB_PAGE_SIZE = 1000;

export async function fetchAllRows(buildQuery, { pageSize = DB_PAGE_SIZE, maxPages = 500 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: from === 0 ? null : rows, error };
    if (data) rows.push(...data);
    if (!data || data.length < pageSize) break;
  }
  return { data: rows, error: null };
}

/** Splits a list into chunks (for .in('bill_id', chunk) lookups that must stay short). */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Runs fn over every item with at most `limit` running at once; results keep their order. */
export async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
