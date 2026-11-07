import React from 'react';

import { useCart } from '../../contexts/CartContext';
import { useApp } from '../../AppContext';

export const formatUnitBadge = (unit) => {
  if (!unit) return 'pcs';
  const u = String(unit).trim().toUpperCase();
  if (u === 'GRAMS' || u === 'GRAM' || u === 'G' || u === 'GM') return 'g';
  if (u === 'KG' || u === 'KGS' || u === 'KILOGRAM' || u === 'KILOGRAMS') return 'kg';
  if (u === 'METER' || u === 'METERS' || u === 'M') return 'm';
  if (u === 'PIECES' || u === 'PIECE' || u === 'PCS') return 'pcs';
  if (u === 'SQFT') return 'sqft';
  if (u === 'FEET' || u === 'FOOT' || u === 'FT') return 'ft';
  return u.length > 3 ? u.substring(0, 3).toLowerCase() : u.toLowerCase();
};

const CartTable = React.memo(function CartTable({ 
  activeTab, 
  selectedCartIndex = null,
  onSelectCartIndex = null,
  onUpdateQuantity, 
  onUpdateDimensions, 
  onEditCuttableItem,
  onCustomPriceChange, 
  onCustomTotalChange, 
  onCustomPriceBlur, 
  onCustomPriceChangeGroup, 
  onCustomTotalChangeGroup, 
  onCustomPriceBlurGroup, 
  onRemoveItem,
  onCancelHeldCart,
  onBackToLocal
}) {
  const { cart, activeCartTab, cancelHeldCart, switchCartTab } = useCart();
  const { userRole } = useApp();
  if (cart.length === 0) {
    if (activeCartTab && activeCartTab.startsWith('held_')) {
      return (
        <div className="h-full flex flex-col items-center justify-center min-h-[320px] text-center p-6" data-testid="empty-held-cart-view">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-error)' }}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <p className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>This Held Cart is Empty</p>
          <p className="text-xs mb-5 max-w-sm" style={{ color: 'var(--text-tertiary)' }}>All items have been removed from this held cart. You can cancel and delete it completely, or return to your local cart.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              data-testid="empty-held-cart-cancel"
              onClick={() => onCancelHeldCart ? onCancelHeldCart(activeCartTab) : cancelHeldCart(activeCartTab)}
              className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-md text-white transition-opacity hover:opacity-90 shadow-sm flex items-center gap-2"
              style={{ backgroundColor: 'var(--color-error)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Cancel & Delete Held Cart
            </button>
            <button
              type="button"
              onClick={() => onBackToLocal ? onBackToLocal() : switchCartTab('local')}
              className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-md transition-colors"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
            >
              ← Back to Local Cart
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col items-center justify-center min-h-[300px]">
        <p className="text-sm font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>Ready</p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Scan items anytime or type the barcode above</p>
      </div>
    );
  }

  const handleWheelBlur = (e) => {
    e.currentTarget.blur();
  };

  return (
    <table className="w-full min-w-[760px] xl:min-w-[900px] text-center whitespace-nowrap border-collapse" role="table">
      <thead className="sticky top-0 z-20" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
        <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <th className="py-4 px-3 w-28 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Barcode</th>
          <th className="py-4 px-3 w-1/3 min-w-[160px] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Item Name</th>
          <th className="p-3 text-center w-60 lg:w-72" style={{ borderRight: '1px solid var(--border-medium)' }}>Quantity</th>
          {activeTab === 'checkout' && (
            <>
              <th className="py-4 px-3 text-center w-28 lg:w-36" style={{ borderRight: '1px solid var(--border-medium)' }}>MRP (₹)</th>
              <th className="py-4 px-3 text-center w-28 lg:w-32" style={{ borderRight: '1px solid var(--border-medium)' }}>Total</th>
            </>
          )}
          {activeTab === 'receive' && (
            <>
              <th className="py-4 px-3 text-center w-28 lg:w-32" style={{ borderRight: '1px solid var(--border-medium)' }}>MSP (₹)</th>
              <th className="py-4 px-3 text-center w-28 lg:w-32" style={{ borderRight: '1px solid var(--border-medium)' }}>MRP (₹)</th>
            </>
          )}
          <th className="py-4 px-2 w-12"></th>
        </tr>
      </thead>
      <tbody style={{ borderBottom: '1px solid var(--border-medium)' }}>
        {cart.map(item => {
          const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
            const billableQty = item.billableQuantity !== undefined && item.billableQuantity !== '' ? Number(item.billableQuantity) : safeQty;
            const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
            const itemMsp = Number(item.msp_price) || Number(item.msp) || Number(item.cost_price) || 0;
            const isItemBelowMsp = !item.is_screw && item.barcode !== 'SCREWS' && activeTab === 'checkout' && itemMsp > 0 && sellPrice < itemMsp;
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
            const hasSubtext = Boolean((activeTab === 'checkout' && isLooseKg) || (safeQty !== billableQty));

            const isRowSelected = cart[selectedCartIndex]?.id === item.id;

            return (
              <tr 
                key={item.id} 
                onClick={() => {
                  const rIdx = cart.findIndex(c => c.id === item.id);
                  if (rIdx >= 0 && onSelectCartIndex) onSelectCartIndex(rIdx);
                }}
                className={`animate-fade-in cursor-pointer transition-colors ${isRowSelected ? 'bg-[var(--bg-hover)]' : ''}`} 
                style={{ 
                  borderBottom: '1px solid var(--border-medium)'
                }}
              >
                <td className="py-4 px-3 text-center align-middle text-sm font-bold" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>
                  {item.scanned_barcode && item.scanned_barcode.includes('-') ? item.scanned_barcode : (item.batch_number ? `${item.barcode}-${String(item.batch_number).padStart(2, '0')}` : item.scanned_barcode || item.instance_barcode || item.barcode)}
                </td>
                <td className="py-4 px-3 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                  {item.pieceLength && (
                    <p className="text-[10px] uppercase font-bold mt-1" style={{ color: 'var(--text-tertiary)' }}>Length per piece: {item.pieceLength} {item.unit}</p>
                  )}
                  {activeTab === 'checkout' && !item.is_screw && item.barcode !== 'SCREWS' && (
                    <div className="flex justify-center gap-2 mt-1">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wider" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                          MRP: ₹{Number(item.price || 0).toFixed(2)}{isLooseKg ? '/kg' : ''}
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wider group/msp cursor-help rounded-sm" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                          MSP: {userRole === 'owner' ? `₹${Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0).toFixed(2)}${isLooseKg ? '/kg' : ''}` : <span className="transition-all duration-300"><span className="group-hover/msp:hidden">***</span><span className="hidden group-hover/msp:inline">₹{Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0).toFixed(2)}{isLooseKg ? '/kg' : ''}</span></span>}
                        </span>
                      </div>
                  )}
                </td>
                <td className="p-2 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                  {item.is_cuttable ? (
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-8 flex items-center justify-center gap-1.5">
                        <button 
                          type="button" 
                          onMouseDown={(e) => e.preventDefault()} 
                          onClick={() => onUpdateQuantity(item.id, Math.max(activeTab === 'checkout' ? 0.1 : 1, safeQty - 1))} 
                          className="w-8 h-8 flex items-center justify-center font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-medium)] rounded-md bg-[var(--bg-tertiary)] shadow-sm cursor-pointer"
                          aria-label="Decrease quantity"
                        >
                          -
                        </button>
                        <div className="inline-flex items-center h-8 bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md px-2 focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)] transition-all shadow-sm">
                          <input 
                            type="number" 
                            step={activeTab === 'checkout' ? "any" : "1"} 
                            min={activeTab === 'checkout' ? "0" : "1"} 
                            onWheel={handleWheelBlur} 
                            value={item.quantity} 
                            onChange={(e) => onUpdateQuantity(item.id, e.target.value)} 
                            className="w-12 h-full text-sm font-bold text-center bg-transparent text-[var(--text-primary)] focus:outline-none p-0" 
                            aria-label={`${item.name} quantity`} 
                          />
                          <span className="text-[10px] font-bold pointer-events-none text-[var(--text-tertiary)] ml-1 shrink-0 uppercase select-none">
                            {activeTab === 'checkout' ? item.unit : (item.unit === 'SQFT' ? 'ROLLS' : 'PCS')}
                          </span>
                        </div>
                        <button 
                          type="button" 
                          onMouseDown={(e) => e.preventDefault()} 
                          onClick={() => onUpdateQuantity(item.id, safeQty + 1)} 
                          className="w-8 h-8 flex items-center justify-center font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-medium)] rounded-md bg-[var(--bg-tertiary)] shadow-sm cursor-pointer"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <div className="h-4 flex flex-col items-center justify-center mt-1">
                        {activeTab === 'checkout' ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditCuttableItem && onEditCuttableItem(item);
                              }}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-accent)] hover:underline hover:text-[var(--text-primary)] transition-colors cursor-pointer px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-medium)]"
                              title="Click to edit cut pieces or length"
                            >
                              <span>
                                {item.cut_pieces 
                                  ? (item.unit === 'SQFT' 
                                      ? `${item.cut_pieces} × ${item.cut_length || item.default_length} FT (${item.default_width || 3} FT H)` 
                                      : `${item.cut_pieces} × ${item.cut_length || item.default_length} ${item.unit || 'FT'}`)
                                  : `${safeQty} ${item.unit}`}
                              </span>
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-2.5 h-2.5 opacity-70">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-[var(--color-accent)] font-semibold leading-none">
                            ({item.actual_quantity !== undefined ? item.actual_quantity : Math.round(safeQty * Number(item.default_length || 12) * (item.unit === 'SQFT' ? Number(item.default_width || 3) : 1) * 100) / 100} {item.unit})
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-8 flex items-center justify-center gap-1.5">
                        {item.instance_barcode ? (
                          <div className="inline-flex items-center h-8 bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md px-2 shadow-sm">
                            <div className="w-12 h-full flex items-center justify-center text-sm font-bold text-[var(--text-primary)]">
                              {safeQty}
                            </div>
                            <span className="text-[10px] font-bold pointer-events-none text-[var(--text-tertiary)] ml-1 shrink-0 uppercase select-none">
                              {formatUnitBadge((item.unit === 'SQFT' || item.is_cuttable) && activeTab !== 'checkout' ? 'PCS' : item.unit)}
                            </span>
                          </div>
                        ) : activeTab === 'checkout' && isLooseKg ? (
                          (() => {
                            const currentGrams = item.grams !== undefined && item.grams !== '' ? item.grams : (item.quantity !== '' ? Math.round(Number(item.quantity) * 1000) : '');
                            return (
                              <>
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
                                    onWheel={handleWheelBlur}
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
                                  <span className="text-[10px] font-bold pointer-events-none text-[var(--text-tertiary)] ml-1 shrink-0 uppercase select-none">
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
                              </>
                            );
                          })()
                        ) : item.is_screw ? (
                          <div className="w-20 h-8 flex items-center justify-center text-xs font-bold bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md text-[var(--text-secondary)]">
                            1 SET
                          </div>
                        ) : (
                          <>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-8 h-8 flex items-center justify-center font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-medium)] rounded-md bg-[var(--bg-tertiary)] shadow-sm cursor-pointer" aria-label={`Decrease ${item.name} quantity`}>-</button>
                            <div className="inline-flex items-center h-8 bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md px-2 focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)] transition-all shadow-sm" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.1) inset' }}>
                              <input type="number" step="any" min="0" onWheel={handleWheelBlur} value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-12 h-full text-sm font-bold text-center bg-transparent text-[var(--text-primary)] focus:outline-none p-0" aria-label={`${item.name} quantity`} />
                              <span className="text-[10px] font-bold pointer-events-none text-[var(--text-tertiary)] ml-1 shrink-0 uppercase select-none">
                                {formatUnitBadge((item.unit === 'SQFT' || item.is_cuttable) && activeTab !== 'checkout' ? 'PCS' : item.unit)}
                              </span>
                            </div>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="w-8 h-8 flex items-center justify-center font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-medium)] rounded-md bg-[var(--bg-tertiary)] shadow-sm cursor-pointer" aria-label={`Increase ${item.name} quantity`}>+</button>
                          </>
                        )}
                      </div>
                      {hasSubtext && (
                        <div className="h-4 flex items-center justify-center mt-1">
                          {isLooseKg && activeTab === 'checkout' ? (
                            <span className="text-[10px] text-[var(--text-tertiary)] font-normal leading-none">
                              ({Number(safeQty).toFixed(3)} kg)
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                {activeTab === 'checkout' && (<>
                  <td className="p-2 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    {item.is_screw || item.barcode === 'SCREWS' ? (
                      <span className="text-sm font-bold text-[var(--text-tertiary)]">—</span>
                    ) : (
                      <div className="flex flex-col items-center justify-center">
                        <div className="h-8 flex items-center justify-center w-full">
                          <div className="relative flex items-center justify-center w-full max-w-[120px] h-8 mx-auto">
                            <span className="absolute left-3 text-[11px] font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>₹</span>
                            <input 
                              type="number" 
                              step="0.01" 
                              min={itemMsp > 0 ? itemMsp : 0}
                              onWheel={handleWheelBlur} 
                              value={item.customPriceInput !== undefined ? (typeof item.customPriceInput === 'number' ? item.customPriceInput.toFixed(2) : item.customPriceInput) : Number(item.price || 0).toFixed(2)} 
                              onChange={(e) => onCustomPriceChange(item.id, e.target.value)} 
                              onBlur={() => onCustomPriceBlur(item.id)} 
                              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                              placeholder="0.00" 
                              className={`w-full h-8 pl-6 pr-2 text-sm font-bold text-center focus:outline-none rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors focus:ring-1 ${isItemBelowMsp ? 'focus:ring-[var(--color-error)]' : 'focus:ring-[var(--color-accent)]'}`} 
                              style={{ 
                                border: isItemBelowMsp ? '1px solid var(--color-error)' : '1px solid var(--border-medium)', 
                                color: isItemBelowMsp ? 'var(--color-error)' : 'var(--text-primary)' 
                              }} 
                              aria-label={`${item.name} MRP`} 
                            />
                          </div>
                        </div>
                        {isItemBelowMsp ? (
                          <div className="h-4 flex items-center justify-center mt-1">
                            <span className="text-[10px] font-bold leading-none" style={{ color: 'var(--color-error)' }}>
                              Min: ₹{itemMsp.toFixed(2)}
                            </span>
                          </div>
                        ) : hasSubtext ? (
                          <div className="h-4 flex items-center justify-center mt-1">
                            {isLooseKg ? (
                              <span className="text-[10px] text-[var(--text-tertiary)] font-normal leading-none">per kg</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-8 flex items-center justify-center w-full">
                        <div className="relative flex items-center justify-center w-full max-w-[120px] h-8 mx-auto">
                          <span className="absolute left-3 text-[11px] font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>₹</span>
                          <input 
                            type="number" 
                            step="0.01" 
                            onWheel={handleWheelBlur} 
                            value={item.customTotalInput !== undefined ? item.customTotalInput : (sellPrice * billableQty).toFixed(2)} 
                            onChange={(e) => onCustomTotalChange(item.id, e.target.value, billableQty)} 
                            onBlur={() => onCustomPriceBlur(item.id)} 
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                            placeholder="0.00" 
                            className={`w-full h-8 pl-6 pr-2 text-sm font-bold text-center focus:outline-none rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors focus:ring-1 ${isItemBelowMsp ? 'focus:ring-[var(--color-error)]' : 'focus:ring-[var(--color-accent)]'}`} 
                            style={{ 
                              border: isItemBelowMsp ? '1px solid var(--color-error)' : '1px solid var(--border-medium)', 
                              color: 'var(--text-primary)' 
                            }} 
                            aria-label={`${item.name} total`} 
                          />
                        </div>
                      </div>
                      {hasSubtext && (
                        <div className="h-4 flex items-center justify-center mt-1">
                          {safeQty !== billableQty ? (
                            <span className="text-[10px] text-[var(--text-tertiary)] font-normal leading-none">Billed: {billableQty} {item.unit}</span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </td>
                </>)}
                {activeTab === 'receive' && (<>
                  <td className="p-2 text-center align-middle text-sm font-semibold bg-[var(--bg-tertiary)] group/msp cursor-help" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                    {userRole === 'owner' ? `₹${Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0).toFixed(2)}` : <span className="transition-all duration-300"><span className="group-hover/msp:hidden">***</span><span className="hidden group-hover/msp:inline">₹{Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0).toFixed(2)}</span></span>}
                  </td>
                  <td className="p-2 text-center align-middle text-sm font-semibold bg-[var(--bg-tertiary)]" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                    ₹{Number(item.selling_price !== undefined ? item.selling_price : item.price || 0).toFixed(2)}
                  </td>
                </>)}
                <td className="p-2 text-center align-middle">
                  <div className="flex flex-col items-center justify-center">
                    <div className="h-8 flex items-center justify-center">
                      <button type="button" onClick={() => onRemoveItem(item.id)} className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-[var(--color-error)] transition-colors cursor-pointer" aria-label={`Remove ${item.name}`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                    {hasSubtext && <div className="h-4 mt-1" />}
                  </div>
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
  );
});

export default CartTable;
