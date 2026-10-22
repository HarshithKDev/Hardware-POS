import React from 'react';

export default function ManualInstanceBarcodeModal({
  isOpen,
  manualInstanceBarcodeModal,
  setManualInstanceBarcodeModal,
  onSubmit,
  onClose
}) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" 
      onClick={onClose}
    >
      <div 
        className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]" 
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 md:p-5 border-b border-[var(--border-light)] flex justify-between items-center glass-header">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] leading-tight">Enter Piece Barcode</h2>
            <p className="text-xs text-[var(--text-tertiary)] font-medium mt-0.5 uppercase tracking-wider">{manualInstanceBarcodeModal.item?.name}</p>
          </div>
        </div>
        
        <form onSubmit={onSubmit} className="flex flex-col">
          <div className="p-5">
            <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Please enter the 2-digit identifier for this piece to receive it into the warehouse.
            </p>
            <div 
              className="mb-2 flex items-baseline bg-[var(--bg-input)] rounded-lg px-4 py-3.5 cursor-text transition-all duration-200 focus-within:ring-2 focus-within:ring-[var(--color-accent)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg-primary)]" 
              style={{ border: '1px solid var(--border-input)' }}
              onClick={() => document.getElementById('instance_barcode_input')?.focus()}
            >
              <span className="text-lg font-bold text-[var(--text-tertiary)] select-none whitespace-nowrap mr-0.5">
                {manualInstanceBarcodeModal.prefix}
              </span>
              <input 
                id="instance_barcode_input"
                type="text" 
                autoFocus 
                value={manualInstanceBarcodeModal.barcodeInput} 
                onChange={e => setManualInstanceBarcodeModal({ ...manualInstanceBarcodeModal, barcodeInput: e.target.value.replace(/[^0-9]/g, ''), error: null })} 
                placeholder="01" 
                maxLength={2} 
                className="flex-1 bg-transparent !text-lg font-bold uppercase p-0 m-0 w-full placeholder:opacity-40 focus:outline-none focus:ring-0 focus:border-transparent !border-none !outline-none !ring-0" 
                style={{ color: 'var(--text-primary)', boxShadow: 'none' }}
              />
            </div>
            {manualInstanceBarcodeModal.error && (
              <div className="text-[var(--color-error)] text-xs font-semibold px-1 mt-2 animate-shake">{manualInstanceBarcodeModal.error}</div>
            )}
          </div>
          
          <div className="p-4 md:p-5 border-t border-[var(--border-light)] bg-[var(--bg-secondary)] flex justify-end gap-3">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-5 py-2.5 text-sm font-bold uppercase tracking-wider rounded-md transition-colors cursor-pointer" 
              style={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', backgroundColor: 'transparent' }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="px-6 py-2.5 text-white text-sm font-bold uppercase tracking-wider focus:outline-none rounded-md transition-colors hover:opacity-90 shadow-sm cursor-pointer" 
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Confirm & Next
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
