import { supabase } from '../supabaseClient';

/**
 * Concurrency-safe read-modify-write for a single row (compare-and-swap).
 *
 * Why: stock used to be updated as "read value -> compute in JS -> write absolute
 * value". If two terminals did that at the same moment, one change was silently
 * lost. Here the UPDATE only applies if the columns still hold the values we read;
 * otherwise we re-read and recompute (optimistic locking). No DB changes needed.
 *
 * @param {object}   opts
 * @param {string}   opts.table    Table name.
 * @param {object}   opts.match    Equality filters identifying exactly one row (e.g. { batch_id, shop_id }).
 *                                 Keys with null/undefined values are ignored.
 * @param {string[]} opts.columns  Columns to read and guard (e.g. ['stock_store', 'stock_warehouse']).
 * @param {(current: object) => ({ update: object, result?: any } | null)} opts.compute
 *                                 Returns the new values to write, or null to skip writing.
 * @param {number}   [opts.maxAttempts=6]
 * @returns {Promise<{ applied: boolean, notFound?: boolean, skipped?: boolean, result?: any, current?: object }>}
 */
export async function casUpdateRow({ table, match, columns, compute, maxAttempts = 6 }) {
  const applyMatch = (q) => {
    for (const [key, value] of Object.entries(match)) {
      if (value !== null && value !== undefined && value !== '') q = q.eq(key, value);
    }
    return q;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data: current, error: readError } = await applyMatch(
      supabase.from(table).select(columns.join(', '))
    ).maybeSingle();
    if (readError) throw readError;
    if (!current) return { applied: false, notFound: true };

    const out = compute(current);
    if (!out || !out.update) return { applied: false, skipped: true, current };

    let updateQuery = applyMatch(supabase.from(table).update(out.update, { count: 'exact' }));
    for (const col of columns) {
      updateQuery = current[col] === null || current[col] === undefined
        ? updateQuery.is(col, null)
        : updateQuery.eq(col, current[col]);
    }
    const { error: updateError, count } = await updateQuery;
    if (updateError) throw updateError;

    // count === 0 means another terminal changed the row between our read and write.
    // If the server didn't report a count at all, fall back to the legacy behaviour (assume applied).
    if (count === null || count === undefined || count > 0) {
      return { applied: true, result: out.result, current };
    }

    // Small randomized backoff before re-reading
    await new Promise((r) => setTimeout(r, 40 * attempt + Math.floor(Math.random() * 60)));
  }

  throw new Error('Stock was being changed by another terminal at the same time. Please try again.');
}
