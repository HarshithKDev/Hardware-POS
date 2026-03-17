import { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function WorkerBilling({ inventory, refreshInventory, defaultTab = 'checkout', hideNav = false, shopSettings, cashierName }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false); 
  const [lastReceipt, setLastReceipt] = useState(null);
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'Notification' });
  const [inventorySearch, setInventorySearch] = useState('');
  
  const [checkoutModal, setCheckoutModal] = useState({ isOpen: false, cashGiven: '' });

  const scannerInputRef = useRef(null); 

  const showAlert = (message, title = 'Notification') => setAlertConfig({ isOpen: true, message, title });
  const closeAlert = () => {
    setAlertConfig({ ...alertConfig, isOpen: false });
    setTimeout(() => scannerInputRef.current?.focus(), 50);
  };

  useEffect(() => { 
    if (!alertConfig.isOpen && !checkoutModal.isOpen && activeTab !== 'inventory') scannerInputRef.current?.focus(); 
  }, [alertConfig.isOpen, checkoutModal.isOpen, activeTab]); 

  const handleBackgroundClick = (e) => {
    if (!alertConfig.isOpen && !checkoutModal.isOpen && activeTab !== 'inventory' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
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
      setCart(prevCart => {
        const existingItemIndex = prevCart.findIndex(cartItem => cartItem.barcode === cleanBarcode);
        if (existingItemIndex >= 0) {
          const updatedCart = [...prevCart];
          updatedCart[existingItemIndex].quantity = (Number(updatedCart[existingItemIndex].quantity) || 1) + 1;
          return updatedCart;
        } else {
          return [...prevCart, { ...item, id: Date.now() + Math.random(), barcode: cleanBarcode, discountPct: 0, quantity: 1, unit: item.unit || 'PCS' }];
        }
      });
      setTimeout(() => scannerInputRef.current?.focus(), 10);
    } else {
      showAlert(`Barcode ${cleanBarcode} not recognized.`, "Invalid Scan");
    }
  };

  const updateQuantity = (id, newQty) => {
    setCart(prevCart => {
      if (newQty === '') return prevCart.map(item => item.id === id ? { ...item, quantity: '' } : item);
      const validQty = Number(newQty);
      if (validQty <= 0) return prevCart.filter(item => item.id !== id);
      return prevCart.map(item => item.id === id ? { ...item, quantity: validQty } : item);
    });
  };

  const updateDiscount = (id, newDiscount) => {
    setCart(prevCart => {
      const validDiscount = Math.min(100, Math.max(0, Number(newDiscount)));
      return prevCart.map(item => item.id === id ? { ...item, discountPct: validDiscount } : item);
    });
  };

  const calculateTotal = () => cart.reduce((total, item) => {
    const qty = item.quantity === '' ? 1 : Number(item.quantity);
    return total + ((item.price * (1 - item.discountPct / 100)) * qty);
  }, 0);

  const initiateCheckoutProcess = () => {
    if (activeTab === 'checkout') {
      setCheckoutModal({ isOpen: true, cashGiven: '' });
    } else {
      handleCompleteTransaction();
    }
  };

  const handleCompleteTransaction = async () => {
    if (cart.length === 0) return;
    if (!navigator.onLine) return showAlert("You are offline.", "Network Error");
    
    setCheckoutModal({ ...checkoutModal, isOpen: false });
    setIsCheckingOut(true);

    try {
      let dbAction = activeTab === 'receive' ? 'RECEIVE' : activeTab === 'transfer' ? 'TRANSFER' : 'SALE';
      let logLocation = activeTab === 'receive' ? 'Warehouse-Inbound' : activeTab === 'transfer' ? 'Warehouse-Transfer' : 'Store';
      let successMsg = activeTab === 'checkout' ? 'Sale complete. Printing receipt...' : 'Inventory updated successfully.';

      const payload = {
        p_action: dbAction,
        p_location: logLocation,
        p_cashier_name: cashierName || 'Unknown',
        p_items: cart.map(item => ({
          barcode: item.barcode,
          name: item.name,
          quantity: item.quantity === '' ? 1 : Number(item.quantity),
          price: item.price,
          discountPct: item.discountPct,
          unit: item.unit
        }))
      };

      const { data, error } = await supabase.rpc('process_pos_transaction', payload);
      if (error) throw new Error(error.message); 

      const total = calculateTotal();

      const receiptCart = cart.map(item => {
        const qty = item.quantity === '' ? 1 : Number(item.quantity);
        const finalRate = item.price * (1 - item.discountPct / 100);
        const lineTotal = finalRate * qty;
        return { ...item, quantity: qty, finalRate, lineTotal };
      });

      setLastReceipt({ 
        id: data.bill_id.split('-')[0], 
        items: receiptCart, 
        total, 
        date: new Date(), 
        type: activeTab,
        cashierName: cashierName || 'Unknown'
      });
      
      setCart([]);
      if (refreshInventory) refreshInventory();
      showAlert(successMsg, "Transaction Complete");
      
      // ONLY print if it is an actual customer sale! Internal moves stay silent.
      if (activeTab === 'checkout') setTimeout(() => { window.print(); }, 100);

    } catch (error) {
      showAlert(`Transaction Failed: ${error.message}`, "Error");
    } finally {
      setIsCheckingOut(false);
    }
  };

  const processedInventory = inventory.filter(item => 
    item.name.toLowerCase().includes(inventorySearch.toLowerCase()) || 
    item.barcode.includes(inventorySearch)
  ).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);

  const cartTotal = calculateTotal();

  return (
    <>
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in print:hidden px-4">
          <div className="bg-white border border-gray-400 w-full max-w-sm rounded-none shadow-[4px_4px_0px_rgba(0,0,0,0.15)]">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between"><span className="text-sm font-semibold">{alertConfig.title}</span><button onClick={closeAlert} className="text-gray-500 hover:text-red-600">×</button></div>
            <div className="p-6"><p className="text-sm">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end"><button onClick={closeAlert} className="px-6 py-1.5 bg-[#0078D7] text-white text-sm rounded-none">OK</button></div>
          </div>
        </div>
      )}

      {checkoutModal.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in print:hidden px-4">
          <div className="bg-white border border-gray-400 w-full max-w-md rounded-none shadow-[4px_4px_0px_rgba(0,0,0,0.15)] overflow-hidden">
            <div className="bg-[#f3f3f3] p-3 border-b border-gray-400 flex justify-between items-center">
              <span className="text-sm font-semibold">Payment Checkout</span>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} className="text-gray-500 hover:text-[#e81123] text-xl leading-none">×</button>
            </div>
            
            <div className="p-6">
              <div className="flex justify-between items-end mb-6 pb-6 border-b border-gray-200">
                <span className="text-gray-600 text-lg">Total Bill:</span>
                <span className="text-3xl font-light text-[#0078D7]">₹{cartTotal.toFixed(2)}</span>
              </div>
              
              <div className="mb-6">
                <label className="block text-sm text-gray-600 mb-2 font-medium">Cash Tendered by Customer (₹)</label>
                <input 
                  type="number" 
                  step="any"
                  autoFocus
                  value={checkoutModal.cashGiven} 
                  onChange={(e) => setCheckoutModal({ ...checkoutModal, cashGiven: e.target.value })} 
                  placeholder="e.g. 500" 
                  className="w-full px-4 py-3 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-2xl font-light rounded-none" 
                />
              </div>

              {Number(checkoutModal.cashGiven) > 0 && (
                <div className={`p-4 mb-2 flex justify-between items-center border ${Number(checkoutModal.cashGiven) >= cartTotal ? 'bg-[#e6f4ea] border-[#107c10] text-[#107c10]' : 'bg-[#fde7e9] border-[#e81123] text-[#e81123]'}`}>
                  <span className="font-semibold">Change to Return:</span>
                  <span className="text-2xl font-bold">
                    ₹{Number(checkoutModal.cashGiven) >= cartTotal ? (Number(checkoutModal.cashGiven) - cartTotal).toFixed(2) : '0.00'}
                  </span>
                </div>
              )}
            </div>

            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end gap-3">
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} className="px-6 py-2 bg-[#e6e6e6] hover:bg-[#cccccc] text-black text-sm border border-gray-400 rounded-none transition-colors">Cancel</button>
              <button onClick={handleCompleteTransaction} className="px-8 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-medium rounded-none transition-colors">Print Receipt</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center print:hidden h-full" onClick={handleBackgroundClick}>
        {!hideNav && (
          <div className="w-full max-w-6xl mb-4 flex flex-wrap gap-2 overflow-x-auto whitespace-nowrap">
            <button onClick={() => { setActiveTab('receive'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'receive' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Receive Inbound</button>
            <button onClick={() => { setActiveTab('transfer'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'transfer' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Move to Store</button>
            <button onClick={() => { setActiveTab('checkout'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'checkout' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Customer Checkout</button>
            <button onClick={() => setActiveTab('inventory')} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Live Inventory</button>
          </div>
        )}

        <div className="w-full max-w-6xl bg-white border border-gray-400 rounded-none shadow-none h-full min-h-125 flex flex-col">
          {activeTab === 'inventory' ? (
            <div className="p-4 md:p-6 animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
                <h1 className="text-2xl font-light text-black">Master Inventory View</h1>
                <input type="text" placeholder="Search item..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="w-full md:w-auto px-3 py-1.5 border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7] rounded-none" />
              </div>
              <div className="border border-gray-400 overflow-x-auto max-h-[60vh]">
                <table className="w-full text-left border-collapse min-w-[500px]">
                  <thead className="sticky top-0 bg-[#e6e6e6]">
                    <tr className="text-black text-xs uppercase border-b border-gray-400">
                      <th className="p-3">Barcode</th>
                      <th className="p-3">Item Name</th>
                      <th className="p-3 text-center">Unit</th>
                      <th className="p-3 text-center">Whse Stock</th>
                      <th className="p-3 text-center">Store Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {processedInventory.map(item => (
                      <tr key={item.id} className="hover:bg-[#f0f0f0]">
                        <td className="p-3 text-sm text-[#0078D7] font-medium">{item.barcode}</td>
                        <td className="p-3 text-sm text-black">{item.name}</td>
                        <td className="p-3 text-sm text-center text-gray-600">{item.unit}</td>
                        <td className={`p-3 text-sm text-center font-bold ${item.stock_warehouse < 10 ? 'text-[#e81123]' : 'text-black'}`}>{item.stock_warehouse || 0}</td>
                        <td className={`p-3 text-sm text-center font-bold ${item.stock_store < 10 ? 'text-[#e81123]' : 'text-black'}`}>{item.stock_store || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="animate-fade-in flex flex-col h-full">
              <div className={`p-4 flex justify-between items-center border-b border-gray-400 ${activeTab === 'receive' ? 'bg-[#e6f4ea]' : activeTab === 'transfer' ? 'bg-[#fff4ce]' : 'bg-[#f3f3f3]'}`}>
                <div>
                  <h1 className="text-lg md:text-xl font-light text-black">
                    {activeTab === 'receive' && 'Receive Wholesaler Shipment'}
                    {activeTab === 'transfer' && 'Transfer Items to Store'}
                    {activeTab === 'checkout' && 'Customer Checkout'}
                  </h1>
                  <p className="text-gray-500 text-xs mt-1 hidden md:block">Ready to scan barcodes...</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 uppercase">Total Value</p>
                  <p className="text-2xl md:text-3xl font-light text-[#0078D7]">₹{cartTotal.toFixed(2)}</p>
                </div>
              </div>

              <form onSubmit={handleScan} className="opacity-0 h-0 w-0 overflow-hidden"><input ref={scannerInputRef} type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} autoFocus /><button type="submit">Scan</button></form>

              <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                      <th className="p-3 border-r border-gray-300 w-1/3">Item Name</th>
                      <th className="p-3 border-r border-gray-300 w-32 text-center">Qty</th>
                      <th className="p-3 border-r border-gray-300 text-right">Unit Price</th>
                      <th className="p-3 border-r border-gray-300 w-28 text-center">Discount (%)</th>
                      <th className="p-3 text-right bg-[#e6e6e6]">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {cart.length === 0 ? (<tr><td colSpan="5" className="p-8 text-center text-gray-500 text-sm">No items scanned.</td></tr>) : (
                      cart.map((item) => {
                        const safeQty = item.quantity === '' ? 1 : Number(item.quantity);
                        return (
                          <tr key={item.id} className="hover:bg-[#f0f0f0]">
                            <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name} <span className="text-gray-400 text-xs block">#{item.barcode}</span></td>
                            <td className="p-3 border-r border-gray-200">
                              <div className="flex items-center justify-center">
                                <button type="button" onClick={() => updateQuantity(item.id, (Number(item.quantity) || 1) - 1)} className="px-2 py-1 bg-[#e6e6e6] hover:bg-[#cccccc] border border-gray-400 border-r-0 text-black font-bold">-</button>
                                <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-16 px-1 py-1 border border-gray-400 text-sm text-center focus:outline-none rounded-none" />
                                <button type="button" onClick={() => updateQuantity(item.id, (Number(item.quantity) || 1) + 1)} className="px-2 py-1 bg-[#e6e6e6] hover:bg-[#cccccc] border border-gray-400 border-l-0 text-black font-bold">+</button>
                              </div>
                            </td>
                            <td className="p-3 border-r border-gray-200 text-sm text-right text-black">{item.price.toFixed(2)}</td>
                            <td className="p-3 border-r border-gray-200"><input type="number" min="0" max="100" value={item.discountPct === 0 ? '' : item.discountPct} onChange={(e) => updateDiscount(item.id, e.target.value)} placeholder="0" className="w-full px-2 py-1 border border-gray-400 text-sm text-center rounded-none" disabled={activeTab !== 'checkout'} /></td>
                            <td className="p-3 text-right text-sm font-semibold text-[#0078D7]">₹{((item.price * (1 - item.discountPct / 100)) * safeQty).toFixed(2)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {cart.length > 0 && (
                <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-between items-center">
                  
                  <button 
                    onClick={() => { if(window.confirm("Are you sure you want to clear the entire cart?")) setCart([]); }} 
                    className="px-6 py-2 bg-transparent text-[#e81123] hover:bg-[#e81123] hover:text-white border border-[#e81123] text-sm font-medium rounded-none transition-colors w-full md:w-auto"
                  >
                    Clear Cart
                  </button>

                  <button 
                    onClick={initiateCheckoutProcess} 
                    disabled={isCheckingOut} 
                    className="px-8 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-medium disabled:opacity-50 rounded-none w-full md:w-auto ml-2"
                  >
                    {isCheckingOut ? 'Processing...' : 'Confirm & Complete'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* ONLY RENDER THERMAL RECEIPT FOR CUSTOMER CHECKOUTS */}
      {lastReceipt && lastReceipt.type === 'checkout' && (
        <div className="hidden print:block text-black font-mono text-xs w-[80mm] mx-auto bg-white p-4">
          
          <div className="text-center mb-3">
            <h1 className="text-xl font-bold uppercase">{shopSettings?.shop_name || 'STORE RECEIPT'}</h1>
            <p className="text-[10px]">Owner: {shopSettings?.owner_name}</p>
          </div>

          <div className="mb-3 text-[10px] flex justify-between border-b border-black border-dashed pb-2">
            <div>
              <p>Bill No: {lastReceipt.id}</p>
              <p>Date: {lastReceipt.date.toLocaleDateString()}</p>
              <p className="capitalize">Cashier: {lastReceipt.cashierName}</p>
            </div>
            <div className="text-right">
              <p>Type: CASH SALE</p>
              <p>Time: {lastReceipt.date.toLocaleTimeString()}</p>
            </div>
          </div>
          
          <table className="w-full mb-3 text-[10px]">
            <thead>
              <tr className="border-b border-black border-dashed">
                <th className="text-left font-semibold pb-1 w-1/2">Item</th>
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
            <span className="font-bold text-sm">TOTAL AMOUNT</span>
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