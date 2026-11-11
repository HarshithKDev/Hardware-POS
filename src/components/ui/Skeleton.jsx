/**
 * Placeholder rows shown while a table loads, so the page keeps its shape instead of
 * jumping from a spinner to a table. The label is read out by screen readers.
 */
const WIDTHS = ['72%', '88%', '64%', '80%', '56%', '92%', '68%'];

export function TableSkeleton({ rows = 8, cols = 5, label = 'Loading…', className = '' }) {
  return (
    <div role="status" aria-live="polite" className={`w-full ${className}`}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="w-full">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 h-11 px-3 border-b border-[var(--border-light)] last:border-b-0">
            {Array.from({ length: cols }).map((__, c) => (
              <div key={c} className="flex-1 flex justify-center">
                <div
                  className="h-3 rounded-md animate-pulse"
                  style={{ width: WIDTHS[(r + c) % WIDTHS.length], backgroundColor: 'var(--border-medium)', animationDelay: `${(r * 60) % 600}ms` }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default TableSkeleton;
