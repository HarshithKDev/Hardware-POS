import React, { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function WorkerBilling({ inventory, refreshInventory, defaultTab = 'checkout', hideNav = false }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false); 
  const [lastReceipt, setLastReceipt] = useState(null);
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'Notification' });
  const [inventorySearch, setInventorySearch] = useState('');

  const scannerInputRef = useRef(null); 

  const showAlert = (message, title = 'Notification') => setAlertConfig({ isOpen: true, message, title });
  const closeAlert = () => {
    setAlertConfig({ ...alertConfig, isOpen: false });
    setTimeout(() => scannerInputRef.current?.focus(), 50);
  };

  useEffect(() => { 
    if (!alertConfig.isOpen && activeTab !== 'inventory') scannerInputRef.current?.focus(); 
  }, [alertConfig.isOpen, activeTab]); 

  const handleBackgroundClick = (e) => {
    if (!alertConfig.isOpen && activeTab !== 'inventory' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
      scannerInputRef.current?.focus();
    }
  };

  const handleScan = (e) => {
    e.preventDefault(); 
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return;

    const item = inventory.find(i => i.barcode === cleanBarcode);
    if (item) {
      const existingItemIndex = cart.findIndex(cartItem => cartItem.barcode === cleanBarcode);
      if (existingItemIndex >= 0) {
        const updatedCart = [...cart];
        const currentQty = Number(updatedCart[existingItemIndex].quantity) || 1;
        updatedCart[existingItemIndex].quantity = currentQty + 1;
        setCart(updatedCart);
      } else {
        setCart([...cart, { ...item, id: Date.now(), barcode: cleanBarcode, discountPct: 0, quantity: 1, unit: item.unit || 'PCS' }]);
      }
      setTimeout(() => scannerInputRef.current?.focus(), 10);
    } else {
      showAlert(`Barcode ${cleanBarcode} not recognized.`, "Invalid Scan");
    }
    setBarcode(''); 
  };

  const updateQuantity = (id, newQty) => {
    let validQty;
    if (newQty === '') {
      validQty = '';
    } else {
      validQty = Math.max(1, Number(newQty)); 
    }
    setCart(cart.map(item => item.id === id ? { ...item, quantity: validQty } : item));
  };

  const updateDiscount = (id, newDiscount) => {
    const validDiscount = Math.min(100, Math.max(0, Number(newDiscount)));
    setCart(cart.map(item => item.id === id ? { ...item, discountPct: validDiscount } : item));
  };

  const calculateTotal = () => cart.reduce((total, item) => {
    const qty = item.quantity === '' ? 1 : Number(item.quantity);
    return total + ((item.price * (1 - item.discountPct / 100)) * qty);
  }, 0);

  const handleCompleteTransaction = async () => {
    if (cart.length === 0) return;
    if (!navigator.onLine) return showAlert("You are offline.", "Network Error");

    try {
      for (const item of cart) {
        const safeQty = item.quantity === '' ? 1 : Number(item.quantity);
        if (safeQty <= 0) throw new Error(`Invalid quantity for ${item.name}`);

        const dbItem = inventory.find(i => i.barcode === item.barcode);
        if (!dbItem) throw new Error(`Item ${item.name} not found in local database.`);

        if (activeTab === 'transfer' && dbItem.stock_warehouse < safeQty) {
          throw new Error(`Insufficient warehouse stock for: ${item.name}. Have ${dbItem.stock_warehouse}, need ${safeQty}.`);
        }
        if (activeTab === 'checkout' && dbItem.stock_store < safeQty) {
          throw new Error(`Insufficient store stock for: ${item.name}. Have ${dbItem.stock_store}, need ${safeQty}.`);
        }
      }
    } catch (preFlightError) {
      return showAlert(preFlightError.message, "Stock Error");
    }

    setIsCheckingOut(true);
    try {
      let dbAction = '';
      let logLocation = '';
      let successMsg = '';

      if (activeTab === 'receive') {
        dbAction = 'RECEIVE';
        logLocation = 'Warehouse-Inbound';
        successMsg = 'Shipment received into warehouse.';
      } else if (activeTab === 'transfer') {
        dbAction = 'TRANSFER';
        logLocation = 'Warehouse-Transfer';
        successMsg = 'Items transferred to store shelves.';
      } else if (activeTab === 'checkout') {
        dbAction = 'SALE';
        logLocation = 'Store';
        successMsg = 'Sale complete. Printing receipt...';
      }

      for (const item of cart) {
        const safeQty = item.quantity === '' ? 1 : Number(item.quantity);
        const { data: success, error: rpcError } = await supabase.rpc('handle_inventory_action', { 
          p_action: dbAction,
          p_barcode: item.barcode, 
          p_quantity: safeQty
        });
        
        if (rpcError) throw rpcError;
        if (!success) throw new Error(`Database rejected deduction for: ${item.name}`);
      }

      const total = calculateTotal();
      const { data: billData, error: billError } = await supabase.from('bills').insert([{ total_amount: total, location: logLocation }]).select(); 
      if (billError) throw billError;
      
      const newBill = billData[0];
      const itemsToInsert = cart.map(item => ({
        bill_id: newBill.id, 
        barcode: item.barcode, 
        name: item.name, 
        quantity: item.quantity === '' ? 1 : Number(item.quantity),
        unit: item.unit, 
        price_at_sale: item.price * (1 - item.discountPct / 100), 
        discount_pct: item.discountPct
      }));

      const { error: itemsError } = await supabase.from('bill_items').insert(itemsToInsert);
      if (itemsError) throw itemsError;

      const receiptCart = cart.map(item => ({ ...item, quantity: item.quantity === '' ? 1 : Number(item.quantity) }));
      setLastReceipt({ id: newBill.id.split('-')[0], items: receiptCart, total, date: new Date(), type: activeTab });
      
      setCart([]);
      if (refreshInventory) refreshInventory();

      showAlert(successMsg, "Transaction Complete");
      
      if (activeTab === 'checkout' || activeTab === 'transfer') {
        setTimeout(() => { window.print(); }, 100);
      }

    } catch (error) {
      showAlert(`Failed: ${error.message}`, "Error");
    } finally {
      setIsCheckingOut(false);
    }
  };

  const processedInventory = inventory.filter(item => 
    item.name.toLowerCase().includes(inventorySearch.toLowerCase()) || 
    item.barcode.includes(inventorySearch)
  ).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in print:hidden">
          <div className="bg-white border border-gray-400 w-96 rounded-none shadow-[4px_4px_0px_rgba(0,0,0,0.15)]">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between"><span className="text-sm font-semibold">{alertConfig.title}</span><button onClick={closeAlert} className="text-gray-500 hover:text-red-600">×</button></div>
            <div className="p-6"><p className="text-sm">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end"><button onClick={closeAlert} className="px-6 py-1.5 bg-[#0078D7] text-white text-sm rounded-none">OK</button></div>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center print:hidden h-full" onClick={handleBackgroundClick}>
        
        {!hideNav && (
          <div className="w-full max-w-6xl mb-4 flex flex-wrap gap-2">
            <button onClick={() => { setActiveTab('receive'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'receive' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Receive Inbound</button>
            <button onClick={() => { setActiveTab('transfer'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'transfer' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Move to Store</button>
            <button onClick={() => { setActiveTab('checkout'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'checkout' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Customer Checkout</button>
            <button onClick={() => setActiveTab('inventory')} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Live Inventory</button>
          </div>
        )}

        <div className="w-full max-w-6xl bg-white border border-gray-400 rounded-none shadow-none h-full min-h-[500px]">
          {activeTab === 'inventory' ? (
            <div className="p-6 animate-fade-in">
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-light text-black">Master Inventory View</h1>
                <input type="text" placeholder="Search item..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="px-3 py-1.5 border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7] rounded-none" />
              </div>
              <div className="border border-gray-400 overflow-y-auto max-h-[600px]">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#e6e6e6]">
                    <tr className="text-black text-xs uppercase border-b border-gray-400">
                      <th className="p-3">Barcode</th>
                      <th className="p-3">Item Name</th>
                      <th className="p-3 text-center">Unit</th>
                      <th className="p-3 text-center bg-[#fff4ce]">Whse Stock</th>
                      <th className="p-3 text-center bg-[#e6f4ea]">Store Stock</th>
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
                  <h1 className="text-xl font-light text-black">
                    {activeTab === 'receive' && 'Receive Wholesaler Shipment'}
                    {activeTab === 'transfer' && 'Transfer Items to Store'}
                    {activeTab === 'checkout' && 'Customer Checkout'}
                  </h1>
                  <p className="text-gray-500 text-xs mt-1">Ready to scan barcodes...</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 uppercase">Total Value</p>
                  <p className="text-3xl font-light text-[#0078D7]">₹{calculateTotal().toFixed(2)}</p>
                </div>
              </div>

              <form onSubmit={handleScan} className="opacity-0 h-0 w-0 overflow-hidden"><input ref={scannerInputRef} type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} autoFocus /><button type="submit">Scan</button></form>

              <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                      <th className="p-3 border-r border-gray-300 w-1/3">Item Name</th>
                      <th className="p-3 border-r border-gray-300 w-24 text-center">Qty</th>
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
                            <td className="p-3 border-r border-gray-200"><input type="number" min="1" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-full px-2 py-1 border border-gray-400 text-sm text-center rounded-none" /></td>
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
                <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end">
                  <button onClick={handleCompleteTransaction} disabled={isCheckingOut} className="px-8 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm disabled:opacity-50 rounded-none transition-colors">
                    {isCheckingOut ? 'Processing...' : 'Confirm & Complete'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* --- PROFESSIONAL THERMAL PRINTER RECEIPT --- */}
      {lastReceipt && (lastReceipt.type === 'checkout' || lastReceipt.type === 'transfer') && (
        <div className="hidden print:block text-black font-mono text-xs w-[80mm] mx-auto bg-white p-4">
          
          <div className="text-center mb-3">
            <h1 className="text-xl font-bold uppercase">{lastReceipt.type === 'transfer' ? 'INTERNAL TRANSFER' : 'HARDWARE STORE'}</h1>
            {lastReceipt.type === 'checkout' && <p className="text-[10px]">Your Trusted Hardware Partner</p>}
          </div>

          <div className="mb-3 text-[10px] flex justify-between border-b border-black border-dashed pb-2">
            <div>
              <p>Bill No: {lastReceipt.id}</p>
              <p>Date: {lastReceipt.date.toLocaleDateString()}</p>
            </div>
            <div className="text-right">
              <p>Type: {lastReceipt.type === 'transfer' ? 'TRANSFER' : 'CASH SALE'}</p>
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
              {lastReceipt.items.map((item, i) => {
                const finalRate = item.price * (1 - item.discountPct / 100);
                const lineTotal = finalRate * item.quantity;
                return (
                  <tr key={i}>
                    <td className="py-1 pr-1 break-words">
                      {item.name}
                      {item.discountPct > 0 && <span className="block text-[8px] text-gray-600">(-{item.discountPct}%)</span>}
                    </td>
                    <td className="py-1 text-center">{item.quantity} {item.unit}</td>
                    <td className="py-1 text-right">{finalRate.toFixed(2)}</td>
                    <td className="py-1 text-right">{lineTotal.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          
          <div className="border-t border-black border-dashed pt-2 flex justify-between items-center mb-4">
            <span className="font-bold text-sm">TOTAL AMOUNT</span>
            <span className="font-bold text-lg">₹{lastReceipt.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>

          {lastReceipt.type === 'checkout' && (
            <div className="text-center text-[10px] border-t border-black border-dashed pt-2 mt-2">
              <p>Thank You For Your Business!</p>
              <p>Goods once sold will not be taken back.</p>
            </div>
          )}

        </div>
      )}
    </>
  );
}