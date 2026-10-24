import React, { useState, useEffect } from 'react';

/**
 * Clean, professional modal for adding untracked screws/fasteners to the bill.
 * Provides quick price presets (₹10, ₹20, ₹30, ₹50, ₹100) and direct input.
 */
export default function ScrewsModal({
  isOpen,
  onClose,
  onSave,
  initialPrice = '',
  isUpdate = false
}) {
  const [price, setPrice] = useState(initialPrice);

  useEffect(() => {
    if (isOpen) {
      setPrice(initialPrice || '');
    }
  }, [isOpen, initialPrice]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const num = Number(price);
    if (!price || isNaN(num) || num <= 0) {
      return;
    }
    onSave(num);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="screws-modal-title"
    >
      <div
        className="w-full max-w-[380px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl"
        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
      >
        {/* Header */}
        <div className="flex justify-between items-center pr-2.5 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div>
            <h3 id="screws-modal-title" className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              {isUpdate ? 'Update Screws Price' : 'Include Screws'}
            </h3>
            <span className="text-[10px] block opacity-70 mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Untracked item · Fixed price (never discounted)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-5">
            <label htmlFor="screws-modal-price" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
              Sold Price (₹) <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              id="screws-modal-price"
              type="number"
              step="any"
              min="1"
              autoFocus
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 30"
              className="w-full h-12 px-4 text-2xl font-bold rounded-lg focus:outline-none transition-all"
              style={{
                border: '1px solid var(--border-input)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-input)',
                fontSize: '1.5rem',
                lineHeight: '2rem'
              }}
            />

            {/* Quick Preset Pills */}
            <div className="grid grid-cols-5 gap-2 mt-3.5">
              {[10, 20, 30, 50, 100].map((val) => {
                const isSelected = Number(price) === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setPrice(String(val))}
                    className="py-1.5 text-xs font-bold rounded border transition-all cursor-pointer text-center"
                    style={{
                      backgroundColor: isSelected ? 'var(--color-accent)' : 'var(--bg-tertiary)',
                      borderColor: isSelected ? 'var(--color-accent)' : 'var(--border-medium)',
                      color: isSelected ? '#ffffff' : 'var(--text-primary)'
                    }}
                  >
                    ₹{val}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-3.5 flex justify-end gap-2 border-t border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-9 rounded-md text-xs font-bold uppercase tracking-wider border border-[var(--border-medium)] transition-colors cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!price || Number(price) <= 0}
              className="px-5 h-9 rounded-md text-xs font-bold uppercase tracking-wider text-white transition-colors cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {isUpdate ? 'Update Screws' : 'Add to Bill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
