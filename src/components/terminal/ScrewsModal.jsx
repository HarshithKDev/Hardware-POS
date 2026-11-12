import { useState, useEffect } from 'react';
import { formatINR } from '../../utils';
import { Modal, Button, Input } from '../ui';

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

  const isValid = Boolean(price) && Number(price) > 0;

  return (
    <Modal
      as="form"
      onSubmit={handleSubmit}
      onClose={onClose}
      title={isUpdate ? 'Update Screws Total' : 'Include Screws'}
      subtitle="Untracked item · Fixed total (never discounted)"
      titleId="screws-modal-title"
      size="sm"
      zIndex={150}
      focusFirst={false}
      restoreFocus={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!isValid} className="min-w-[120px]">
            {isUpdate ? 'Update Screws' : 'Add to Bill'}
          </Button>
        </>
      )}
    >
      <Input
        id="screws-modal-price"
        label="Total Price (₹)"
        required
        size="lg"
        type="number"
        inputMode="decimal"
        step="any"
        min="1"
        autoFocus
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="e.g. 30"
        prefix="₹"
      />

      {/* Quick presets */}
      <div className="grid grid-cols-5 gap-2 mt-3">
        {[10, 20, 30, 50, 100].map((val) => {
          const isSelected = Number(price) === val;
          return (
            <button
              key={val}
              type="button"
              onClick={() => setPrice(String(val))}
              aria-pressed={isSelected}
              className={`h-8 text-xs font-semibold rounded-md border transition-colors cursor-pointer tabular-nums ${isSelected
                ? 'bg-[var(--color-accent-solid)] border-[var(--color-accent-solid)] text-white'
                : 'bg-[var(--bg-tertiary)] border-[var(--border-medium)] text-[var(--text-primary)] hover:border-[var(--color-accent)]'}`}
            >
              ₹{formatINR(val, 0)}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
