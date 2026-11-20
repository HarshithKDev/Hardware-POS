import { useState } from 'react';
import { formatINR } from '../../utils';
import { Modal, Button, Input } from '../ui';

/**
 * Clean, professional modal for adding untracked screws/fasteners to the bill.
 * Provides quick price presets (₹10, ₹20, ₹30, ₹50, ₹100) and direct input.
 * "Give for free" keeps the entered amount for reference but adds ₹0 to the bill.
 */
export default function ScrewsModal({
  isOpen,
  onClose,
  onSave,
  initialPrice = '',
  initialFree = false,
  isUpdate = false
}) {
  const [price, setPrice] = useState(initialPrice);
  const [isFree, setIsFree] = useState(initialFree);
  // Each time it opens, start from the current screws price (set while rendering, so the
  // previous price never flashes for a frame)
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setPrice(initialPrice || '');
      setIsFree(Boolean(initialFree));
    }
  }

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const num = Number(price);
    if (!price || isNaN(num) || num <= 0) {
      return;
    }
    onSave(num, isFree);
  };

  const isValid = Boolean(price) && Number(price) > 0;

  return (
    <Modal
      as="form"
      onSubmit={handleSubmit}
      onClose={onClose}
      title={isUpdate ? 'Update Screws Total' : 'Include Screws'}
      subtitle={isFree ? 'Untracked item · Given free (₹0 on the bill)' : 'Untracked item · Fixed total (never discounted)'}
      titleId="screws-modal-title"
      size="sm"
      zIndex={150}
      focusFirst={false}
      restoreFocus={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!isValid} className="min-w-[120px]">
            {isUpdate ? 'Update Screws' : (isFree ? 'Add as Free' : 'Add to Bill')}
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

      {/* Free screws: the amount is still entered, but it is not added to the bill total */}
      <label
        htmlFor="screws-modal-free"
        className="mt-4 flex items-start gap-2.5 p-3 rounded-md border cursor-pointer select-none"
        style={{
          backgroundColor: isFree ? 'var(--color-success-bg)' : 'var(--bg-tertiary)',
          borderColor: isFree ? 'var(--color-success)' : 'var(--border-medium)'
        }}
      >
        <input
          id="screws-modal-free"
          type="checkbox"
          checked={isFree}
          onChange={(e) => setIsFree(e.target.checked)}
          className="mt-0.5 w-4 h-4 cursor-pointer accent-[var(--color-accent-solid)]"
        />
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Give screws for free</span>
          <span className="text-xs text-[var(--text-secondary)]">
            {isFree && isValid
              ? `₹${formatINR(Number(price), 2)} of screws will NOT be added to the bill total.`
              : 'The amount is noted, but not added to the bill total.'}
          </span>
        </span>
      </label>
    </Modal>
  );
}
