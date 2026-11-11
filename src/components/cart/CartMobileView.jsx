import React from 'react';
import { formatINR } from '../../utils';

/** Mobile cart view */
import { useCart } from '../../contexts/CartContext';
import { useApp } from '../../AppContext';
import { formatUnitBadge } from './CartTable';

const CartMobileView = React.memo(function CartMobileView({ 
  activeTab, 
  onUpdateQuantity, 
  onUpdateDimensions, 
  onEditCuttableItem,
  onCustomPriceChange, 
  onCustomTotalChange, 
  onCustomPriceBlur, 
  onRemoveItem,
  onCancelHeldCart,
  onBackToLocal
}) {
  const { cart, activeCartTab, cancelHeldCart, switchCartTab } = useCart();
  const { userRole } = useApp();
  if (cart.length === 0) {
    if (activeCartTab && activeCartTab.startsWith('held_')) {
      return (
        <div className="p-8 text-center flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-error)' }}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </div>
          <p className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>This Held Cart is Empty</p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>All items have been removed from this held cart.</p>
          <div className="flex flex-col w-full gap-2">
            <button
              type="button"
              onClick={() => onCancelHeldCart ? onCancelHeldCart(activeCartTab) : cancelHeldCart(activeCartTab)}
              className="w-full py-3 text-sm font-bold rounded-md text-white transition-opacity hover:opacity-90 shadow-sm flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--color-error-solid)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Cancel & Delete Held Cart
            </button>
            <button
              type="button"
              onClick={() => onBackToLocal ? onBackToLocal() : switchCartTab('local')}
              className="w-full py-3 text-sm font-bold rounded-md transition-colors"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
            >
              ← Back to Local Cart
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="p-10 text-center text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Cart Empty</div>
    );
  }

  if (activeTab === 'receive' || activeTab === 'transfer') {
    return cart.map((item) => (
      <div key={item.id} className="p-5 flex flex-col shadow-md rounded-lg animate-fade-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '2px solid var(--border-medium)' }}>
        <div className="flex justify-between items-start mb-4 gap-4">
          <div className="flex flex-col flex-1">
            <span className="font-bold text-xl leading-tight" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
            {item.is_cuttable && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-medium)] text-[var(--color-accent)] mt-1 self-start">
                Total {item.actual_quantity !== undefined && item.actual_quantity !== '' ? item.actual_quantity : item.quantity} {String(item.unit || '').toLowerCase()}
              </span>
            )}
          </div>
          <button 
            onClick={() => onRemoveItem(item.id)} 
            className="w-12 h-12 flex items-center justify-center rounded-md font-bold text-2xl flex-shrink-0 transition-all active:scale-95" 
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
        
        <div className="flex justify-between items-center mt-2 pt-4" style={{ borderTop: '2px dashed var(--border-light)' }}>
          <span className="text-base font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Quantity</span>
          <div className="flex items-center gap-2">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, Number(item.quantity) - 1)} className="w-14 h-14 flex items-center justify-center rounded-md bg-[var(--bg-tertiary)] active:bg-[var(--bg-hover)] text-[var(--text-primary)] border-2 border-[var(--border-medium)] font-bold text-3xl leading-none transition-all active:scale-95">-</button>
            <input
              type="number"
              min="0"
              step="any"
              value={item.quantity}
              onChange={(e) => onUpdateQuantity(item.id, e.target.value)}
              className="w-20 h-14 text-center text-2xl font-bold rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border-2 border-[var(--border-medium)] focus:outline-none focus:border-[var(--color-accent)] appearance-none m-0"
            />
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, Number(item.quantity) + 1)} className="w-14 h-14 flex items-center justify-center rounded-md bg-[var(--bg-tertiary)] active:bg-[var(--bg-hover)] text-[var(--text-primary)] border-2 border-[var(--border-medium)] font-bold text-3xl leading-none transition-all active:scale-95">+</button>
          </div>
        </div>

        {activeTab === 'receive' && (
          <div className="flex gap-4 mt-4 pt-4" style={{ borderTop: '2px dashed var(--border-light)' }}>
            <div className="flex-1">
              <span className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-secondary)' }}>MRP</span>
              <div className="w-full h-12 flex items-center justify-center text-lg font-semibold text-center rounded-md bg-[var(--bg-tertiary)]" style={{ border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                ₹{formatINR(Number(item.selling_price !== undefined ? item.selling_price : item.price || 0), 2)}
              </div>
            </div>
          </div>
        )}
      </div>
    ));
  }

  return cart.map((item) => {
    const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
    const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
    return (
      <div key={item.id} className="p-4 flex flex-col gap-3 animate-fade-in" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <div className="flex justify-between items-start">
          <div className="pr-2 flex-1">
            <div className="flex justify-between items-start w-full">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name || (item.is_screw || item.barcode === 'SCREWS' ? 'Screws' : 'Item')}</p>
              <button type="button" onClick={() => onRemoveItem(item.id)} className=" text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-[var(--color-error)]" aria-label={`Remove ${item.name}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
            {item.pieceLength && (
              <p className="text-[11px] uppercase font-bold mt-1" style={{ color: 'var(--text-tertiary)' }}>Length per piece: {item.pieceLength} {item.unit}</p>
            )}
            <p className="text-xs mt-1 mb-1" style={{ color: 'var(--color-accent)' }}>#{item.scanned_barcode || item.barcode}</p>
            {activeTab === 'checkout' && !item.is_screw && item.barcode !== 'SCREWS' && (
              <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                MRP: ₹{formatINR(Number(item.price || 0), 2)}{item.is_loose_item && item.unit?.toUpperCase() === 'KG' ? '/kg' : ''} • <span className="group/msp cursor-help">MSP: {userRole === 'owner' ? `₹${formatINR(Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0), 2)}${item.is_loose_item && item.unit?.toUpperCase() === 'KG' ? '/kg' : ''}` : <span className="transition-all duration-300"><span className="group-hover/msp:hidden">***</span><span className="hidden group-hover/msp:inline">₹{formatINR(Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0), 2)}{item.is_loose_item && item.unit?.toUpperCase() === 'KG' ? '/kg' : ''}</span></span>}</span>
              </p>
            )}
          </div>
          {activeTab === 'checkout' && (
            <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>₹{formatINR((sellPrice * safeQty), 2)}</p>
          )}
        </div>
        <div className="flex justify-between items-center mt-1 pt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
          {item.is_cuttable ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-1.5">
                <div className="inline-flex items-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] overflow-hidden shadow-sm">
                  <button 
                    type="button" 
                    onMouseDown={(e) => e.preventDefault()} 
                    onClick={() => onUpdateQuantity(item.id, Math.max(Math.min(1, safeQty), safeQty - 1))} 
                    className="w-10 h-10 flex items-center justify-center text-lg font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors border-r border-[var(--border-medium)] select-none"
                    style={{ borderRadius: 0 }}
                    aria-label="Decrease quantity"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={item.quantity}
                    onChange={(e) => onUpdateQuantity(item.id, e.target.value)}
                    className="w-14 h-10 text-center font-bold text-sm bg-transparent text-[var(--text-primary)] rounded-none !border-none !shadow-none !outline-none focus:!outline-none focus:!border-none focus:!shadow-none focus:bg-[var(--bg-secondary)] transition-colors p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    style={{ borderRadius: 0, border: 'none', boxShadow: 'none', outline: 'none' }}
                    aria-label={`${item.name} quantity`}
                  />
                  <button 
                    type="button" 
                    onMouseDown={(e) => e.preventDefault()} 
                    onClick={() => onUpdateQuantity(item.id, safeQty + 1)} 
                    className="w-10 h-10 flex items-center justify-center text-lg font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors border-l border-[var(--border-medium)] select-none"
                    style={{ borderRadius: 0 }}
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
              </div>
              <span className="text-xs font-semibold text-[var(--text-tertiary)]">
                {String(item.unit || '').toLowerCase()}
              </span>
            </div>
          ) : (
            <div className="flex items-center">
              <div className="flex items-center gap-1.5">
                {(() => {
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

                  if (activeTab === 'checkout' && isLooseKg) {
                    const currentGrams = item.grams !== undefined && item.grams !== '' ? item.grams : (item.quantity !== '' ? Math.round(Number(item.quantity) * 1000) : '');
                    return (
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              const nextGrams = Math.max(0, (Number(currentGrams) || 0) - 50);
                              onUpdateQuantity(item.id, nextGrams === 0 ? 0 : nextGrams / 1000, nextGrams);
                            }}
                            className="w-8 h-8 flex items-center justify-center font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-medium)] rounded-md bg-[var(--bg-tertiary)] shadow-sm cursor-pointer"
                            aria-label={`Decrease ${item.name} quantity by 50g`}
                            title="-50g"
                          >
                            -
                          </button>
                          <div className="inline-flex items-center h-8 bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md px-2 focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)] transition-all shadow-sm" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.1) inset' }}>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              value={currentGrams}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  onUpdateQuantity(item.id, '', '');
                                } else {
                                  const g = Math.max(0, Number(val));
                                  onUpdateQuantity(item.id, g / 1000, g);
                                }
                              }}
                              className="w-12 h-full text-sm font-bold text-center bg-transparent text-[var(--text-primary)] focus:outline-none p-0"
                              aria-label={`${item.name} quantity in grams`}
                            />
                            <span className="text-[11px] font-bold pointer-events-none text-[var(--text-tertiary)] ml-1 shrink-0 uppercase select-none">
                              g
                            </span>
                          </div>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              const nextGrams = (Number(currentGrams) || 0) + 50;
                              onUpdateQuantity(item.id, nextGrams / 1000, nextGrams);
                            }}
                            className="w-8 h-8 flex items-center justify-center font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-medium)] rounded-md bg-[var(--bg-tertiary)] shadow-sm cursor-pointer"
                            aria-label={`Increase ${item.name} quantity by 50g`}
                            title="+50g"
                          >
                            +
                          </button>
                        </div>
                        <span className="text-xs text-[var(--text-tertiary)] font-normal mt-0.5">
                          ({Number(safeQty).toFixed(3)} kg)
                        </span>
                      </div>
                    );
                  }

                  if (item.is_screw || item.barcode === 'SCREWS') {
                    return (
                      <div className="w-20 h-8 flex items-center justify-center text-xs font-bold bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md text-[var(--text-secondary)]">
                        1 SET
                      </div>
                    );
                  }

                  return (
                    <div className="flex flex-col items-center">
                      <div className="inline-flex items-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] overflow-hidden shadow-sm">
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-8 h-8 flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors cursor-pointer border-r border-[var(--border-medium)] select-none" style={{ borderRadius: 0 }} aria-label={`Decrease ${item.name} quantity`}>-</button>
                        <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-14 h-8 text-sm font-bold text-center bg-transparent text-[var(--text-primary)] rounded-none !border-none !shadow-none !outline-none focus:!outline-none focus:!border-none focus:!shadow-none focus:bg-[var(--bg-secondary)] transition-colors p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" style={{ borderRadius: 0, border: 'none', boxShadow: 'none', outline: 'none' }} aria-label={`${item.name} quantity`} />
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="w-8 h-8 flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors cursor-pointer border-l border-[var(--border-medium)] select-none" style={{ borderRadius: 0 }} aria-label={`Increase ${item.name} quantity`}>+</button>
                      </div>
                      <span className="text-xs text-[var(--text-tertiary)] font-medium mt-0.5">
                        {safeQty} {formatUnitBadge(item.unit === 'SQFT' && activeTab !== 'checkout' ? 'ROLLS' : item.unit)}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  });
});

export default CartMobileView;
