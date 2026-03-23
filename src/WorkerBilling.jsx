import { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import { Spinner } from './App'; 

export default function WorkerBilling({ inventory, refreshInventory, defaultTab = 'checkout', hideNav = false, shopSettings, cashierName }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false); 
  const [lastReceipt, setLastReceipt] = useState(null);
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'Notice' });
  const [checkoutModal, setCheckoutModal] = useState({ isOpen: false, cashGiven: '' });
  const scannerInputRef = useRef(null); 

  const showAlert = (message, title = 'Notice') => setAlertConfig({ isOpen: true, message, title });
  const closeAlert = () => { setAlertConfig({ ...alertConfig, isOpen: false }); setTimeout(() => scannerInputRef.current?.focus(), 50); };

  useEffect(() => { if (!alertConfig.isOpen && !checkoutModal.isOpen) scannerInputRef.current?.focus(); }, [alertConfig.isOpen, checkoutModal.isOpen, activeTab]); 
  
  const handleBackgroundClick = (e) => { 
    if (!alertConfig.isOpen && !checkoutModal.isOpen && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') {
      scannerInputRef.current?.focus(); 
    }
  };

  const handleScan = async (e) => {
    e.preventDefault(); 
    const cleanBarcode = barcode.trim(); 
    setBarcode(''); 
    if (!cleanBarcode) return;

    let item = inventory.find(i => i.barcode === cleanBarcode);
    if (!item) {
      const { data } = await supabase.from('inventory').select('*').eq('barcode', cleanBarcode).single();
      if (data && data.is_active !== false) item = data;
    }

    if (item) {
      setCart(prev => {
        const idx = prev.findIndex(c => c.barcode === cleanBarcode);
        if (idx >= 0) { 
          const up = [...prev]; 
          up[idx].quantity = (Number(up[idx].quantity) || 1) + 1; 
          return up; 
        }
        return [...prev, { ...item, id: Date.now(), discountPct: 0, quantity: 1, unit: item.unit || 'PCS' }];
      });
      setTimeout(() => scannerInputRef.current?.focus(), 10);
    } else {
      showAlert(`SKU code ${cleanBarcode} not found in catalog.`, "Validation Error");
    }
  };

  const updateQuantity = (id, val) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: val === '' ? '' : Math.max(0, Number(val)) } : i).filter(i => i.quantity !== 0));
  };

  const updateDiscount = (id, val) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, discountPct: Math.min(100, Math.max(0, Number(val))) } : i));
  };

  const calculateTotal = () => cart.reduce((tot, i) => tot + ((i.price * (1 - i.discountPct / 100)) * (i.quantity === '' ? 1 : Number(i.quantity))), 0);

  const handleCompleteTransaction = async () => {
    if (cart.length === 0) return;
    setIsCheckingOut(true);
    try {
      const payload = {
        p_action: activeTab === 'receive' ? 'RECEIVE' : activeTab === 'transfer' ? 'TRANSFER' : 'SALE',
        p_location: activeTab === 'receive' ? 'Warehouse-Inbound' : activeTab === 'transfer' ? 'Warehouse-Transfer' : 'Store',
        p_cashier_name: cashierName || 'Sys',
        p_items: cart.map(i => ({ 
          barcode: i.barcode, 
          name: i.name, 
          quantity: i.quantity === '' ? 1 : Number(i.quantity), 
          price: i.price, 
          discountPct: i.discountPct, 
          unit: i.unit 
        }))
      };

      const { data, error } = await supabase.rpc('process_pos_transaction', payload);
      if (error) throw new Error(error.message); 

      setLastReceipt({ 
        id: data.bill_id.split('-')[0], 
        items: cart.map(i => ({
          ...i, 
          quantity: i.quantity === '' ? 1 : Number(i.quantity), 
          finalRate: i.price * (1 - i.discountPct / 100), 
          lineTotal: (i.price * (1 - i.discountPct / 100)) * (i.quantity === '' ? 1 : Number(i.quantity))
        })), 
        total: calculateTotal(), 
        date: new Date(), 
        type: activeTab, 
        cashierName: cashierName || 'Sys' 
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

  return (
    <>
      {/* WINDOWS 10 ALERT MODAL */}
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] print:hidden px-4">
          <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold text-black">{alertConfig.title}</span>
              <button onClick={closeAlert} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm text-black">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
              <button onClick={closeAlert} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* WINDOWS 10 CHECKOUT MODAL */}
      {checkoutModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] print:hidden px-4">
          <div className="bg-white border border-gray-400 w-[450px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col">
            <div className="bg-[#0078D7] flex justify-between items-center pr-1 pl-4 py-1 border-b border-[#005a9e]">
              <span className="text-xs font-semibold text-white">Payment Terminal</span>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} className="text-white hover:bg-[#e81123] px-3 py-1.5 leading-none transition-none focus:outline-none">✕</button>
            </div>
            <div className="p-6 bg-white">
              <div className="flex justify-between items-end mb-6 pb-4 border-b border-gray-300">
                <span className="text-xs font-semibold uppercase text-gray-500">Gross Due</span>
                <span className="text-4xl font-light text-black">₹{cartTotal.toFixed(2)}</span>
              </div>
              
              <div className="mb-6">
                <label className="block text-xs font-semibold uppercase text-gray-700 mb-2">Tender Amount (₹)</label>
                <input type="number" step="any" autoFocus value={checkoutModal.cashGiven} onChange={(e) => setCheckoutModal({ ...checkoutModal, cashGiven: e.target.value })} placeholder="0.00" className="w-full px-4 py-3 border-2 border-gray-300 bg-white text-2xl font-mono focus:outline-none focus:border-[#0078D7]" />
              </div>
              
              {Number(checkoutModal.cashGiven) > 0 && (
                <div className={`p-4 border ${Number(checkoutModal.cashGiven) >= cartTotal ? 'bg-[#e6f4ea] border-[#107c10]' : 'bg-[#fde7e9] border-[#e81123]'}`}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold uppercase">Change Due</span>
                    <span className="text-2xl font-light text-black">₹{Number(checkoutModal.cashGiven) >= cartTotal ? (Number(checkoutModal.cashGiven) - cartTotal).toFixed(2) : '0.00'}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={handleCompleteTransaction} disabled={isCheckingOut} className="px-8 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50 flex justify-center items-center min-w-[120px]">
                {isCheckingOut ? <Spinner className="w-4 h-4 text-white" /> : 'Execute'}
              </button>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} disabled={isCheckingOut} className="px-8 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7] disabled:opacity-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN BILLING INTERFACE */}
      <div className="flex flex-col h-full w-full print:hidden font-sans" onClick={handleBackgroundClick}>
        
        {!hideNav && (
          <div className="flex gap-1 mb-6 border-b border-gray-300 pb-2">
            <button onClick={() => { setActiveTab('receive'); setCart([]); }} className={`px-6 py-1.5 text-sm focus:outline-none ${activeTab === 'receive' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700'}`}>Inbound</button>
            <button onClick={() => { setActiveTab('transfer'); setCart([]); }} className={`px-6 py-1.5 text-sm focus:outline-none ${activeTab === 'transfer' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700'}`}>Transfer</button>
            <button onClick={() => { setActiveTab('checkout'); setCart([]); }} className={`px-6 py-1.5 text-sm focus:outline-none ${activeTab === 'checkout' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700'}`}>Terminal</button>
          </div>
        )}

        <div className="flex flex-col flex-1 border border-gray-300 bg-white">
          <div className={`p-4 border-b border-gray-300 flex flex-col md:flex-row justify-between md:items-center gap-4 ${activeTab === 'receive' ? 'bg-[#f4fbf5]' : activeTab === 'transfer' ? 'bg-[#fffaf0]' : 'bg-[#f9f9f9]'}`}>
            <div>
              <h2 className="text-xl font-light text-black">
                {activeTab === 'receive' && 'Inbound Stock Entry'}
                {activeTab === 'transfer' && 'Internal Inventory Move'}
                {activeTab === 'checkout' && 'Point of Sale Terminal'}
              </h2>
            </div>
            <div className="text-left md:text-right border-t border-gray-300 pt-2 md:border-0 md:pt-0">
              <span className="text-xs font-semibold uppercase text-gray-500 block mb-1">Gross Total</span>
              <span className="text-3xl font-light text-[#0078D7]">₹{cartTotal.toFixed(2)}</span>
            </div>
          </div>

          <form onSubmit={handleScan} className="opacity-0 h-0 w-0 overflow-hidden absolute">
            <input ref={scannerInputRef} type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} autoFocus />
            <button type="submit">Scan</button>
          </form>

          {/* DESKTOP TABLE */}
          <div className="hidden md:block flex-1 overflow-y-auto bg-white">
            {cart.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm font-semibold uppercase text-gray-500">System Ready. Awaiting Input.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-300">
                  <tr className="text-xs font-semibold uppercase text-gray-600">
                    <th className="p-3 border-r border-gray-300 w-1/3">Nomenclature</th>
                    <th className="p-3 border-r border-gray-300 text-center w-36">Quantity</th>
                    <th className="p-3 border-r border-gray-300 text-right w-32">Unit Rate</th>
                    <th className="p-3 border-r border-gray-300 text-center w-28">Disc (%)</th>
                    <th className="p-3 text-right w-32">Line Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {cart.map(item => {
                    const safeQty = item.quantity === '' ? 1 : Number(item.quantity);
                    return (
                      <tr key={item.id} className="hover:bg-[#f9f9f9]">
                        <td className="p-3 border-r border-gray-200">
                          <p className="text-sm font-semibold text-black">{item.name}</p>
                          <p className="text-xs text-[#0078D7] font-mono mt-0.5">#{item.barcode}</p>
                        </td>
                        <td className="p-2 border-r border-gray-200">
                          <div className="flex items-center justify-center">
                            <button type="button" onClick={() => updateQuantity(item.id, (Number(item.quantity) || 1) - 1)} className="w-8 h-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black font-bold focus:outline-none border border-gray-400 border-r-0">-</button>
                            <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-12 h-8 px-1 text-sm font-semibold text-center border-y border-gray-400 focus:outline-none focus:border focus:border-[#0078D7] z-10" />
                            <button type="button" onClick={() => updateQuantity(item.id, (Number(item.quantity) || 1) + 1)} className="w-8 h-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black font-bold focus:outline-none border border-gray-400 border-l-0">+</button>
                          </div>
                        </td>
                        <td className="p-3 border-r border-gray-200 text-right text-sm text-black">
                          {item.price.toFixed(2)}
                        </td>
                        <td className="p-2 border-r border-gray-200">
                          <input type="number" min="0" max="100" value={item.discountPct === 0 ? '' : item.discountPct} onChange={(e) => updateDiscount(item.id, e.target.value)} placeholder="0" className="w-full h-8 px-2 border-2 border-gray-300 text-sm text-center focus:outline-none focus:border-[#0078D7]" disabled={activeTab !== 'checkout'} />
                        </td>
                        <td className="p-3 text-right text-sm font-bold text-black">
                          ₹{((item.price * (1 - item.discountPct / 100)) * safeQty).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* MOBILE CARDS */}
          <div className="md:hidden flex-1 overflow-y-auto bg-white divide-y divide-gray-300">
            {cart.length === 0 ? (
              <div className="p-10 text-center text-sm font-semibold uppercase text-gray-500">Awaiting Input</div>
            ) : (
              cart.map((item) => {
                const safeQty = item.quantity === '' ? 1 : Number(item.quantity);
                return (
                  <div key={item.id} className="p-4 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div className="pr-2">
                        <p className="text-sm font-semibold text-black">{item.name}</p>
                        <p className="text-xs text-[#0078D7] font-mono mt-1">#{item.barcode} • ₹{item.price.toFixed(2)}/ea</p>
                      </div>
                      <p className="text-base font-bold text-black">₹{((item.price * (1 - item.discountPct / 100)) * safeQty).toFixed(2)}</p>
                    </div>
                    <div className="flex justify-between items-center mt-1 pt-3 border-t border-gray-200">
                      <div className="flex items-center">
                        <button type="button" onClick={() => updateQuantity(item.id, (Number(item.quantity) || 1) - 1)} className="w-10 h-8 bg-[#e6e6e6] active:bg-[#cccccc] text-black font-bold text-lg focus:outline-none border border-gray-400 border-r-0">-</button>
                        <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-12 h-8 px-1 text-sm font-semibold text-center border-y border-gray-400 focus:outline-none focus:border focus:border-[#0078D7] z-10" />
                        <button type="button" onClick={() => updateQuantity(item.id, (Number(item.quantity) || 1) + 1)} className="w-10 h-8 bg-[#e6e6e6] active:bg-[#cccccc] text-black font-bold text-lg focus:outline-none border border-gray-400 border-l-0">+</button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-gray-600 uppercase">Disc:</span>
                        <div className="relative">
                          <input type="number" min="0" max="100" value={item.discountPct === 0 ? '' : item.discountPct} onChange={(e) => updateDiscount(item.id, e.target.value)} placeholder="0" className="w-14 h-8 px-1 border-2 border-gray-300 bg-white text-sm font-semibold text-center focus:outline-none focus:border-[#0078D7]" disabled={activeTab !== 'checkout'} />
                          <span className="absolute right-1 top-1.5 text-gray-400 text-xs">%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* BOTTOM ACTION BAR */}
          {cart.length > 0 && (
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex flex-col md:flex-row justify-between gap-3">
              <button onClick={() => { if(window.confirm("Void current transaction?")) setCart([]); }} className="w-full md:w-auto px-8 py-2 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7]">
                Void Trans
              </button>
              <button onClick={() => activeTab === 'checkout' ? setCheckoutModal({isOpen: true, cashGiven: ''}) : handleCompleteTransaction()} className="w-full md:w-auto px-10 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black flex justify-center items-center">
                {isCheckingOut ? 'Processing' : 'Execute'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* THERMAL PRINTER TEMPLATE */}
      {lastReceipt && lastReceipt.type === 'checkout' && (
        <div className="hidden print:block text-black font-mono text-xs w-[80mm] mx-auto bg-white p-4">
          <div className="text-center mb-3">
            <h1 className="text-xl font-bold uppercase">{shopSettings?.shop_name || 'STORE RECEIPT'}</h1>
            <p className="text-[10px]">Owner: {shopSettings?.owner_name}</p>
          </div>
          <div className="mb-3 text-[10px] flex justify-between border-b border-black border-dashed pb-2">
            <div>
              <p>Txn ID: {lastReceipt.id}</p>
              <p>Date: {lastReceipt.date.toLocaleDateString()}</p>
              <p className="capitalize">Op: {lastReceipt.cashierName}</p>
            </div>
            <div className="text-right">
              <p>Type: POS SALE</p>
              <p>Time: {lastReceipt.date.toLocaleTimeString()}</p>
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
                    {item.discountPct > 0 && <span className="block text-[8px] text-gray-600">(-{item.discountPct}%)</span>}
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
        </div>
      )}
    </>
  );
}