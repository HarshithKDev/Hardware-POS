import { useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { localToUtcIso } from '../utils';
import { supabase } from '../supabaseClient';
import { isMissingFunctionError } from '../services/posRpc';

const ROWS_PER_STEP = 1000; // the database returns at most 1,000 rows per request

const localDay = (iso) => new Date(iso).toLocaleDateString('en-CA');

// With the pos_active_days database function: the list of days itself (a few bytes per day)
// instead of 1,000 raw timestamps per step.
const DAYS_PER_STEP = 60;
let daysFunctionMissing = false;
const deviceTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

/** Days from the database function, or null when it can't be used (then the caller falls back). */
async function fetchDaysStep(kind, beforeIso) {
  if (daysFunctionMissing || !supabase?.rpc) return null;
  const { data, error } = await supabase.rpc('pos_active_days', {
    p_kind: kind,
    p_tz: deviceTimeZone(),
    p_before: beforeIso || null,
    p_limit: DAYS_PER_STEP,
  });
  if (error) {
    if (isMissingFunctionError(error, 'pos_active_days')) daysFunctionMissing = true;
    else console.warn('[ActiveDays] Falling back to reading timestamps:', error.message);
    return null;
  }
  if (!Array.isArray(data)) return null;
  const days = data.map(r => String(r?.day ?? r).slice(0, 10)).filter(Boolean);
  const next = days.length >= DAYS_PER_STEP ? localToUtcIso(`${days[days.length - 1]}T00:00:00`) : undefined;
  return { days, next };
}

/**
 * List of days (YYYY-MM-DD, newest first) that have activity, for the day-by-day screens.
 *
 * Loads in steps of 1,000 rows (newest first) instead of one capped request, so the list
 * reaches all the way back in history. Each step continues before the oldest day already
 * listed. When `currentIndex` gets near the end of what is loaded, the next step loads by itself.
 *
 * With `daysKind` ('sales' | 'audit') the pos_active_days database function is asked first.
 *
 * fetchStep(beforeIso | null) must return { data: [{ created_at }], error }, newest first,
 * limited to 1,000 rows, and only rows created before `beforeIso` when it is given.
 */
export function useActiveDays(queryKey, fetchStep, { enabled = true, currentIndex = 0, staleTime = 1000 * 60 * 2, daysKind = null } = {}) {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    staleTime,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      if (daysKind) {
        const fromFunction = await fetchDaysStep(daysKind, pageParam);
        if (fromFunction) return fromFunction;
      }
      const { data, error } = await fetchStep(pageParam);
      if (error) throw error;
      const rows = data || [];
      const days = [];
      for (const row of rows) {
        if (!row?.created_at) continue;
        const d = localDay(row.created_at);
        if (days[days.length - 1] !== d && !days.includes(d)) days.push(d);
      }
      // A full step may have stopped part-way through its oldest day: continue before that day starts
      const next = rows.length >= ROWS_PER_STEP && days.length > 0 ? localToUtcIso(`${days[days.length - 1]}T00:00:00`) : undefined;
      return { days, next };
    },
    getNextPageParam: (last) => last.next,
  });

  const dates = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const page of query.data?.pages || []) {
      for (const d of page.days) {
        if (!seen.has(d)) { seen.add(d); out.push(d); }
      }
    }
    return out;
  }, [query.data]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  // Load the next step before the user reaches the end of the loaded days
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && dates.length > 0 && currentIndex >= dates.length - 2) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, dates.length, currentIndex, fetchNextPage]);

  return {
    dates,
    hasMore: Boolean(hasNextPage),
    isLoadingMore: isFetchingNextPage,
    loadMore: fetchNextPage,
    isLoading: query.isLoading,
    error: query.error,
  };
}

export const ACTIVE_DAYS_STEP = ROWS_PER_STEP;
