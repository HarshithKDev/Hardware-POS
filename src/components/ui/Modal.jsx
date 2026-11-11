import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Popups sit above the app's top bar (z-index 9999) but below alerts/notices (99999).
const MODAL_LAYER_BASE = 10000;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const WIDTHS = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-[660px]', xl: 'sm:max-w-3xl' };

/**
 * Shared modal shell: dark overlay, centred panel (bottom sheet on phones), header with
 * title/subtitle/close, scrolling body and a footer for actions.
 *
 *  - role="dialog", aria-modal, aria-labelledby
 *  - Tab stays inside the modal; focus returns to where it was when the modal closes
 *  - Esc calls onClose, unless `closeOnEsc={false}` (screens that already handle their
 *    own keys, like the checkout counter, keep doing so)
 *  - An element with autoFocus inside keeps its focus; otherwise the first control is focused
 *    (focusFirst={false} skips that).
 *  - restoreFocus={false}: don't move focus back on close. The checkout counter uses this so
 *    Enter/Space after closing a modal can't re-press the button that opened it.
 *  - Rendered at the top of the page (portal) and above the top bar (which uses z 9999);
 *    zIndex keeps each screen's existing order between popups.
 */
export default function Modal({
  isOpen = true,
  onClose,
  title,
  subtitle,
  titleId = 'modal-title',
  size = 'md',
  zIndex = 100,
  closeOnEsc = true,
  focusFirst = true,
  restoreFocus = true,
  closeOnBackdrop = false,
  showClose = true,
  footer,
  as: Panel = 'div',
  onSubmit,
  bodyClassName = 'p-5',
  children,
}) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.activeElement;
    const panel = panelRef.current;
    if (focusFirst && panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector('[autofocus]') || panel.querySelector(FOCUSABLE);
      first?.focus();
    }
    const onKeyDown = (e) => {
      if (!panelRef.current) return;
      if (e.key === 'Escape' && closeOnEsc && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!panelRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (restoreFocus && previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    };
  }, [isOpen, closeOnEsc, focusFirst, restoreFocus]);

  if (!isOpen) return null;

  const overlay = (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 print:hidden animate-fade-in"
      style={{ zIndex: MODAL_LAYER_BASE + zIndex }}
      role="presentation"
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.(); }}
    >
      <Panel
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        onSubmit={onSubmit}
        className={`w-full ${WIDTHS[size] || WIDTHS.md} max-h-[92dvh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-[var(--border-light)] shadow-2xl bg-[var(--bg-secondary)] text-[var(--text-primary)] animate-scale-in`}
      >
        {(title || showClose) && (
          <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-[var(--border-light)] shrink-0">
            <div className="min-w-0">
              {title && <h3 id={titleId} className="text-base font-semibold text-[var(--text-primary)] break-words">{title}</h3>}
              {subtitle && <p className="mt-0.5 text-xs text-[var(--text-secondary)] break-words">{subtitle}</p>}
            </div>
            {showClose && onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                title="Close (Esc)"
                className="-mr-2 -mt-0.5 p-1.5 rounded-md shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
        {footer && (
          <div
            className="px-5 py-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] shrink-0"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </Panel>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}