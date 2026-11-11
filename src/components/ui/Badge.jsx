/**
 * Small status label (CASH, COMPLETED, LOW STOCK...).
 * tone: neutral | accent | success | warning | error
 */
const TONES = {
  neutral: 'text-[var(--text-secondary)] bg-[var(--bg-tertiary)] border-[var(--border-medium)]',
  accent: 'text-[var(--color-accent)] bg-[var(--color-accent-bg)] border-[var(--color-accent)]/30',
  success: 'text-[var(--color-success)] bg-[var(--color-success-bg)] border-[var(--color-success)]/30',
  warning: 'text-[var(--color-warning)] bg-[var(--color-warning-bg)] border-[var(--color-warning)]/30',
  error: 'text-[var(--color-error)] bg-[var(--color-error-bg)] border-[var(--color-error)]/30',
};

export default function Badge({ tone = 'neutral', className = '', children, ...rest }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${TONES[tone] || TONES.neutral} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
