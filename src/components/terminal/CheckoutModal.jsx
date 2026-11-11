import { formatINR } from '../../utils';
import { Modal, Button } from '../ui';

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

  const isInvalidNegotiatedTotal = checkoutModal.paymentMethod !== 'SHOWROOM' && checkoutModal.negotiatedTotal !== '' && (
    Number(checkoutModal.negotiatedTotal) < minPossibleTotal || 
    Number(checkoutModal.negotiatedTotal) < screwPrice
  );

  const isShowroom = checkoutModal.paymentMethod === 'SHOWROOM';
  const inputBase = 'w-full px-3 rounded-md bg-[var(--bg-input)] text-[var(--text-input)] placeholder:text-[var(--text-tertiary)] border focus:outline-none focus:border-[var(--color-accent)]';

  return (
    <Modal
      onClose={onClose}
      title="Checkout Payment"
      titleId="checkout-title"
      size="lg"
      zIndex={100}
      closeOnEsc={false}
      focusFirst={false}
      restoreFocus={false}
      bodyClassName="p-4 sm:p-5"
      footer={(
        <div className="w-full flex flex-col gap-2">
          {checkoutModal.error && (
            <p className="text-sm font-semibold text-center" style={{ color: 'var(--color-error)' }}>
              {checkoutModal.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="lg" onClick={onClose} disabled={isCheckingOut} className="flex-1 sm:flex-none" title="Cancel (Esc)">
              Cancel
            </Button>
            <Button
              variant={isShowroom ? 'warning' : 'primary'}
              size="lg"
              onClick={onCompleteTransaction}
              disabled={isInvalidNegotiatedTotal}
              loading={isCheckingOut}
              title={isInvalidNegotiatedTotal ? `Cannot complete sale: Negotiated amount is below minimum allowed total (₹${formatINR(minPossibleTotal, 2)})` : 'Enter'}
              className="flex-1 sm:flex-none min-w-[180px]"
            >
              <span>{isShowroom ? 'Send to Showroom' : 'Complete Sale'}</span>
            </Button>
          </div>
        </div>
      )}
    >
        <div>
          <div className="flex justify-between items-end mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Total Due</span>
            <span className="text-3xl sm:text-4xl font-semibold tabular-nums" style={{ color: 'var(--color-accent)' }} aria-live="polite">₹{formatINR(activeTotal, 2)}</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3.5">
            <div>
              <label htmlFor="customer-name" className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Customer Name (Optional)
              </label>
              <input 
                id="customer-name" 
                type="text" 
                value={checkoutModal.customerName || ''} 
                onChange={(e) => setCheckoutModal({ ...checkoutModal, customerName: e.target.value })} 
                placeholder="e.g. John Doe" 
                className={`${inputBase} h-10 text-sm`} 
                style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
              />
            </div>
            <div>
              <label htmlFor="customer-phone" className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Customer Phone (Optional)
              </label>
              <input 
                id="customer-phone" 
                type="text" 
                value={checkoutModal.customerPhone || ''} 
                onChange={(e) => setCheckoutModal({ ...checkoutModal, customerPhone: e.target.value })} 
                placeholder="e.g. 9876543210" 
                className={`${inputBase} h-10 text-sm`} 
                style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
              />
            </div>
          </div>

          {/* Showroom dispatch is a stock movement, not a sale: no negotiated amount / MSP rules */}
          {checkoutModal.paymentMethod !== 'SHOWROOM' && (
          <div className="mb-3.5">
            <label htmlFor="negotiated-total" className="block text-xs font-bold uppercase tracking-wider mb-1.5 flex justify-between items-center" style={{ color: 'var(--text-secondary)' }}>
              <span>Final Negotiated Amount (₹)</span>
              <span className="font-normal normal-case tracking-normal text-xs text-[var(--text-tertiary)]">
                System Total: ₹{formatINR(cartTotal, 2)}{minPossibleTotal > 0 ? ` | Min Allowed: ₹${formatINR(minPossibleTotal, 2)}` : ''}
              </span>
            </label>
            <input 
              id="negotiated-total" 
              type="number" 
              step="any" 
              min="0" 
              autoFocus
              onFocus={(e) => e.target.select()}
              value={checkoutModal.negotiatedTotal} 
              onChange={(e) => { 
                const v = parseFloat(e.target.value); 
                setCheckoutModal({ ...checkoutModal, error: '', negotiatedTotal: (isNaN(v) || v < 0) ? '' : e.target.value });
              }} 
              placeholder={`e.g. ${Math.floor(cartTotal)}`} 
              className={`${inputBase} h-12 text-xl font-bold tabular-nums`} 
              style={{ 
                border: (checkoutModal.error || (checkoutModal.negotiatedTotal !== '' && (Number(checkoutModal.negotiatedTotal) < minPossibleTotal || Number(checkoutModal.negotiatedTotal) < screwPrice))) 
                  ? '1px solid var(--color-error)' 
                  : '1px solid var(--border-input)', 
                backgroundColor: 'var(--bg-input)', 
                color: 'var(--text-input)' 
              }} 
            />
            {screwPrice > 0 && (
              <div className="mt-1.5 flex items-center justify-between text-xs font-semibold px-2.5 py-1.5 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-light)]" style={{ color: 'var(--text-secondary)' }}>
                <span>Screws: ₹{formatINR(screwPrice, 2)} (Fixed price)</span>
                <span className="text-xs text-[var(--text-tertiary)] font-normal">Discount applies to other items only</span>
              </div>
            )}
            {checkoutModal.negotiatedTotal !== '' && Number(checkoutModal.negotiatedTotal) < screwPrice && (
              <p className="text-xs font-semibold mt-1.5 leading-snug" style={{ color: 'var(--color-error)' }}>
                Warning: Negotiated amount cannot be less than ₹{formatINR(screwPrice, 2)} (Screws price is fixed at ₹{formatINR(screwPrice, 2)}).
              </p>
            )}
            {checkoutModal.negotiatedTotal !== '' && Number(checkoutModal.negotiatedTotal) < minPossibleTotal && Number(checkoutModal.negotiatedTotal) >= screwPrice && (
              <p className="text-xs font-semibold mt-1.5 leading-snug" style={{ color: 'var(--color-error)' }}>
                Warning: Cannot discount below minimum selling limit (₹{formatINR(minPossibleTotal, 2)}{screwPrice > 0 ? ` including ₹${formatINR(screwPrice, 2)} for screws` : ''}). Products cannot be sold below MSP.
              </p>
            )}
          </div>
          )}

          <div className="mb-3.5">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Payment Method</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {[
                { key: 'CASH', label: 'Cash', shortcut: '1' },
                { key: 'UPI', label: 'UPI', shortcut: '2' },
                { key: 'SPLIT', label: 'UPI + Cash', shortcut: '3' },
                { key: 'SHOWROOM', label: 'Showroom', shortcut: '4' },
              ].map(({ key: method, label, shortcut }) => {
                const isSelected = checkoutModal.paymentMethod === method;
                const isShowroomMethod = method === 'SHOWROOM';
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setCheckoutModal({ ...checkoutModal, paymentMethod: method, error: '' })}
                    aria-pressed={isSelected}
                    title={`Shortcut: ${shortcut}`}
                    className={`relative h-11 px-3 sm:px-4 text-sm font-semibold rounded-md transition-colors flex items-center justify-center cursor-pointer ${isSelected ? 'shadow-sm' : 'hover:border-[var(--border-heavy)]'}`}
                    style={{ 
                      backgroundColor: isShowroomMethod
                        ? (isSelected ? 'var(--color-warning)' : 'var(--bg-tertiary)')
                        : (isSelected ? 'var(--color-accent-solid)' : 'var(--bg-tertiary)'),
                      color: isSelected
                        ? (isShowroomMethod ? '#000' : '#fff')
                        : 'var(--text-primary)',
                      border: `1px solid ${isShowroomMethod && isSelected ? 'var(--color-warning)' : isSelected ? 'var(--color-accent-solid)' : 'var(--border-medium)'}`
                    }}
                  >
                    <span>{label}</span>
                    <kbd aria-hidden="true" className="absolute top-1 right-1.5 text-xs font-mono font-normal opacity-60">{shortcut}</kbd>
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
                  Stock transfer to the showroom. Items are removed from store stock (and from inventory value). Not a sale: no payment, revenue or profit is recorded.
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
                    <label htmlFor="cash-given" className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
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
                    className={`${inputBase} h-12 text-xl font-bold tabular-nums`} 
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
                            className={`h-8 px-3 rounded-md text-xs font-semibold tabular-nums transition-colors border cursor-pointer ${
                              isSelected
                                ? 'bg-[var(--color-accent-solid)] text-white border-[var(--color-accent-solid)] shadow-sm'
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
                          className="h-8 px-2.5 rounded-md text-xs font-semibold text-[var(--color-error)] hover:bg-[var(--color-error-bg)] transition-colors cursor-pointer border border-transparent"
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
                      <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--color-success)' }}>
                        ₹{formatINR((numCashGiven - activeTotal), 2)}
                      </div>
                    </div>
                  )}

                  {isUnderpaid && (
                    <div className="mt-3 p-3 rounded-md flex items-center justify-between animate-fade-in" style={{ backgroundColor: 'var(--color-error-bg)', border: '1px solid var(--color-error)' }}>
                      <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-error)' }}>Shortfall (Remaining Due):</div>
                      <div className="text-xl font-bold tabular-nums" style={{ color: 'var(--color-error)' }}>
                        ₹{formatINR((activeTotal - numCashGiven), 2)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {checkoutModal.paymentMethod === 'SPLIT' && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <label htmlFor="split-upi" className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>UPI (₹)</label>
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
                    className={`${inputBase} h-12 text-xl font-bold tabular-nums`} 
                    style={{ border: checkoutModal.error ? '1px solid var(--color-error)' : '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="split-cash" className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Cash (₹)</label>
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
                    className={`${inputBase} h-12 text-xl font-bold tabular-nums`} 
                    style={{ border: checkoutModal.error ? '1px solid var(--color-error)' : '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
                  />
                </div>
              </div>
            )}
          </div>
        </div>
    </Modal>
  );
}
