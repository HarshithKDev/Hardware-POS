/**
 * Standard table classes so every data table has the same header, row height, padding,
 * hover and number alignment. Use with plain <table>/<th>/<td>:
 *   <div className={table.wrap}><table className={table.table}> <thead className={table.thead}>
 *   <th className={table.th}> ... <tr className={table.tr}> <td className={table.td}> / {table.num}
 */
export const table = {
  wrap: 'w-full overflow-x-auto rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-secondary)]',
  table: 'w-full border-collapse text-center text-sm',
  thead: 'sticky top-0 z-10 bg-[var(--bg-tertiary)]',
  th: 'h-10 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] whitespace-nowrap border-b border-[var(--border-medium)]',
  tr: 'border-b border-[var(--border-light)] last:border-b-0 hover:bg-[var(--bg-hover)] transition-colors',
  td: 'h-11 px-3 text-[var(--text-primary)]',
  num: 'h-11 px-3 tabular-nums text-[var(--text-primary)]',
  tfoot: 'bg-[var(--bg-tertiary)] font-semibold border-t border-[var(--border-medium)]',
};

export default table;
