import React, { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; // Import our cloud connection

// Notice we added refreshInventory and sessionLocation to the props
export default function WorkerBilling({ inventory, refreshInventory, sessionLocation }) {
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false); // Tracks if the network request is currently running
  
  const scannerInputRef = useRef(null); 

  useEffect(() => {
    scannerInputRef.current?.focus();
  }, [cart]); 

  const handleBackgroundClick = (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
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
      alert(`Item with barcode ${barcode} not found in inventory!`);
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

  // The massive new cloud checkout function
  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    setIsCheckingOut(true);

    try {
      const total = calculateTotal();

      // 1. Create the Main Bill
      const { data: billData, error: billError } = await supabase
        .from('bills')
        .insert([{ total_amount: total, location: sessionLocation || 'Store' }])
        .select(); // We use select() to get the generated ID back instantly

      if (billError) throw billError;
      const newBill = billData[0];

      // 2. Format the Line Items
      const itemsToInsert = cart.map(item => ({
        bill_id: newBill.id,
        barcode: item.barcode,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        price_at_sale: item.price * (1 - item.discountPct / 100),
        discount_pct: item.discountPct
      }));

      // Insert all items into the bill_items table at once
      const { error: itemsError } = await supabase
        .from('bill_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      // 3. Deduct the Stock from Inventory using Promise.all (Promise.all - a method that takes an array of promises and runs them all concurrently, waiting until every single one is finished before moving on)
      const stockUpdates = cart.map(async (item) => {
        // Find current stock from the inventory prop
        const currentStock = inventory.find(i => i.barcode === item.barcode)?.stock || 0;
        const newStock = currentStock - item.quantity;

        return supabase
          .from('inventory')
          .update({ stock: newStock })
          .eq('barcode', item.barcode);
      });

      await Promise.all(stockUpdates);

      // 4. Success! Clean up the UI.
      alert(`Success! Bill recorded successfully for ₹${total.toFixed(2)}.`);
      setCart([]);
      
      // Tell App.jsx to fetch the newly updated stock numbers
      if (refreshInventory) refreshInventory();

    } catch (error) {
      console.error("Checkout Error:", error.message);
      alert("Failed to complete sale. Please check your network connection.");
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <div className="flex flex-col items-center" onClick={handleBackgroundClick}>
      <div className="w-full max-w-6xl bg-white border border-gray-400 rounded-none shadow-none">
        
        <div className="bg-[#f3f3f3] p-4 text-black flex justify-between items-center border-b border-gray-400">
          <div>
            <h1 className="text-xl font-light">Store Checkout</h1>
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
                <th className="p-3 font-medium border-r border-gray-300 w-16 text-center">S.No</th>
                <th className="p-3 font-medium border-r border-gray-300 w-1/3">Item Name</th>
                <th className="p-3 font-medium border-r border-gray-300 w-20 text-center">Qty</th>
                <th className="p-3 font-medium border-r border-gray-300 w-24">Unit</th>
                <th className="p-3 font-medium border-r border-gray-300 text-right">MRP (₹)</th>
                <th className="p-3 font-medium border-r border-gray-300 w-28 text-center">Discount (%)</th>
                <th className="p-3 font-medium border-r border-gray-300 text-right">Final Price</th>
                <th className="p-3 font-medium text-right bg-[#e6e6e6]">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cart.length === 0 ? (
                <tr><td colSpan="8" className="p-8 text-center text-gray-500 text-sm">No items scanned yet. Start scanning to add to the bill.</td></tr>
              ) : (
                cart.map((item, index) => {
                  const finalPrice = item.price * (1 - item.discountPct / 100);
                  const lineTotal = finalPrice * item.quantity;
                  
                  return (
                    <tr key={item.id} className="hover:bg-[#f0f0f0]">
                      <td className="p-3 border-r border-gray-200 text-sm text-center text-gray-500">{index + 1}</td>
                      <td className="p-3 border-r border-gray-200 text-sm">{item.name} <br/><span className="text-gray-400 text-xs">#{item.barcode}</span></td>
                      <td className="p-3 border-r border-gray-200 text-sm text-center font-medium">{item.quantity}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-gray-600">{item.unit}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-right">{item.price.toFixed(2)}</td>
                      <td className="p-3 border-r border-gray-200">
                        <input type="number" min="0" max="100" value={item.discountPct === 0 ? '' : item.discountPct} onChange={(e) => updateDiscount(item.id, e.target.value)} placeholder="0" className="w-full px-2 py-1 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none text-center" />
                      </td>
                      <td className="p-3 border-r border-gray-200 text-right text-sm">{finalPrice.toFixed(2)}</td>
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
            {/* The button now triggers our async cloud function and disables itself while loading */}
            <button 
              onClick={handleCompleteSale} 
              disabled={isCheckingOut}
              className="px-8 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm transition-colors rounded-none border border-[#005a9e] disabled:opacity-50"
            >
              {isCheckingOut ? 'Processing...' : 'Complete Sale'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}