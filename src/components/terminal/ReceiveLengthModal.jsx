import React from 'react';

export default function ReceiveLengthModal({
  isOpen,
  receiveLengthModal,
  setReceiveLengthModal,
  onSubmit,
  onClose
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-sm flex flex-col shadow-2xl" style={{ backgroundColor: 'var(--bg-primary)', borderTop: '4px solid var(--color-accent)' }}>
        <div className="flex justify-between items-center p-4" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
          <h3 className="font-bold tracking-wider text-sm" style={{ color: 'var(--text-primary)' }}>ENTER PIECE LENGTH</h3>
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
        <form onSubmit={onSubmit} className="p-6">
          <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
            What is the standard length of each <strong>{receiveLengthModal.item?.name}</strong> piece?
          </p>
          <div className="mb-6">
            <input 
              type="number" 
              autoFocus 
              step="any" 
              min="0" 
              value={receiveLengthModal.length} 
              onChange={e => { 
                const v = parseFloat(e.target.value); 
                setReceiveLengthModal({ ...receiveLengthModal, length: (isNaN(v) || v < 0) ? '' : e.target.value });
              }} 
              placeholder={`Length (${receiveLengthModal.item?.unit || 'm'})`} 
              className="w-full h-12 px-4 text-xl focus:outline-none rounded-md" 
              style={{ border: '2px solid var(--color-accent)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
            />
          </div>
          <div className="flex justify-end gap-3">
            <button 
              type="submit" 
              disabled={!receiveLengthModal.length} 
              className="h-9 px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50 transition-colors hover:brightness-110 cursor-pointer" 
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Add to Cart
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
