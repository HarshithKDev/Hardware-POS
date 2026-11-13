import React from 'react';
import { formatINR } from '../../utils';

import { useCart } from '../../contexts/CartContext';
import { useApp } from '../../AppContext';
import useScanFlash, { scanFlashClass } from './useScanFlash';

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
  onCustomPriceChange, 
  onCustomTotalChange, 
  onCustomPriceBlur, 
  onRemoveItem,
  onCancelHeldCart,
  onBackToLocal
}) {
  const { cart, activeCartTab, cancelHeldCart, switchCartTab } = useCart();
  const { userRole } = useApp();
  const scanFlash = useScanFlash(cart, activeCartTab);
  if (cart.length === 0) {
    if (activeCartTab && activeCartTab.startsWith('held_')) {
      return (
        <div className="h-full flex flex-col items-center justify-center min-h-[320px] text-center p-6" data-testid="empty-held-cart-view">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'var(--color-error-bg)', color: 'var(--color-error)' }}>
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
              className="px-5 py-2.5 text-xs font-bold rounded-md text-white transition-opacity hover:opacity-90 shadow-sm flex items-center gap-2"
              style={{ backgroundColor: 'var(--color-error-solid)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Cancel & Delete Held Cart
            </button>
            <button
              type="button"
              onClick={() => onBackToLocal ? onBackToLocal() : switchCartTab('local')}
              className="px-5 py-2.5 text-xs font-bold rounded-md transition-colors"
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
            const hasQtySubtext = Boolean(
              item.is_cuttable ||
              (!item.instance_barcode && !item.is_screw && item.barcode !== 'SCREWS')
            );
            const hasSubtext = activeTab === 'checkout' && Boolean(
              hasQtySubtext || isLooseKg || (safeQty !== billableQty)
            );

            const isRowSelected = cart[selectedCartIndex]?.id === item.id;

            return (
              <tr 
                key={item.id} 
                onClick={() => {
                  const rIdx = cart.findIndex(c => c.id === item.id);
                  if (rIdx >= 0 && onSelectCartIndex) onSelectCartIndex(rIdx);
                }}
                className={`animate-fade-in cursor-pointer transition-colors ${isRowSelected ? 'bg-[var(--bg-hover)]' : ''} ${scanFlashClass(scanFlash, item.id)}`} 
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
                    <p className="text-[11px] uppercase font-bold mt-1" style={{ color: 'var(--text-tertiary)' }}>Length per piece: {item.pieceLength} {item.unit}</p>
                  )}
                  {activeTab === 'checkout' && !item.is_screw && item.barcode !== 'SCREWS' && (
                    <div className="flex justify-center gap-2 mt-1">
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 uppercase tracking-wider" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                          MRP: ₹{formatINR(Number(item.price || 0), 2)}{isLooseKg ? '/kg' : ''}
                        </span>
                        <span tabIndex={-1} className="outline-none text-[11px] font-semibold px-1.5 py-0.5 uppercase tracking-wider group/msp cursor-help rounded-sm" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                          MSP: {userRole === 'owner' ? `₹${formatINR(Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0), 2)}${isLooseKg ? '/kg' : ''}` : <span className="transition-all duration-300"><span className="group-hover/msp:hidden group-focus/msp:hidden">***</span><span className="hidden group-hover/msp:inline group-focus/msp:inline">₹{formatINR(Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0), 2)}{isLooseKg ? '/kg' : ''}</span></span>}
                        </span>
                      </div>
                  )}
                </td>
                <td className="py-3 px-2 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                  {item.is_cuttable ? (
                    <div className="flex flex-col items-center justify-center">
                      <div className="inline-flex items-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] overflow-hidden shadow-sm">
                        <button 
                          type="button" 
                          onMouseDown={(e) => e.preventDefault()} 
                          onClick={() => onUpdateQuantity(item.id, Math.max(Math.min(1, safeQty), safeQty - 1))} 
                          className="w-8 h-8 flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors cursor-pointer border-r border-[var(--border-medium)] select-none"
                          style={{ borderRadius: 0 }}
                          aria-label="Decrease quantity" title="Decrease quantity"
                        >
                          -
                        </button>
                        <input 
                          type="number" inputMode="decimal" 
                          step="any" 
                          min="0" 
                          onWheel={handleWheelBlur} 
                          value={item.quantity} 
                          onChange={(e) => onUpdateQuantity(item.id, e.target.value)} 
                          className="compact-field w-14 h-8 text-sm font-bold text-center bg-transparent text-[var(--text-primary)] rounded-none !border-none !shadow-none !outline-none focus:!outline-none focus:!border-none focus:!shadow-none focus:bg-[var(--bg-secondary)] transition-colors p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                          style={{ borderRadius: 0, border: 'none', boxShadow: 'none', outline: 'none' }}
                          aria-label={`${item.name} quantity`} 
                        />
                        <button 
                          type="button" 
                          onMouseDown={(e) => e.preventDefault()} 
                          onClick={() => onUpdateQuantity(item.id, safeQty + 1)} 
                          className="w-8 h-8 flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors cursor-pointer border-l border-[var(--border-medium)] select-none"
                          style={{ borderRadius: 0 }}
                          aria-label="Increase quantity" title="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      {/* Cut-length items: the quantity is the total length / area (no pieces) */}
                      <span className="mt-1 text-xs text-[var(--text-tertiary)] font-medium">
                        Total {safeQty} {String(item.unit || '').toLowerCase()}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center">
                      {item.instance_barcode ? (
                        <div className="h-8 flex items-center justify-center">
                          <div className="inline-flex items-center h-8 px-3 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-medium)] shadow-sm">
                            <span className="text-sm font-bold text-[var(--text-primary)]">
                              {safeQty} {formatUnitBadge((item.unit === 'SQFT' || item.is_cuttable) && activeTab !== 'checkout' ? 'PCS' : item.unit)}
                            </span>
                          </div>
                        </div>
                      ) : activeTab === 'checkout' && isLooseKg ? (
                        (() => {
                          const currentGrams = item.grams !== undefined && item.grams !== '' ? item.grams : (item.quantity !== '' ? Math.round(Number(item.quantity) * 1000) : '');
                          return (
                            <>
                              <div className="min-h-8 flex items-center justify-center">
                                <div className="inline-flex items-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] overflow-hidden shadow-sm">
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      const nextGrams = Math.max(0, (Number(currentGrams) || 0) - 50);
                                      onUpdateQuantity(item.id, nextGrams === 0 ? 0 : nextGrams / 1000, nextGrams);
                                    }}
                                    className="h-8 px-2 flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors cursor-pointer border-r border-[var(--border-medium)] select-none"
                                    style={{ borderRadius: 0 }}
                                    aria-label={`Decrease ${item.name} quantity by 50g`}
                                    title="-50g"
                                  >
                                    -50g
                                  </button>
                                  <input
                                    type="number" inputMode="decimal"
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
                                    className="compact-field w-14 h-8 text-sm font-bold text-center bg-transparent text-[var(--text-primary)] rounded-none !border-none !shadow-none !outline-none focus:!outline-none focus:!border-none focus:!shadow-none focus:bg-[var(--bg-secondary)] transition-colors p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    style={{ borderRadius: 0, border: 'none', boxShadow: 'none', outline: 'none' }}
                                    aria-label={`${item.name} quantity in grams`}
                                  />
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      const nextGrams = (Number(currentGrams) || 0) + 50;
                                      onUpdateQuantity(item.id, nextGrams / 1000, nextGrams);
                                    }}
                                    className="h-8 px-2 flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors cursor-pointer border-l border-[var(--border-medium)] select-none"
                                    style={{ borderRadius: 0 }}
                                    aria-label={`Increase ${item.name} quantity by 50g`}
                                    title="+50g"
                                  >
                                    +50g
                                  </button>
                                </div>
                              </div>
                              <div className="h-4 flex items-center justify-center mt-1">
                                <span className="text-xs text-[var(--text-tertiary)] font-medium leading-none">
                                  {Number(safeQty).toFixed(3)} kg ({currentGrams || 0}g)
                                </span>
                              </div>
                            </>
                          );
                        })()
                      ) : item.is_screw ? (
                        <div className="h-8 flex items-center justify-center">
                          <div className="w-20 h-8 flex items-center justify-center text-xs font-bold bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md text-[var(--text-secondary)]">
                            1 SET
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="min-h-8 flex items-center justify-center">
                            <div className="inline-flex items-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] overflow-hidden shadow-sm">
                              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="tap-area relative w-8 h-8 flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors cursor-pointer border-r border-[var(--border-medium)] select-none" style={{ borderRadius: 0 }} aria-label={`Decrease ${item.name} quantity`} title={`Decrease ${item.name} quantity`}>-</button>
                              <input type="number" inputMode="decimal" step="any" min="0" onWheel={handleWheelBlur} value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="compact-field w-14 h-8 text-sm font-bold text-center bg-transparent text-[var(--text-primary)] rounded-none !border-none !shadow-none !outline-none focus:!outline-none focus:!border-none focus:!shadow-none focus:bg-[var(--bg-secondary)] transition-colors p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" style={{ borderRadius: 0, border: 'none', boxShadow: 'none', outline: 'none' }} aria-label={`${item.name} quantity`} />
                              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="tap-area relative w-8 h-8 flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors cursor-pointer border-l border-[var(--border-medium)] select-none" style={{ borderRadius: 0 }} aria-label={`Increase ${item.name} quantity`} title={`Increase ${item.name} quantity`}>+</button>
                            </div>
                          </div>
                          <div className="h-4 flex items-center justify-center mt-1">
                            <span className="text-xs text-[var(--text-tertiary)] font-medium leading-none">
                              {safeQty} {formatUnitBadge(item.unit)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </td>
                {activeTab === 'checkout' && (<>
                  <td className="py-3 px-2 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    {item.is_screw || item.barcode === 'SCREWS' ? (
                      <span className="text-sm font-bold text-[var(--text-tertiary)]">—</span>
                    ) : (
                      <div className="flex flex-col items-center justify-center">
                        <div className="h-8 flex items-center justify-center w-full">
                          <div className="relative flex items-center justify-center w-full max-w-[120px] h-8 mx-auto">
                            <span className="absolute left-3 text-xs font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>₹</span>
                            <input 
                              type="number" inputMode="decimal" 
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
                            <span className="text-xs font-bold leading-none" style={{ color: 'var(--color-error)' }}>
                              Min: ₹{formatINR(itemMsp, 2)}
                            </span>
                          </div>
                        ) : hasSubtext ? (
                          <div className="h-4 flex items-center justify-center mt-1">
                            {isLooseKg ? (
                              <span className="text-xs text-[var(--text-tertiary)] font-normal leading-none">per kg</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-2 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-8 flex items-center justify-center w-full">
                        <div className="relative flex items-center justify-center w-full max-w-[120px] h-8 mx-auto">
                          <span className="absolute left-3 text-xs font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>₹</span>
                          <input 
                            type="number" inputMode="decimal" 
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
                            <span className="text-xs text-[var(--text-tertiary)] font-normal leading-none">Billed: {billableQty} {item.unit}</span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </td>
                </>)}
                {activeTab === 'receive' && (<>
                  <td tabIndex={-1} className="outline-none p-2 text-center align-middle text-sm font-semibold bg-[var(--bg-tertiary)] group/msp cursor-help" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                    {userRole === 'owner' ? `₹${formatINR(Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0), 2)}` : <span className="transition-all duration-300"><span className="group-hover/msp:hidden group-focus/msp:hidden">***</span><span className="hidden group-hover/msp:inline group-focus/msp:inline">₹{formatINR(Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0), 2)}</span></span>}
                  </td>
                  <td className="p-2 text-center align-middle text-sm font-semibold bg-[var(--bg-tertiary)]" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                    ₹{formatINR(Number(item.selling_price !== undefined ? item.selling_price : item.price || 0), 2)}
                  </td>
                </>)}
                <td className="p-2 text-center align-middle">
                  <div className="flex flex-col items-center justify-center">
                    <div className="h-8 flex items-center justify-center">
                      <button type="button" onClick={() => onRemoveItem(item.id)} className="tap-area relative w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--color-error-bg)] hover:text-[var(--color-error)] transition-colors cursor-pointer" aria-label={`Remove ${item.name}`} title={`Remove ${item.name}`}>
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
