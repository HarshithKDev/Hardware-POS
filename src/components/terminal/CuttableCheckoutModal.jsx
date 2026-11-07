import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';

export default function CuttableCheckoutModal({
  isOpen,
  modalData, // { item, batch, cartItemId, initialCutPieces, initialCutLength }
  cart = [],
  onSubmit,
  onClose
}) {
  const [qty, setQty] = useState('1');
  const [length, setLength] = useState('');
  const qtyInputRef = useRef(null);

  useEffect(() => {
    if (isOpen && modalData?.item) {
      const defLen = modalData.item.default_length ? String(modalData.item.default_length) : '12';
      setQty(String(modalData?.initialCutPieces || '1'));
      setLength(modalData?.initialCutLength !== undefined && modalData?.initialCutLength !== null 
        ? String(modalData.initialCutLength) 
        : defLen
      );
      setTimeout(() => {
        if (qtyInputRef.current) {
          qtyInputRef.current.focus();
          qtyInputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, modalData]);

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
  // For mesh: qty * length * fixed width
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

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-md flex flex-col rounded-xl overflow-hidden shadow-2xl border border-[var(--border-light)] bg-[var(--bg-secondary)]">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--border-light)]">
          <div>
            <h3 className="font-bold text-base text-[var(--text-primary)]">
              {modalData?.cartItemId ? 'Edit Item' : 'Checkout Cuttable Item'}
            </h3>
            <p className="text-xs text-[var(--color-accent)] font-semibold mt-0.5">
              {item.name} {batch?.batch_number ? `(Batch #${String(batch.batch_number).padStart(2, '0')})` : ''}
            </p>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="p-1.5 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stock & Unit Info Header */}
        <div className="px-6 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border-medium)] flex items-center justify-between text-xs">
          <div>
            <span className="text-[var(--text-secondary)]">Available Stock: </span>
            <span className={`font-bold ${availableStock > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
              {availableStock} {unitLabel}
            </span>
            {alreadyInCart > 0 && (
              <span className="text-[var(--text-tertiary)] ml-1 font-medium">
                ({alreadyInCart} {unitLabel} in cart)
              </span>
            )}
          </div>
          <div className="text-right">
            <span className="text-[var(--text-secondary)]">MRP: </span>
            <span className="text-[var(--text-primary)] font-bold">₹{unitPrice.toFixed(2)} / {unitLabel}</span>
          </div>
        </div>

        {/* Simple Form: QTY and Length */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div className="flex gap-3">
            {/* Quantity */}
            <div className={isSqft ? 'w-1/3' : 'w-1/2'}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-[var(--text-secondary)]">
                Quantity (Qty)
              </label>
              <input
                ref={qtyInputRef}
                type="number"
                min="1"
                step="1"
                value={qty}
                onChange={e => setQty(e.target.value)}
                className="w-full h-12 px-3 text-lg font-bold text-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-input)] focus:border-[var(--color-accent)] focus:outline-none"
                placeholder="1"
              />
            </div>

            {/* Cut Length */}
            <div className={isSqft ? 'w-1/3' : 'w-1/2'}>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Length ({isSqft ? 'ft' : unitLabel})
                </label>
                <span className="text-[10px] text-[var(--text-tertiary)] font-medium">
                  Max: {defaultLen} {isSqft ? 'ft' : unitLabel}
                </span>
              </div>
              <input
                type="number"
                step="any"
                min="0.1"
                max={defaultLen}
                value={length}
                onChange={e => setLength(e.target.value)}
                className={`w-full h-12 px-3 text-lg font-bold text-center rounded-lg border bg-[var(--bg-input)] text-[var(--text-input)] focus:outline-none ${
                  isLengthExceeded 
                    ? 'border-red-500 focus:border-red-500 text-red-400' 
                    : 'border-[var(--border-medium)] focus:border-[var(--color-accent)]'
                }`}
                placeholder={String(defaultLen)}
              />
            </div>

            {/* Mesh Fixed Height display */}
            {isSqft && (
              <div className="w-1/3">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-[var(--text-secondary)]">
                  Height
                </label>
                <div className="h-12 flex items-center justify-center font-bold text-sm bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-lg text-[var(--text-primary)]">
                  {defaultWid} ft
                </div>
              </div>
            )}
          </div>

          {/* Bill Calculation Summary Card */}
          <div className="p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-medium)] flex items-center justify-between">
            <div>
              <span className="text-xs text-[var(--text-tertiary)] uppercase font-semibold block">Total Quantity</span>
              <span className="text-xl font-black text-[var(--color-accent)]">
                {totalQty} <span className="text-sm font-bold uppercase">{unitLabel}</span>
              </span>
              <span className="block text-[11px] text-[var(--text-secondary)] mt-0.5">
                {parsedQty} &times; {parsedLength} {isSqft ? 'ft' : unitLabel} {isSqft ? `&times; ${defaultWid} ft H` : ''}
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-[var(--text-tertiary)] uppercase font-semibold block">Total Bill</span>
              <span className="text-2xl font-black text-[var(--color-success)]">
                ₹{totalBill.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Out of Stock Warning */}
          {isOutOfStock && (
            <div className="p-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-red-500/40 text-xs text-red-400 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>
                Insufficient stock! Only {availableStock} {unitLabel} available{alreadyInCart > 0 ? ` (${alreadyInCart} ${unitLabel} already in cart)` : ''}.
              </span>
            </div>
          )}

          {/* Length Exceeded Warning */}
          {isLengthExceeded && (
            <div className="p-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-red-500/40 text-xs text-red-400 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>
                Length per piece ({parsedLength} {isSqft ? 'ft' : unitLabel}) cannot exceed max piece length ({defaultLen} {isSqft ? 'ft' : unitLabel}).
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-5 text-sm font-semibold rounded-lg border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={totalQty <= 0 || isOutOfStock || isLengthExceeded}
              className="h-10 px-8 text-sm font-bold rounded-lg text-white bg-[var(--color-accent)] hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer shadow-md"
            >
              {modalData?.cartItemId ? 'Update' : 'Add to Bill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
