import { useEffect, useRef, useCallback } from 'react';
import Button from './components/ui/Button';

// ---------------------------------------------------------------
// Shared Dialog components with proper accessibility:
//  - role="dialog", aria-modal, aria-labelledby, aria-describedby
//  - Focus trapping (Tab/Shift+Tab cycle within modal)
//  - Escape key to close
//
// Replaces the 3 copy-pasted modal implementations that existed
// in OwnerDashboard, WorkerBilling, and AppModals.
// ---------------------------------------------------------------

/**
 * Traps focus within a dialog element. Returns a ref to attach to
 * the dialog container.
 */
function useFocusTrap(isOpen) {
  const containerRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Remember what was focused before the dialog opened
    previousFocusRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    // Focus the first focusable element inside the dialog
    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = container.querySelectorAll(focusableSelector);
    if (focusables.length > 0) focusables[0].focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') return; // Handled separately by onClose

      if (e.key === 'Tab') {
        const currentFocusables = container.querySelectorAll(focusableSelector);
        if (currentFocusables.length === 0) return;

        const first = currentFocusables[0];
        const last = currentFocusables[currentFocusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus when dialog closes
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  return containerRef;
}

/**
 * Base dialog overlay. Handles backdrop, centering, escape key, and focus trap.
 */
export function DialogOverlay({ isOpen, onClose, children, labelId, maxWidth = '400px' }) {
  const containerRef = useFocusTrap(isOpen);

  const handleEscape = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[30000] px-4 print:hidden animate-fade-in"
      style={{ backgroundColor: 'var(--overlay-bg)' }}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className="w-[94%] sm:w-full flex flex-col rounded-2xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl"
        style={{
          maxWidth: maxWidth,
          backgroundColor: 'var(--bg-secondary)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Alert Dialog / Toast — informational message that slides from top and auto-dismisses.
 */
export function AlertDialog({ isOpen, title, message, onClose }) {
  useEffect(() => {
    if (isOpen) {
      // Dynamic timer: give longer messages more reading time (3.5s - 7s)
      const msgLen = typeof message === 'string' ? message.length : 0;
      const duration = Math.min(7000, Math.max(3000, msgLen * 40));
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose, message]);

  if (!isOpen) return null;

  let borderColorStyle = 'var(--border-medium)';
  let titleColor = 'var(--text-primary)';
  const lowerTitle = (title || '').toLowerCase();
  
  if (lowerTitle.includes('success') || lowerTitle.includes('restored') || lowerTitle.includes('backup') || lowerTitle.includes('download') || lowerTitle.includes('export')) {
    borderColorStyle = 'var(--color-success)';
    titleColor = 'var(--color-success)';
  } else if (lowerTitle.includes('error') || lowerTitle.includes('fail') || lowerTitle.includes('invalid')) {
    borderColorStyle = 'var(--color-error)'; // red
    titleColor = 'var(--color-error)';
  } else if (lowerTitle.includes('warn') || lowerTitle.includes('limit') || lowerTitle.includes('notice') || lowerTitle.includes('missing') || lowerTitle.includes('required') || lowerTitle.includes('expired')) {
    borderColorStyle = 'var(--color-warning)';
    titleColor = 'var(--color-warning)';
  } else if (lowerTitle.includes('info')) {
    borderColorStyle = 'var(--color-accent)';
    titleColor = 'var(--color-accent)';
  }

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 px-4 animate-fade-in-down print:hidden pointer-events-none w-full max-w-lg md:max-w-xl z-[99999]">
      <div 
        onClick={onClose}
        className="flex items-start justify-between gap-3 px-5 py-4 rounded-xl shadow-2xl pointer-events-auto cursor-pointer transition-transform hover:scale-[1.01] overflow-hidden"
        style={{ 
          backgroundColor: 'var(--bg-secondary)',
          border: `1px solid ${borderColorStyle}`,
          borderLeft: `4px solid ${borderColorStyle}`
        }}
      >
        <div className="flex-1 min-w-0 text-left">
          {title && title !== 'Notice' && title !== 'Info' && (
            <p className="text-sm font-bold mb-1.5 flex items-center gap-1.5" style={{ color: titleColor }}>
              <span>{title}</span>
            </p>
          )}
          <p 
            className="text-xs sm:text-sm font-medium leading-relaxed whitespace-pre-line break-words [overflow-wrap:anywhere]" 
            style={{ color: 'var(--text-secondary)' }}
          >
            {message}
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded-md transition-colors shrink-0 -mr-1 -mt-1 cursor-pointer"
          aria-label="Close notification" title="Close notification"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Confirm Dialog — asks the user to confirm or cancel an action.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
}) {
  const labelId = 'confirm-dialog-title';
  const descId = 'confirm-dialog-desc';

  return (
    <DialogOverlay isOpen={isOpen} onClose={onCancel} labelId={labelId}>
      {/* Title */}
      <div className="flex justify-between items-center px-5 sm:px-6 pt-5 sm:pt-6 pb-2">
        <span
          id={labelId}
          className="text-base font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </span>
      </div>

      {/* Body */}
      <div className="px-5 sm:px-6 py-3 sm:py-4">
        <p id={descId} className="text-sm leading-relaxed whitespace-pre-line break-words [overflow-wrap:anywhere]" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
      </div>

      {/* Footer */}
      <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-2 flex items-center justify-end gap-2.5">
        <Button variant="secondary" onClick={onCancel} className="flex-1 sm:flex-none h-11 sm:h-10 sm:px-6">
          {cancelLabel}
        </Button>
        <Button variant={isDestructive ? 'danger' : 'primary'} onClick={onConfirm} className="flex-1 sm:flex-none h-11 sm:h-10 sm:px-6">
          {confirmLabel}
        </Button>
      </div>
    </DialogOverlay>
  );
}
