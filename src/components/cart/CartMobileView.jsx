import React from 'react';

/** Mobile cart view */
import { useCart } from '../../contexts/CartContext';

const CartMobileView = React.memo(function CartMobileView({ activeTab }) {
  const { cart } = useCart();
  const [expandedGroups, setExpandedGroups] = React.useState({});

  const toggleGroup = (barcode) => {
    setExpandedGroups(prev => ({ ...prev, [barcode]: !prev[barcode] }));
  };
  if (cart.length === 0) {
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
            {item.instance_barcode && <span className="font-mono text-sm mt-1" style={{ color: 'var(--color-accent)' }}>Piece #{item.instance_barcode.includes('-') ? item.instance_barcode.split('-')[1] : item.instance_barcode.slice(-6)}</span>}
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
      </div>
    ));
  }

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
      group.totalQty += safeQty;
      const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
      group.totalPrice += sellPrice * safeQty;
      group.customPriceInput = item.customPriceInput !== undefined ? item.customPriceInput : item.price;
      group.discountPct = item.discountPct;
    } else {
      groupedCart.push(item);
    }
  });

  return groupedCart.map((item) => {
    if (item.isGroup) {
      const isExpanded = expandedGroups[item.barcode];
      return (
         <React.Fragment key={item.id}>
             {/* Parent Card */}
             <div className="p-4 flex flex-col gap-3 animate-fade-in cursor-pointer" onClick={() => toggleGroup(item.barcode)} style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border-light)' }}>
                 <div className="flex justify-between items-start">
                     <div className="flex items-center gap-3 pr-2 flex-1">
                         <span className="text-xl font-bold" style={{ color: 'var(--text-secondary)' }}>{isExpanded ? '▼' : '▶'}</span>
                         <div>
                             <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                             <p className="text-xs mt-1 mb-1" style={{ color: 'var(--text-tertiary)' }}>#{item.barcode}</p>
                             <span className="text-xs bg-[var(--color-accent-bg)] px-2 py-0.5 rounded-full" style={{ color: 'var(--color-accent)' }}>{item.children.length} Pieces</span>
                         </div>
                     </div>
                     <div className="text-right">
                         <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>₹{item.totalPrice.toFixed(2)}</p>
                     </div>
                 </div>
                 <div className="flex justify-between items-center mt-1 pt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                     <div className="flex flex-col text-left">
                         <div className="inline-flex items-center gap-1.5 bg-[var(--bg-tertiary)] px-3 py-1.5 rounded-md border border-[var(--border-medium)]">
                             <span className="font-bold text-lg leading-none" style={{ color: 'var(--text-primary)' }}>{Number(item.totalQty).toFixed(2)}</span>
                             <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{item.unit}</span>
                         </div>
                     </div>
                     <div className="flex justify-end gap-2">
                         <button type="button" onClick={(e) => { e.stopPropagation(); item.children.forEach(c => onRemoveItem(c.id)); }} className="p-2 rounded transition-colors focus:outline-none" style={{ color: 'var(--color-error)' }} aria-label={`Remove all ${item.name}`}>
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                         </button>
                     </div>
                 </div>
             </div>
             {/* Child Cards */}
             {isExpanded && item.children.map((child, idx) => {
                 const safeQty = child.quantity === '' ? 0 : Number(child.quantity);
                 const isLast = idx === item.children.length - 1;
                 const sellPrice = child.customPriceInput !== undefined && child.customPriceInput !== '' ? Number(child.customPriceInput) : Number(child.price || 0);
                 return (
                     <div key={child.id} className="p-3 pl-8 flex flex-col gap-2 animate-fade-in bg-[var(--bg-primary)] relative" style={{ borderBottom: isLast ? '1px solid var(--border-light)' : '1px dashed var(--border-medium)' }}>
                         <div className="flex justify-between items-center pl-2">
                             <div className="flex items-center gap-2">
                                 <span className="text-sm font-bold text-[var(--border-medium)]" style={{ color: 'var(--text-tertiary)' }}>↳</span>
                                 <span className="text-xs font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>Piece #{child.instance_barcode ? (child.instance_barcode.includes('-') ? child.instance_barcode.split('-')[1] : child.instance_barcode.slice(-6)) : 'Unknown'}</span>
                             </div>
                             <button type="button" onClick={() => onRemoveItem(child.id)} className="p-1 rounded transition-colors focus:outline-none" style={{ color: 'var(--text-secondary)' }} aria-label={`Remove piece`}>✕</button>
                         </div>
                         <div className="flex justify-between items-center pl-2">
                             {child.unit === 'SQFT' ? (
                                 <div className="flex items-center gap-1">
                                     <span className="font-bold text-xs bg-[var(--bg-tertiary)] px-2 py-1 rounded-sm border border-[var(--border-medium)] text-[var(--text-primary)]">{child.pieceLength || child.length} ft</span>
                                     <span className="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>×</span>
                                     <span className="font-bold text-xs bg-[var(--bg-tertiary)] px-2 py-1 rounded-sm border border-[var(--border-medium)] text-[var(--text-primary)]">{child.width} ft</span>
                                     <span className="text-[10px] font-bold ml-1 text-[var(--color-accent)]">{safeQty} sqft</span>
                                 </div>
                             ) : (
                                 <span className="font-bold text-xs bg-[var(--bg-tertiary)] px-2 py-1 rounded-sm border border-[var(--border-medium)] text-[var(--text-primary)]">{safeQty} {child.unit}</span>
                             )}
                             <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>₹{(sellPrice * safeQty).toFixed(2)}</p>
                         </div>
                     </div>
                 );
             })}
         </React.Fragment>
      );
    }
    
    const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
    const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
    return (
      <div key={item.id} className="p-4 flex flex-col gap-3 animate-fade-in" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <div className="flex justify-between items-start">
          <div className="pr-2 flex-1">
            <div className="flex justify-between items-start w-full">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
              <button type="button" onClick={() => onRemoveItem(item.id)} className=" text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-[var(--color-error)]" aria-label={`Remove ${item.name}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
            {item.pieceLength && (
              <p className="text-[10px] uppercase font-bold mt-1" style={{ color: 'var(--text-tertiary)' }}>Length per piece: {item.pieceLength} {item.unit}</p>
            )}
            <p className="text-xs mt-1 mb-1" style={{ color: 'var(--color-accent)' }}>#{item.instance_barcode || item.barcode}</p>
            {activeTab === 'checkout' && (
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                MRP: ₹{Number(item.price || 0).toFixed(2)} • MSP: ₹{Number(item.msp || 0).toFixed(2)}
              </p>
            )}
          </div>
          {activeTab === 'checkout' && (
            <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>₹{(sellPrice * safeQty).toFixed(2)}</p>
          )}
        </div>
        <div className="flex justify-between items-center mt-1 pt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
          {item.unit === 'SQFT' && activeTab === 'checkout' ? (
            <div className="flex items-center gap-2 w-full justify-between mt-1">
              <div className="flex items-center gap-2">
                {item.instance_barcode ? (
                  <>
                    <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1.5 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>{item.length} ft</span>
                    <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                    <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-1.5 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>{item.width} ft</span>
                  </>
                ) : (
                  <>
                    <div className="relative inline-flex items-center">
                      <input type="number" step="any" placeholder="L" value={item.length !== undefined ? item.length : ''} onChange={(e) => onUpdateDimensions(item.id, 'length', e.target.value)} className="w-20 h-10 pl-2 pr-8 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} aria-label="Length" />
                      <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                    </div>
                    <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                    <div className="relative inline-flex items-center">
                      <input type="number" step="any" placeholder="H" value={item.width !== undefined ? item.width : ''} onChange={(e) => onUpdateDimensions(item.id, 'width', e.target.value)} className="w-20 h-10 pl-2 pr-8 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} aria-label="Height" />
                      <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                    </div>
                    <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                    <input type="number" step="any" min="1" placeholder="Qty" value={item.rolls !== undefined ? item.rolls : '1'} onChange={(e) => onUpdateDimensions(item.id, 'rolls', e.target.value)} className="w-14 h-10 px-2 text-sm font-semibold text-center focus:outline-none rounded-md" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} aria-label="Rolls" />
                  </>
                )}
              </div>
              <div className="flex flex-col items-end justify-center">
                <div className="inline-flex items-center gap-1.5 bg-[var(--bg-tertiary)] px-3 py-1.5 rounded-md border border-[var(--border-medium)]">
                  <span className="font-bold text-lg leading-none" style={{ color: 'var(--text-primary)' }}>{safeQty}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{item.unit}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center">
              <div className="flex" style={{ border: '1px solid var(--border-medium)', borderRadius: '2px' }}>
                {item.instance_barcode ? (
                  <div className="w-30 h-8 px-4 flex items-center justify-center text-sm font-semibold text-center bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">1</div>
                ) : (
                  <>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-10 h-8 font-bold text-lg focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }} aria-label={`Decrease ${item.name} quantity`}>-</button>
                    <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-12 h-8 px-1 text-sm font-semibold text-center focus:outline-none rounded-md" aria-label={`${item.name} quantity`} />
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="w-10 h-8 font-bold text-lg focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', borderLeft: '1px solid var(--border-medium)' }} aria-label={`Increase ${item.name} quantity`}>+</button>
                  </>
                )}
                <div className="h-8 px-3 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderLeft: '1px solid var(--border-medium)' }}>{item.unit === 'SQFT' && activeTab !== 'checkout' ? 'ROLLS' : item.unit}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  });
});

export default CartMobileView;
