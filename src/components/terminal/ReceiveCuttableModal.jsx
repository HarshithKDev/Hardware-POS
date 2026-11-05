import React, { useState, useEffect } from 'react';

export default function ReceiveCuttableModal({
  isOpen,
  modalData, // { item, batch, action: 'receive' | 'transfer' }
  cart = [],
  onSubmit,
  onClose
}) {
  const [piecesInput, setPiecesInput] = useState('1');

  useEffect(() => {
    if (isOpen) {
      setPiecesInput('1');
    }
  }, [isOpen]);

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

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (pieces <= 0) return;
    onSubmit({
      pieces,
      totalDimension,
      item,
      batch
    });
  };

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

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-md flex flex-col rounded-xl overflow-hidden shadow-2xl border border-[var(--border-light)] bg-[var(--bg-secondary)]">
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-[var(--border-light)]">
          <div>
            <h3 className="font-bold text-base text-[var(--text-primary)]">
              {isTransfer ? 'Move Cuttable to Store' : 'Receive Cuttable Stock'}
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

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {/* Dimensions Info Card */}
          <div className="p-3.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-medium)] flex items-center justify-between text-xs">
            <div>
              <span className="text-[var(--text-secondary)] block">Standard Unit Size:</span>
              <span className="text-[var(--text-primary)] font-bold text-sm">
                {isSqft 
                  ? `${defaultWid} ft (W) × ${defaultLen} ft (L) = ${defaultWid * defaultLen} sqft/roll` 
                  : `${defaultLen} ${unitLabel} per piece`}
              </span>
            </div>
            {isTransfer && maxAvailablePieces !== null && (
              <div className="text-right">
                <span className="text-[var(--text-secondary)] block">Whse Available:</span>
                <span className="text-[var(--color-warning)] font-bold text-sm">
                  {maxAvailablePieces} {isSqft ? 'ROLLS' : 'PCS'} ({batch.stock_warehouse} {unitLabel})
                </span>
              </div>
            )}
          </div>

          {/* Pieces Input */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-[var(--text-secondary)]">
              {isSqft ? 'Number of Rolls' : 'Number of Pieces (Pipes / Bars)'}
            </label>
            <div className="relative">
              <input
                type="number"
                autoFocus
                min="1"
                step="1"
                max={maxAvailablePieces !== null ? maxAvailablePieces : undefined}
                value={piecesInput}
                onChange={e => setPiecesInput(e.target.value)}
                className="w-full h-14 px-4 text-2xl font-bold rounded-lg border-2 border-[var(--color-accent)] bg-[var(--bg-input)] text-[var(--text-input)] focus:outline-none"
                placeholder="1"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold uppercase text-[var(--text-tertiary)]">
                {isSqft ? 'ROLLS' : 'PCS'}
              </span>
            </div>

            {/* Quick buttons */}
            <div className="flex gap-2 mt-2.5">
              {[1, 5, 10, 20, 50].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPiecesInput(String(n))}
                  className="flex-1 py-1.5 text-xs font-semibold rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-medium)] transition-colors cursor-pointer"
                >
                  +{n}
                </button>
              ))}
            </div>
          </div>

          {/* Calculated Output Summary */}
          <div className="p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-medium)] flex items-center justify-between">
            <div>
              <span className="text-xs text-[var(--text-tertiary)] uppercase font-semibold block">Total Stock To {isTransfer ? 'Transfer' : 'Add'}</span>
              <span className="text-xl font-black text-[var(--color-accent)]">
                {totalDimension} <span className="text-sm font-bold uppercase">{unitLabel}</span>
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-[var(--text-tertiary)] block">Calculated Formula</span>
              <span className="text-xs text-[var(--text-secondary)] font-mono">
                {pieces} {isSqft ? 'Rolls' : 'PCS'} × {isSqft ? `${defaultWid * defaultLen} sqft` : `${defaultLen} ${unitLabel}`}
              </span>
            </div>
          </div>

          {/* Actions */}
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
              disabled={pieces <= 0 || (maxAvailablePieces !== null && pieces > maxAvailablePieces)}
              className="h-10 px-6 text-sm font-bold rounded-lg text-white bg-[var(--color-accent)] hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer shadow-md"
            >
              {isTransfer ? `Transfer ${totalDimension} ${unitLabel}` : `Add ${totalDimension} ${unitLabel}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

