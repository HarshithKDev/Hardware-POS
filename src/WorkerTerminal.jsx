import { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';
import ReceiptTemplate from './ReceiptTemplate';

export default function WorkerTerminal({ activeTab, shopSettings, cashierName, refreshInventory, showAlert, showConfirm, isModalOpen }) {
  const [cart, setCart] = useState(() => {
    try { const saved = localStorage.getItem(`pos_cart_${activeTab}`); return saved ? JSON.parse(saved) : []; } catch (e) { return []; }
  });
  const [manualBarcode, setManualBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [checkoutModal, setCheckoutModal] = useState({ isOpen: false, cashGiven: '' });
  
  const barcodeBuffer = useRef('');
  const lastKeyTime = useRef(Date.now());
  const cartRef = useRef(cart);
  
  useEffect(() => { cartRef.current = cart; localStorage.setItem(`pos_cart_${activeTab}`, JSON.stringify(cart)); }, [cart, activeTab]);

  const processScan = async (scannedCode) => {
    const cleanBarcode = scannedCode.trim(); 
    if (!cleanBarcode) return;
    let item = cartRef.current.find(i => i.barcode === cleanBarcode);
    if (!item) {
      const { data, error } = await supabase.from('inventory').select('*').eq('barcode', cleanBarcode).eq('is_active', true).single();
      if (error || !data) return showAlert(`Barcode ${cleanBarcode} not found in the system.`, "Error");
      item = data;
    }
    if (item) {
      if (activeTab === 'checkout') {
        const currentCartItem = cartRef.current.find(c => c.barcode === cleanBarcode);
        const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
        if (Number(item.stock_store || 0) <= 0) return showAlert(`${item.name} is out of stock in the store.`, "Out of Stock");
        if (currentQty >= Number(item.stock_store || 0)) return showAlert(`You only have ${item.stock_store} of ${item.name} in the store.`, "Stock Limit");
      }
      setCart(prev => {
        const idx = prev.findIndex(c => c.barcode === cleanBarcode);
        if (idx >= 0) { const up = [...prev]; up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1 }; return up; }
        return [...prev, { ...item, id: Date.now(), customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: 1, unit: item.unit || 'PCS' }];
      });
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (isModalOpen || checkoutModal.isOpen) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const currentTime = Date.now();
      if (currentTime - lastKeyTime.current > 200) barcodeBuffer.current = '';
      lastKeyTime.current = currentTime;
      if (e.key === 'Enter') { if (barcodeBuffer.current.length > 0) { e.preventDefault(); processScan(barcodeBuffer.current); barcodeBuffer.current = ''; } } 
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { barcodeBuffer.current += e.key; }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isModalOpen, checkoutModal.isOpen]);

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
      const payload = { p_action: activeTab === 'receive' ? 'RECEIVE' : activeTab === 'transfer' ? 'TRANSFER' : 'SALE', p_location: activeTab === 'receive' ? 'Warehouse-Inbound' : activeTab === 'transfer' ? 'Warehouse-Transfer' : 'Store', p_cashier_name: cashierName || 'System', p_items: finalCart.map(i => ({ barcode: i.barcode, name: i.name, quantity: Number(i.quantity), price: i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0), discountPct: 0, unit: i.unit })) };
      const { data, error } = await supabase.rpc('process_pos_transaction', payload);
      if (error) throw new Error(error.message);
      setLastReceipt({ id: data.bill_id.split('-')[0], items: finalCart.map(i => { const finalRate = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0); return { ...i, quantity: Number(i.quantity), finalRate, mrp: Number(i.price || 0), lineTotal: finalRate * Number(i.quantity) }; }), total: calculateTotal(), date: new Date(), type: activeTab });
      setCart([]); setCheckoutModal({ isOpen: false, cashGiven: '' });
      if (refreshInventory) refreshInventory();
      if (activeTab === 'checkout') setTimeout(() => { window.print(); }, 100); else showAlert("Stock updated successfully.", "Success");
    } catch (e) { showAlert(e.message, "System Error"); } finally { setIsCheckingOut(false); }
  };

  const cartTotal = calculateTotal(); const cartUnits = calculateTotalUnits();
  const cartTotalCents = Math.round(cartTotal * 100); const cashGivenCents = Math.round(Number(checkoutModal.cashGiven || 0) * 100);
  const differenceCents = Math.abs(cashGivenCents - cartTotalCents); const isShortfall = cashGivenCents > 0 && cashGivenCents < cartTotalCents;
  const formatDateTime = (dateObj) => { if (!dateObj) return { datePart: '', timePart: '' }; const d = dateObj; let hours = d.getHours(); const ampm = hours >= 12 ? 'PM' : 'AM'; hours = hours % 12 || 12; return { datePart: d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }), timePart: `${hours.toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} ${ampm}` }; };

  return (
    <>
      {checkoutModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] print:hidden px-4">
          <div className="bg-white border border-gray-400 w-[450px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold uppercase tracking-wider text-black">Checkout Payment</span>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white">
              <div className="flex justify-between items-end mb-6 pb-4 border-b border-gray-300"><span className="text-xs font-bold uppercase tracking-wider text-gray-500">Total Due</span><span className="text-4xl font-light text-[#0078D7]">₹{cartTotal.toFixed(2)}</span></div>
              <div className="mb-6"><label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">Cash Given (₹)</label><input type="number" step="any" autoFocus value={checkoutModal.cashGiven} onChange={(e) => setCheckoutModal({ ...checkoutModal, cashGiven: e.target.value })} placeholder="0.00" className="w-full h-12 px-4 border-2 border-gray-300 bg-white text-2xl font-mono rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
              {cashGivenCents > 0 && (<div className={`p-4 border ${!isShortfall ? 'bg-[#e6f4ea] border-[#107c10]' : 'bg-[#fde7e9] border-[#e81123]'}`}><div className="flex justify-between items-center"><span className="text-xs font-bold uppercase tracking-wider text-black">{!isShortfall ? 'Give Change' : 'Missing Amount'}</span><span className="text-2xl font-light text-black">₹{(differenceCents / 100).toFixed(2)}</span></div></div>)}
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={handleCompleteTransaction} disabled={isCheckingOut || isShortfall} className="h-9 px-8 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold rounded-none border border-transparent focus:outline-none focus:ring-2 focus:ring-[#0078D7] focus:ring-offset-1 disabled:opacity-50 flex justify-center items-center min-w-[120px]">{isCheckingOut ? <Spinner className="w-4 h-4 text-white" /> : 'Complete Sale'}</button>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} disabled={isCheckingOut} className="h-9 px-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm font-semibold rounded-none disabled:opacity-50 focus:outline-none">Cancel</button>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex flex-col flex-1 border border-gray-400 bg-white min-h-[500px] rounded-none shadow-sm">
        <div className={`p-4 border-b border-gray-400 flex flex-col md:flex-row justify-between gap-4 ${activeTab === 'receive' ? 'bg-[#f4fbf5]' : activeTab === 'transfer' ? 'bg-[#fffaf0]' : 'bg-[#f3f3f3]'}`}>
          <div className="flex flex-col">
            <h2 className="text-2xl font-light text-black">{activeTab === 'receive' ? 'Receive New Stock' : activeTab === 'transfer' ? 'Move Stock to Store' : 'Checkout Counter'}</h2>
            <form onSubmit={(e) => { e.preventDefault(); processScan(manualBarcode); setManualBarcode(''); }} className="mt-3 flex items-center">
              <input type="text" value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)} placeholder="Enter Barcode manually..." className="h-9 border-2 border-gray-300 px-3 text-sm focus:outline-none focus:border-[#0078D7] rounded-none w-full md:w-64" />
              <button type="submit" className="h-9 bg-[#e6e6e6] px-4 text-sm font-semibold border-2 border-l-0 border-gray-300 hover:bg-[#cccccc] rounded-none focus:outline-none">Add</button>
            </form>
          </div>
          <div className="text-left md:text-right border-t border-gray-300 pt-2 md:border-0 md:pt-0 flex flex-col justify-end">
            <span className="text-xs uppercase font-semibold text-gray-500 tracking-wider block mb-1">{activeTab === 'checkout' ? 'Total Price' : 'Total Units'}</span>
            <span className="text-4xl font-light text-[#0078D7]">{activeTab === 'checkout' ? `₹${cartTotal.toFixed(2)}` : cartUnits}</span>
          </div>
        </div>

        <div className="hidden md:block flex-1 overflow-y-auto bg-white rounded-none">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center min-h-[300px]"><p className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-2">Ready</p><p className="text-xs text-gray-400">Scan items anytime or type the barcode above</p></div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#f9f9f9] sticky top-0 border-b border-gray-300 z-10">
                <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                  <th className="p-3 border-r border-gray-200 w-2/5">Item Name</th><th className={`p-3 text-center w-40 ${activeTab === 'checkout' ? 'border-r border-gray-200' : ''}`}>Quantity</th>
                  {activeTab === 'checkout' && (<><th className="p-3 border-r border-gray-200 text-center w-36">Price (₹)</th><th className="p-3 border-r border-gray-200 text-center w-28">Disc (%)</th><th className="p-3 text-right w-32">Total</th></>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 border-b border-gray-300">
                {cart.map(item => {
                  const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
                  const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
                  return (
                    <tr key={item.id} className="hover:bg-[#f3f3f3] transition-none">
                      <td className="p-3 border-r border-gray-200">
                        <p className="text-sm font-semibold text-black">{item.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <p className="text-xs text-[#0078D7] font-mono">#{item.barcode}</p>
                          {activeTab === 'checkout' && (
                            <div className="flex gap-2">
                              <span className="text-[10px] text-gray-600 font-semibold bg-[#e6e6e6] px-1.5 py-0.5 border border-gray-300 uppercase tracking-wider">
                                MRP: ₹{Number(item.price || 0).toFixed(2)}
                              </span>
                              <span className="text-[10px] text-gray-600 font-semibold bg-[#e6e6e6] px-1.5 py-0.5 border border-gray-300 uppercase tracking-wider">
                                MSP: ₹{Number(item.msp || 0).toFixed(2)}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className={`p-2 ${activeTab === 'checkout' ? 'border-r border-gray-200' : ''}`}>
                        <div className="flex items-center justify-center">
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateQuantity(item.id, safeQty - 1)} className="w-8 h-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black font-bold border border-gray-400 border-r-0 rounded-none focus:outline-none">-</button>
                          <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-14 h-8 px-1 text-sm font-semibold text-center border border-gray-400 focus:outline-none focus:border-[#0078D7] focus:z-10 rounded-none" />
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateQuantity(item.id, safeQty + 1)} className="w-8 h-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black font-bold border border-gray-400 border-l-0 rounded-none focus:outline-none">+</button>
                        </div>
                      </td>
                      {activeTab === 'checkout' && (<>
                        <td className="p-2 border-r border-gray-200"><input type="number" step="0.01" value={item.customPriceInput !== undefined ? item.customPriceInput : Number(item.price||0).toFixed(2)} onChange={(e) => handleCustomPriceChange(item.id, e.target.value)} onBlur={() => applyCustomPriceBlur(item.id)} placeholder="0.00" className="w-full h-8 px-2 border border-gray-300 text-sm font-semibold text-center bg-white rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                        <td className="p-2 border-r border-gray-200 bg-[#f9f9f9]"><input type="number" value={item.discountPct ? Number(item.discountPct).toFixed(1) : '0.0'} disabled className="w-full h-8 px-2 border border-transparent text-sm font-semibold text-center bg-transparent rounded-none outline-none cursor-not-allowed text-gray-500" /></td>
                        <td className="p-3 text-right text-sm font-bold text-black">₹{(sellPrice * safeQty).toFixed(2)}</td>
                      </>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        
        {/* Mobile View Omitted for Brevity but standardizing borders... */}
        <div className="md:hidden flex-1 overflow-y-auto bg-white divide-y divide-gray-300 border-b border-gray-400">
           {cart.length === 0 ? (
                <div className="p-10 text-center text-sm font-semibold uppercase tracking-widest text-gray-500">Cart Empty</div>
              ) : (
                cart.map((item) => {
                  const safeQty = item.quantity === '' ? 0 : Number(item.quantity);
                  const sellPrice = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
                  return (
                    <div key={item.id} className="p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div className="pr-2">
                          <p className="text-sm font-semibold text-black">{item.name}</p>
                          <p className="text-xs text-[#0078D7] mt-1 mb-1">#{item.barcode}</p>
                          {activeTab === 'checkout' && (
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                              MRP: ₹{Number(item.price || 0).toFixed(2)} • MSP: ₹{Number(item.msp || 0).toFixed(2)}
                            </p>
                          )}
                        </div>
                        {activeTab === 'checkout' && (<p className="text-base font-bold text-black">₹{(sellPrice * safeQty).toFixed(2)}</p>)}
                      </div>
                      <div className="flex justify-between items-center mt-1 pt-3 border-t border-gray-200">
                        <div className="flex items-center">
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateQuantity(item.id, safeQty - 1)} className="w-10 h-8 bg-[#e6e6e6] active:bg-[#cccccc] text-black font-bold text-lg border border-gray-400 border-r-0 rounded-none">-</button>
                          <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-12 h-8 px-1 text-sm font-semibold text-center border border-gray-400 focus:outline-none focus:border-[#0078D7] z-10 rounded-none" />
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateQuantity(item.id, safeQty + 1)} className="w-10 h-8 bg-[#e6e6e6] active:bg-[#cccccc] text-black font-bold text-lg border border-gray-400 border-l-0 rounded-none">+</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
        </div>

        <div className="p-4 bg-[#f3f3f3] flex flex-col md:flex-row justify-between gap-3">
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => showConfirm("Are you sure you want to clear the items?", () => setCart([]), activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items')} className="w-full md:w-auto h-10 px-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm font-semibold uppercase tracking-wider rounded-none focus:outline-none">{activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items'}</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => activeTab === 'checkout' ? setCheckoutModal({isOpen: true, cashGiven: ''}) : handleCompleteTransaction()} className="w-full md:w-auto h-10 px-10 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold uppercase tracking-wider rounded-none border border-transparent focus:outline-none focus:ring-2 focus:ring-[#0078D7] focus:ring-offset-1 flex justify-center items-center">{isCheckingOut ? 'Saving...' : 'Complete'}</button>
        </div>
      </div>
      <ReceiptTemplate lastReceipt={lastReceipt} shopSettings={shopSettings} formatDateTime={formatDateTime} />
    </>
  );
}