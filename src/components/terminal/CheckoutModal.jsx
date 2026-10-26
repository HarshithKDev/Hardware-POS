import React from 'react';
import { Spinner } from '../../SharedUI';

export default function CheckoutModal({
  isOpen,
  onClose,
  checkoutModal,
  setCheckoutModal,
  activeTotal,
  cartTotal,
  minPossibleTotal,
  screwPrice = 0,
  userRole,
  cashierName,
  isCheckingOut,
  onCompleteTransaction,
  getQuickTenderOptions
}) {
  if (!isOpen) return null;

  const isInvalidNegotiatedTotal = checkoutModal.negotiatedTotal !== '' && (
    Number(checkoutModal.negotiatedTotal) < minPossibleTotal || 
    Number(checkoutModal.negotiatedTotal) < screwPrice
  );

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center z-[100] print:hidden px-0 sm:px-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-title"
    >
      <div 
        className="w-full sm:w-full max-w-[660px] max-h-[92dvh] sm:max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-xl overflow-hidden animate-scale-in border-t sm:border border-[var(--border-light)] shadow-2xl" 
        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
      >
        <div className="sm:hidden w-10 h-1 bg-[var(--border-medium)] rounded-full mx-auto my-2 shrink-0" />
        <div className="flex justify-between items-center pr-2 pl-4 py-2 sm:py-2.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span id="checkout-title" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Checkout Payment
          </span>
          <button
            type="button"
            onClick={onClose}
            className="sm:hidden p-1.5 text-xs font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          <div className="flex justify-between items-end mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Total Due</span>
            <span className="text-3xl sm:text-4xl font-light" style={{ color: 'var(--color-accent)' }} aria-live="polite">₹{activeTotal.toFixed(2)}</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3.5">
            <div>
              <label htmlFor="customer-name" className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Customer Name (Optional)
              </label>
              <input 
                id="customer-name" 
                type="text" 
                value={checkoutModal.customerName || ''} 
                onChange={(e) => setCheckoutModal({ ...checkoutModal, customerName: e.target.value })} 
                placeholder="e.g. John Doe" 
                className="w-full h-10 px-3 text-sm focus:outline-none rounded-md" 
                style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
              />
            </div>
            <div>
              <label htmlFor="customer-phone" className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Customer Phone (Optional)
              </label>
              <input 
                id="customer-phone" 
                type="text" 
                value={checkoutModal.customerPhone || ''} 
                onChange={(e) => setCheckoutModal({ ...checkoutModal, customerPhone: e.target.value })} 
                placeholder="e.g. 9876543210" 
                className="w-full h-10 px-3 text-sm focus:outline-none rounded-md" 
                style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
              />
            </div>
          </div>

          <div className="mb-3.5">
            <label htmlFor="negotiated-total" className="block text-xs font-bold uppercase tracking-wider mb-1.5 flex justify-between items-center" style={{ color: 'var(--text-secondary)' }}>
              <span>Final Negotiated Amount (₹)</span>
              <span className="opacity-70 font-normal text-[11px]">
                System Total: ₹{cartTotal.toFixed(2)}{minPossibleTotal > 0 ? ` | Min Allowed: ₹${minPossibleTotal.toFixed(2)}` : ''}
              </span>
            </label>
            <input 
              id="negotiated-total" 
              type="number" 
              step="any" 
              min="0" 
              autoFocus
              value={checkoutModal.negotiatedTotal} 
              onChange={(e) => { 
                const v = parseFloat(e.target.value); 
                setCheckoutModal({ ...checkoutModal, error: '', negotiatedTotal: (isNaN(v) || v < 0) ? '' : e.target.value });
              }} 
              placeholder={`e.g. ${Math.floor(cartTotal)}`} 
              className="w-full h-11 px-3.5 text-xl font-bold focus:outline-none rounded-md" 
              style={{ 
                border: (checkoutModal.error || (checkoutModal.negotiatedTotal !== '' && (Number(checkoutModal.negotiatedTotal) < minPossibleTotal || Number(checkoutModal.negotiatedTotal) < screwPrice))) 
                  ? '1px solid var(--color-error)' 
                  : '1px solid var(--border-input)', 
                backgroundColor: 'var(--bg-input)', 
                color: 'var(--text-input)' 
              }} 
            />
            {screwPrice > 0 && (
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-semibold px-2.5 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border-light)]" style={{ color: 'var(--text-secondary)' }}>
                <span>Screws: ₹{screwPrice.toFixed(2)} (Fixed price)</span>
                <span className="text-[10px] text-[var(--text-tertiary)] font-normal">Discount applies to other items only</span>
              </div>
            )}
            {checkoutModal.negotiatedTotal !== '' && Number(checkoutModal.negotiatedTotal) < screwPrice && (
              <p className="text-[11px] font-bold mt-1 leading-tight" style={{ color: 'var(--color-error)' }}>
                Warning: Negotiated amount cannot be less than ₹{screwPrice.toFixed(2)} (Screws price is fixed at ₹{screwPrice.toFixed(2)}).
              </p>
            )}
            {checkoutModal.negotiatedTotal !== '' && Number(checkoutModal.negotiatedTotal) < minPossibleTotal && Number(checkoutModal.negotiatedTotal) >= screwPrice && (
              <p className="text-[11px] font-bold mt-1 leading-tight" style={{ color: 'var(--color-error)' }}>
                Warning: Cannot discount below minimum selling limit (₹{minPossibleTotal.toFixed(2)}{screwPrice > 0 ? ` including ₹${screwPrice.toFixed(2)} for screws` : ''}). Products cannot be sold below MSP.
              </p>
            )}
          </div>

          <div className="mb-3.5">
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Payment Method</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {[
                { key: 'CASH', label: 'Cash', shortcut: '1' },
                { key: 'UPI', label: 'UPI', shortcut: '2' },
                { key: 'SPLIT', label: 'UPI + Cash', shortcut: '3' },
                { key: 'SHOWROOM', label: 'Showroom', shortcut: '4' },
              ].map(({ key: method, label, shortcut }) => {
                const isSelected = checkoutModal.paymentMethod === method;
                const isShowroom = method === 'SHOWROOM';
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setCheckoutModal({ ...checkoutModal, paymentMethod: method, error: '' })}
                    className={`h-11 px-3 sm:px-4 text-xs sm:text-sm font-bold uppercase tracking-wide rounded-md transition-all flex items-center justify-center ${isSelected ? 'shadow-sm' : 'hover:border-[var(--border-heavy)]'}`}
                    style={{ 
                      backgroundColor: isShowroom
                        ? (isSelected ? 'var(--color-warning)' : 'var(--bg-tertiary)')
                        : (isSelected ? 'var(--color-accent)' : 'var(--bg-tertiary)'),
                      color: isSelected
                        ? (isShowroom ? '#000' : '#fff')
                        : 'var(--text-primary)',
                      border: `1px solid ${isShowroom && isSelected ? 'var(--color-warning)' : isSelected ? 'var(--color-accent)' : 'var(--border-medium)'}`
                    }}
                  >
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            {checkoutModal.paymentMethod === 'SHOWROOM' && (
              <div className="p-3 mt-2 rounded-md border flex items-start gap-2.5 animate-fade-in" style={{ backgroundColor: 'rgba(234, 179, 8, 0.08)', borderColor: 'rgba(234, 179, 8, 0.3)', color: 'var(--color-warning)' }}>
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs font-medium leading-relaxed">
                  Goods dispatched to showroom. Products are deducted from store inventory and recorded under Showroom without adding to shop sales revenue or profit.
                </p>
              </div>
            )}

            {checkoutModal.paymentMethod === 'CASH' && (() => {
              const numCashGiven = Number(checkoutModal.cashGiven || 0);
              const isChange = checkoutModal.cashGiven !== '' && numCashGiven >= activeTotal;
              const isUnderpaid = checkoutModal.cashGiven !== '' && numCashGiven > 0 && numCashGiven < activeTotal;
              const tenderPills = getQuickTenderOptions ? getQuickTenderOptions(activeTotal) : [];

              return (
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-1.5">
                    <label htmlFor="cash-given" className="block text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Cash Given (Optional)
                    </label>
                  </div>
                  <input 
                    id="cash-given" 
                    type="number" 
                    step="any" 
                    min="0" 
                    value={checkoutModal.cashGiven} 
                    onChange={(e) => { 
                      const v = parseFloat(e.target.value); 
                      setCheckoutModal({ ...checkoutModal, error: '', cashGiven: (isNaN(v) || v < 0) && e.target.value !== '' ? checkoutModal.cashGiven : e.target.value });
                    }} 
                    placeholder="Leave empty if exact, or enter amount" 
                    className="w-full h-12 px-4 text-2xl font-bold focus:outline-none rounded-md" 
                    style={{ border: checkoutModal.error ? '1px solid var(--color-error)' : '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
                  />

                  {/* Quick Tender Note Suggestions (higher standard notes) */}
                  {tenderPills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {tenderPills.map((pill) => {
                        const isSelected = Number(checkoutModal.cashGiven) === pill.value;
                        return (
                          <button
                            key={pill.value}
                            type="button"
                            onClick={() => setCheckoutModal(prev => ({ ...prev, cashGiven: String(pill.value), error: '' }))}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                              isSelected
                                ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)] shadow-sm'
                                : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--border-medium)]'
                            }`}
                          >
                            {pill.label}
                          </button>
                        );
                      })}
                      {checkoutModal.cashGiven !== '' && (
                        <button
                          type="button"
                          onClick={() => setCheckoutModal(prev => ({ ...prev, cashGiven: '', error: '' }))}
                          className="px-2.5 py-1.5 rounded-md text-xs font-bold text-[var(--color-error)] hover:bg-[var(--color-error-bg)] transition-colors cursor-pointer border border-transparent"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                  
                  {/* Live Change / Shortfall Display */}
                  {isChange && (
                    <div className="mt-3 p-3 rounded-md flex items-center justify-between animate-fade-in" style={{ backgroundColor: 'var(--color-success-bg)', border: '1px solid var(--color-success)' }}>
                      <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-success)' }}>Change to Return:</div>
                      <div className="text-2xl font-bold" style={{ color: 'var(--color-success)' }}>
                        ₹{(numCashGiven - activeTotal).toFixed(2)}
                      </div>
                    </div>
                  )}

                  {isUnderpaid && (
                    <div className="mt-3 p-3 rounded-md flex items-center justify-between animate-fade-in" style={{ backgroundColor: 'var(--color-error-bg)', border: '1px solid var(--color-error)' }}>
                      <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-error)' }}>Shortfall (Remaining Due):</div>
                      <div className="text-xl font-bold" style={{ color: 'var(--color-error)' }}>
                        ₹{(activeTotal - numCashGiven).toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {checkoutModal.paymentMethod === 'SPLIT' && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <label htmlFor="split-upi" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>UPI (₹)</label>
                  <input 
                    id="split-upi" 
                    type="number" 
                    step="any" 
                    min="0" 
                    value={checkoutModal.splitUpi} 
                    onChange={(e) => { 
                      const val = e.target.value; 
                      const v = parseFloat(val); 
                      let newCash = checkoutModal.splitCash; 
                      if (val === '') { 
                        newCash = ''; 
                      } else if (!isNaN(v) && v >= 0) { 
                        newCash = Number(Math.max(0, activeTotal - v).toFixed(2)).toString(); 
                      } 
                      setCheckoutModal({ ...checkoutModal, error: '', splitUpi: (isNaN(v) && val !== '') || v < 0 ? checkoutModal.splitUpi : val, splitCash: newCash });
                    }} 
                    placeholder="0.00" 
                    className="w-full h-12 px-4 text-2xl focus:outline-none rounded-md" 
                    style={{ border: checkoutModal.error ? '1px solid var(--color-error)' : '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="split-cash" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Cash (₹)</label>
                  <input 
                    id="split-cash" 
                    type="number" 
                    step="any" 
                    min="0" 
                    value={checkoutModal.splitCash} 
                    onChange={(e) => { 
                      const val = e.target.value; 
                      const v = parseFloat(val); 
                      let newUpi = checkoutModal.splitUpi; 
                      if (val === '') { 
                        newUpi = ''; 
                      } else if (!isNaN(v) && v >= 0) { 
                        newUpi = Number(Math.max(0, activeTotal - v).toFixed(2)).toString(); 
                      } 
                      setCheckoutModal({ ...checkoutModal, error: '', splitCash: (isNaN(v) && val !== '') || v < 0 ? checkoutModal.splitCash : val, splitUpi: newUpi });
                    }} 
                    placeholder="0.00" 
                    className="w-full h-12 px-4 text-2xl focus:outline-none rounded-md" 
                    style={{ border: checkoutModal.error ? '1px solid var(--color-error)' : '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="px-4 pb-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          {checkoutModal.error && (
            <p className="text-sm font-bold text-center" style={{ color: 'var(--color-error)' }}>
              {checkoutModal.error}
            </p>
          )}
        </div>
        <div className="p-3 sm:p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <button 
            type="button"
            onClick={onClose} 
            disabled={isCheckingOut} 
            className="flex-1 sm:flex-initial min-h-[44px] md:min-h-0 md:h-10 px-4 sm:px-8 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md text-white transition-colors bg-[var(--color-error)] hover:bg-red-600 flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Cancel</span>
          </button>
          <button 
            type="button"
            onClick={onCompleteTransaction} 
            disabled={isCheckingOut || isInvalidNegotiatedTotal} 
            title={isInvalidNegotiatedTotal ? `Cannot complete sale: Negotiated amount is below minimum allowed total (₹${minPossibleTotal.toFixed(2)})` : undefined}
            className={`flex-1 sm:flex-initial min-h-[44px] md:min-h-0 md:h-10 px-4 sm:px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50 flex justify-center items-center gap-2 min-w-[140px] ${isCheckingOut || isInvalidNegotiatedTotal ? 'cursor-not-allowed' : 'cursor-pointer'}`} 
            style={{ backgroundColor: checkoutModal.paymentMethod === 'SHOWROOM' ? 'var(--color-warning)' : 'var(--color-accent)' }}
          >
            {isCheckingOut ? <Spinner className="w-4 h-4 text-white" /> : (
              <span>{checkoutModal.paymentMethod === 'SHOWROOM' ? 'Send to Showroom' : 'Complete Sale'}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
