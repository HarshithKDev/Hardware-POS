import React from 'react';

/** Desktop cart table */
import { useCart } from '../../contexts/CartContext';

const CartTable = React.memo(function CartTable({ activeTab, onUpdateQuantity, onUpdateDimensions, onCustomPriceChange, onCustomPriceBlur, onCustomPriceChangeGroup, onCustomPriceBlurGroup, onRemoveItem }) {
  const { cart } = useCart();
  const [expandedGroups, setExpandedGroups] = React.useState({});

  const toggleGroup = (barcode) => {
    setExpandedGroups(prev => ({ ...prev, [barcode]: !prev[barcode] }));
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
    <table className="hw-table text-center whitespace-nowrap" role="table">
      <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)' }}>
        <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <th className="p-3 w-2/5 text-center" >Item Name</th>
          <th className={`p-3 text-center w-72 ${activeTab === 'checkout' || activeTab === 'receive' ? '' : ''}`} style={activeTab === 'checkout' || activeTab === 'receive' ? {  } : {}}>Quantity</th>
          {activeTab === 'checkout' && (
            <>
              <th className="p-3 text-center w-36" >Price (₹)</th>
              <th className="p-3 text-center w-28" >Disc (%)</th>
              <th className="p-3 text-center w-32" >Total</th>
            </>
          )}
          {activeTab === 'receive' && (
            <>
              <th className="p-3 text-center w-32" >Cost (₹)</th>
              <th className="p-3 text-center w-32" >Sell (₹)</th>
            </>
          )}
          <th className="p-3 w-12"></th>
        </tr>
      </thead>
      <tbody >
        {(() => {
          const groupedCart = [];
          const groupMap = new Map();

          cart.forEach(item => {
            if (activeTab === 'checkout' && item.is_cuttable) {
              if (!groupMap.has(item.barcode)) {
                const group = {
                  isGroup: true,
                  id: `group-${item.barcode}`,
                  barcode: item.barcode,
                  name: item.name,
                  unit: item.unit,
                  price: item.price,
                  msp: item.msp,
                  customPriceInput: item.customPriceInput !== undefined ? item.customPriceInput : item.price,
                  discountPct: item.discountPct || 0,
                  totalQty: 0,
                  totalPrice: 0,
                  children: []
                };
                groupedCart.push(group);
                groupMap.set(item.barcode, group);
              }
              const group = groupMap.get(item.barcode);
              group.children.push(item);
              const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
              const billableQty = item.billableQuantity !== undefined && item.billableQuantity !== '' ? Number(item.billableQuantity) : safeQty;
              group.totalQty += safeQty;
              group.totalBillableQty = (group.totalBillableQty || 0) + billableQty;
              const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
              group.totalPrice += sellPrice * billableQty;
              group.customPriceInput = item.customPriceInput !== undefined ? item.customPriceInput : item.price;
              group.discountPct = item.discountPct;
            } else {
              groupedCart.push(item);
            }
          });

          return groupedCart.map(item => {
            if (item.isGroup) {
              const isExpanded = expandedGroups[item.barcode];
              const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
              return (
                <React.Fragment key={item.id}>
                  {/* Parent Row */}
                  <tr className="animate-fade-in cursor-pointer bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => toggleGroup(item.barcode)} style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border-light)' }}>
                    <td className="p-3 text-left" >
                      <div className="flex items-center gap-3">
                        <span className="text-xl font-bold" style={{ color: 'var(--text-secondary)' }}>{isExpanded ? '▼' : '▶'}</span>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name} <span className="text-xs bg-[var(--color-accent-bg)] px-2 py-0.5 rounded-full" style={{ color: 'var(--color-accent)' }}>{item.children.length} Pieces</span></p>
                          <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-tertiary)' }}>#{item.barcode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 text-center" >
                      <div className="inline-flex items-center justify-center gap-1.5 bg-[var(--bg-tertiary)] px-3 py-1.5 rounded-md border border-[var(--border-medium)]">
                        <span className="font-bold text-lg leading-none" style={{ color: 'var(--text-primary)' }}>{Number(item.totalQty).toFixed(2)}</span>
                        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{item.unit}</span>
                      </div>
                    </td>
                    <td className="p-2"  onClick={e => e.stopPropagation()}>
                      <input type="number" step="0.01" value={item.customPriceInput !== undefined ? item.customPriceInput : Number(item.price || 0).toFixed(2)} onChange={(e) => onCustomPriceChangeGroup(item.barcode, e.target.value)} onBlur={() => onCustomPriceBlurGroup(item.barcode)} placeholder="0.00" className="w-full h-8 px-2 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-light)' }} aria-label={`${item.name} price`} />
                    </td>
                    <td className="p-2" style={{ backgroundColor: 'var(--bg-quaternary)' }}>
                      <input type="number" value={item.discountPct ? Number(item.discountPct).toFixed(1) : '0.0'} disabled className="w-full h-8 px-2 text-sm font-semibold text-center bg-transparent outline-none cursor-not-allowed" style={{ color: 'var(--text-tertiary)', border: 'none' }} aria-label={`${item.name} discount`} />
                    </td>
                    <td className="p-3 text-center text-sm font-bold" style={{ color: 'var(--text-primary)' }}>₹{item.totalPrice.toFixed(2)}</td>
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
                    return (
                      <tr key={child.id} className="animate-fade-in bg-[var(--bg-primary)]" style={{ borderBottom: isLast ? '1px solid var(--border-light)' : '1px dashed var(--border-medium)' }}>
                        <td className="p-3 pl-12 text-left relative" >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[var(--border-medium)]" style={{ color: 'var(--text-tertiary)' }}>↳</span>
                            <span className="text-xs font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>Piece #{child.instance_barcode ? (child.instance_barcode.includes('-') ? child.instance_barcode.split('-')[1] : child.instance_barcode.slice(-6)) : 'Unknown'}</span>
                          </div>
                        </td>
                        <td className="p-2 text-center" >
                          {child.unit === 'SQFT' ? (
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>{child.pieceLength || child.length} ft</span>
                                <span className="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>×</span>
                                <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>{child.width} ft</span>
                                <span className="text-[10px] font-bold ml-2 text-[var(--color-accent)]">{safeQty} sqft</span>
                              </div>
                          ) : (
                              <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1 rounded-sm border border-[var(--border-medium)] text-[var(--text-primary)]">{safeQty} {child.unit}</span>
                          )}
                        </td>
                        <td className="p-2" ></td>
                        <td className="p-2" style={{ backgroundColor: 'var(--bg-quaternary)' }}></td>
                        <td className="p-2 text-center text-sm font-bold" >
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
            return (
              <tr key={item.id} className="animate-fade-in" >
                <td className="p-3 text-center" >
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                  {item.pieceLength && (
                    <p className="text-[10px] uppercase font-bold mt-1" style={{ color: 'var(--text-tertiary)' }}>Length per piece: {item.pieceLength} {item.unit}</p>
                  )}
                  <div className="flex items-center justify-center gap-3 mt-1">
                    <p className="text-xs font-mono" style={{ color: 'var(--color-accent)' }}>#{item.instance_barcode || item.barcode}</p>
                    {activeTab === 'checkout' && (
                      <div className="flex justify-center gap-2">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wider" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                          MRP: ₹{Number(item.price || 0).toFixed(2)}
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wider" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                          MSP: ₹{Number(item.msp || 0).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </td>
                <td className="p-2" style={activeTab === 'checkout' ? {  } : {}}>
                  {(item.unit === 'SQFT' && activeTab === 'checkout') || (item.is_cuttable && activeTab === 'receive') ? (
                    <div className="flex items-center justify-center gap-2">
                      {item.instance_barcode && activeTab !== 'receive' ? (
                        <div className="flex items-center gap-2 ml-4">
                            <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-2 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>
                              {item.length} ft
                            </span>
                            <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                            <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-2 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>
                              {item.width} ft
                            </span>
                            <span className="text-[10px] font-bold ml-2" style={{ color: 'var(--color-accent)' }}>{safeQty} sqft</span>
                        </div>
                      ) : (
                        <>
                          <div className="relative inline-flex items-center">
                            <input type="number" step="any" placeholder="L" disabled={activeTab === 'receive' && item.has_preset_length} value={activeTab === 'receive' ? (item.default_length || '') : (item.length !== undefined ? item.length : '')} onChange={(e) => activeTab === 'receive' ? onUpdateDimensions(item.id, 'default_length', e.target.value) : onUpdateDimensions(item.id, 'length', e.target.value)} className={`w-24 h-10 pl-2 pr-12 text-sm font-semibold text-center focus:outline-none rounded-md ${activeTab === 'receive' && item.has_preset_length ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]' : ''}`} style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} title={activeTab === 'receive' && item.has_preset_length ? "Length is preset by default" : "Length"} aria-label="Length" />
                            <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>{item.unit === 'SQFT' ? 'ft' : item.unit}</span>
                          </div>
                          {item.unit === 'SQFT' && (
                            <>
                              <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                              <div className="relative inline-flex items-center">
                                <input type="number" step="any" placeholder="H" disabled={activeTab === 'receive' && item.has_preset_width} value={activeTab === 'receive' ? (item.default_width || '') : (item.width !== undefined ? item.width : '')} onChange={(e) => activeTab === 'receive' ? onUpdateDimensions(item.id, 'default_width', e.target.value) : onUpdateDimensions(item.id, 'width', e.target.value)} className={`w-24 h-10 pl-2 pr-12 text-sm font-semibold text-center focus:outline-none rounded-md ${activeTab === 'receive' && item.has_preset_width ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]' : ''}`} style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} title={activeTab === 'receive' && item.has_preset_width ? "Width is preset by default" : "Height"} aria-label="Height" />
                                <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                              </div>
                            </>
                          )}
                          <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                          {item.instance_barcode && activeTab === 'receive' ? (
                            <div className="w-14 h-10 px-2 text-sm font-bold flex items-center justify-center bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-medium)] rounded" title="Quantity is locked to 1 for specific piece">1</div>
                          ) : (
                            <input type="number" step="any" min="1" placeholder="Qty" value={activeTab === 'receive' ? item.quantity : (item.rolls !== undefined ? item.rolls : '1')} onChange={(e) => activeTab === 'receive' ? onUpdateQuantity(item.id, e.target.value) : onUpdateDimensions(item.id, 'rolls', e.target.value)} className="w-14 h-10 px-2 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} title={activeTab === 'receive' ? 'Pcs / Rolls' : 'Qty'} aria-label="Quantity" />
                          )}
                        </>
                      )}
                      {activeTab === 'checkout' && (
                        <div className="flex flex-col ml-3 text-left">
                          <span className="font-bold text-xl leading-none" style={{ color: 'var(--color-accent)' }}>{safeQty}</span>
                          <span className="text-[10px] font-bold uppercase mt-1" style={{ color: 'var(--text-secondary)' }}>{item.unit}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center">
                      <div className="flex" style={{ border: '1px solid var(--border-medium)', borderRadius: '2px' }}>
                        {item.instance_barcode ? (
                          <div className="w-30 h-8 px-4 flex items-center justify-center text-sm font-semibold text-center bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">{safeQty} </div>
                        ) : (
                          <>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-8 h-8 font-bold focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }} aria-label={`Decrease ${item.name} quantity`}>-</button>
                            <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-14 h-8 px-1 text-sm font-semibold text-center focus:outline-none rounded-md" aria-label={`${item.name} quantity`} />
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="w-8 h-8 font-bold focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', borderLeft: '1px solid var(--border-medium)' }} aria-label={`Increase ${item.name} quantity`}>+</button>
                          </>
                        )}
                        <div className="h-8 px-2 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderLeft: '1px solid var(--border-medium)' }}>{(item.unit === 'SQFT' || item.is_cuttable) && activeTab !== 'checkout' ? 'PIECES' : item.unit}</div>
                      </div>
                    </div>
                  )}
                </td>
                {activeTab === 'checkout' && (<>
                  <td className="p-2" >
                    <input type="number" step="0.01" value={item.customPriceInput !== undefined ? item.customPriceInput : Number(item.price || 0).toFixed(2)} onChange={(e) => onCustomPriceChange(item.id, e.target.value)} onBlur={() => onCustomPriceBlur(item.id)} placeholder="0.00" className="w-full h-8 px-2 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-light)' }} aria-label={`${item.name} price`} />
                  </td>
                  <td className="p-2" style={{ backgroundColor: 'var(--bg-quaternary)' }}>
                    <input type="number" value={item.discountPct ? Number(item.discountPct).toFixed(1) : '0.0'} disabled className="w-full h-8 px-2 text-sm font-semibold text-center bg-transparent outline-none cursor-not-allowed" style={{ color: 'var(--text-tertiary)', border: 'none' }} aria-label={`${item.name} discount`} />
                  </td>
                  <td className="p-3 text-center text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    ₹{(sellPrice * billableQty).toFixed(2)}
                    {safeQty !== billableQty && (
                      <div className="text-[10px] text-[var(--text-tertiary)] font-normal mt-1">Billed: {billableQty} {item.unit}</div>
                    )}
                  </td>
                </>)}
                {activeTab === 'receive' && (<>
                  <td className="p-2" >
                    <input type="number" step="0.01" value={item.purchase_cost !== undefined ? item.purchase_cost : Number(item.price || 0).toFixed(2)} onChange={(e) => onUpdateDimensions(item.id, 'purchase_cost', e.target.value)} placeholder="0.00" className="w-full h-8 px-2 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-light)' }} aria-label={`${item.name} purchase cost`} />
                  </td>
                  <td className="p-2" >
                    <input type="number" step="0.01" value={item.selling_price !== undefined ? item.selling_price : Number(item.price || 0).toFixed(2)} onChange={(e) => onUpdateDimensions(item.id, 'selling_price', e.target.value)} placeholder="0.00" className="w-full h-8 px-2 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-light)' }} aria-label={`${item.name} selling price`} />
                  </td>
                </>)}
                <td className="p-2 text-center align-middle">
                  <button type="button" onClick={() => onRemoveItem(item.id)} className=" text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-[var(--color-error)]" aria-label={`Remove ${item.name}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </td>
              </tr>
            );
          });
        })()}
      </tbody>
    </table>
  );
});

export default CartTable;
