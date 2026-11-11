import { forwardRef, useId } from 'react';

/** Small label used above form controls (one style everywhere). */
export function FieldLabel({ htmlFor, children, required = false, hint, className = '' }) {
  return (
    <label htmlFor={htmlFor} className={`flex items-center justify-between gap-2 mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] ${className}`}>
      <span>
        {children}
        {required && <span className="ml-0.5 text-[var(--color-error)]" aria-hidden="true">*</span>}
      </span>
      {hint && <span className="normal-case tracking-normal font-normal text-[var(--text-tertiary)]">{hint}</span>}
    </label>
  );
}

const SIZES = {
  md: 'h-10 text-sm',
  lg: 'h-12 text-xl font-bold',
};

/**
 * Shared text/number input with optional label, prefix (e.g. ₹), suffix (e.g. ft / PCS),
 * hint and inline error. Extra props go to the <input>.
 */
const Input = forwardRef(function Input(
  { label, required, hint, error, prefix, suffix, size = 'md', id, className = '', inputClassName = '', ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;
  const borderColor = error ? 'border-[var(--color-error)]' : 'border-[var(--border-input)] focus-within:border-[var(--color-accent)]';
  return (
    <div className={className}>
      {label && <FieldLabel htmlFor={inputId} required={required} hint={hint}>{label}</FieldLabel>}
      <div className={`flex items-center gap-2 px-3 rounded-md border bg-[var(--bg-input)] transition-colors ${borderColor} ${SIZES[size] || SIZES.md}`}>
        {prefix && <span className="shrink-0 text-[var(--text-secondary)] font-semibold">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          required={required}
          className={`w-full h-full min-w-0 bg-transparent text-[var(--text-input)] placeholder:text-[var(--text-tertiary)] ${inputClassName}`}
          style={{ outline: 'none', border: 'none', boxShadow: 'none', padding: 0, fontSize: 'inherit', fontWeight: 'inherit' }}
          {...rest}
        />
        {suffix && <span className="shrink-0 text-sm font-semibold text-[var(--text-secondary)]">{suffix}</span>}
      </div>
      {error && typeof error === 'string' && (
        <p id={`${inputId}-error`} className="mt-1 text-xs font-semibold text-[var(--color-error)]">{error}</p>
      )}
    </div>
  );
});

export default Input;
