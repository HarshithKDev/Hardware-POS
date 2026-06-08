import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';
import ReceiptTemplate from './ReceiptTemplate';
import { PrintPreviewModal } from './AppModals';
import { useQueryClient } from '@tanstack/react-query';
import { getInventoryItemByBarcode, queueOfflineTransaction, getInventoryByQuery, saveInventoryBatch } from './services/db';
import { syncInventoryToLocal } from './services/sync';
import { useApp } from './AppContext';
import { generateId, formatDateTime } from './utils';
import { SCAN_TIMEOUT_MS } from './constants';

// ---------------------------------------------------------------
// Extracted sub-components (Phase 5 decomposition)
// ---------------------------------------------------------------

/** Desktop cart table */
function CartTable({ cart, activeTab, onUpdateQuantity, onUpdateDimensions, onCustomPriceChange, onCustomPriceBlur, onRemoveItem }) {
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
          <th className={`p-3 text-center w-72 ${activeTab === 'checkout' ? '' : ''}`} style={activeTab === 'checkout' ? { borderRight: '1px solid var(--border-light)' } : {}}>Quantity</th>
          {activeTab === 'checkout' && (
            <>
              <th className="p-3 text-center w-36" style={{ borderRight: '1px solid var(--border-light)' }}>Price (₹)</th>
              <th className="p-3 text-center w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Disc (%)</th>
              <th className="p-3 text-center w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Total</th>
            </>
          )}
          <th className="p-3 w-12"></th>
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
              <td className="p-2" style={activeTab === 'checkout' ? { borderRight: '1px solid var(--border-light)' } : {}}>
                {(item.unit === 'SQFT' && activeTab === 'checkout') || (item.is_cuttable && activeTab === 'receive') ? (
                  <div className="flex items-center justify-center gap-2">
                    {item.instance_barcode && activeTab !== 'receive' ? (
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-2 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>
                          {item.pieceLength || item.length} {item.unit === 'SQFT' ? 'ft' : item.unit}
                        </span>
                        {item.unit === 'SQFT' && (
                          <>
                            <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                            <span className="font-bold text-sm bg-[var(--bg-tertiary)] px-3 py-2 rounded-sm border border-[var(--border-medium)]" style={{ color: 'var(--text-primary)' }}>
                              {item.width} ft
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="relative inline-flex items-center">
                          <input type="number" step="any" placeholder="L" value={activeTab === 'receive' ? (item.default_length || '') : (item.length !== undefined ? item.length : '')} onChange={(e) => activeTab === 'receive' ? onUpdateDimensions(item.id, 'default_length', e.target.value) : onUpdateDimensions(item.id, 'length', e.target.value)} className="w-20 h-10 pl-2 pr-10 text-sm font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} title="Length" aria-label="Length" />
                          <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>{item.unit === 'SQFT' ? 'ft' : item.unit}</span>
                        </div>
                        {item.unit === 'SQFT' && (
                          <>
                            <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                            <div className="relative inline-flex items-center">
                              <input type="number" step="any" placeholder="H" value={activeTab === 'receive' ? (item.default_width || '') : (item.width !== undefined ? item.width : '')} onChange={(e) => activeTab === 'receive' ? onUpdateDimensions(item.id, 'default_width', e.target.value) : onUpdateDimensions(item.id, 'width', e.target.value)} className="w-20 h-10 pl-2 pr-10 text-sm font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} title="Height" aria-label="Height" />
                              <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                            </div>
                          </>
                        )}
                        <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                        {item.instance_barcode && activeTab === 'receive' ? (
                          <div className="w-14 h-10 px-2 text-sm font-bold flex items-center justify-center bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-medium)] rounded" title="Quantity is locked to 1 for specific piece">1</div>
                        ) : (
                          <input type="number" step="any" min="1" placeholder="Qty" value={activeTab === 'receive' ? item.quantity : (item.rolls !== undefined ? item.rolls : '1')} onChange={(e) => activeTab === 'receive' ? onUpdateQuantity(item.id, e.target.value) : onUpdateDimensions(item.id, 'rolls', e.target.value)} className="w-14 h-10 px-2 text-sm font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} title={activeTab === 'receive' ? 'Pcs / Rolls' : 'Qty'} aria-label="Quantity" />
                        )}
                      </>
                    )}
                    {activeTab === 'checkout' && (
                      <div className="flex flex-col ml-3 text-left">
                        <span className="font-bold text-xl leading-none" style={{ color: 'var(--color-accent)' }}>={safeQty}</span>
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
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-8 h-8 font-bold focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }} aria-label={`Decrease ${item.name} quantity`}>-</button>
                          <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-14 h-8 px-1 text-sm font-semibold text-center focus:outline-none" aria-label={`${item.name} quantity`} />
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="w-8 h-8 font-bold focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', borderLeft: '1px solid var(--border-medium)' }} aria-label={`Increase ${item.name} quantity`}>+</button>
                        </>
                      )}
                      <div className="h-8 px-2 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderLeft: '1px solid var(--border-medium)' }}>{(item.unit === 'SQFT' || item.is_cuttable) && activeTab !== 'checkout' ? 'PIECES' : item.unit}</div>
                    </div>
                  </div>
                )}
              </td>
              {activeTab === 'checkout' && (<>
                <td className="p-2" style={{ borderRight: '1px solid var(--border-light)' }}>
                  <input type="number" step="0.01" value={item.customPriceInput !== undefined ? item.customPriceInput : Number(item.price || 0).toFixed(2)} onChange={(e) => onCustomPriceChange(item.id, e.target.value)} onBlur={() => onCustomPriceBlur(item.id)} placeholder="0.00" className="w-full h-8 px-2 text-sm font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-light)' }} aria-label={`${item.name} price`} />
                </td>
                <td className="p-2" style={{ borderRight: '1px solid var(--border-light)', backgroundColor: 'var(--bg-quaternary)' }}>
                  <input type="number" value={item.discountPct ? Number(item.discountPct).toFixed(1) : '0.0'} disabled className="w-full h-8 px-2 text-sm font-semibold text-center bg-transparent outline-none cursor-not-allowed" style={{ color: 'var(--text-tertiary)', border: 'none' }} aria-label={`${item.name} discount`} />
                </td>
                <td className="p-3 text-center text-sm font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>₹{(sellPrice * safeQty).toFixed(2)}</td>
              </>)}
              <td className="p-2 text-center align-middle">
                <button type="button" onClick={() => onRemoveItem(item.id)} className="w-8 h-8 rounded flex items-center justify-center transition-colors focus:outline-none" style={{ color: 'var(--color-danger)', backgroundColor: 'transparent' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'} aria-label={`Remove ${item.name}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Mobile cart view */
function CartMobileView({ cart, activeTab, onUpdateQuantity, onUpdateDimensions, onRemoveItem }) {
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
          <div className="pr-2 flex-1">
            <div className="flex justify-between items-start w-full">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
              <button type="button" onClick={() => onRemoveItem(item.id)} className="p-1 rounded transition-colors focus:outline-none" style={{ color: 'var(--color-danger)', backgroundColor: 'transparent' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'} aria-label={`Remove ${item.name}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
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
                      <input type="number" step="any" placeholder="L" value={item.length !== undefined ? item.length : ''} onChange={(e) => onUpdateDimensions(item.id, 'length', e.target.value)} className="w-20 h-10 pl-2 pr-8 text-sm font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} aria-label="Length" />
                      <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                    </div>
                    <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                    <div className="relative inline-flex items-center">
                      <input type="number" step="any" placeholder="H" value={item.width !== undefined ? item.width : ''} onChange={(e) => onUpdateDimensions(item.id, 'width', e.target.value)} className="w-20 h-10 pl-2 pr-8 text-sm font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} aria-label="Height" />
                      <span className="absolute right-2 text-[10px] font-bold uppercase pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                    </div>
                    <span className="font-bold text-sm" style={{ color: 'var(--text-tertiary)' }}>×</span>
                    <input type="number" step="any" min="1" placeholder="Qty" value={item.rolls !== undefined ? item.rolls : '1'} onChange={(e) => onUpdateDimensions(item.id, 'rolls', e.target.value)} className="w-14 h-10 px-2 text-sm font-semibold text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', borderRadius: '4px' }} aria-label="Rolls" />
                  </>
                )}
              </div>
              <div className="flex flex-col text-right">
                <span className="font-bold text-xl leading-none" style={{ color: 'var(--color-accent)' }}>={safeQty}</span>
                <span className="text-[10px] font-bold uppercase mt-1" style={{ color: 'var(--text-secondary)' }}>{item.unit}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center">
              <div className="flex" style={{ border: '1px solid var(--border-medium)', borderRadius: '2px' }}>
                {item.instance_barcode ? (
                  <div className="w-30 h-8 px-4 flex items-center justify-center text-sm font-semibold text-center bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">1</div>
                ) : (
                  <>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty - 1)} className="w-10 h-8 font-bold text-lg focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }} aria-label={`Decrease ${item.name} quantity`}>-</button>
                    <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => onUpdateQuantity(item.id, e.target.value)} className="w-12 h-8 px-1 text-sm font-semibold text-center focus:outline-none" aria-label={`${item.name} quantity`} />
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onUpdateQuantity(item.id, safeQty + 1)} className="w-10 h-8 font-bold text-lg focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', borderLeft: '1px solid var(--border-medium)' }} aria-label={`Increase ${item.name} quantity`}>+</button>
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
}

// ---------------------------------------------------------------
// Main WorkerTerminal component (orchestrator)
// ---------------------------------------------------------------
export default function WorkerTerminal({ activeTab, shopSettings, cashierName }) {
  const { showAlert, showConfirm, alertConfig, confirmConfig } = useApp();
  const queryClient = useQueryClient();

  const [cart, setCart] = useState(() => {
    try { const saved = localStorage.getItem(`pos_cart_${activeTab}`); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  const [manualBarcode, setManualBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [checkoutModal, setCheckoutModal] = useState({ isOpen: false, cashGiven: '' });
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [looseItemModal, setLooseItemModal] = useState({ isOpen: false, item: null, qty: '' });

  // Cuttable item states
  const [selectPieceModal, setSelectPieceModal] = useState({ isOpen: false, item: null, instances: [], isLoading: false });
  const [cutLengthModal, setCutLengthModal] = useState({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false });
  const [receiveLengthModal, setReceiveLengthModal] = useState({ isOpen: false, item: null, length: '' });

  const barcodeBuffer = useRef('');
  const lastKeyTime = useRef(Date.now());
  const cartRef = useRef(cart);
  // Refs for values used inside the keydown closure (fixes stale closure #18)
  const activeTabRef = useRef(activeTab);
  const showAlertRef = useRef(showAlert);

  useEffect(() => { cartRef.current = cart; localStorage.setItem(`pos_cart_${activeTab}`, JSON.stringify(cart)); }, [cart, activeTab]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { showAlertRef.current = showAlert; }, [showAlert]);

  useEffect(() => {
    if (manualBarcode.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const fetchSuggestions = async () => {
      try {
        const searchStr = manualBarcode.trim();
        const baseSearch = searchStr.includes('-') ? searchStr.split('-')[0] : searchStr;
        const { data: parentData } = await getInventoryByQuery({
          limit: 10,
          offset: 0,
          search: baseSearch,
        });
        
        let finalSuggestions = parentData || [];
        
        // If they are explicitly searching for an instance, fetch it
        if (searchStr.includes('-')) {
          const { data: instData } = await supabase.from('stock_instances')
            .select('instance_barcode, current_length, parent_barcode')
            .ilike('instance_barcode', `%${searchStr}%`)
            .eq('is_active', true)
            .limit(5);
            
          if (instData && instData.length > 0) {
            const instanceSuggestions = instData.map(inst => {
              const parent = finalSuggestions.find(p => p.barcode === inst.parent_barcode);
              if (!parent) return null;
              return {
                ...parent,
                barcode: inst.instance_barcode,
                name: `${parent.name} (Piece #${inst.instance_barcode.split('-')[1]}) [${inst.current_length} ${parent.unit === 'SQFT' ? 'ft' : parent.unit}]`
              };
            }).filter(Boolean);
            
            // Add specific instances to the top of the list
            finalSuggestions = [...instanceSuggestions, ...finalSuggestions];
          }
        }
        
        setSuggestions(finalSuggestions);
        setShowSuggestions(true);
      } catch (error) {
        console.error("Suggestion fetch error:", error);
      }
    };
    const timer = setTimeout(fetchSuggestions, 200);
    return () => clearTimeout(timer);
  }, [manualBarcode]);

  const processScan = useCallback(async (scannedCode) => {
    const cleanBarcode = scannedCode.trim();
    if (!cleanBarcode) return;

    let scannedInstanceBarcode = null;
    let searchBarcode = cleanBarcode;

    // Check if it's an instance barcode (e.g., 1001-001)
    if (cleanBarcode.includes('-')) {
      const parts = cleanBarcode.split('-');
      if (parts.length === 2 && !isNaN(parts[1])) {
        searchBarcode = parts[0];
        scannedInstanceBarcode = cleanBarcode;
      }
    }

    let item = cartRef.current.find(i => i.barcode === searchBarcode && !i.is_cuttable);
    if (!item) {
      item = await getInventoryItemByBarcode(searchBarcode);
      if (!item) return showAlertRef.current(`Barcode ${cleanBarcode} not found in the system.`, "Error");
    }

    if (item) {
      const currentTab = activeTabRef.current;

      // Cuttable items receive logic
      if (item.is_cuttable && currentTab === 'receive') {
        if (scannedInstanceBarcode) {
          setCart(prev => {
            const idx = prev.findIndex(c => c.instance_barcode === scannedInstanceBarcode);
            if (idx >= 0) return prev;
            return [...prev, { ...item, id: generateId(), instance_barcode: scannedInstanceBarcode, customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: 1, unit: item.unit, length: '', width: '', default_length: item.default_length, default_width: item.default_width }];
          });
        } else {
          setCart(prev => [...prev, { ...item, id: generateId(), customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: 1, unit: item.unit, length: '', width: '', default_length: item.default_length, default_width: item.default_width }]);
        }
        setManualBarcode('');
        return;
      }

      // Cuttable items transfer logic
      if (item.is_cuttable && currentTab === 'transfer') {
        if (scannedInstanceBarcode) {
          // Verify instance exists and get length if transferring
          let instLength = item.default_length;
          const { data } = await supabase.from('stock_instances').select('current_length').eq('instance_barcode', scannedInstanceBarcode).single();
          if (!data) return showAlertRef.current(`Piece #${scannedInstanceBarcode} does not exist!`, "Not Found");
          if (!data.current_length || data.current_length <= 0) return showAlertRef.current(`Piece #${scannedInstanceBarcode} has no length left!`, "Empty Piece");
          instLength = data.current_length;

          // Add the scanned instance barcode directly to the cart as 1 piece
          setCart(prev => {
            const idx = prev.findIndex(c => c.instance_barcode === scannedInstanceBarcode);
            if (idx >= 0) {
              showAlertRef.current(`Piece #${scannedInstanceBarcode} is already in the cart!`, "Already Added");
              return prev; // Already scanned
            }
            return [...prev, { ...item, id: generateId(), instance_barcode: scannedInstanceBarcode, quantity: 1, unit: item.unit, length: '', width: '', default_length: item.default_length, default_width: item.default_width, pieceLength: instLength }];
          });
          setManualBarcode('');
          return;
        } else {
          showAlertRef.current(`To transfer this roll, you must scan the unique sticker you printed for it. If you don't have a scanner, type the exact sticker number (e.g., ${item.barcode}-1001) into the search bar and press Enter.`, "Scan Unique Sticker");
          return;
        }
      }

      // Cuttable items logic (only applies in Checkout/Sale mode)
      if (item.is_cuttable && currentTab === 'checkout') {
        if (scannedInstanceBarcode) {
          // They scanned a specific piece directly
          let instData = null;
          if (navigator.onLine) {
            const { data } = await supabase.from('stock_instances').select('*').eq('instance_barcode', scannedInstanceBarcode).single();
            instData = data;
          }
          setCutLengthModal({
            isOpen: true,
            item,
            instance: instData || { instance_barcode: scannedInstanceBarcode, current_length: '?' },
            cutQty: '',
            discardScrap: false
          });
        } else {
          // They searched the generic parent name
          setSelectPieceModal({ isOpen: true, item, instances: [], isLoading: true });
          if (navigator.onLine) {
            supabase.from('stock_instances').select('*').eq('parent_barcode', item.barcode).eq('is_active', true)
              .then(({ data }) => setSelectPieceModal(prev => ({ ...prev, instances: data || [], isLoading: false })))
              .catch(() => setSelectPieceModal(prev => ({ ...prev, isLoading: false })));
          } else {
            setSelectPieceModal(prev => ({ ...prev, isLoading: false }));
            showAlertRef.current("Cannot view active pieces while offline.", "Offline");
          }
        }
        return;
      }

      // Normal items stock check
      if (currentTab === 'checkout' && !item.is_cuttable) {
        const currentCartItem = cartRef.current.find(c => c.barcode === cleanBarcode);
        const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
        if (Number(item.stock_store || 0) <= 0) return showAlertRef.current(`${item.name} is out of stock in the store.`, "Out of Stock");
        if (currentQty >= Number(item.stock_store || 0)) return showAlertRef.current(`You only have ${item.stock_store} of ${item.name} in the store.`, "Stock Limit");
      }

      if (item.is_loose_item) {
        setLooseItemModal({ isOpen: true, item, qty: '' });
        return;
      }

      setCart(prev => {
        const idx = prev.findIndex(c => c.barcode === cleanBarcode);
        if (idx >= 0) { const up = [...prev]; up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1 }; return up; }
        return [...prev, { ...item, id: generateId(), customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: item.unit === 'SQFT' ? 0 : 1, unit: item.unit || 'PCS', length: '', width: '', rolls: '1' }];
      });
    }
  }, []);

  useEffect(() => {
    const isModalOpen = alertConfig.isOpen || confirmConfig.isOpen || checkoutModal.isOpen || printPreviewOpen || looseItemModal.isOpen || selectPieceModal.isOpen || cutLengthModal.isOpen || receiveLengthModal.isOpen;
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
  }, [alertConfig.isOpen, confirmConfig.isOpen, checkoutModal.isOpen, printPreviewOpen, looseItemModal.isOpen, selectPieceModal.isOpen, cutLengthModal.isOpen, receiveLengthModal.isOpen, processScan]);

  const handleLooseItemSubmit = (e) => {
    if (e) e.preventDefault();
    const { item, qty } = looseItemModal;
    const addQty = Number(qty) || 0;
    if (addQty <= 0) {
      setLooseItemModal({ isOpen: false, item: null, qty: '' });
      return;
    }

    if (activeTab === 'checkout') {
      const currentCartItem = cart.find(c => c.barcode === item.barcode);
      const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
      const proposedQty = currentQty + addQty;
      if (proposedQty > Number(item.stock_store || 0)) {
        showAlert(`You only have ${item.stock_store} of ${item.name} in the store.`, "Stock Limit");
        return;
      }
    }

    setCart(prev => {
      const idx = prev.findIndex(c => c.barcode === item.barcode);
      if (idx >= 0) {
        const up = [...prev];
        up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + addQty };
        return up;
      }
      return [...prev, {
        ...item,
        id: generateId(),
        customPriceInput: Number(item.price || 0).toFixed(2),
        discountPct: 0,
        quantity: addQty,
        unit: item.unit || 'PCS',
        length: '', width: '', rolls: '1'
      }];
    });
    setLooseItemModal({ isOpen: false, item: null, qty: '' });
  };

  const handleCutLengthSubmit = (e) => {
    if (e) e.preventDefault();
    const { item, instance, cutQty, discardScrap } = cutLengthModal;
    const addQty = Number(cutQty) || 0;

    if (addQty <= 0) {
      setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false });
      return;
    }

    const currentLength = Number(instance.current_length);
    if (!isNaN(currentLength) && addQty > currentLength) {
      showAlert(`You are trying to cut ${addQty}${item.unit}, but the piece only has ${currentLength}${item.unit} left!`, "Invalid Cut");
      return;
    }

    setCart(prev => {
      const idx = prev.findIndex(c => c.instance_barcode === instance.instance_barcode);
      if (idx >= 0) {
        const up = [...prev];
        up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + addQty, discard_scrap: discardScrap };
        return up;
      }
      return [...prev, {
        ...item,
        id: generateId(),
        instance_barcode: instance.instance_barcode,
        discard_scrap: discardScrap,
        name: `${item.name} (Cut from #${instance.instance_barcode.split('-')[1] || 'Piece'})`,
        customPriceInput: Number(item.price || 0).toFixed(2),
        discountPct: 0,
        quantity: item.unit === 'SQFT' ? parseFloat((addQty * (Number(item.default_width) || 1)).toFixed(2)) : addQty,
        unit: item.unit || 'PCS',
        length: addQty, 
        width: Number(item.default_width) || '',
        pieceLength: addQty,
        rolls: '1'
      }];
    });
    setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false });
  };

  const handleReceiveLengthSubmit = (e) => {
    if (e) e.preventDefault();
    if (!receiveLengthModal.length) return;

    const { item, length } = receiveLengthModal;
    setCart(prev => {
      const idx = prev.findIndex(c => c.barcode === item.barcode);
      if (idx >= 0) {
        const up = [...prev];
        up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1, pieceLength: length };
        return up;
      }
      return [{ ...item, quantity: 1, pieceLength: length, customPriceInput: '' }, ...prev];
    });
    setReceiveLengthModal({ isOpen: false, item: null, length: '' });
  };

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
          if (activeTab === 'receive') {
            return updated;
          }
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

  const handleRemoveItem = (id) => setCart(prev => prev.filter(i => i.id !== id));

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

    if (activeTab === 'transfer') {
      const missingInstance = finalCart.filter(i => i.unit === 'SQFT' && !i.instance_barcode);
      if (missingInstance.length > 0) {
        showAlert(`For cuttable items, you MUST scan the unique roll barcode to transfer it. You cannot transfer the generic item.`, "Unique Barcode Required");
        return;
      }
    }

    if (activeTab === 'receive') {
      const missingDefaults = finalCart.filter(i => i.unit === 'SQFT' && (!i.default_length || !i.default_width));
      if (missingDefaults.length > 0) {
        showAlert(`Please set Default Roll Dimensions in the Catalog for: ${missingDefaults.map(i => i.name).join(', ')}`, "Missing Dimensions");
        return;
      }
    }

    if (activeTab === 'checkout') {
      const missingInstance = finalCart.filter(i => i.unit === 'SQFT' && !i.instance_barcode);
      if (missingInstance.length > 0) {
        showAlert(`For cuttable items, you MUST scan the unique roll barcode to sell it.`, "Unique Barcode Required");
        return;
      }
      const missingDimensions = finalCart.filter(i => i.unit === 'SQFT' && (!i.length || !i.width));
      if (missingDimensions.length > 0) {
        showAlert(`Please specify Length and Height for all Cuttable Stock items.`, "Missing Dimensions");
        return;
      }
    }

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
        p_items: finalCart.map(i => {
          let calcQuantity = Number(i.quantity);
          if (i.is_cuttable) {
            if (i.unit === 'SQFT') {
              if (activeTab === 'receive') {
                calcQuantity = Number(i.quantity) * Number(i.default_length) * Number(i.default_width);
              } else if (activeTab === 'transfer') {
                calcQuantity = Number(i.pieceLength || i.default_length) * Number(i.default_width);
              }
            } else {
              // For METER/FT etc, receive/transfer quantity is just the length
              if (activeTab === 'receive') {
                calcQuantity = Number(i.quantity) * Number(i.default_length);
              } else if (activeTab === 'transfer') {
                calcQuantity = Number(i.pieceLength || i.default_length);
              }
            }
          }
          return {
            barcode: i.barcode,
            name: i.name,
            quantity: calcQuantity,
            price: i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0),
            discountPct: 0,
            unit: i.unit,
            instance_barcode: i.instance_barcode || null,
            discard_scrap: i.discard_scrap || false,
            piece_length: i.pieceLength || null,
            num_rolls: (activeTab === 'receive' && i.is_cuttable) ? Number(i.quantity) : null,
            default_length: i.default_length ? Number(i.default_length) : null,
            default_width: i.default_width ? Number(i.default_width) : null
          };
        }),
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

      // Manually update local IDB for instant feedback
      for (const item of finalCart) {
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem) {
          if (activeTab === 'receive') {
            localItem.stock_warehouse = (Number(localItem.stock_warehouse) || 0) + Number(item.quantity);
          } else if (activeTab === 'transfer') {
            localItem.stock_warehouse = Math.max(0, (Number(localItem.stock_warehouse) || 0) - Number(item.quantity));
            localItem.stock_store = (Number(localItem.stock_store) || 0) + Number(item.quantity);
          } else if (activeTab === 'checkout') {
            localItem.stock_store = Math.max(0, (Number(localItem.stock_store) || 0) - Number(item.quantity));
          }
          await saveInventoryBatch([localItem]);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['inventory'] });

      if (navigator.onLine) {
        // Trigger background sync to ensure true consistency with server
        syncInventoryToLocal().then(() => {
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
        });
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

      {/* Loose Item Quantity Modal */}
      {looseItemModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[95%] max-w-[400px] flex flex-col shadow-2xl animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Loose Item Quantity</span>
              <button type="button" onClick={() => setLooseItemModal({ isOpen: false, item: null, qty: '' })} className="px-3 py-1.5 leading-none focus:outline-none text-lg">✕</button>
            </div>
            <form onSubmit={handleLooseItemSubmit}>
              <div className="p-6">
                <p className="text-sm mb-4 font-semibold">{looseItemModal.item?.name}</p>
                <label htmlFor="loose-qty" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Enter Quantity</label>
                <input id="loose-qty" type="number" step="any" min="0.1" autoFocus value={looseItemModal.qty} onChange={(e) => setLooseItemModal({ ...looseItemModal, qty: e.target.value })} placeholder="0" className="w-full h-12 px-4 text-2xl font-mono focus:outline-none" style={{ border: '2px solid var(--color-accent)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              </div>
              <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
                <button type="submit" disabled={!looseItemModal.qty} className="h-9 px-8 text-white text-sm font-semibold focus:outline-none disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>Add to Cart</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Select Piece Modal */}
      {selectPieceModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[95%] max-w-[400px] flex flex-col shadow-2xl animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Select Piece</span>
              <button type="button" onClick={() => setSelectPieceModal({ isOpen: false, item: null, instances: [], isLoading: false })} className="px-3 py-1.5 leading-none focus:outline-none text-lg">✕</button>
            </div>
            <div className="p-6 flex flex-col">
              <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Which piece of <strong style={{ color: 'var(--color-accent)' }}>{selectPieceModal.item?.name}</strong> are you cutting from?</p>

              {selectPieceModal.isLoading ? (
                <div className="flex justify-center p-6"><Spinner className="w-6 h-6 text-[var(--color-accent)]" /></div>
              ) : selectPieceModal.instances.length === 0 ? (
                <p className="text-xs font-bold text-center p-4 text-[var(--color-error)]">No active pieces found.</p>
              ) : (
                <div className="max-h-[300px] overflow-y-auto flex flex-col gap-2 mb-4">
                  {selectPieceModal.instances.map(inst => (
                    <button
                      key={inst.id}
                      onClick={() => {
                        setSelectPieceModal({ isOpen: false, item: null, instances: [], isLoading: false });
                        setCutLengthModal({ isOpen: true, item: selectPieceModal.item, instance: inst, cutQty: '', discardScrap: false });
                      }}
                      className="p-3 text-left border border-[var(--border-medium)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors flex justify-between items-center focus:outline-none focus:border-[var(--color-accent)]"
                    >
                      <span className="font-mono text-xs font-bold" style={{ color: 'var(--color-accent)' }}>#{inst.instance_barcode}</span>
                      <span className="text-sm font-bold text-[var(--text-primary)]">{inst.current_length} {selectPieceModal.item?.unit} left</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receive Length Modal */}
      {receiveLengthModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm flex flex-col shadow-2xl" style={{ backgroundColor: 'var(--bg-primary)', borderTop: '4px solid var(--color-accent)' }}>
            <div className="flex justify-between items-center p-4" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
              <h3 className="font-bold tracking-wider text-sm" style={{ color: 'var(--text-primary)' }}>ENTER PIECE LENGTH</h3>
              <button type="button" onClick={() => setReceiveLengthModal({ isOpen: false, item: null, length: '' })} className="px-3 py-1.5 leading-none focus:outline-none text-lg">✕</button>
            </div>
            <form onSubmit={handleReceiveLengthSubmit} className="p-6">
              <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>What is the standard length of each <strong>{receiveLengthModal.item?.name}</strong> piece?</p>
              <div className="mb-6">
                <input type="number" autoFocus step="any" min="0.1" value={receiveLengthModal.length} onChange={e => setReceiveLengthModal({ ...receiveLengthModal, length: e.target.value })} placeholder={`Length (${receiveLengthModal.item?.unit})`} className="w-full h-12 px-4 text-xl font-mono focus:outline-none" style={{ border: '2px solid var(--color-accent)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="submit" disabled={!receiveLengthModal.length} className="h-9 px-8 text-white text-sm font-semibold focus:outline-none disabled:opacity-50 transition-colors hover:brightness-110" style={{ backgroundColor: 'var(--color-accent)' }}>Add to Cart</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cut Length Modal */}
      {cutLengthModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[95%] max-w-[400px] flex flex-col shadow-2xl animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Cut Length</span>
              <button type="button" onClick={() => setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false })} className="px-3 py-1.5 leading-none focus:outline-none text-lg">✕</button>
            </div>

            <form onSubmit={handleCutLengthSubmit}>
              <div className="p-6">
                <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>How much of <strong style={{ color: 'var(--color-accent)' }}>{cutLengthModal.item?.name}</strong> are you cutting from piece <strong className="font-mono text-[var(--text-primary)]">#{cutLengthModal.instance?.instance_barcode.split('-')[1] || cutLengthModal.instance?.instance_barcode}</strong>?</p>

                <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Current Piece: {cutLengthModal.instance?.current_length} {cutLengthModal.item?.unit}</p>

                <div className="relative mb-4">
                  <input type="number" autoFocus step="any" min="0.1" value={cutLengthModal.cutQty} onChange={e => {
                    const val = e.target.value;
                    const numVal = Number(val);
                    const max = Number(cutLengthModal.instance?.current_length);
                    const isSmallScrap = !isNaN(numVal) && !isNaN(max) && (max - numVal < 1) && (max - numVal > 0);
                    setCutLengthModal({ ...cutLengthModal, cutQty: val, discardScrap: isSmallScrap });
                  }} className="w-full h-12 px-4 text-2xl font-mono focus:outline-none" style={{ border: '2px solid var(--color-accent)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} placeholder="0" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>{cutLengthModal.item?.unit}</span>
                </div>

                {cutLengthModal.instance?.current_length !== '?' && Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty) < 1 && Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty) > 0 && (
                  <label className="flex items-center gap-3 p-3 border cursor-pointer mt-4" style={{ borderColor: 'var(--color-warning)', backgroundColor: 'var(--bg-tertiary)' }}>
                    <input type="checkbox" checked={cutLengthModal.discardScrap} onChange={e => setCutLengthModal({ ...cutLengthModal, discardScrap: e.target.checked })} className="w-5 h-5 cursor-pointer accent-[var(--color-warning)]" />
                    <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Only {(Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty)).toFixed(2)} {cutLengthModal.item?.unit} left. Discard remaining scrap?</span>
                  </label>
                )}
              </div>
              <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
                <button type="submit" disabled={!cutLengthModal.cutQty} className="h-9 px-8 text-white text-sm font-semibold focus:outline-none disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>Add Cut</button>
              </div>
            </form>
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
            <form onSubmit={(e) => { e.preventDefault(); processScan(manualBarcode); setManualBarcode(''); setShowSuggestions(false); }} className="mt-3 flex items-center relative">
              <label htmlFor="manual-barcode" className="sr-only">Barcode</label>
              <input id="manual-barcode" type="text" value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)} onFocus={() => manualBarcode.trim().length >= 2 && setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} placeholder="Search barcode or name..." className="h-9 px-3 text-sm focus:outline-none w-full md:w-64" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} autoComplete="off" />
              <button type="submit" className="h-9 px-4 text-sm font-semibold focus:outline-none" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '2px solid var(--border-input)', borderLeft: 'none' }}>Add</button>
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute top-[100%] left-0 w-full md:w-64 bg-[var(--bg-secondary)] border border-[var(--border-medium)] z-50 max-h-60 overflow-y-auto shadow-lg mt-1 rounded-sm">
                  {suggestions.map((item) => (
                    <li
                      key={item.barcode}
                      className="px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)] text-sm flex justify-between border-b border-[var(--border-light)] last:border-0"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const typed = manualBarcode.trim();
                        let targetBarcode = item.barcode;
                        if (typed.startsWith(item.barcode + '-')) {
                          targetBarcode = typed;
                        }
                        setManualBarcode('');
                        setShowSuggestions(false);
                        processScan(targetBarcode);
                      }}
                    >
                      <span className="truncate pr-2 font-medium" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                      <span className="text-[10px] font-mono whitespace-nowrap self-center px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-accent)' }}>#{item.barcode}</span>
                    </li>
                  ))}
                </ul>
              )}
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
            onRemoveItem={handleRemoveItem}
          />
        </div>

        {/* Mobile View */}
        <div className="md:hidden flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
          <CartMobileView
            cart={cart}
            activeTab={activeTab}
            onUpdateQuantity={updateQuantity}
            onUpdateDimensions={updateDimensions}
            onRemoveItem={handleRemoveItem}
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