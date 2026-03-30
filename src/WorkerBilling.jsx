import { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import { Spinner } from './App'; 

export default function WorkerBilling({ inventory, refreshInventory, defaultTab = 'checkout', hideNav = false, shopSettings, cashierName }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false); 
  const [lastReceipt, setLastReceipt] = useState(null);
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'System Notice' });
  const [checkoutModal, setCheckoutModal] = useState({ isOpen: false, cashGiven: '' });
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, message: '', title: 'Action Required', onConfirm: null });
  const scannerInputRef = useRef(null); 

  const showAlert = (message, title = 'System Notice') => setAlertConfig({ isOpen: true, message, title });
  const closeAlert = () => { setAlertConfig({ ...alertConfig, isOpen: false }); setTimeout(() => scannerInputRef.current?.focus(), 50); };
  
  const showConfirm = (message, onConfirmCallback, title = 'Action Required') => setConfirmConfig({ isOpen: true, message, title, onConfirm: onConfirmCallback });

  useEffect(() => { if (!alertConfig.isOpen && !checkoutModal.isOpen && !confirmConfig.isOpen) scannerInputRef.current?.focus(); }, [alertConfig.isOpen, checkoutModal.isOpen, confirmConfig.isOpen, activeTab]); 
  
  const handleBackgroundClick = (e) => { 
    if (!alertConfig.isOpen && !checkoutModal.isOpen && !confirmConfig.isOpen && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') {
      scannerInputRef.current?.focus(); 
    }
  };

  const handleScan = async (e) => {
    e.preventDefault(); 
    const cleanBarcode = barcode.trim(); 
    setBarcode(''); 
    if (!cleanBarcode) return;

    let item = cart.find(i => i.barcode === cleanBarcode) || inventory.find(i => i.barcode === cleanBarcode && i.is_active !== false);
    if (!item) {
      const { data } = await supabase.from('inventory').select('*').eq('barcode', cleanBarcode).single();
      if (data && data.is_active !== false) item = data;
    }

    if (item) {
      if (activeTab === 'checkout') {
        const currentCartItem = cart.find(c => c.barcode === cleanBarcode);
        const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
        const availableStock = Number(item.stock_store || 0);

        if (availableStock <= 0) {
          showAlert(`No stock remaining for ${item.name} in the store.`, "Out of Stock");
          return;
        }
        if (currentQty >= availableStock) {
          showAlert(`Cannot exceed available store stock (${availableStock}) for ${item.name}.`, "Stock Limit Reached");
          return;
        }
      }

      setCart(prev => {
        const idx = prev.findIndex(c => c.barcode === cleanBarcode);
        if (idx >= 0) { 
          const up = [...prev]; 
          up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1 }; 
          return up; 
        }
        return [...prev, { ...item, id: Date.now(), customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: 1, unit: item.unit || 'PCS' }];
      });
      setTimeout(() => scannerInputRef.current?.focus(), 10);
    } else {
      showAlert(`SKU code ${cleanBarcode} not found in catalog.`, "Validation Error");
    }
  };

  const updateQuantity = (id, val) => {
    setCart(prev => {
      let limitMsg = '';
      const newCart = prev.map(i => {
        if (i.id === id) {
          let newQty = val === '' ? '' : Math.max(0, Number(val));
          if (activeTab === 'checkout' && val !== '') {
            const maxStock = Number(i.stock_store || 0);
            if (newQty > maxStock) {
              limitMsg = `Cannot exceed available store stock (${maxStock}) for ${i.name}.`;
              newQty = maxStock;
            }
          }
          return { ...i, quantity: newQty };
        }
        return i;
      }).filter(i => i.quantity !== 0);

      if (limitMsg) {
        setTimeout(() => showAlert(limitMsg, "Stock Limit"), 0);
      }
      return newCart;
    });
  };

  const handleCustomPriceChange = (id, val) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, customPriceInput: val } : i));
  };

  const applyCustomPriceBlur = (id) => {
    setCart(prev => prev.map(i => {
      if (i.id === id) {
        let val = Number(i.customPriceInput);
        if (isNaN(val)) val = Number(i.price || 0);
        
        const msp = Number(i.msp || 0);
        const mrp = Number(i.price || 0);
        
        if (val < msp) val = msp;
        if (val > mrp) val = mrp;
        
        const disc = mrp > 0 ? ((mrp - val) / mrp) * 100 : 0;
        return { ...i, customPriceInput: val.toFixed(2), discountPct: disc };
      }
      return i;
    }));
  };

  const calculateTotal = () => cart.reduce((tot, i) => {
    const qty = i.quantity === '' ? 0 : Number(i.quantity);
    const sellPrice = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
    return tot + (sellPrice * qty);
  }, 0);

  const calculateTotalUnits = () => cart.reduce((tot, i) => tot + (i.quantity === '' ? 0 : Number(i.quantity)), 0);

  const formatDateTime = (dateObj) => {
    if (!dateObj) return { datePart: '', timePart: '' };
    const datePart = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    let hours = dateObj.getHours();
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const paddedHours = hours.toString().padStart(2, '0');
    return { datePart, timePart: `${paddedHours}:${minutes} ${ampm}` };
  };

  const handleCompleteTransaction = async () => {
    const finalCart = cart.filter(i => Number(i.quantity) > 0);
    if (finalCart.length === 0) return;
    setIsCheckingOut(true);
    try {
      const payload = {
        p_action: activeTab === 'receive' ? 'RECEIVE' : activeTab === 'transfer' ? 'TRANSFER' : 'SALE',
        p_location: activeTab === 'receive' ? 'Warehouse-Inbound' : activeTab === 'transfer' ? 'Warehouse-Transfer' : 'Store',
        p_cashier_name: cashierName || 'System',
        p_items: finalCart.map(i => ({ 
          barcode: i.barcode, 
          name: i.name, 
          quantity: Number(i.quantity), 
          price: i.customPriceInput !== undefined ? Number(i.customPriceInput) : Number(i.price || 0), 
          discountPct: Number(i.discountPct || 0), 
          unit: i.unit 
        }))
      };

      const { data, error } = await supabase.rpc('process_pos_transaction', payload);
      if (error) throw new Error(error.message); 

      setLastReceipt({ 
        id: data.bill_id.split('-')[0], 
        items: finalCart.map(i => {
          const finalRate = i.customPriceInput !== undefined ? Number(i.customPriceInput) : Number(i.price || 0);
          return {
            ...i, 
            quantity: Number(i.quantity), 
            finalRate: finalRate, 
            lineTotal: finalRate * Number(i.quantity)
          };
        }), 
        total: calculateTotal(), 
        date: new Date(), 
        type: activeTab, 
        cashierName: cashierName || 'System' 
      });

      setCart([]); 
      if (refreshInventory) refreshInventory(); 
      setCheckoutModal({ isOpen: false, cashGiven: '' }); 

      if (activeTab === 'checkout') {
        setTimeout(() => { window.print(); }, 100);
      } else {
        showAlert("Inventory operation committed successfully.", "Success");
      }
    } catch (e) { 
      showAlert(e.message, "System Error"); 
    } finally { 
      setIsCheckingOut(false); 
    }
  };

  const cartTotal = calculateTotal();
  const cartUnits = calculateTotalUnits();

  return (
    <div style={{ fontFamily: "'Roboto', sans-serif" }}>
      <style>{`
        @media print {
          @page {
            margin: 0;
            size: 80mm auto; /* Thermal paper roll sizing */
          }
          body {
            margin: 0;
            padding: 0;
          }
          body * { visibility: hidden !important; }
          #printable-receipt, #printable-receipt * { visibility: visible !important; }
          #printable-receipt { 
             position: absolute; 
             left: 0; 
             top: 0; 
             width: 80mm; 
             margin: 0; 
             padding: 4mm; 
          }
        }
      `}</style>
      
      {/* WINDOWS 10 ALERT MODAL */}
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] print:hidden px-4">
          <div className="bg-white border-2 border-[#0078D7] w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0078D7]">{alertConfig.title}</span>
              <button onClick={closeAlert} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm text-black">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
              <button onClick={closeAlert} className="px-8 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black">Acknowledge</button>
            </div>
          </div>
        </div>
      )}

      {/* WINDOWS 10 CONFIRM MODAL */}
      {confirmConfig.isOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] print:hidden px-4">
          <div className="bg-white border-2 border-[#0078D7] w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0078D7]">{confirmConfig.title}</span>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm text-black">{confirmConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => { if (confirmConfig.onConfirm) confirmConfig.onConfirm(); setConfirmConfig({ ...confirmConfig, isOpen: false }); }} className="px-8 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black">Execute</button>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="px-8 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm rounded-none focus:outline-none focus:border-[#0078D7]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* WINDOWS 10 CHECKOUT MODAL */}
      {checkoutModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] print:hidden px-4">
          <div className="bg-white border-2 border-[#0078D7] w-[450px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-[#0078D7] flex justify-between items-center pr-1 pl-4 py-1 border-b border-[#005a9e]">
              <span className="text-xs font-semibold uppercase tracking-wider text-white">Payment Terminal</span>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} className="text-white hover:bg-[#e81123] px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white">
              <div className="flex justify-between items-end mb-6 pb-4 border-b border-gray-300">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Gross Due</span>
                <span className="text-4xl font-light text-black">₹{cartTotal.toFixed(2)}</span>
              </div>
              
              <div className="mb-6">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">Tender Amount (₹)</label>
                <input type="number" step="any" autoFocus value={checkoutModal.cashGiven} onChange={(e) => setCheckoutModal({ ...checkoutModal, cashGiven: e.target.value })} placeholder="0.00" className="w-full px-4 py-3 border-2 border-gray-300 bg-white text-2xl font-mono rounded-none focus:outline-none focus:border-[#0078D7]" />
              </div>
              
              {Number(checkoutModal.cashGiven) > 0 && (
                <div className={`p-4 border ${Number(checkoutModal.cashGiven) >= (cartTotal - 0.01) ? 'bg-[#e6f4ea] border-[#107c10]' : 'bg-[#fde7e9] border-[#e81123]'}`}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-wider text-black">
                      {Number(checkoutModal.cashGiven) >= (cartTotal - 0.01) ? 'Change Due' : 'Shortfall'}
                    </span>
                    <span className="text-2xl font-light text-black">
                      ₹{Math.abs(Number(checkoutModal.cashGiven) - cartTotal).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={handleCompleteTransaction} disabled={isCheckingOut || (Number(checkoutModal.cashGiven) > 0 && Number(checkoutModal.cashGiven) < (cartTotal - 0.01))} className="px-8 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50 flex justify-center items-center min-w-[120px]">
                {isCheckingOut ? <Spinner className="w-4 h-4 text-white" /> : 'Execute'}
              </button>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} disabled={isCheckingOut} className="px-8 py-2 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm font-semibold rounded-none disabled:opacity-50 focus:outline-none focus:border-[#0078D7]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN BILLING INTERFACE */}
      <div className="flex flex-col h-full w-full print:hidden font-sans" onClick={handleBackgroundClick}>
        
        {!hideNav && (
          <div className="flex gap-1 mb-6 border-b border-gray-300 pb-0">
            <button onClick={() => { setActiveTab('receive'); setCart([]); }} onMouseDown={(e) => e.preventDefault()} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${activeTab === 'receive' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Inbound</button>
            <button onClick={() => { setActiveTab('transfer'); setCart([]); }} onMouseDown={(e) => e.preventDefault()} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${activeTab === 'transfer' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Transfer</button>
            <button onClick={() => { setActiveTab('checkout'); setCart([]); }} onMouseDown={(e) => e.preventDefault()} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${activeTab === 'checkout' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Terminal</button>
          </div>
        )}

        <div className="flex flex-col flex-1 border border-gray-400 bg-white min-h-[500px] rounded-none">
          
          <div className={`p-4 border-b border-gray-400 flex flex-col md:flex-row justify-between md:items-center gap-4 ${activeTab === 'receive' ? 'bg-[#f4fbf5]' : activeTab === 'transfer' ? 'bg-[#fffaf0]' : 'bg-[#f9f9f9]'}`}>
            <div>
              <h2 className="text-2xl font-light text-black">
                {activeTab === 'receive' && 'Inbound Stock Entry'}
                {activeTab === 'transfer' && 'Internal Inventory Relocation'}
                {activeTab === 'checkout' && 'Point of Sale Terminal'}
              </h2>
            </div>
            <div className="text-left md:text-right border-t border-gray-300 pt-2 md:border-0 md:pt-0">
              <span className="text-xs uppercase font-semibold text-gray-500 tracking-wider block mb-1">
                {activeTab === 'checkout' ? 'Gross Total' : 'Total Units'}
              </span>
              <span className="text-4xl font-light text-[#0078D7]">
                {activeTab === 'checkout' ? `₹${cartTotal.toFixed(2)}` : cartUnits}
              </span>
            </div>
          </div>

          <form onSubmit={handleScan} className="opacity-0 h-0 w-0 overflow-hidden absolute">
            <input ref={scannerInputRef} type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} autoFocus />
            <button type="submit">Scan</button>
          </form>

          {/* DESKTOP TABLE */}
          <div className="hidden md:block flex-1 overflow-y-auto bg-white rounded-none">
            {cart.length === 0 ? (
              <div className="h-full flex items-center justify-center min-h-[300px]">
                <p className="text-sm font-semibold uppercase tracking-widest text-gray-500">System Ready. Awaiting Scanner Input.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-400">
                  <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                    <th className="p-3 border-r border-gray-300 w-1/3">Nomenclature</th>
                    <th className={`p-3 text-center w-40 ${activeTab === 'checkout' ? 'border-r border-gray-300' : ''}`}>Quantity</th>
                    {activeTab === 'checkout' && (
                      <>
                        <th className="p-3 border-r border-gray-300 text-center w-36">Sell Price (₹)</th>
                        <th className="p-3 border-r border-gray-300 text-center w-28">Disc (%)</th>
                        <th className="p-3 text-right w-32">Line Net</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 border-b border-gray-400">
                  {cart.map(item => {
                    const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
                    const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);

                    return (
                      <tr key={item.id} className="hover:bg-[#f9f9f9]">
                        <td className="p-3 border-r border-gray-200">
                          <p className="text-sm font-semibold text-black">{item.name}</p>
                          <p className="text-xs text-[#0078D7] font-mono mt-0.5">#{item.barcode}</p>
                        </td>
                        <td className={`p-2 ${activeTab === 'checkout' ? 'border-r border-gray-200' : ''}`}>
                          <div className="flex items-center justify-center">
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateQuantity(item.id, safeQty - 1)} className="w-8 h-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black font-bold focus:outline-none border-2 border-gray-300 border-r-0 rounded-none">-</button>
                            <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-14 h-8 px-1 text-sm font-semibold text-center border-y-2 border-gray-300 focus:outline-none focus:bg-[#cce8ff] focus:border-[#0078D7] z-10 rounded-none" />
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateQuantity(item.id, safeQty + 1)} className="w-8 h-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black font-bold focus:outline-none border-2 border-gray-300 border-l-0 rounded-none">+</button>
                          </div>
                        </td>
                        {activeTab === 'checkout' && (
                          <>
                            <td className="p-2 border-r border-gray-200">
                              <input 
                                type="number" step="0.01" 
                                value={item.customPriceInput !== undefined ? item.customPriceInput : Number(item.price||0).toFixed(2)} 
                                onChange={(e) => handleCustomPriceChange(item.id, e.target.value)} 
                                onBlur={() => applyCustomPriceBlur(item.id)}
                                placeholder="0.00" 
                                className="w-full h-8 px-2 border-2 border-gray-300 text-sm font-semibold text-center bg-white rounded-none focus:outline-none focus:border-[#0078D7]" 
                              />
                            </td>
                            <td className="p-2 border-r border-gray-200 bg-gray-50">
                              <input 
                                type="number" 
                                value={item.discountPct ? Number(item.discountPct).toFixed(1) : '0.0'} 
                                disabled 
                                className="w-full h-8 px-2 border border-transparent text-sm font-semibold text-center bg-transparent rounded-none outline-none cursor-not-allowed text-gray-500" 
                              />
                            </td>
                            <td className="p-3 text-right text-sm font-bold text-black">
                              ₹{(sellPrice * safeQty).toFixed(2)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* MOBILE CARDS */}
          <div className="md:hidden flex-1 overflow-y-auto bg-white divide-y divide-gray-300 border-b border-gray-400">
            {cart.length === 0 ? (
              <div className="p-10 text-center text-sm font-semibold uppercase tracking-widest text-gray-500">Awaiting Input</div>
            ) : (
              cart.map((item) => {
                const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
                const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);

                return (
                  <div key={item.id} className="p-4 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div className="pr-2">
                        <p className="text-sm font-semibold text-black">{item.name}</p>
                        <p className="text-xs text-[#0078D7] mt-1">#{item.barcode} {activeTab === 'checkout' && `• MRP ₹${Number(item.price||0).toFixed(2)}`}</p>
                      </div>
                      {activeTab === 'checkout' && (
                        <p className="text-base font-bold text-black">₹{(sellPrice * safeQty).toFixed(2)}</p>
                      )}
                    </div>
                    <div className="flex justify-between items-center mt-1 pt-3 border-t border-gray-200">
                      <div className="flex items-center">
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateQuantity(item.id, safeQty - 1)} className="w-10 h-8 bg-[#e6e6e6] active:bg-[#cccccc] text-black font-bold text-lg focus:outline-none border-2 border-gray-300 border-r-0 rounded-none">-</button>
                        <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-12 h-8 px-1 text-sm font-semibold text-center border-y-2 border-gray-300 focus:outline-none focus:bg-[#cce8ff] focus:border-[#0078D7] z-10 rounded-none" />
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateQuantity(item.id, safeQty + 1)} className="w-10 h-8 bg-[#e6e6e6] active:bg-[#cccccc] text-black font-bold text-lg focus:outline-none border-2 border-gray-300 border-l-0 rounded-none">+</button>
                      </div>
                      {activeTab === 'checkout' && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Sell Px:</span>
                          <input 
                            type="number" step="0.01" 
                            value={item.customPriceInput !== undefined ? item.customPriceInput : Number(item.price||0).toFixed(2)} 
                            onChange={(e) => handleCustomPriceChange(item.id, e.target.value)} 
                            onBlur={() => applyCustomPriceBlur(item.id)}
                            className="w-16 h-8 px-1 border-2 border-gray-300 bg-white text-sm font-semibold text-center rounded-none focus:outline-none focus:border-[#0078D7]" 
                          />
                          <span className="text-xs text-gray-400 font-semibold bg-gray-50 px-1 py-1 border border-transparent">(-{item.discountPct ? Number(item.discountPct).toFixed(1) : '0'}%)</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* BOTTOM ACTION BAR */}
          <div className="p-4 bg-[#f3f3f3] flex flex-col md:flex-row justify-between gap-3">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => showConfirm("Clear active list?", () => setCart([]), activeTab === 'checkout' ? 'Void Trans' : 'Clear List')} className="w-full md:w-auto px-8 py-2 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm font-semibold uppercase tracking-wider rounded-none focus:outline-none focus:border-[#0078D7]">
              {activeTab === 'checkout' ? 'Void Trans' : 'Clear List'}
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => activeTab === 'checkout' ? setCheckoutModal({isOpen: true, cashGiven: ''}) : handleCompleteTransaction()} className="w-full md:w-auto px-10 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold uppercase tracking-wider rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black flex justify-center items-center">
              {isCheckingOut ? 'Processing' : 'Execute'}
            </button>
          </div>
        </div>
      </div>

      {/* THERMAL PRINTER TEMPLATE */}
      <div id="printable-receipt" className="hidden print:block text-black font-mono text-xs w-[80mm] mx-auto bg-white p-4" style={{ fontFamily: "'Roboto', sans-serif" }}>
        {lastReceipt && lastReceipt.type === 'checkout' && (
          <>
            <div className="text-center mb-3">
              <h1 className="text-xl font-bold uppercase">{shopSettings?.shop_name || 'STORE RECEIPT'}</h1>
              <p className="text-[10px]">Owner: {shopSettings?.owner_name}</p>
            </div>
            <div className="mb-3 text-[10px] flex justify-between border-b border-black border-dashed pb-2">
              <div>
                <p>Txn ID: {lastReceipt.id}</p>
                <p>Date: {formatDateTime(lastReceipt.date).datePart}</p>
              </div>
              <div className="text-right">
                <p>Type: POS SALE</p>
                <p>Time: {formatDateTime(lastReceipt.date).timePart}</p>
              </div>
            </div>
            <table className="w-full mb-3 text-[10px]">
              <thead>
                <tr className="border-b border-black border-dashed">
                  <th className="text-left font-semibold pb-1 w-1/2">SKU/Item</th>
                  <th className="text-center font-semibold pb-1 w-1/6">Qty</th>
                  <th className="text-right font-semibold pb-1 w-1/6">Rate</th>
                  <th className="text-right font-semibold pb-1 w-1/6">Amt</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {lastReceipt.items.map((item, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-1 text-wrap">
                      {item.name}
                    </td>
                    <td className="py-1 text-center">{item.quantity} {item.unit}</td>
                    <td className="py-1 text-right">{item.finalRate.toFixed(2)}</td>
                    <td className="py-1 text-right">{item.lineTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-black pt-2 flex justify-between items-center mb-4">
              <span className="font-bold text-sm">NET DUE</span>
              <span className="font-bold text-lg">₹{lastReceipt.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            </div>
            <div className="text-center text-[10px] border-t border-black border-dashed pt-2 mt-2">
              <p>Thank You For Your Business!</p>
              <p>Goods once sold will not be taken back.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}