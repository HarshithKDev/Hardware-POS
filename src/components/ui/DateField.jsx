const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-10" -> "10 Nov 2026" (no timezone shifts: the string is read as-is). */
export function formatDayLabel(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Date picker that always shows the date as "10 Nov 2026" (the browser's own date box
 * shows 10/11/2026 on these PCs, which reads like 10 October). The real <input type="date">
 * sits invisibly on top, so clicking anywhere opens the normal calendar and the keyboard
 * still works. onChange receives the normal input change event (value = "YYYY-MM-DD").
 */
export default function DateField({ value, onChange, min, max, placeholder = 'Pick a date', className = '', ...rest }) {
  const label = formatDayLabel(value);
  return (
    <div
      className={`relative inline-flex items-center gap-2 h-10 md:h-9 px-3 rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-input)] text-sm font-semibold focus-within:border-[var(--color-accent)] focus-within:shadow-[var(--focus-ring)] hover:border-[var(--border-heavy)] transition-colors cursor-pointer ${className}`}
    >
      <svg className="w-4 h-4 shrink-0 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span className="whitespace-nowrap tabular-nums" aria-hidden="true">{label || placeholder}</span>
      <input
        type="date"
        value={value || ''}
        min={min}
        max={max}
        onChange={onChange}
        onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* older browsers: native behaviour */ } }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        style={{ colorScheme: 'dark' }}
        {...rest}
      />
    </div>
  );
}
