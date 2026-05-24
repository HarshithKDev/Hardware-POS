import { useEffect, useRef, useCallback } from 'react';

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
function DialogOverlay({ isOpen, onClose, children, labelId }) {
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
      className="fixed inset-0 flex items-center justify-center z-[100] px-4 print:hidden animate-fade-in"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
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
        className="w-[95%] max-w-[400px] flex flex-col shadow-lg animate-scale-in"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: 'var(--border-medium)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Alert Dialog — informational message with an OK/Acknowledge button.
 */
export function AlertDialog({ isOpen, title, message, onClose, buttonLabel = 'OK' }) {
  const labelId = 'alert-dialog-title';
  const descId = 'alert-dialog-desc';

  return (
    <DialogOverlay isOpen={isOpen} onClose={onClose} labelId={labelId}>
      {/* Title bar */}
      <div
        className="flex justify-between items-center pr-1 pl-4 py-1"
        style={{
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          borderBottomColor: 'var(--border-light)',
        }}
      >
        <span
          id={labelId}
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </span>
        <button
          onClick={onClose}
          className="px-3 py-1.5 leading-none transition-colors focus:outline-none focus:ring-1"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = 'var(--color-error)';
            e.target.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'transparent';
            e.target.style.color = 'var(--text-secondary)';
          }}
          aria-label="Close dialog"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="p-6" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <p id={descId} className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {message}
        </p>
      </div>

      {/* Footer */}
      <div
        className="p-4 flex justify-end"
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          borderTopWidth: '1px',
          borderTopStyle: 'solid',
          borderTopColor: 'var(--border-light)',
        }}
      >
        <button
          onClick={onClose}
          className="px-6 py-1.5 text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black"
          style={{ backgroundColor: 'var(--color-accent)' }}
          onMouseEnter={(e) => (e.target.style.backgroundColor = 'var(--color-accent-hover)')}
          onMouseLeave={(e) => (e.target.style.backgroundColor = 'var(--color-accent)')}
        >
          {buttonLabel}
        </button>
      </div>
    </DialogOverlay>
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
}) {
  const labelId = 'confirm-dialog-title';
  const descId = 'confirm-dialog-desc';

  return (
    <DialogOverlay isOpen={isOpen} onClose={onCancel} labelId={labelId}>
      {/* Title bar */}
      <div
        className="flex justify-between items-center pr-1 pl-4 py-1"
        style={{
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          borderBottomColor: 'var(--border-light)',
        }}
      >
        <span
          id={labelId}
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </span>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 leading-none transition-colors focus:outline-none focus:ring-1"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = 'var(--color-error)';
            e.target.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'transparent';
            e.target.style.color = 'var(--text-secondary)';
          }}
          aria-label="Close dialog"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="p-6" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <p id={descId} className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {message}
        </p>
      </div>

      {/* Footer */}
      <div
        className="p-4 flex justify-end gap-2"
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          borderTopWidth: '1px',
          borderTopStyle: 'solid',
          borderTopColor: 'var(--border-light)',
        }}
      >
        <button
          onClick={onConfirm}
          className="px-6 py-1.5 text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black"
          style={{ backgroundColor: 'var(--color-accent)' }}
          onMouseEnter={(e) => (e.target.style.backgroundColor = 'var(--color-accent-hover)')}
          onMouseLeave={(e) => (e.target.style.backgroundColor = 'var(--color-accent)')}
        >
          {confirmLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-1.5 text-sm focus:outline-none focus:ring-1"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--border-medium)',
          }}
          onMouseEnter={(e) => (e.target.style.backgroundColor = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.target.style.backgroundColor = 'var(--bg-tertiary)')}
        >
          {cancelLabel}
        </button>
      </div>
    </DialogOverlay>
  );
}
