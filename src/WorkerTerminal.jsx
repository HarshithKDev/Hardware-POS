import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';
import ReceiptTemplate from './ReceiptTemplate';
import { PrintPreviewModal } from './AppModals';
import { getInventoryItemByBarcode, queueOfflineTransaction } from './services/db';
import { useApp } from './AppContext';
import { generateId, formatDateTime } from './utils';
import { SCAN_TIMEOUT_MS } from './constants';

// ---------------------------------------------------------------
// Extracted sub-components (Phase 5 decomposition)
// ---------------------------------------------------------------

/** Desktop cart table */
function CartTable({ cart, activeTab, onUpdateQuantity, onUpdateDimensions, onCustomPriceChange, onCustomPriceBlur }) {
  if (cart.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center min-h-[300px]">
        <p className="text-sm font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>Ready</p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Scan items anytime or type the barcode above</p>
      </div>
    );
  }

  return (
    <table className="w-full text-center whitespace-nowrap border-collapse" role="table">
      <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-light)' }}>
        <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <th className="p-3 w-2/5 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
          <th className={`p-3 text-center w-56 ${activeTab === 'checkout' ? '' : ''}`} style={activeTab === 'checkout' ? { borderRight: '1px solid var(--border-light)' } : {}}>Quantity</th>
          {activeTab === 'checkout' && (
            <>
              <th className="p-3 text-center w-36" style={{ borderRight: '1px solid var(--border-light)' }}>Price (₹)</th>
              <th className="p-3 text-center w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Disc (%)</th>
              <th className="p-3 text-center w-32">Total</th>
            </>
          )}
        </tr>
      </thead>
      <tbody style={{ borderBottom: '1px solid var(--border-light)' }}>
        {cart.map(item => {
          const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
          const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
          return (
            <tr key={item.id} className="animate-fade-in" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <td className="p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                <div className="flex items-center justify-center gap-3 mt-1">
                  <p className="text-xs font-mono" style={{ color: 'var(--color-accent)' }}>#{item.barcode}</p>
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
              <td className="p-2" style={activeTab === 'checkout' ? { borderRight: '1px solid var(--border-light)' } : {}}>
                {item.unit === 'SQFT' ? (
                  <div className="flex items-center justify-center gap-1">
                    <input type="number" step="any" placeholder="L" value={item.length !== undefined ? item.length : ''} onChange={(e) => onUpdateDimensions(item.id, 'length', e.target.value)} className="w-12 h-8 px-1 text-xs font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)' }} title="Length" aria-label="Length" />
                    <span className="font-bold text-xs" style={{ color: 'var(--text-tertiary)' }}>x</span>
                    <input type="number" step="any" placeholder="H" value={item.width !== undefined ? item.width : ''} onChange={(e) => onUpdateDimensions(item.id, 'width', e.target.value)} className="w-12 h-8 px-1 text-xs font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)' }} title="Height" aria-label="Height" />
                    <span className="font-bold text-xs" style={{ color: 'var(--text-tertiary)' }}>x</span>
                    <input type="number" step="any" min="1" placeholder="Rolls" value={item.rolls !== undefined ? item.rolls : '1'} onChange={(e) => onUpdateDimensions(item.id, 'rolls', e.target.value)} className="w-12 h-8 px-1 text-xs font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)' }} title="Rolls / Qty" aria-label="Rolls" />
                    <span className="font-bold text-sm ml-1 w-10 text-left" style={{ color: 'var(--color-accent)' }}>={safeQty}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center">
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-8 h-8 font-bold focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderRight: 'none' }} aria-label={`Decrease ${item.name} quantity`}>-</button>
                    <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-14 h-8 px-1 text-sm font-semibold text-center focus:outline-none focus:z-10" style={{ border: '1px solid var(--border-medium)' }} aria-label={`${item.name} quantity`} />
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="w-8 h-8 font-bold focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderLeft: 'none' }} aria-label={`Increase ${item.name} quantity`}>+</button>
                  </div>
                )}
              </td>
              {activeTab === 'checkout' && (<>
                <td className="p-2" style={{ borderRight: '1px solid var(--border-light)' }}>
                  <input type="number" step="0.01" value={item.customPriceInput !== undefined ? item.customPriceInput : Number(item.price||0).toFixed(2)} onChange={(e) => onCustomPriceChange(item.id, e.target.value)} onBlur={() => onCustomPriceBlur(item.id)} placeholder="0.00" className="w-full h-8 px-2 text-sm font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-light)' }} aria-label={`${item.name} price`} />
                </td>
                <td className="p-2" style={{ borderRight: '1px solid var(--border-light)', backgroundColor: 'var(--bg-quaternary)' }}>
                  <input type="number" value={item.discountPct ? Number(item.discountPct).toFixed(1) : '0.0'} disabled className="w-full h-8 px-2 text-sm font-semibold text-center bg-transparent outline-none cursor-not-allowed" style={{ color: 'var(--text-tertiary)', border: 'none' }} aria-label={`${item.name} discount`} />
                </td>
                <td className="p-3 text-center text-sm font-bold" style={{ color: 'var(--text-primary)' }}>₹{(sellPrice * safeQty).toFixed(2)}</td>
              </>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Mobile cart view */
function CartMobileView({ cart, activeTab, onUpdateQuantity, onUpdateDimensions }) {
  if (cart.length === 0) {
    return (
      <div className="p-10 text-center text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Cart Empty</div>
    );
  }

  return cart.map((item) => {
    const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
    const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
    return (
      <div key={item.id} className="p-4 flex flex-col gap-3 animate-fade-in" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <div className="flex justify-between items-start">
          <div className="pr-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
            <p className="text-xs mt-1 mb-1" style={{ color: 'var(--color-accent)' }}>#{item.barcode}</p>
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
          {item.unit === 'SQFT' ? (
            <div className="flex items-center gap-1 w-full justify-between">
              <div className="flex items-center gap-1">
                <input type="number" step="any" placeholder="L" value={item.length !== undefined ? item.length : ''} onChange={(e) => onUpdateDimensions(item.id, 'length', e.target.value)} className="w-10 h-8 px-1 text-xs font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)' }} aria-label="Length" />
                <span className="font-bold text-xs" style={{ color: 'var(--text-tertiary)' }}>x</span>
                <input type="number" step="any" placeholder="H" value={item.width !== undefined ? item.width : ''} onChange={(e) => onUpdateDimensions(item.id, 'width', e.target.value)} className="w-10 h-8 px-1 text-xs font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)' }} aria-label="Height" />
                <span className="font-bold text-xs" style={{ color: 'var(--text-tertiary)' }}>x</span>
                <input type="number" step="any" min="1" placeholder="Rolls" value={item.rolls !== undefined ? item.rolls : '1'} onChange={(e) => onUpdateDimensions(item.id, 'rolls', e.target.value)} className="w-10 h-8 px-1 text-xs font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)' }} aria-label="Rolls" />
              </div>
              <span className="font-bold text-sm" style={{ color: 'var(--color-accent)' }}>={safeQty} sqft</span>
            </div>
          ) : (
            <div className="flex items-center">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-10 h-8 font-bold text-lg focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderRight: 'none' }} aria-label={`Decrease ${item.name} quantity`}>-</button>
              <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-12 h-8 px-1 text-sm font-semibold text-center focus:outline-none z-10" style={{ border: '1px solid var(--border-medium)' }} aria-label={`${item.name} quantity`} />
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="w-10 h-8 font-bold text-lg focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderLeft: 'none' }} aria-label={`Increase ${item.name} quantity`}>+</button>
            </div>
          )}
        </div>
      </div>
    );
  });
}

// ---------------------------------------------------------------
// Main WorkerTerminal component (orchestrator)
// ---------------------------------------------------------------
export default function WorkerTerminal({ activeTab, shopSettings, cashierName }) {
  const { showAlert, showConfirm, alertConfig, confirmConfig } = useApp();

  const [cart, setCart] = useState(() => {
    try { const saved = localStorage.getItem(`pos_cart_${activeTab}`); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  const [manualBarcode, setManualBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [checkoutModal, setCheckoutModal] = useState({ isOpen: false, cashGiven: '' });
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);

  const barcodeBuffer = useRef('');
  const lastKeyTime = useRef(Date.now());
  const cartRef = useRef(cart);
  // Refs for values used inside the keydown closure (fixes stale closure #18)
  const activeTabRef = useRef(activeTab);
  const showAlertRef = useRef(showAlert);

  useEffect(() => { cartRef.current = cart; localStorage.setItem(`pos_cart_${activeTab}`, JSON.stringify(cart)); }, [cart, activeTab]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { showAlertRef.current = showAlert; }, [showAlert]);

  const processScan = useCallback(async (scannedCode) => {
    const cleanBarcode = scannedCode.trim();
    if (!cleanBarcode) return;
    let item = cartRef.current.find(i => i.barcode === cleanBarcode);
    if (!item) {
      item = await getInventoryItemByBarcode(cleanBarcode);
      if (!item) return showAlertRef.current(`Barcode ${cleanBarcode} not found in the system.`, "Error");
    }
    if (item) {
      const currentTab = activeTabRef.current;
      if (currentTab === 'checkout') {
        const currentCartItem = cartRef.current.find(c => c.barcode === cleanBarcode);
        const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
        if (Number(item.stock_store || 0) <= 0) return showAlertRef.current(`${item.name} is out of stock in the store.`, "Out of Stock");
        if (currentQty >= Number(item.stock_store || 0)) return showAlertRef.current(`You only have ${item.stock_store} of ${item.name} in the store.`, "Stock Limit");
      }
      setCart(prev => {
        const idx = prev.findIndex(c => c.barcode === cleanBarcode);
        if (idx >= 0) { const up = [...prev]; up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1 }; return up; }
        return [...prev, { ...item, id: generateId(), customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: item.unit === 'SQFT' ? 0 : 1, unit: item.unit || 'PCS', length: '', width: '', rolls: '1' }];
      });
    }
  }, []);

  useEffect(() => {
    const isModalOpen = alertConfig.isOpen || confirmConfig.isOpen || checkoutModal.isOpen || printPreviewOpen;
    const handleGlobalKeyDown = (e) => {
      if (isModalOpen) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const currentTime = Date.now();
      if (currentTime - lastKeyTime.current > SCAN_TIMEOUT_MS) barcodeBuffer.current = '';
      lastKeyTime.current = currentTime;
      if (e.key === 'Enter') {
        if (barcodeBuffer.current.length > 0) { e.preventDefault(); processScan(barcodeBuffer.current); barcodeBuffer.current = ''; }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        barcodeBuffer.current += e.key;
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [alertConfig.isOpen, confirmConfig.isOpen, checkoutModal.isOpen, printPreviewOpen, processScan]);

  const updateQuantity = (id, val) => {
    setCart(prev => {
      let limitMsg = '';
      const newCart = prev.map(i => {
        if (i.id === id) {
          let newQty = val === '' ? '' : Math.max(0, Number(val));
          if (activeTab === 'checkout' && val !== '') {
            const maxStock = Number(i.stock_store || 0);
            if (newQty > maxStock) { limitMsg = `You only have ${maxStock} of ${i.name} in the store.`; newQty = maxStock; }
          }
          return { ...i, quantity: newQty };
        }
        return i;
      }).filter(i => i.quantity !== 0);
      if (limitMsg) setTimeout(() => showAlert(limitMsg, "Stock Limit"), 0);
      return newCart;
    });
  };

  const updateDimensions = (id, field, val) => {
    setCart(prev => {
      let limitMsg = '';
      const newCart = prev.map(i => {
        if (i.id === id) {
          const updated = { ...i, [field]: val };
          const l = Number(updated.length) || 0;
          const w = Number(updated.width) || 0;
          const r = updated.rolls === '' ? 1 : (Number(updated.rolls) || 1);
          let newQty = parseFloat((l * w * r).toFixed(2));
          if (activeTab === 'checkout' && newQty > 0) {
            const maxStock = Number(i.stock_store || 0);
            if (newQty > maxStock) { limitMsg = `You only have ${maxStock} of ${i.name} in the store.`; newQty = maxStock; }
          }
          return { ...updated, quantity: newQty };
        }
        return i;
      });
      if (limitMsg) setTimeout(() => showAlert(limitMsg, "Stock Limit"), 0);
      return newCart;
    });
  };

  const handleCustomPriceChange = (id, val) => setCart(prev => prev.map(i => i.id === id ? { ...i, customPriceInput: val } : i));

  const applyCustomPriceBlur = (id) => setCart(prev => prev.map(i => {
    if (i.id === id) {
      let val = Number(i.customPriceInput); if (isNaN(val)) val = Number(i.price || 0);
      const msp = Number(i.msp || 0); const mrp = Number(i.price || 0);
      if (val < msp) val = msp; if (val > mrp) val = mrp;
      const disc = mrp > 0 ? ((mrp - val) / mrp) * 100 : 0;
      return { ...i, customPriceInput: val.toFixed(2), discountPct: disc };
    }
    return i;
  }));

  const calculateTotal = () => cart.reduce((tot, i) => tot + Math.round((i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0)) * 100) * (i.quantity === '' ? 0 : Number(i.quantity)), 0) / 100;
  const calculateTotalUnits = () => cart.reduce((tot, i) => tot + (i.quantity === '' ? 0 : Number(i.quantity)), 0);

  const handleCompleteTransaction = async () => {
    const finalCart = cart.filter(i => Number(i.quantity) > 0);
    if (finalCart.length === 0) return;
    setIsCheckingOut(true);
    try {
      if (activeTab === 'checkout' && navigator.onLine) {
        try {
          const barcodes = finalCart.map(item => item.barcode);
          const { data: liveStock, error: stockError } = await supabase.from('inventory').select('barcode, name, stock_store').in('barcode', barcodes);
          if (!stockError && liveStock) {
            for (const cartItem of finalCart) {
              const liveItem = liveStock.find(i => i.barcode === cartItem.barcode);
              if (!liveItem || Number(liveItem.stock_store) < cartItem.quantity) {
                const available = liveItem ? liveItem.stock_store : 0;
                throw new Error(`Someone just bought ${cartItem.name}! There are only ${available} left in the shop.`);
              }
            }
          }
        } catch (e) {
          if (e.message.includes('left in the shop')) throw e;
        }
      }

      const payload = {
        p_action: activeTab === 'receive' ? 'RECEIVE' : activeTab === 'transfer' ? 'TRANSFER' : 'SALE',
        p_location: activeTab === 'receive' ? 'Warehouse-Inbound' : activeTab === 'transfer' ? 'Warehouse-Transfer' : 'Store',
        p_cashier_name: cashierName || 'System',
        p_items: finalCart.map(i => ({
          barcode: i.barcode,
          name: i.name,
          quantity: Number(i.quantity),
          price: i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0),
          discountPct: 0,
          unit: i.unit,
        })),
      };

      let successData = null;
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase.rpc('process_pos_transaction', payload);
          if (error) throw error;
          successData = data;
        } catch (error) {
          if (error.message === 'Failed to fetch' || error.code === '503') {
            await queueOfflineTransaction(payload);
            successData = { bill_id: 'OFFL-' + generateId().substring(0, 5).toUpperCase() };
            setTimeout(() => showAlertRef.current("Transaction queued offline. It will sync automatically when internet returns.", "Offline Mode"), 100);
          } else {
            throw new Error(error.message);
          }
        }
      } else {
        await queueOfflineTransaction(payload);
        successData = { bill_id: 'OFFL-' + generateId().substring(0, 5).toUpperCase() };
        setTimeout(() => showAlertRef.current("Transaction queued offline. It will sync automatically when internet returns.", "Offline Mode"), 100);
      }

      setLastReceipt({
        id: successData.bill_id.split('-')[0],
        items: finalCart.map(i => {
          const finalRate = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
          return { ...i, quantity: Number(i.quantity), finalRate, mrp: Number(i.price || 0), lineTotal: finalRate * Number(i.quantity) };
        }),
        total: calculateTotal(),
        date: new Date(),
        type: activeTab,
      });
      setCart([]);
      setCheckoutModal({ isOpen: false, cashGiven: '' });

      if (activeTab === 'checkout') {
        setPrintPreviewOpen(true);
      } else {
        showAlert("Stock updated successfully.", "Success");
      }
    } catch (e) {
      showAlert(e.message, "Notice");
    } finally {
      setIsCheckingOut(false);
    }
  };

  const cartTotal = calculateTotal();
  const cartUnits = calculateTotalUnits();
  const cartTotalCents = Math.round(cartTotal * 100);
  const cashGivenCents = Math.round(Number(checkoutModal.cashGiven || 0) * 100);
  const differenceCents = Math.abs(cashGivenCents - cartTotalCents);
  const isShortfall = cashGivenCents > 0 && cashGivenCents < cartTotalCents;

  return (
    <>
      {/* Checkout Modal */}
      {checkoutModal.isOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[100] print:hidden px-4 animate-fade-in"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-title"
        >
          <div className="w-[95%] max-w-[450px] flex flex-col animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span id="checkout-title" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Checkout Payment</span>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} className="px-3 py-1.5 leading-none focus:outline-none" aria-label="Close checkout">✕</button>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-end mb-6 pb-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Total Due</span>
                <span className="text-4xl font-light" style={{ color: 'var(--color-accent)' }} aria-live="polite">₹{cartTotal.toFixed(2)}</span>
              </div>
              <div className="mb-6">
                <label htmlFor="cash-given" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Cash Given (₹)</label>
                <input id="cash-given" type="number" step="any" autoFocus value={checkoutModal.cashGiven} onChange={(e) => setCheckoutModal({ ...checkoutModal, cashGiven: e.target.value })} placeholder="0.00" className="w-full h-12 px-4 text-2xl font-mono focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              </div>
              {cashGivenCents > 0 && (
                <div className={`p-4 ${!isShortfall ? 'pos-success-box' : 'pos-error-box'}`} aria-live="polite">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>{!isShortfall ? 'Give Change' : 'Missing Amount'}</span>
                    <span className="text-2xl font-light" style={{ color: 'var(--text-primary)' }}>₹{(differenceCents / 100).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
              <button onClick={handleCompleteTransaction} disabled={isCheckingOut || isShortfall} className="h-9 px-8 text-white text-sm font-semibold focus:outline-none disabled:opacity-50 flex justify-center items-center min-w-[120px]" style={{ backgroundColor: 'var(--color-accent)' }}>
                {isCheckingOut ? <Spinner className="w-4 h-4 text-white" /> : 'Complete Sale'}
              </button>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} disabled={isCheckingOut} className="h-9 px-8 text-sm font-semibold disabled:opacity-50 focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-[500px] shadow-sm print:hidden" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
        {/* Header Block */}
        <div className={`p-4 flex flex-col md:flex-row justify-between gap-4 ${activeTab === 'receive' ? 'pos-receive-bg' : activeTab === 'transfer' ? 'pos-transfer-bg' : ''}`} style={{ borderBottom: '1px solid var(--border-medium)', ...(activeTab !== 'receive' && activeTab !== 'transfer' ? { backgroundColor: 'var(--bg-tertiary)' } : {}) }}>
          <div className="flex flex-col">
            <h2 className="text-2xl font-light" style={{ color: 'var(--text-primary)' }}>
              {activeTab === 'receive' ? 'Receive New Stock' : activeTab === 'transfer' ? 'Move Stock to Store' : 'Checkout Counter'}
            </h2>
            <form onSubmit={(e) => { e.preventDefault(); processScan(manualBarcode); setManualBarcode(''); }} className="mt-3 flex items-center">
              <label htmlFor="manual-barcode" className="sr-only">Barcode</label>
              <input id="manual-barcode" type="text" value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)} placeholder="Enter Barcode manually..." className="h-9 px-3 text-sm focus:outline-none w-full md:w-64" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              <button type="submit" className="h-9 px-4 text-sm font-semibold focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '2px solid var(--border-input)', borderLeft: 'none' }}>Add</button>
            </form>
          </div>
          <div className="text-left md:text-right flex flex-col justify-end pt-2 md:pt-0" style={{ borderTop: window.innerWidth < 768 ? `1px solid var(--border-light)` : 'none' }}>
            <span className="text-xs uppercase font-semibold tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>{activeTab === 'checkout' ? 'Total Price' : 'Total Units'}</span>
            <span className="text-4xl font-light" style={{ color: 'var(--color-accent)' }} aria-live="polite">
              {activeTab === 'checkout' ? `₹${cartTotal.toFixed(2)}` : cartUnits}
            </span>
          </div>
        </div>

        {/* Desktop View */}
        <div className="hidden md:block flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <CartTable
            cart={cart}
            activeTab={activeTab}
            onUpdateQuantity={updateQuantity}
            onUpdateDimensions={updateDimensions}
            onCustomPriceChange={handleCustomPriceChange}
            onCustomPriceBlur={applyCustomPriceBlur}
          />
        </div>

        {/* Mobile View */}
        <div className="md:hidden flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
          <CartMobileView
            cart={cart}
            activeTab={activeTab}
            onUpdateQuantity={updateQuantity}
            onUpdateDimensions={updateDimensions}
          />
        </div>

        <div className="p-4 flex flex-col md:flex-row justify-between gap-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => showConfirm("Are you sure you want to clear the items?", () => setCart([]), activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items')}
            className="w-full md:w-auto h-10 px-8 text-sm font-semibold uppercase tracking-wider focus:outline-none"
            style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
          >
            {activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items'}
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => activeTab === 'checkout' ? setCheckoutModal({ isOpen: true, cashGiven: '' }) : handleCompleteTransaction()}
            className="w-full md:w-auto h-10 px-10 text-white text-sm font-semibold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-offset-1 flex justify-center items-center"
            style={{ backgroundColor: 'var(--color-accent)', border: '1px solid transparent' }}
          >
            {isCheckingOut ? 'Saving...' : 'Complete'}
          </button>
        </div>
      </div>
      
      {/* Hidden Receipt Template for actual browser printing */}
      <ReceiptTemplate lastReceipt={lastReceipt} shopSettings={shopSettings} formatDateTime={formatDateTime} />

      {/* Custom Print Preview Modal */}
      <PrintPreviewModal
        isOpen={printPreviewOpen}
        onClose={() => setPrintPreviewOpen(false)}
        type="receipt"
        title="Receipt Preview"
      >
        <ReceiptTemplate lastReceipt={lastReceipt} shopSettings={shopSettings} formatDateTime={formatDateTime} isPreview={true} />
      </PrintPreviewModal>
    </>
  );
}