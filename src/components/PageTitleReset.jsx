import { useState } from 'react';
import { RotateCcw } from 'lucide-react';

/**
 * Reusable page title with an integrated reset action.
 * Allows users to reset page filters, searches, and states to their initial defaults by clicking the title.
 *
 * @param {string} title - The title text (e.g. "Store Inventory Actions", "Sales History")
 * @param {Function} onReset - Callback invoked to reset page state
 * @param {string} [subtitle] - Optional subtitle text rendered underneath
 * @param {string} [className] - Optional custom CSS classes for the container
 * @param {string} [tag="h1"] - HTML heading tag ("h1" or "h2")
 * @param {string} [tooltip] - Custom tooltip text
 */
export default function PageTitleReset({
  title,
  onReset,
  subtitle,
  className = '',
  tag: HeadingTag = 'h1',
  tooltip = 'Click title to reset page to default state',
  extra
}) {
  const [isRotating, setIsRotating] = useState(false);

  const handleClick = (e) => {
    e.preventDefault();
    setIsRotating(true);
    setTimeout(() => setIsRotating(false), 500);
    if (onReset) onReset();
  };

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-center gap-3">
        <div className="group inline-flex items-center gap-2.5 transition-all hover:opacity-85">
          {/* The title resets on click with a mouse (desktop habit). On phones a tap on the
              title does nothing, so filters are never reset by accident; the ↻ button does it. */}
          <button
            type="button"
            onClick={handleClick}
            className="tap-area relative inline-flex items-center text-left cursor-pointer select-none p-0 bg-transparent border-0 focus:outline-none w-fit transition-all active:scale-[0.99] max-md:pointer-events-none"
            title={tooltip}
            aria-label={`${title} - Click to reset`}
          >
            <HeadingTag
              className="text-xl sm:text-2xl font-semibold m-0 leading-tight transition-colors group-hover:text-[var(--color-accent)]"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </HeadingTag>
          </button>
          <button
            type="button"
            onClick={handleClick}
            title={tooltip}
            aria-label="Reset filters"
            className={`tap-area relative p-1 rounded-md bg-transparent border-0 cursor-pointer text-[var(--text-tertiary)] group-hover:text-[var(--color-accent)] group-hover:bg-[var(--bg-tertiary)] focus:outline-none transition-all duration-300 ${
              isRotating ? '-rotate-180 text-[var(--color-accent)]' : ''
            }`}
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {extra}
      </div>
      {subtitle && (
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          {subtitle}
        </p>
      )}
    </div>
  );
}
