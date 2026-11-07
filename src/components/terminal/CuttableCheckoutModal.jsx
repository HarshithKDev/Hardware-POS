import React, { useState, useEffect, useRef } from 'react';

export default function CuttableCheckoutModal({
  isOpen,
  modalData, // { item, batch, cartItemId, initialCutPieces, initialCutLength }
  cart = [],
  onSubmit,
  onClose
}) {
  const [qty, setQty] = useState('1');
  const [length, setLength] = useState('');
  const lengthInputRef = useRef(null);

  useEffect(() => {
    if (isOpen && modalData?.item) {
      const defLen = modalData.item.default_length ? String(modalData.item.default_length) : '12';
      setQty(String(modalData?.initialCutPieces || '1'));
      setLength(modalData?.initialCutLength !== undefined && modalData?.initialCutLength !== null 
        ? String(modalData.initialCutLength) 
        : defLen
      );
      setTimeout(() => {
        if (lengthInputRef.current) {
          lengthInputRef.current.focus();
          lengthInputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, modalData]);

  // Handle ESC key to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !modalData?.item) return null;

  const { item, batch } = modalData;
  const isSqft = item.unit === 'SQFT';
  const defaultLen = Number(item.default_length) || (isSqft ? 100 : 12);
  const defaultWid = isSqft ? (Number(item.default_width) || 3) : 1;
  const unitLabel = isSqft ? 'sqft' : (item.unit || 'ft');
  const unitPrice = Number(batch?.selling_price ?? (item.price || 0));

  // Store stock available (excluding current cart reservations for this batch)
  const totalStoreStock = batch 
    ? Number(batch.stock_store || 0)
    : (item.batches?.reduce((sum, b) => sum + Number(b.stock_store || 0), 0) || Number(item.stock_store || 0));

  const alreadyInCart = (cart || [])
    .filter(c => {
      if (modalData?.cartItemId && c.id === modalData.cartItemId) return false;
      if (batch?.batch_id) {
        return c.barcode === item.barcode && c.batch_id === batch.batch_id;
      }
      return c.barcode === item.barcode;
    })
    .reduce((sum, c) => {
      const q = c.actual_quantity !== undefined && c.actual_quantity !== ''
        ? Number(c.actual_quantity)
        : (c.quantity !== undefined && c.quantity !== '' ? Number(c.quantity) : 0);
      return sum + q;
    }, 0);

  const availableStock = Math.max(0, Math.round((totalStoreStock - alreadyInCart) * 100) / 100);

  const parsedQty = parseFloat(qty) || 0;
  const parsedLength = parseFloat(length) || 0;

  // Total quantity calculation:
  // For pipes: qty * length
  // For mesh: qty * length * fixed width (height)
  const totalQty = isSqft
    ? Math.round(parsedQty * parsedLength * defaultWid * 100) / 100
    : Math.round(parsedQty * parsedLength * 100) / 100;

  const totalBill = Math.round(totalQty * unitPrice * 100) / 100;
  const isOutOfStock = totalQty > availableStock;
  const isLengthExceeded = parsedLength > defaultLen;

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (totalQty <= 0 || isOutOfStock || isLengthExceeded) return;
    onSubmit({
      item,
      batch,
      cartItemId: modalData?.cartItemId || null,
      billableQty: totalQty,
      deductQty: totalQty,
      cutPieces: parsedQty,
      cutLength: parsedLength,
      is_full_piece: parsedLength === defaultLen,
      scrapAction: null,
      scrapLeftover: 0
    });
  };

  const batchStr = batch?.batch_number ? `Batch #${String(batch.batch_number).padStart(2, '0')}` : null;
  const specStr = isSqft ? `${defaultWid} ft Height Roll` : `${defaultLen} ${unitLabel} Standard`;

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-md flex flex-col rounded-xl overflow-hidden shadow-2xl border border-[var(--border-light)] bg-[var(--bg-secondary)]">
        {/* Header */}
        <div className="flex justify-between items-start px-6 pt-5 pb-3">
          <div className="pr-4">
            <h3 className="font-bold text-base text-[var(--text-primary)] leading-snug">
              {item.name}
            </h3>
            <p className="text-xs text-[var(--text-tertiary)] mt-1 flex flex-wrap items-center gap-1.5 font-medium">
              <span>{specStr}</span>
              {batchStr && <span>· {batchStr}</span>}
              <span>· ₹{unitPrice.toFixed(2)}/{unitLabel}</span>
              <span className={`font-semibold ${availableStock > 0 ? 'text-[var(--text-secondary)]' : 'text-red-400'}`}>
                · {availableStock > 0 ? `${availableStock} ${unitLabel} in stock` : 'Out of stock'}
              </span>
            </p>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Minimal Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-5 pt-2 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Cut Length */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                Length to Cut
              </label>
              <div className="relative">
                <input
                  ref={lengthInputRef}
                  type="number"
                  step="any"
                  min="0.1"
                  max={defaultLen}
                  value={length}
                  onChange={e => setLength(e.target.value)}
                  className={`w-full h-11 pl-3 pr-8 text-base font-bold rounded-lg border bg-[var(--bg-input)] text-[var(--text-input)] focus:outline-none transition-colors ${
                    isLengthExceeded 
                      ? 'border-red-500 focus:border-red-500 text-red-400' 
                      : 'border-[var(--border-medium)] focus:border-[var(--color-accent)]'
                  }`}
                  placeholder={String(defaultLen)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-tertiary)] uppercase">
                  {isSqft ? 'ft' : unitLabel}
                </span>
              </div>
              <span className="block text-[11px] text-[var(--text-tertiary)] mt-1">
                Max {defaultLen} {isSqft ? 'ft' : unitLabel}
              </span>
            </div>

            {/* Pieces */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                Pieces
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={qty}
                onChange={e => setQty(e.target.value)}
                className="w-full h-11 px-3 text-base font-bold rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-input)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
                placeholder="1"
              />
              <span className="block text-[11px] text-[var(--text-tertiary)] mt-1">
                Number of cuts
              </span>
            </div>
          </div>

          {/* Validation Messages (only shown when invalid) */}
          {isLengthExceeded && (
            <p className="text-xs text-red-400 font-medium -mt-1">
              Length ({parsedLength} {isSqft ? 'ft' : unitLabel}) cannot exceed max {defaultLen} {isSqft ? 'ft' : unitLabel}.
            </p>
          )}

          {isOutOfStock && !isLengthExceeded && (
            <p className="text-xs text-red-400 font-medium -mt-1">
              Insufficient stock! Only {availableStock} {unitLabel} available{alreadyInCart > 0 ? ` (${alreadyInCart} in cart)` : ''}.
            </p>
          )}

          {/* Integrated Minimal Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border-light)] mt-1">
            <div>
              <div className="text-xl font-bold text-[var(--text-primary)]">
                ₹{totalBill.toFixed(2)}
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-medium">
                <span className="text-[var(--text-secondary)] font-semibold">{totalQty} {unitLabel}</span>
                {parsedQty > 0 && parsedLength > 0 && (
                  <span className="ml-1">
                    ({isSqft 
                      ? `${parsedQty} × ${parsedLength} ft × ${defaultWid} ft H` 
                      : `${parsedQty} × ${parsedLength} ${unitLabel}`})
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 text-xs font-semibold rounded-lg border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={totalQty <= 0 || isOutOfStock || isLengthExceeded}
                className="h-9 px-5 text-xs font-bold rounded-lg text-white bg-[var(--color-accent)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm"
              >
                {modalData?.cartItemId ? 'Update' : 'Add to Bill'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
