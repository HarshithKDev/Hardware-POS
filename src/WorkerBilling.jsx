import React, { useState, useRef, useEffect } from 'react';

export default function WorkerBilling({ inventory }) {
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
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
        setCart([...cart, { ...item, id: Date.now(), barcode, discountPct: 0, quantity: 1 }]);
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

  return (
    <div className="flex flex-col items-center" onClick={handleBackgroundClick}>
      <div className="w-full max-w-5xl bg-white border border-gray-400 rounded-none shadow-none">
        
        {/* Windows-style Header Panel */}
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

        {/* Windows-style Datagrid Table */}
        <div className="p-0 overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                <th className="p-3 font-medium border-r border-gray-300 w-1/2">Item Name</th>
                <th className="p-3 font-medium border-r border-gray-300">Rate (₹)</th>
                <th className="p-3 font-medium border-r border-gray-300">Qty</th>
                <th className="p-3 font-medium border-r border-gray-300 w-28">Discount (%)</th>
                <th className="p-3 font-medium text-right">Final Price (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cart.length === 0 ? (
                <tr><td colSpan="5" className="p-8 text-center text-gray-500 text-sm">No items scanned yet. Start scanning to add to the bill.</td></tr>
              ) : (
                cart.map((item) => {
                  const finalPrice = (item.price * (1 - item.discountPct / 100)) * item.quantity;
                  return (
                    // Subtle hover effect like file explorer
                    <tr key={item.id} className="hover:bg-[#f0f0f0]">
                      <td className="p-3 border-r border-gray-200 text-sm">{item.name} <span className="text-gray-400 text-xs ml-2">#{item.barcode}</span></td>
                      <td className="p-3 border-r border-gray-200 text-sm">{item.price.toFixed(2)}</td>
                      <td className="p-3 border-r border-gray-200 text-sm">{item.quantity}</td>
                      <td className="p-3 border-r border-gray-200">
                        <input type="number" min="0" max="100" value={item.discountPct === 0 ? '' : item.discountPct} onChange={(e) => updateDiscount(item.id, e.target.value)} placeholder="0" className="w-full px-2 py-1 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none" />
                      </td>
                      <td className="p-3 text-right text-sm">{finalPrice.toFixed(2)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {cart.length > 0 && (
          <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end">
            <button onClick={() => { alert(`Bill generated successfully for ₹${calculateTotal().toFixed(2)}!`); setCart([]); }} className="px-8 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm transition-colors rounded-none border border-[#005a9e]">
              Complete Sale
            </button>
          </div>
        )}
      </div>
    </div>
  );
}