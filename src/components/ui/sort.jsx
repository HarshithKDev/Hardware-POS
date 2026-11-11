import { useMemo, useState, useCallback } from 'react';

const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });

/**
 * Click-to-sort for a list that is already loaded (sorting happens in the browser only;
 * nothing is re-fetched or saved).
 *   const { sorted, sort, toggleSort } = useSort(rows, { total: r => r.total_amount }, { key: 'date', dir: 'desc' })
 * With no active key, rows keep their original order.
 */
export function useSort(rows, accessors, initial = { key: null, dir: 'desc' }) {
  const [sort, setSort] = useState(initial);
  const toggleSort = useCallback((key) => {
    setSort(prev => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      // numbers/dates usually wanted biggest/newest first; text A→Z first
      : { key, dir: accessors?.[key]?.textual ? 'asc' : 'desc' }));
  }, [accessors]);
  const sorted = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    const acc = sort.key ? accessors?.[sort.key] : null;
    const get = typeof acc === 'function' ? acc : acc?.get;
    if (!get) return list;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return list
      .map((row, index) => ({ row, index, value: get(row) }))
      .sort((a, b) => {
        const av = a.value, bv = b.value;
        const aEmpty = av === null || av === undefined || av === '';
        const bEmpty = bv === null || bv === undefined || bv === '';
        if (aEmpty || bEmpty) return aEmpty && bEmpty ? a.index - b.index : aEmpty ? 1 : -1;
        const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : collator.compare(String(av), String(bv));
        return cmp === 0 ? a.index - b.index : cmp * factor;
      })
      .map(x => x.row);
  }, [rows, accessors, sort]);
  return { sorted, sort, toggleSort };
}

/**
 * A table header cell that sorts its column when clicked. Shows ▲/▼ for the active column
 * and sets aria-sort for screen readers. Extra props (style, className) go on the <th>.
 */
export function SortTh({ label, sortKey, sort, onSort, className = '', align = 'center', ...rest }) {
  const active = sort?.key === sortKey;
  const dir = active ? sort.dir : null;
  return (
    <th
      className={className}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      {...rest}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider font-semibold cursor-pointer transition-colors hover:text-[var(--text-primary)] ${align === 'center' ? 'justify-center' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={`text-[11px] leading-none ${active ? 'text-[var(--color-accent)]' : 'opacity-40'}`}>
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
        </span>
      </button>
    </th>
  );
}
