import React from 'react';
import { Spinner } from '../../SharedUI';

export default function SelectPieceModal({
  isOpen,
  selectPieceModal,
  setSelectPieceModal,
  cart = [],
  setCart,
  generateId,
  setManualBarcode,
  setCutLengthModal,
  showAlertRef,
  onClose
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-[85%] max-w-[400px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Select Piece</span>
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
        <div className="p-6 flex flex-col">
          <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
            Which piece of <strong style={{ color: 'var(--color-accent)' }}>{selectPieceModal.item?.name}</strong> are you {selectPieceModal.action === 'transfer' ? 'transferring' : 'cutting from'}?
          </p>

          {selectPieceModal.isLoading ? (
            <div className="flex justify-center p-6"><Spinner className="w-6 h-6 text-[var(--color-accent)]" /></div>
          ) : selectPieceModal.instances.length === 0 ? (
            <p className="text-xs font-bold text-center p-4 text-[var(--color-error)]">No active pieces found.</p>
          ) : (
            <div className="max-h-[300px] overflow-y-auto flex flex-col gap-2 mb-4">
              {selectPieceModal.instances.map(inst => {
                let availableLength = Number(inst.current_length);
                if (selectPieceModal.action === 'checkout') {
                  const inCartQty = cart.filter(c => c.instance_barcode === inst.instance_barcode).reduce((sum, c) => sum + ((Number(c.length) || Number(c.pieceLength) || 0) * (Number(c.rolls) || 1)), 0);
                  availableLength = Math.round((availableLength - inCartQty) * 100) / 100;
                }
                
                if (availableLength <= 0 && selectPieceModal.action === 'checkout') return null;
                
                const isAlreadyInCartTransfer = selectPieceModal.action === 'transfer' && cart.some(c => c.instance_barcode === inst.instance_barcode);
                const batch = selectPieceModal.item.batches?.find(b => b.batch_id === inst.batch_id);
                const sellingPrice = batch?.selling_price ?? (selectPieceModal.item.price || 0);
                
                return (
                  <button
                    key={inst.id}
                    type="button"
                    disabled={isAlreadyInCartTransfer}
                    onClick={() => {
                      const actionType = selectPieceModal.action;
                      onClose();
                      
                      if (actionType === 'transfer') {
                        // Transfer mode: add directly to cart
                        setCart(prev => {
                          const idx = prev.findIndex(c => c.instance_barcode === inst.instance_barcode);
                          if (idx >= 0) {
                            showAlertRef?.current ? showAlertRef.current(`Piece #${inst.instance_barcode} is already in the cart!`, "Already Added") : alert(`Piece #${inst.instance_barcode} is already in the cart!`);
                            return prev;
                          }
                          
                          const purchaseCost = batch?.purchase_cost ?? (selectPieceModal.item.cost_price || 0);
                          const mspPrice = batch?.msp ?? (selectPieceModal.item.msp || 0);

                          return [...prev, { 
                            ...selectPieceModal.item, 
                            id: generateId ? generateId() : String(Date.now()), 
                            instance_barcode: inst.instance_barcode, 
                            batch_id: inst.batch_id,
                            batch_number: batch?.batch_number ?? null,
                            purchase_cost: Number(purchaseCost).toFixed(2),
                            selling_price: Number(sellingPrice).toFixed(2),
                            msp_price: Number(mspPrice).toFixed(2),
                            price: Number(sellingPrice).toFixed(2),
                            msp: Number(mspPrice).toFixed(2),
                            customPriceInput: Number(sellingPrice).toFixed(2),
                            discountPct: 0,
                            quantity: 1, 
                            unit: selectPieceModal.item.unit, 
                            length: '', 
                            width: '', 
                            default_length: selectPieceModal.item.default_length, 
                            default_width: selectPieceModal.item.default_width, 
                            pieceLength: inst.current_length 
                          }];
                        });
                        if (setManualBarcode) setManualBarcode('');
                      } else {
                        // Checkout mode: proceed to cutting
                        setCutLengthModal({ isOpen: true, item: selectPieceModal.item, instance: inst, cutQty: '', discardScrap: false });
                      }
                    }}
                    className={`p-3 text-left border border-[var(--border-medium)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors flex justify-between items-center focus:outline-none rounded-md focus:border-[var(--color-accent)] cursor-pointer ${isAlreadyInCartTransfer ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                  >
                    <div className="flex flex-col items-start">
                      <span className="text-xs font-bold" style={{ color: 'var(--color-accent)' }}>#{inst.instance_barcode}</span>
                      <span className="text-xs font-bold mt-0.5" style={{ color: 'var(--text-tertiary)' }}>MRP: ₹{Number(sellingPrice).toFixed(2)}</span>
                    </div>
                    <span className="text-sm font-bold text-[var(--text-primary)]">
                      {isAlreadyInCartTransfer ? 'Already in Cart' : `${availableLength} ${selectPieceModal.item?.unit} left`}
                    </span>
                  </button>
                );
              })}
            </div>
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
        </div>
      </div>
    </div>
  );
}
