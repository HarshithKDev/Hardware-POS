import React, { useState, useEffect } from 'react';

export default function CuttableCheckoutModal({
  isOpen,
  modalData, // { item, batch, cartItemId, initialMode, initialFullPieces, initialCutPieces, initialCutLength, initialScrapAction }
  onSubmit,
  onClose
}) {
  const [mode, setMode] = useState('full'); // 'full' | 'cut'
  const [fullPieces, setFullPieces] = useState('1');
  const [cutPieces, setCutPieces] = useState('1');
  const [cutLength, setCutLength] = useState('');
  const [scrapAction, setScrapAction] = useState('add'); // 'add' | 'discard' | 'keep'

  useEffect(() => {
    if (isOpen) {
      setMode(modalData?.initialMode || (modalData?.initialCutPieces && !modalData?.is_full_piece ? 'cut' : 'full'));
      setFullPieces(String(modalData?.initialFullPieces || '1'));
      setCutPieces(String(modalData?.initialCutPieces || '1'));
      setCutLength(modalData?.initialCutLength !== undefined && modalData?.initialCutLength !== null ? String(modalData.initialCutLength) : '');
      setScrapAction(modalData?.initialScrapAction || 'add');
    }
  }, [isOpen, modalData]);

  if (!isOpen || !modalData?.item) return null;

  const { item, batch } = modalData;
  const isSqft = item.unit === 'SQFT';
  const defaultLen = Number(item.default_length) || (isSqft ? 100 : 12);
  const defaultWid = isSqft ? (Number(item.default_width) || 3) : 1;
  const unitLabel = isSqft ? 'sqft' : (item.unit || 'ft');
  const unitPrice = Number(batch?.selling_price ?? (item.price || 0));

  // Store stock available
  const availableStock = batch 
    ? Number(batch.stock_store || 0)
    : (item.batches?.reduce((sum, b) => sum + Number(b.stock_store || 0), 0) || Number(item.stock_store || 0));

  // Calculations
  let billableQty = 0;
  let deductQty = 0;
  let scrapLeftover = 0;
  let isSmallScrap = false;

  const parsedCutLength = parseFloat(cutLength) || 0;
  const isCutExceeding = mode === 'cut' && parsedCutLength > defaultLen;

  if (mode === 'full') {
    const pcs = Math.max(1, parseInt(fullPieces, 10) || 1);
    const totalDim = isSqft ? pcs * defaultWid * defaultLen : pcs * defaultLen;
    billableQty = totalDim;
    deductQty = totalDim;
  } else if (!isCutExceeding) {
    const pcs = Math.max(1, parseInt(cutPieces, 10) || 1);
    const len = Math.max(0, parsedCutLength);

    if (isSqft) {
      // Mesh: pieces * cut length * fixed width
      billableQty = Math.round(pcs * len * defaultWid * 100) / 100;
      deductQty = billableQty;
    } else {
      // Pipes: pieces * cut length
      const baseCutQty = Math.round(pcs * len * 100) / 100;
      
      // Check scrap rule for single/retail cuts:
      // If customer cuts a length smaller than standard length, check remaining offcut
      if (len > 0 && len < defaultLen) {
        scrapLeftover = Math.round((defaultLen - (len % defaultLen)) * 100) / 100;
        if (scrapLeftover > 0 && scrapLeftover < 3) {
          isSmallScrap = true;
        }
      }

      if (isSmallScrap) {
        if (scrapAction === 'add') {
          // Customer agrees to take remaining scrap piece -> billed for full length
          billableQty = Math.round(pcs * defaultLen * 100) / 100;
          deductQty = billableQty;
        } else if (scrapAction === 'discard') {
          // Customer declined, discard scrap -> billed only for cut, deduct full piece from stock
          billableQty = baseCutQty;
          deductQty = Math.round(pcs * defaultLen * 100) / 100;
        } else {
          // Keep scrap in stock -> billed for cut, deduct cut
          billableQty = baseCutQty;
          deductQty = baseCutQty;
        }
      } else {
        billableQty = baseCutQty;
        deductQty = baseCutQty;
      }
    }
  }

  const billTotal = Math.round(billableQty * unitPrice * 100) / 100;
  const isOutOfStock = deductQty > availableStock;

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (billableQty <= 0 || isCutExceeding) return;
    onSubmit({
      item,
      batch,
      cartItemId: modalData?.cartItemId || null,
      mode,
      billableQty,
      deductQty,
      cutPieces: mode === 'full' ? parseInt(fullPieces, 10) || 1 : parseInt(cutPieces, 10) || 1,
      cutLength: mode === 'full' ? defaultLen : parseFloat(cutLength) || defaultLen,
      scrapAction: isSmallScrap ? scrapAction : null,
      scrapLeftover: isSmallScrap ? scrapLeftover : 0
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-lg flex flex-col rounded-xl overflow-hidden shadow-2xl border border-[var(--border-light)] bg-[var(--bg-secondary)] max-h-[92vh]">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--border-light)]">
          <div>
            <h3 className="font-bold text-base text-[var(--text-primary)]">
              {modalData?.cartItemId ? 'Edit Cut' : 'Checkout Cuttable Item'}
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
            <span className="text-[var(--text-secondary)]">Store Stock: </span>
            <span className={`font-bold ${availableStock > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
              {availableStock} {unitLabel}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[var(--text-secondary)]">MRP: </span>
            <span className="text-[var(--text-primary)] font-bold">₹{unitPrice.toFixed(2)} / {unitLabel}</span>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="px-6 pt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode('full')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition-all cursor-pointer flex items-center justify-center gap-2 ${
              mode === 'full'
                ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)] shadow-md'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-medium)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span>{isSqft ? 'Full Roll' : `Full ${defaultLen} FT`}</span>
            <span className="text-xs opacity-80">({isSqft ? `${defaultWid * defaultLen} sqft` : `${defaultLen} ${unitLabel}`})</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('cut')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition-all cursor-pointer flex items-center justify-center gap-2 ${
              mode === 'cut'
                ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)] shadow-md'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-medium)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span>Cut Custom Length</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 overflow-y-auto">
          {mode === 'full' ? (
            /* Mode 1: Full Piece */
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-[var(--text-secondary)]">
                {isSqft ? 'Number of Full Rolls' : `Quantity (${defaultLen} FT each)`}
              </label>
              <div className="relative">
                <input
                  type="number"
                  autoFocus
                  min="1"
                  step="1"
                  value={fullPieces}
                  onChange={e => setFullPieces(e.target.value)}
                  className="w-full h-14 px-4 text-2xl font-bold rounded-lg border-2 border-[var(--color-accent)] bg-[var(--bg-input)] text-[var(--text-input)] focus:outline-none"
                  placeholder="1"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold uppercase text-[var(--text-tertiary)]">
                  {isSqft ? 'ROLLS' : 'QTY'}
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                {[1, 2, 3, 5, 10].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFullPieces(String(n))}
                    className="flex-1 py-1.5 text-xs font-semibold rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-medium)] transition-colors cursor-pointer"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Mode 2: Custom Cut */
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                {/* Number of cut pieces */}
                <div className="w-1/3">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-[var(--text-secondary)]">
                    No. of Cuts
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={cutPieces}
                    onChange={e => setCutPieces(e.target.value)}
                    className="w-full h-12 px-3 text-lg font-bold text-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-input)] focus:border-[var(--color-accent)] focus:outline-none"
                    placeholder="1"
                  />
                </div>

                {/* Cut length per piece */}
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Cut Length ({item.unit === 'METER' ? 'M' : 'FT'})
                    </label>
                    <span className="text-[11px] text-[var(--text-tertiary)] font-medium">
                      Max: <strong className="text-[var(--text-secondary)]">{defaultLen} {unitLabel}</strong>
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      autoFocus
                      step="any"
                      min="0.1"
                      max={defaultLen}
                      value={cutLength}
                      onChange={e => setCutLength(e.target.value)}
                      className={`w-full h-12 pl-4 pr-12 text-lg font-bold rounded-lg border-2 ${
                        isCutExceeding ? 'border-red-500 focus:border-red-500' : 'border-[var(--color-accent)] focus:border-[var(--color-accent)]'
                      } bg-[var(--bg-input)] text-[var(--text-input)] focus:outline-none`}
                      placeholder={`Max ${defaultLen}`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase text-[var(--text-tertiary)]">
                      {item.unit === 'METER' ? 'M' : 'FT'}
                    </span>
                  </div>
                  {!isSqft && [2, 3, 4, 6, 8, 10].some(n => n < defaultLen) && (
                    <div className="flex gap-1.5 mt-2">
                      {[2, 3, 4, 6, 8, 10].filter(n => n < defaultLen).map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setCutLength(String(n))}
                          className={`flex-1 py-1 text-xs font-semibold rounded border transition-colors cursor-pointer ${
                            parseFloat(cutLength) === n
                              ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                              : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-medium)]'
                          }`}
                        >
                          {n}ft
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Mesh Fixed Width display */}
                {isSqft && (
                  <div className="w-1/4">
                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-[var(--text-secondary)]">
                      Roll Width
                    </label>
                    <div className="h-12 flex items-center justify-center font-bold text-sm bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-lg text-[var(--text-primary)]">
                      {defaultWid} ft
                    </div>
                  </div>
                )}
              </div>

              {/* Validation Warning when cut length > default length */}
              {isCutExceeding && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 font-semibold flex items-start gap-2 animate-scale-in">
                  <span className="text-base leading-none">⚠️</span>
                  <span>
                    Cut length (<strong>{parsedCutLength} {unitLabel}</strong>) cannot exceed the standard piece length (<strong>{defaultLen} {unitLabel}</strong>). A single piece cannot be cut larger than {defaultLen} {unitLabel}. For full pieces, switch to the &ldquo;Full {defaultLen} FT&rdquo; tab.
                  </span>
                </div>
              )}

              {/* Scrap Rule Banner when remaining piece < 3ft */}
              {isSmallScrap && (
                <div className="p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/10 flex flex-col gap-2.5 animate-scale-in">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-400 text-sm">⚠️</span>
                    <div className="text-xs text-[var(--text-primary)]">
                      <strong>Remaining piece is {scrapLeftover.toFixed(1)} ft (less than 3 ft).</strong>
                      <p className="text-[var(--text-secondary)] mt-0.5">Please request customer to purchase the remaining offcut piece.</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 pt-1">
                    <label className={`flex items-center gap-2.5 p-2 rounded border cursor-pointer transition-colors ${scrapAction === 'add' ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--text-primary)] font-bold' : 'border-[var(--border-medium)] text-[var(--text-secondary)]'}`}>
                      <input 
                        type="radio" 
                        name="scrapAction" 
                        value="add" 
                        checked={scrapAction === 'add'} 
                        onChange={() => setScrapAction('add')}
                        className="accent-[var(--color-accent)] cursor-pointer" 
                      />
                      <span className="text-xs">
                        Customer agreed to take scrap (+{scrapLeftover.toFixed(1)} ft) &rarr; Bill full {defaultLen} ft
                      </span>
                    </label>

                    <label className={`flex items-center gap-2.5 p-2 rounded border cursor-pointer transition-colors ${scrapAction === 'discard' ? 'bg-red-500/20 border-red-500 text-[var(--text-primary)] font-bold' : 'border-[var(--border-medium)] text-[var(--text-secondary)]'}`}>
                      <input 
                        type="radio" 
                        name="scrapAction" 
                        value="discard" 
                        checked={scrapAction === 'discard'} 
                        onChange={() => setScrapAction('discard')}
                        className="accent-red-500 cursor-pointer" 
                      />
                      <span className="text-xs">
                        Customer declined &rarr; Bill {cutLength} ft, discard {scrapLeftover.toFixed(1)} ft scrap from inventory
                      </span>
                    </label>

                    <label className={`flex items-center gap-2.5 p-2 rounded border cursor-pointer transition-colors ${scrapAction === 'keep' ? 'bg-[var(--bg-tertiary)] border-[var(--border-medium)] text-[var(--text-primary)] font-bold' : 'border-[var(--border-medium)] text-[var(--text-secondary)]'}`}>
                      <input 
                        type="radio" 
                        name="scrapAction" 
                        value="keep" 
                        checked={scrapAction === 'keep'} 
                        onChange={() => setScrapAction('keep')}
                        className="accent-[var(--text-secondary)] cursor-pointer" 
                      />
                      <span className="text-xs">
                        Keep {scrapLeftover.toFixed(1)} ft scrap in stock &rarr; Bill {cutLength} ft, deduct {cutLength} ft
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bill Calculation Summary Card */}
          <div className="p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-medium)] flex items-center justify-between">
            <div>
              <span className="text-xs text-[var(--text-tertiary)] uppercase font-semibold block">Total Quantity Billed</span>
              <span className="text-xl font-black text-[var(--color-accent)]">
                {billableQty} <span className="text-sm font-bold uppercase">{unitLabel}</span>
              </span>
              {deductQty !== billableQty && (
                <span className="block text-[11px] text-[var(--color-warning)] mt-0.5">
                  ({deductQty} {unitLabel} deducted including discarded scrap)
                </span>
              )}
            </div>
            <div className="text-right">
              <span className="text-xs text-[var(--text-tertiary)] uppercase font-semibold block">Total Bill</span>
              <span className="text-2xl font-black text-[var(--color-success)]">
                ₹{billTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Out of Stock Warning */}
          {isOutOfStock && (
            <div className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400 font-semibold text-center">
              Insufficient stock! Requested {deductQty} {unitLabel}, but only {availableStock} {unitLabel} available in Store.
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
              disabled={billableQty <= 0 || isOutOfStock || isCutExceeding}
              className="h-10 px-8 text-sm font-bold rounded-lg text-white bg-[var(--color-accent)] hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer shadow-md"
            >
              {modalData?.cartItemId ? 'Update Cut' : 'Add to Bill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

