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
  onCustomPriceChange, 
  onCustomTotalChange, 
  onCustomPriceBlur, 
  onCustomPriceChangeGroup, 
  onCustomTotalChangeGroup, 
  onCustomPriceBlurGroup, 
  onRemoveItem 
}) {
  const { cart } = useCart();
  const { userRole } = useApp();
  const [expandedGroups, setExpandedGroups] = React.useState({});

  const toggleGroup = (groupKey) => {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };
  if (cart.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center min-h-[300px]">
        <p className="text-sm font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>Ready</p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Scan items anytime or type the barcode above</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 overflow-x-auto">
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
        {(() => {
          const groupedCart = [];
          const groupMap = new Map();

          cart.forEach(item => {
            if (activeTab === 'checkout' && item.is_cuttable) {
              const groupKey = `${item.barcode}_${item.batch_id || 'default'}`;
              if (!groupMap.has(groupKey)) {
                const group = {
                  isGroup: true,
                  id: `group-${groupKey}`,
                  groupKey: groupKey,
                  barcode: item.barcode,
                  batch_id: item.batch_id,
                  name: item.batch_number ? `${item.name} - Batch ${String(item.batch_number).padStart(2, '0')}` : item.name,
                  unit: item.unit,
                  price: item.price,
                  msp: item.msp,
                  msp_price: item.msp_price,
                  customPriceInput: item.customPriceInput !== undefined ? item.customPriceInput : item.price,
                  discountPct: item.discountPct || 0,
                  totalQty: 0,
                  totalPrice: 0,
                  children: []
                };
                groupedCart.push(group);
                groupMap.set(groupKey, group);
              }
              const group = groupMap.get(groupKey);
              group.children.push(item);
              const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
              const billableQty = item.billableQuantity !== undefined && item.billableQuantity !== '' ? Number(item.billableQuantity) : safeQty;
              group.totalQty += safeQty;
              group.totalBillableQty = (group.totalBillableQty || 0) + billableQty;
              const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
              group.totalPrice += sellPrice * billableQty;
              group.customPriceInput = item.customPriceInput !== undefined ? item.customPriceInput : item.price;
              group.customTotalInput = item.customTotalInput;
              group.discountPct = item.discountPct;
            } else {
              groupedCart.push(item);
            }
          });

          return groupedCart.map(item => {
            if (item.isGroup) {
              const isExpanded = expandedGroups[item.groupKey];
              const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
              return (
                <React.Fragment key={item.id}>
                  {/* Parent Row */}
                  <tr className="animate-fade-in cursor-pointer bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => toggleGroup(item.groupKey)} style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border-light)' }}>
                    <td className="py-4 px-3 text-center" >
                      <div className="flex items-center justify-center gap-2">
                        <span className={`text-[var(--text-secondary)] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </span>
                        <p className="text-sm  font-bold" style={{ color: 'var(--color-accent)' }}>{item.barcode}</p>
                      </div>
                    </td>
                    <td className="py-4 px-3 text-center" >
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name} <span className="text-xs bg-[var(--color-accent-bg)] px-2 py-0.5 rounded-full" style={{ color: 'var(--color-accent)' }}>{item.children.length} Pieces</span></p>
                      {activeTab === 'checkout' && (
                        <div className="flex justify-center gap-2 mt-1.5">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wider rounded-sm" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                            MRP: ₹{Number(item.price || 0).toFixed(2)}
                          </span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wider rounded-sm group/msp cursor-help" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                            MSP: {userRole === 'owner' ? `₹${Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0).toFixed(2)}` : <span className="transition-all duration-300"><span className="group-hover/msp:hidden">***</span><span className="hidden group-hover/msp:inline">₹{Number(item.msp_price !== undefined ? item.msp_price : item.msp || 0).toFixed(2)}</span></span>}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-center" >
                      <div className="inline-flex items-baseline justify-center gap-1">
                        <span className="font-bold text-[15px]" style={{ color: 'var(--text-primary)' }}>{Number(item.totalQty).toFixed(2)}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{item.unit}</span>
                      </div>
                    </td>
                    <td className="p-2" onClick={e => e.stopPropagation()}>
                      <div className="relative inline-flex items-center w-full max-w-[120px] mx-auto">
                        <span className="absolute left-3 text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>₹</span>
                        <input type="number" step="0.01" value={item.customPriceInput !== undefined ? (typeof item.customPriceInput === 'number' ? item.customPriceInput.toFixed(2) : item.customPriceInput) : Number(item.price || 0).toFixed(2)} onChange={(e) => onCustomPriceChangeGroup(item.groupKey, e.target.value)} onBlur={() => onCustomPriceBlurGroup(item.groupKey)} placeholder="0.00" className="w-full h-8 pl-6 pr-2 text-sm font-bold text-center focus:outline-none rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors focus:ring-1 focus:ring-[var(--color-accent)]" style={{ border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }} aria-label={`${item.name} MRP`} />
                      </div>
                    </td>
                    <td className="p-2"  onClick={e => e.stopPropagation()}>
                      <div className="relative inline-flex items-center w-full max-w-[120px] mx-auto">
                        <span className="absolute left-3 text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>₹</span>
                        <input type="number" step="0.01" value={item.customTotalInput !== undefined ? item.customTotalInput : item.totalPrice.toFixed(2)} onChange={(e) => onCustomTotalChangeGroup(item.groupKey, e.target.value, item.totalBillableQty)} onBlur={() => onCustomPriceBlurGroup(item.groupKey)} placeholder="0.00" className="w-full h-8 pl-6 pr-2 text-sm font-bold text-center focus:outline-none rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors focus:ring-1 focus:ring-[var(--color-accent)]" style={{ border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }} aria-label={`${item.name} total`} />
                      </div>
                    </td>
                    <td className="p-2 text-center align-middle" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => item.children.forEach(c => onRemoveItem(c.id))} className="w-8 h-8 mx-auto rounded flex items-center justify-center transition-colors focus:outline-none" style={{ color: 'var(--text-secondary)' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-error)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }} aria-label={`Remove all ${item.name}`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  </tr>
                  {/* Child Rows */}
                  {isExpanded && item.children.map((child, idx) => {
                    const safeQty = child.quantity === '' ? 0 : Number(child.quantity);
                    const billableQty = child.billableQuantity !== undefined && child.billableQuantity !== '' ? Number(child.billableQuantity) : safeQty;
                    const isLast = idx === item.children.length - 1;
                    const isChildSelected = cart[selectedCartIndex]?.id === child.id;
                    return (
                      <tr 
                        key={child.id} 
                        onClick={() => {
                          const cIdx = cart.findIndex(c => c.id === child.id);
                          if (cIdx >= 0 && onSelectCartIndex) onSelectCartIndex(cIdx);
                        }}
                        className={`animate-fade-in cursor-pointer transition-colors ${isChildSelected ? 'bg-[var(--bg-hover)]' : 'bg-[var(--bg-primary)]'}`} 
                        style={{ 
                          borderBottom: isLast ? '1px solid var(--border-medium)' : '1px dashed var(--border-medium)',
                          boxShadow: isChildSelected ? 'inset 4px 0 0 var(--color-accent)' : undefined
                        }}
                      >
                        <td className="py-4 px-3 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          <div className="flex items-center justify-center gap-2">
                            <svg className="w-4 h-4" style={{ color: 'var(--border-heavy)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5v8a2 2 0 002 2h7M14 11l4 4-4 4" />
                            </svg>
                            <span className="text-xs  font-bold" style={{ color: 'var(--text-tertiary)' }}>{child.instance_barcode || 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="py-4 px-3 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                           <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>Cut Piece</span>
                        </td>
                        <td className="p-2 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          {child.unit === 'SQFT' ? (
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>{child.pieceLength || child.length} ft</span>
                                <span className="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>×</span>
                                <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>{child.width} ft</span>
                                <span className="text-[10px] font-bold ml-2 text-[var(--color-accent)]">{safeQty} sqft</span>
                              </div>
                          ) : (
                              <div className="inline-flex items-baseline justify-center gap-1">
                                <span className="font-bold text-[15px]" style={{ color: 'var(--text-primary)' }}>{safeQty}</span>
                                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{child.unit}</span>
                              </div>
                          )}
                        </td>
                        <td className="p-2" style={{ borderRight: '1px solid var(--border-medium)' }}></td>
                        <td className="p-2 text-center text-sm font-bold" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          ₹{(sellPrice * billableQty).toFixed(2)}
                          {safeQty !== billableQty && (
                             <div className="text-[10px] text-[var(--text-tertiary)] font-normal">Billed for {billableQty} sqft</div>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <button type="button" onClick={() => onRemoveItem(child.id)} className="w-6 h-6 mx-auto rounded flex items-center justify-center transition-colors focus:outline-none" style={{ color: 'var(--text-secondary)' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'} aria-label={`Remove piece`}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            }
            
            const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
            const billableQty = item.billableQuantity !== undefined && item.billableQuantity !== '' ? Number(item.billableQuantity) : safeQty;
            const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
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
                  borderBottom: '1px solid var(--border-medium)',
                  boxShadow: isRowSelected ? 'inset 4px 0 0 var(--color-accent)' : undefined
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
                  {activeTab === 'checkout' && (
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
                  {(item.unit === 'SQFT' && item.is_cuttable && activeTab === 'checkout') || (item.is_cuttable && activeTab === 'receive') ? (
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-8 flex items-center justify-center gap-2">
                        {item.instance_barcode && activeTab !== 'receive' ? (
                          <div className="flex items-center gap-2">
                              <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1.5 rounded-md border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>
                                {item.length} ft
                              </span>
                              <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                              <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1.5 rounded-md border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>
                                {item.width} ft
                              </span>
                              <span className="text-[10px] font-bold ml-2" style={{ color: 'var(--color-accent)' }}>{safeQty} sqft</span>
                          </div>
                        ) : (
                          <>
                            <div className="relative inline-flex items-center">
                              <input type="number" step="any" placeholder="L" disabled={activeTab === 'receive'} value={activeTab === 'receive' ? (item.pieceLength || item.default_length || '') : (item.length !== undefined ? item.length : '')} onChange={(e) => activeTab === 'receive' ? onUpdateDimensions(item.id, 'default_length', e.target.value) : onUpdateDimensions(item.id, 'length', e.target.value)} className={`w-24 h-8 pl-2 pr-10 text-sm font-semibold text-center focus:outline-none rounded-md ${activeTab === 'receive' ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]' : ''}`} style={{ border: '1px solid var(--border-medium)' }} title={activeTab === 'receive' ? "Length is locked during receive" : "Length"} aria-label="Length" />
                              <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>{item.unit === 'SQFT' ? 'ft' : (item.unit?.toUpperCase() === 'METER' ? 'M' : item.unit)}</span>
                            </div>
                            {item.unit === 'SQFT' && (
                              <>
                                <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                                <div className="relative inline-flex items-center">
                                  <input type="number" step="any" placeholder="H" disabled={activeTab === 'receive'} value={activeTab === 'receive' ? (item.default_width || '') : (item.width !== undefined ? item.width : '')} onChange={(e) => activeTab === 'receive' ? onUpdateDimensions(item.id, 'default_width', e.target.value) : onUpdateDimensions(item.id, 'width', e.target.value)} className={`w-24 h-8 pl-2 pr-10 text-sm font-semibold text-center focus:outline-none rounded-md ${activeTab === 'receive' ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]' : ''}`} style={{ border: '1px solid var(--border-medium)' }} title={activeTab === 'receive' ? "Width is locked during receive" : "Height"} aria-label="Height" />
                                  <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                                </div>
                              </>
                            )}
                            <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                            {item.instance_barcode && activeTab === 'receive' ? (
                              <div className="w-14 h-8 px-2 text-sm font-bold flex items-center justify-center bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-medium)] rounded-md" title="Quantity is locked to 1 for specific piece">1</div>
                            ) : activeTab === 'receive' ? (
                              <input type="number" step="any" min="1" placeholder="Qty" disabled value={item.quantity} className="w-14 h-8 px-2 text-sm font-semibold text-center focus:outline-none rounded-md opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]" style={{ border: '1px solid var(--border-medium)' }} title="Scan to increase quantity" aria-label="Quantity" />
                            ) : (
                              <input type="number" step="any" min="1" placeholder="Qty" value={item.rolls !== undefined ? item.rolls : '1'} onChange={(e) => onUpdateDimensions(item.id, 'rolls', e.target.value)} className="w-14 h-8 px-2 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-medium)' }} title="Qty" aria-label="Quantity" />
                            )}
                          </>
                        )}
                        {activeTab === 'checkout' && (
                          <div className="flex flex-col ml-3 text-left">
                            <span className="font-bold text-base leading-none" style={{ color: 'var(--color-accent)' }}>{safeQty}</span>
                            <span className="text-[10px] font-bold uppercase mt-0.5" style={{ color: 'var(--text-secondary)' }}>{item.unit}</span>
                          </div>
                        )}
                      </div>
                      {hasSubtext && <div className="h-4 mt-1" />}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-8 flex items-center justify-center gap-1.5">
                        {item.instance_barcode ? (
                          <div className="relative inline-flex items-center">
                            <div className="w-20 h-8 pr-7 flex items-center justify-center text-sm font-bold bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md text-[var(--text-primary)] shadow-sm">
                              {safeQty}
                            </div>
                            <span className="absolute right-2 text-[10px] font-bold pointer-events-none text-[var(--text-tertiary)]">
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
                                <div className="relative inline-flex items-center">
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
                                    className="w-20 h-8 pl-3 pr-7 text-sm font-bold text-center bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] transition-all shadow-sm"
                                    aria-label={`${item.name} quantity in grams`}
                                    style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.1) inset' }}
                                  />
                                  <span className="absolute right-2 text-[10px] font-bold pointer-events-none text-[var(--text-tertiary)]">
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
                        ) : (
                          <>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-8 h-8 flex items-center justify-center font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-medium)] rounded-md bg-[var(--bg-tertiary)] shadow-sm cursor-pointer" aria-label={`Decrease ${item.name} quantity`}>-</button>
                            <div className="relative inline-flex items-center">
                              <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-20 h-8 pl-3 pr-7 text-sm font-bold text-center bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] transition-all shadow-sm" aria-label={`${item.name} quantity`} style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.1) inset' }} />
                              <span className="absolute right-2 text-[10px] font-bold pointer-events-none text-[var(--text-tertiary)]">
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
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-8 flex items-center justify-center w-full">
                        <div className="relative flex items-center justify-center w-full max-w-[120px] h-8 mx-auto">
                          <span className="absolute left-3 text-[11px] font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>₹</span>
                          <input type="number" step="0.01" value={item.customPriceInput !== undefined ? (typeof item.customPriceInput === 'number' ? item.customPriceInput.toFixed(2) : item.customPriceInput) : Number(item.price || 0).toFixed(2)} onChange={(e) => onCustomPriceChange(item.id, e.target.value)} onBlur={() => onCustomPriceBlur(item.id)} placeholder="0.00" className="w-full h-8 pl-6 pr-2 text-sm font-bold text-center focus:outline-none rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors focus:ring-1 focus:ring-[var(--color-accent)]" style={{ border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }} aria-label={`${item.name} MRP`} />
                        </div>
                      </div>
                      {hasSubtext && (
                        <div className="h-4 flex items-center justify-center mt-1">
                          {isLooseKg ? (
                            <span className="text-[10px] text-[var(--text-tertiary)] font-normal leading-none">per kg</span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    <div className="flex flex-col items-center justify-center">
                      <div className="h-8 flex items-center justify-center w-full">
                        <div className="relative flex items-center justify-center w-full max-w-[120px] h-8 mx-auto">
                          <span className="absolute left-3 text-[11px] font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>₹</span>
                          <input type="number" step="0.01" value={item.customTotalInput !== undefined ? item.customTotalInput : (sellPrice * billableQty).toFixed(2)} onChange={(e) => onCustomTotalChange(item.id, e.target.value, billableQty)} onBlur={() => onCustomPriceBlur(item.id)} placeholder="0.00" className="w-full h-8 pl-6 pr-2 text-sm font-bold text-center focus:outline-none rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors focus:ring-1 focus:ring-[var(--color-accent)]" style={{ border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }} aria-label={`${item.name} total`} />
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
          });
        })()}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default CartTable;
