import React from 'react';

export default function LooseItemModal({
  isOpen,
  looseItemModal,
  setLooseItemModal,
  activeTab,
  isWarehouseDisabled,
  onSubmit,
  onClose
}) {
  if (!isOpen || !looseItemModal?.item) return null;

  const item = looseItemModal.item;
  const isLooseKg = Boolean(
    item.is_loose_item && (
      item.unit?.toUpperCase() === 'KG' ||
      item.unit?.toUpperCase() === 'KGS' ||
      item.unit?.toUpperCase() === 'GRAMS' ||
      item.unit?.toUpperCase() === 'GRAM' ||
      item.unit?.toUpperCase() === 'G' ||
      item.unit?.toUpperCase() === 'GM'
    )
  );
  const availableStore = Number(item.stock_store || 0);
  const availableWhse = Number(item.stock_warehouse || 0);
  const ratePerKg = Number(item.price || 0);
  const isCheckout = activeTab === 'checkout';

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-[85%] max-w-[420px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            {activeTab === 'checkout' ? 'Loose Item Quantity' : activeTab === 'receive' ? 'Receive Stock' : 'Move Stock'}
          </span>
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
            <div className="flex items-center justify-between mb-3">
              <p className="text-base font-bold text-[var(--text-primary)]">{item.name}</p>
              <span className="text-xs font-mono font-semibold text-[var(--color-accent)]">#{item.barcode}</span>
            </div>

            {/* Stock Info Badge */}
            <div className="p-2.5 rounded-lg mb-4 flex items-center justify-between text-xs" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
              <span className="text-[var(--text-secondary)] font-medium">
                {isCheckout ? 'Store Stock' : activeTab === 'transfer' ? 'Warehouse Stock' : (isWarehouseDisabled ? 'Current Store Stock' : 'Current Warehouse')}:
              </span>
              <span className="font-bold text-[var(--text-primary)]">
                {isCheckout || (activeTab === 'receive' && isWarehouseDisabled) ? `${availableStore} kg` : `${availableWhse} kg`}
              </span>
            </div>

            {/* Input Label */}
            <label htmlFor="loose-qty" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
              {isCheckout && isLooseKg ? 'Enter Quantity in Grams (g)' : `Enter Quantity (${item.unit || 'PCS'})`}
            </label>

            {/* Input Box */}
            <div className="relative">
              <input
                id="loose-qty"
                type="number"
                step={isCheckout && isLooseKg ? '1' : 'any'}
                min="0"
                autoFocus
                value={looseItemModal.qty}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setLooseItemModal({ ...looseItemModal, qty: (isNaN(v) || v < 0) ? '' : e.target.value });
                }}
                placeholder={isCheckout && isLooseKg ? 'e.g. 50, 100, 250' : '0'}
                className="w-full h-12 pl-4 pr-20 text-2xl font-bold focus:outline-none rounded-md"
                style={{
                  border: '2px solid var(--color-accent)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-input)'
                }}
              />
              <span className="absolute right-3 top-3.5 text-xs font-bold lowercase tracking-wider text-[var(--text-secondary)]">
                {isCheckout && isLooseKg ? 'g' : (item.unit || 'PCS')}
              </span>
            </div>

            {/* Quick Preset Buttons for grams during checkout */}
            {isCheckout && isLooseKg && (
              <div className="flex gap-1.5 mt-3 flex-wrap">
                {[50, 100, 250, 500, 1000].map(presetGrams => (
                  <button
                    key={presetGrams}
                    type="button"
                    onClick={() => setLooseItemModal({ ...looseItemModal, qty: String(presetGrams) })}
                    className="px-2.5 py-1 text-xs font-bold rounded border transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] cursor-pointer"
                    style={{
                      backgroundColor: looseItemModal.qty === String(presetGrams) ? 'var(--color-accent-bg)' : 'var(--bg-tertiary)',
                      borderColor: looseItemModal.qty === String(presetGrams) ? 'var(--color-accent)' : 'var(--border-medium)',
                      color: looseItemModal.qty === String(presetGrams) ? 'var(--color-accent)' : 'var(--text-secondary)'
                    }}
                  >
                    {presetGrams >= 1000 ? `${presetGrams / 1000} kg` : `${presetGrams}g`}
                  </button>
                ))}
              </div>
            )}

            {/* Live Price Calculation in Checkout */}
            {isCheckout && isLooseKg && looseItemModal.qty && Number(looseItemModal.qty) > 0 && (
              <div className="mt-4 p-3 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent-bg)]/20 text-xs flex flex-col gap-1">
                <div className="flex justify-between font-medium text-[var(--text-secondary)]">
                  <span>Equivalent weight:</span>
                  <span className="font-bold text-[var(--text-primary)]">{(Number(looseItemModal.qty) / 1000).toFixed(3)} kg</span>
                </div>
                <div className="flex justify-between font-medium text-[var(--text-secondary)]">
                  <span>Rate:</span>
                  <span>₹{ratePerKg.toFixed(2)} / kg</span>
                </div>
                <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[var(--border-light)]" style={{ color: 'var(--color-accent)' }}>
                  <span>Total Price:</span>
                  <span>₹{((Number(looseItemModal.qty) / 1000) * ratePerKg).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 text-sm font-semibold rounded-md border border-[var(--border-medium)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!looseItemModal.qty || Number(looseItemModal.qty) <= 0}
              className="h-9 px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50 transition-transform active:scale-95 cursor-pointer"
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
