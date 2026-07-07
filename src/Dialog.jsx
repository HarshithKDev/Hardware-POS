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
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
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
        className="w-[85%] max-w-[400px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl"
        style={{
          backgroundColor: 'var(--bg-secondary)',
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
      <div className="flex justify-between items-center px-6 pt-6 pb-2">
        <span
          id={labelId}
          className="text-base font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </span>
      </div>

      {/* Body */}
      <div className="px-6 py-4">
        <p id={descId} className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
      </div>

      {/* Footer */}
      <div className="px-6 pb-6 pt-2 flex justify-end">
        <button
          onClick={onClose}
          className="h-10 px-6 text-sm font-medium rounded-md"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
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
      {/* Title */}
      <div className="flex justify-between items-center px-6 pt-6 pb-2">
        <span
          id={labelId}
          className="text-base font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </span>
      </div>

      {/* Body */}
      <div className="px-6 py-4">
        <p id={descId} className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
      </div>

      {/* Footer */}
      <div className="px-6 pb-6 pt-2 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="h-10 px-6 text-sm font-medium rounded-md border border-[var(--border-light)] hover:bg-[var(--bg-hover)] transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--text-primary)',
          }}
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          className="h-10 px-6 text-sm font-medium rounded-md transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogOverlay>
  );
}
