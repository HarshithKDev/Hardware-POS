import React, { useState, useEffect, useRef } from 'react';

export default function ReceiveCuttableModal({
  isOpen,
  modalData, // { item, batch, action: 'receive' | 'transfer' }
  cart = [],
  onSubmit,
  onClose
}) {
  const [piecesInput, setPiecesInput] = useState('1');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setPiecesInput('1');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen]);

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

  const { item, batch, action = 'receive' } = modalData;
  const isSqft = item.unit === 'SQFT';
  const defaultLen = Number(item.default_length) || (isSqft ? 100 : 12);
  const defaultWid = isSqft ? (Number(item.default_width) || 3) : 1;
  const unitLabel = isSqft ? 'sqft' : (item.unit || 'ft');

  const pieces = Math.max(1, parseInt(piecesInput, 10) || 1);
  const totalDimension = isSqft 
    ? Math.round(pieces * defaultWid * defaultLen * 100) / 100 
    : Math.round(pieces * defaultLen * 100) / 100;

  const isTransfer = action === 'transfer';
  const totalWhStock = Number(batch?.stock_warehouse ?? (item?.stock_warehouse || 0));
  const alreadyInTransferCart = isTransfer
    ? (cart || [])
        .filter(c => c.barcode === item.barcode && (!batch?.batch_id || c.batch_id === batch.batch_id))
        .reduce((sum, c) => sum + (Number(c.actual_quantity !== undefined ? c.actual_quantity : c.quantity) || 0), 0)
    : 0;
  const availableWhStock = Math.max(0, totalWhStock - alreadyInTransferCart);
  const pieceDimension = isSqft ? (defaultWid * defaultLen) : defaultLen;
  const maxAvailablePieces = isTransfer
    ? Math.floor(availableWhStock / pieceDimension)
    : null;

  const isExceeded = maxAvailablePieces !== null && pieces > maxAvailablePieces;

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (pieces <= 0 || isExceeded) return;
    onSubmit({
      pieces,
      totalDimension,
      item,
      batch
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-md flex flex-col rounded-xl overflow-hidden shadow-2xl border border-[var(--border-light)] bg-[var(--bg-secondary)]">
        {/* Header */}
        <div className="flex justify-between items-start px-6 pt-5 pb-3">
          <div className="pr-4">
            <h3 className="font-bold text-base text-[var(--text-primary)] leading-snug">
              {isTransfer ? 'Move Stock to Store' : 'Receive Stock'}
            </h3>
            <p className="text-xs text-[var(--text-tertiary)] mt-1 flex flex-wrap items-center gap-1.5 font-medium">
              <span className="text-[var(--text-secondary)] font-semibold">{item.name}</span>
              {batch?.batch_number && <span>· Batch #{String(batch.batch_number).padStart(2, '0')}</span>}
              <span>· {isSqft ? `${defaultWid} ft (H) × ${defaultLen} ft (L) (${defaultWid * defaultLen} sqft/roll)` : `${defaultLen} ${unitLabel}/pc`}</span>
              {isTransfer && maxAvailablePieces !== null && (
                <span className="text-[var(--color-warning)] font-semibold">
                  · {maxAvailablePieces} {isSqft ? 'rolls' : 'pcs'} in whse
                </span>
              )}
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
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
              {isSqft ? 'Number of Rolls' : 'Number of Pieces'}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="number"
                min="1"
                step="1"
                max={maxAvailablePieces !== null ? maxAvailablePieces : undefined}
                value={piecesInput}
                onChange={e => setPiecesInput(e.target.value)}
                className={`w-full h-11 pl-3 pr-16 text-base font-bold rounded-lg border bg-[var(--bg-input)] text-[var(--text-input)] focus:outline-none transition-colors ${
                  isExceeded
                    ? 'border-red-500 focus:border-red-500 text-red-400'
                    : 'border-[var(--border-medium)] focus:border-[var(--color-accent)]'
                }`}
                placeholder="1"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-tertiary)] uppercase">
                {isSqft ? 'ROLLS' : 'PCS'}
              </span>
            </div>

            {/* Quick buttons */}
            <div className="flex gap-1.5 mt-2">
              {[1, 5, 10, 20, 50].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPiecesInput(String(n))}
                  className="flex-1 py-1 text-xs font-medium rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-medium)] transition-colors cursor-pointer"
                >
                  +{n}
                </button>
              ))}
            </div>
          </div>

          {isExceeded && (
            <p className="text-xs text-red-400 font-medium -mt-1">
              Only {maxAvailablePieces} {isSqft ? 'rolls' : 'pieces'} available in warehouse ({availableWhStock} {unitLabel}).
            </p>
          )}

          {/* Integrated Minimal Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border-light)] mt-1">
            <div>
              <div className="text-xl font-bold text-[var(--text-primary)]">
                {totalDimension} <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase">{unitLabel}</span>
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-medium">
                {pieces} {isSqft ? (pieces === 1 ? 'roll' : 'rolls') : (pieces === 1 ? 'pc' : 'pcs')}
                <span className="ml-1">
                  ({pieces} × {isSqft ? `${defaultWid * defaultLen} sqft` : `${defaultLen} ${unitLabel}`})
                </span>
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
                disabled={pieces <= 0 || isExceeded}
                className="h-9 px-5 text-xs font-bold rounded-lg text-white bg-[var(--color-accent)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-sm"
              >
                {isTransfer ? 'Transfer Stock' : 'Add Stock'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
