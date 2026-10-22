import React from 'react';

export default function CutLengthModal({
  isOpen,
  cutLengthModal,
  setCutLengthModal,
  cart = [],
  onSubmit,
  onClose
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-[85%] max-w-[400px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Cut Length</span>
          <button 
            type="button" 
            onClick={onClose} 
            className="p-2 rounded-full transition-colors hover:bg-[var(--bg-hover)] cursor-pointer" 
            style={{ color: 'var(--text-tertiary)' }} 
            aria-label="Close modal"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="p-6">
            <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
              How much of <strong style={{ color: 'var(--color-accent)' }}>{cutLengthModal.item?.name}</strong> are you cutting from piece <strong className="text-[var(--text-primary)]">#{cutLengthModal.instance?.instance_barcode}</strong>?
            </p>

            <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Current Piece: {(() => {
                const dbLen = Number(cutLengthModal.instance?.current_length) || 0;
                const already = cart.filter(c => c.instance_barcode === cutLengthModal.instance?.instance_barcode).reduce((tot, c) => tot + (Number(c.length) || Number(c.pieceLength) || 0), 0);
                return Math.max(0, dbLen - already).toFixed(2);
              })()} {cutLengthModal.item?.unit === 'SQFT' ? 'ft' : cutLengthModal.item?.unit}
            </p>

            <div className="relative mb-4">
              <input 
                type="number" 
                autoFocus 
                step="0.01" 
                min="0" 
                value={cutLengthModal.cutQty} 
                onChange={e => {
                  const val = e.target.value;
                  const numVal = Math.round((Number(val) || 0) * 100) / 100;
                  if (numVal < 0 || isNaN(numVal)) {
                    setCutLengthModal({ ...cutLengthModal, cutQty: '', discardScrap: false });
                    return;
                  }
                  const max = Number(cutLengthModal.instance?.current_length);
                  const isSmallScrap = !isNaN(numVal) && !isNaN(max) && (max - numVal < 1) && (max - numVal > 0);
                  setCutLengthModal({ ...cutLengthModal, cutQty: val, discardScrap: isSmallScrap });
                }} 
                className="w-full h-12 px-4 text-2xl focus:outline-none rounded-md" 
                style={{ border: '2px solid var(--color-accent)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
                placeholder="0" 
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>
                {cutLengthModal.item?.unit === 'SQFT' ? 'ft' : cutLengthModal.item?.unit}
              </span>
            </div>

            {cutLengthModal.instance?.current_length !== '?' && Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty) < 1 && Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty) > 0 && (
              <label className="flex items-center gap-3 p-3 border cursor-pointer mt-4" style={{ borderColor: 'var(--color-warning)', backgroundColor: 'var(--bg-tertiary)' }}>
                <input 
                  type="checkbox" 
                  checked={cutLengthModal.discardScrap} 
                  onChange={e => setCutLengthModal({ ...cutLengthModal, discardScrap: e.target.checked })} 
                  className="w-5 h-5 cursor-pointer accent-[var(--color-warning)]" 
                />
                <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  Only {(Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty)).toFixed(2)} {cutLengthModal.item?.unit === 'SQFT' ? 'ft' : cutLengthModal.item?.unit} left. Discard remaining scrap?
                </span>
              </label>
            )}
          </div>
          <div className="p-4 flex justify-end gap-3" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
            <button 
              type="button" 
              onClick={onClose} 
              className="h-9 px-6 text-sm font-semibold rounded-md transition-colors border border-red-500 text-red-500 hover:bg-red-500/10 cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={!cutLengthModal.cutQty || isNaN(Number(cutLengthModal.instance?.current_length))} 
              className="h-9 px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50 transition-colors hover:brightness-110 cursor-pointer" 
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Add Cut
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
