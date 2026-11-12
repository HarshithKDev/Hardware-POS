import { forwardRef } from 'react';
import { Spinner } from '../../SharedUI';

/**
 * Shared button. One look for the whole app.
 *  variant: primary (solid blue) | success (solid green) | danger (solid red)
 *           | warning (solid amber) | secondary (neutral outline) | ghost (no border)
 *           | danger-outline (red text, for destructive actions that open a confirm)
 *  size:    sm = 32px (table/inline) · md = 40px (default) · lg = 48px (main counter actions)
 *  loading: shows a spinner, keeps the button width and disables it.
 */
const VARIANTS = {
  primary: 'text-white bg-[var(--color-accent-solid)] hover:bg-[var(--color-accent-solid-hover)] border border-transparent',
  success: 'text-white bg-[var(--color-success-solid)] hover:bg-[var(--color-success-solid-hover)] border border-transparent',
  danger: 'text-white bg-[var(--color-error-solid)] hover:bg-[var(--color-error-solid-hover)] border border-transparent',
  warning: 'text-[var(--color-warning-on-solid)] bg-[var(--color-warning-solid)] hover:brightness-95 border border-transparent',
  secondary: 'text-[var(--text-primary)] bg-transparent border border-[var(--border-medium)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-heavy)]',
  ghost: 'text-[var(--text-secondary)] bg-transparent border border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
  'danger-outline': 'text-[var(--color-error)] bg-transparent border border-[var(--color-error)]/50 hover:bg-[var(--color-error-bg)]',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

// Positioned buttons keep their own position; all others become relative so the touch area can attach.
const positionFor = (className) => (/(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className) ? '' : 'relative');

export const buttonClass = ({ variant = 'secondary', size = 'md', fullWidth = false, className = '' } = {}) =>
  `tap-area ${positionFor(className)} inline-flex items-center justify-center shrink-0 rounded-md font-semibold whitespace-nowrap transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant] || VARIANTS.secondary} ${SIZES[size] || SIZES.md} ${fullWidth ? 'w-full' : ''} ${className}`;

const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', type = 'button', loading = false, fullWidth = false, disabled, className = '', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, fullWidth, className: `relative ${className}` })}
      {...rest}
    >
      {loading ? (
        <>
          {/* keep the label in the layout (invisible) so the button keeps its width */}
          <span className="invisible inline-flex items-center gap-2">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center"><Spinner className="w-4 h-4" /></span>
        </>
      ) : children}
    </button>
  );
});

export default Button;
