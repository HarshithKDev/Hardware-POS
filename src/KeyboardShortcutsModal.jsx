import React, { useEffect } from 'react';
import { X, Keyboard, ShoppingBag, CreditCard, Layers, Navigation, Info } from 'lucide-react';
import { DialogOverlay } from './Dialog';

export default function KeyboardShortcutsModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'F1') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sections = [
    {
      title: 'Checkout & Billing',
      icon: <ShoppingBag className="w-4 h-4 text-[var(--color-accent)]" />,
      shortcuts: [
        { keys: ['F2', '/'], description: 'Focus Barcode Scanner / Product Search' },
        { keys: ['F4', 'Space'], description: 'Open Checkout & Payment Modal' },
        { keys: ['F7'], description: 'Hold Active Cart' },
        { keys: ['F8'], description: 'Clear / Cancel Current Cart' },
      ],
    },
    {
      title: 'Payment Modal',
      icon: <CreditCard className="w-4 h-4 text-emerald-400" />,
      shortcuts: [
        { keys: ['1', 'C'], description: 'Select Cash Payment' },
        { keys: ['2', 'U'], description: 'Select UPI Payment' },
        { keys: ['3', 'S'], description: 'Select Split (Cash + UPI)' },
        { keys: ['4', 'H'], description: 'Select Showroom (Pending)' },
        { keys: ['Enter ↵'], description: 'Complete Sale / Confirm Payment' },
        { keys: ['Esc'], description: 'Cancel & Close Payment Modal' },
      ],
    },
    {
      title: 'Cart Navigation & Quantities',
      icon: <Layers className="w-4 h-4 text-amber-400" />,
      shortcuts: [
        { keys: ['↑', '↓'], description: 'Navigate and select items in the cart' },
        { keys: ['+'], description: 'Increase quantity of selected item' },
        { keys: ['-'], description: 'Decrease quantity of selected item' },
        { keys: ['Del'], description: 'Remove selected item from cart' },
      ],
    },
    {
      title: 'Navigation & Screens',
      icon: <Navigation className="w-4 h-4 text-sky-400" />,
      shortcuts: [
        { keys: ['F1', '?'], description: 'Open this Keyboard Shortcuts Cheatsheet' },
        { keys: ['Alt', 'D'], description: 'Return to Staff Dashboard' },
        { keys: ['Alt', '1'], description: 'Switch to Billing / Checkout Counter' },
        { keys: ['Alt', '2'], description: 'Switch to Receive Stock' },
        { keys: ['Alt', '3'], description: 'Switch to Move Stock (Transfer)' },
        { keys: ['Esc'], description: 'Close any modal / clear current focus' },
      ],
    },
  ];

  return (
    <DialogOverlay isOpen={true} onClose={onClose} zIndex={10000}>
      <div 
        className="w-[95%] max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl border animate-scale-in"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border-medium)',
          color: 'var(--text-primary)'
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}
        >
          <div className="flex items-center gap-3">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}
            >
              <Keyboard className="w-5 h-5 text-[var(--color-accent)]" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>Keyboard Shortcuts</span>
                <span 
                  className="text-[10px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold"
                  style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                >
                  POS Speed Mode
                </span>
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">Run your billing counter without touching the mouse</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {sections.map((section, idx) => (
            <div key={idx} className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] pb-1 border-b border-[var(--border-light)]">
                {section.icon}
                <span>{section.title}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {section.shortcuts.map((sc, sIdx) => (
                  <div
                    key={sIdx}
                    className="flex items-center justify-between p-2.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)]"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      borderColor: 'var(--border-light)'
                    }}
                  >
                    <span className="text-xs font-medium text-[var(--text-secondary)] pr-3">
                      {sc.description}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {sc.keys.map((k, kIdx) => (
                        <React.Fragment key={kIdx}>
                          <kbd
                            className="px-2 py-1 text-xs font-mono font-bold rounded shadow-sm border"
                            style={{
                              backgroundColor: 'var(--bg-secondary)',
                              borderColor: 'var(--border-medium)',
                              color: 'var(--text-primary)'
                            }}
                          >
                            {k}
                          </kbd>
                          {kIdx < sc.keys.length - 1 && (
                            <span className="text-[10px] font-bold text-[var(--text-tertiary)]">/</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-between px-6 py-3 border-t shrink-0 text-xs text-[var(--text-secondary)]"
          style={{ borderColor: 'var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}
        >
          <span className="flex items-center gap-1.5">
            <Info size={13} className="text-[var(--color-accent)] inline shrink-0" />
            <span>Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-medium)] font-mono font-bold text-[10px] text-[var(--text-primary)]">F1</kbd> anytime to open this guide</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            Got it (Esc)
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
