import React, { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function WorkerBilling({ inventory, refreshInventory, sessionLocation }) {
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false); 
  
  const [lastReceipt, setLastReceipt] = useState(null);
  
  // --- NEW: CUSTOM ALERT MODAL STATE ---
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'Notification' });
  const scannerInputRef = useRef(null); 

  const showAlert = (message, title = 'Notification') => {
    setAlertConfig({ isOpen: true, message, title });
  };

  // Close alert and instantly focus back on the scanner
  const closeAlert = () => {
    setAlertConfig({ ...alertConfig, isOpen: false });
    setTimeout(() => scannerInputRef.current?.focus(), 50);
  };

  useEffect(() => {
    // Only auto-focus if the alert modal is NOT open
    if (!alertConfig.isOpen) scannerInputRef.current?.focus();
  }, [cart, alertConfig.isOpen]); 

  const handleBackgroundClick = (e) => {
    if (!alertConfig.isOpen && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
      scannerInputRef.current?.focus();
    }
  };

  const handleScan = (e) => {
    e.preventDefault(); 
    const item = inventory.find(i => i.barcode === barcode);
    if (item) {
      const existingItemIndex = cart.findIndex(cartItem => cartItem.barcode === barcode);
      if (existingItemIndex >= 0) {
        const updatedCart = [...cart];
        updatedCart[existingItemIndex].quantity += 1;
        setCart(updatedCart);
      } else {
        setCart([...cart, { ...item, id: Date.now(), barcode, discountPct: 0, quantity: 1, unit: item.unit || 'PCS' }]);
      }
    } else {
      // Replaced browser alert
      showAlert(`Item with barcode ${barcode} not found in database!`, "Invalid Scan");
    }
    setBarcode(''); 
  };

  const updateDiscount = (id, newDiscount) => {
    const validDiscount = Math.min(100, Math.max(0, Number(newDiscount)));
    setCart(cart.map(item => item.id === id ? { ...item, discountPct: validDiscount } : item));
  };

  const calculateTotal = () => {
    return cart.reduce((total, item) => {
      const finalPricePerItem = item.price * (1 - item.discountPct / 100);
      return total + (finalPricePerItem * item.quantity);
    }, 0);
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    if (!navigator.onLine) return showAlert("You are offline. Please check your network connection.", "Network Error");

    setIsCheckingOut(true);
    try {
      for (const item of cart) {
        const { data: success, error: rpcError } = await supabase.rpc('decrement_stock', { p_barcode: item.barcode, p_quantity: item.quantity });
        if (rpcError) throw rpcError;
        if (!success) throw new Error(`Insufficient stock for ${item.name}!`);
      }

      const total = calculateTotal();
      const { data: billData, error: billError } = await supabase.from('bills').insert([{ total_amount: total, location: sessionLocation || 'Store' }]).select(); 
      if (billError) throw billError;
      
      const newBill = billData[0];
      const itemsToInsert = cart.map(item => ({
        bill_id: newBill.id,
        barcode: item.barcode,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        price_at_sale: item.price * (1 - item.discountPct / 100),
        discount_pct: item.discountPct
      }));

      const { error: itemsError } = await supabase.from('bill_items').insert(itemsToInsert);
      if (itemsError) throw itemsError;

      setLastReceipt({
        id: newBill.id.split('-')[0],
        items: [...cart],
        total: total,
        date: new Date(),
        location: sessionLocation
      });

      setCart([]);
      if (refreshInventory) refreshInventory();

      // Show success modal, then trigger printer
      showAlert(`Success! Bill recorded securely for ₹${total.toFixed(2)}.`, "Sale Complete");
      setTimeout(() => {
        window.print();
      }, 100);

    } catch (error) {
      console.error("Checkout Error:", error.message);
      showAlert(`Checkout Failed: ${error.message}`, "Transaction Error");
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <>
      {/* --- CUSTOM ALERT MODAL --- */}
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in print:hidden">
          <div className="bg-white border border-gray-400 w-96 shadow-[4px_4px_0px_rgba(0,0,0,0.15)] rounded-none">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between items-center">
              <span className="text-sm font-semibold text-black px-1">{alertConfig.title}</span>
              <button onClick={closeAlert} className="text-gray-500 hover:text-[#e81123] text-lg leading-none px-2 transition-colors">×</button>
            </div>
            <div className="p-6">
              <p className="text-sm text-black">{alertConfig.message}</p>
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end">
              <button onClick={closeAlert} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm transition-colors rounded-none border border-[#005a9e]">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* --- THE VISIBLE POS SCREEN --- */}
      <div className="flex flex-col items-center print:hidden" onClick={handleBackgroundClick}>
        <div className="w-full max-w-6xl bg-white border border-gray-400 rounded-none shadow-none">
          <div className="bg-[#f3f3f3] p-4 flex justify-between items-center border-b border-gray-400">
            <div>
              <h1 className="text-xl font-light text-black">Store Checkout</h1>
              <p className="text-gray-500 text-xs mt-1">Ready to scan items...</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase">Total Amount</p>
              <p className="text-3xl font-light text-[#0078D7]">₹{calculateTotal().toFixed(2)}</p>
            </div>
          </div>

          <form onSubmit={handleScan} className="opacity-0 h-0 w-0 overflow-hidden">
            <input ref={scannerInputRef} type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} autoFocus />
            <button type="submit">Scan</button>
          </form>

          <div className="p-0 overflow-x-auto min-h-[400px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                  <th className="p-3 border-r border-gray-300 w-1/3">Item Name</th>
                  <th className="p-3 border-r border-gray-300 w-20 text-center">Qty</th>
                  <th className="p-3 border-r border-gray-300 w-24">Unit</th>
                  <th className="p-3 border-r border-gray-300 text-right">MRP (₹)</th>
                  <th className="p-3 border-r border-gray-300 w-28 text-center">Discount (%)</th>
                  <th className="p-3 text-right bg-[#e6e6e6]">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {cart.length === 0 ? (<tr><td colSpan="6" className="p-8 text-center text-gray-500 text-sm">No items scanned.</td></tr>) : (
                  cart.map((item) => {
                    const lineTotal = (item.price * (1 - item.discountPct / 100)) * item.quantity;
                    return (
                      <tr key={item.id} className="hover:bg-[#f0f0f0]">
                        <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name} <br/><span className="text-gray-400 text-xs">#{item.barcode}</span></td>
                        <td className="p-3 border-r border-gray-200 text-sm text-center text-black font-medium">{item.quantity}</td>
                        <td className="p-3 border-r border-gray-200 text-sm text-gray-600">{item.unit}</td>
                        <td className="p-3 border-r border-gray-200 text-sm text-right text-black">{item.price.toFixed(2)}</td>
                        <td className="p-3 border-r border-gray-200">
                          <input type="number" min="0" max="100" value={item.discountPct === 0 ? '' : item.discountPct} onChange={(e) => updateDiscount(item.id, e.target.value)} placeholder="0" className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none text-center text-black" />
                        </td>
                        <td className="p-3 text-right text-sm font-semibold text-[#0078D7] bg-[#fafafa]">{lineTotal.toFixed(2)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {cart.length > 0 && (
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end">
              <button onClick={handleCompleteSale} disabled={isCheckingOut} className="px-8 py-2 bg-[#0078D7] hover:bg-[#005a9e] transition-colors text-white text-sm rounded-none disabled:opacity-50">
                {isCheckingOut ? 'Processing...' : 'Complete Sale & Print'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* --- THE HIDDEN THERMAL RECEIPT --- */}
      {lastReceipt && (
        <div className="hidden print:block text-black font-mono text-xs w-[80mm] mx-auto bg-white p-2">
          <div className="text-center mb-4">
            <h1 className="text-lg font-bold">Hardware Store POS</h1>
            <p>Location: {lastReceipt.location}</p>
            <p>Receipt #: {lastReceipt.id}</p>
            <p>{lastReceipt.date.toLocaleString()}</p>
            <p className="mt-2 border-b border-black border-dashed"></p>
          </div>
          
          <table className="w-full mb-4">
            <thead>
              <tr className="border-b border-black border-dashed">
                <th className="text-left font-normal pb-1">Item</th>
                <th className="text-center font-normal pb-1">Qty</th>
                <th className="text-right font-normal pb-1">Amt</th>
              </tr>
            </thead>
            <tbody>
              {lastReceipt.items.map((item, i) => {
                const finalPrice = item.price * (1 - item.discountPct / 100);
                const lineTotal = finalPrice * item.quantity;
                return (
                  <tr key={i}>
                    <td className="py-1 pr-2 truncate max-w-[40mm]">
                      {item.name}
                      {item.discountPct > 0 && <span className="block text-[10px]">- {item.discountPct}% OFF</span>}
                    </td>
                    <td className="py-1 text-center align-top">{item.quantity}</td>
                    <td className="py-1 text-right align-top">{lineTotal.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          
          <div className="border-t border-black border-dashed pt-2">
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL:</span>
              <span>₹{lastReceipt.total.toFixed(2)}</span>
            </div>
          </div>
          
          <div className="text-center mt-6 text-[10px]">
            <p>Thank you for your business!</p>
            <p>Please retain receipt for returns.</p>
          </div>
        </div>
      )}
    </>
  );
}