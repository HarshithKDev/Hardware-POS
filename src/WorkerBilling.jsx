import React, { useState, useRef, useEffect } from 'react';

// Temporary dummy database (Database - an organized collection of structured information or data) for the frontend
const INVENTORY = {
  '1001': { name: 'Brass Door Handle', price: 450 },
  '1002': { name: 'Steel Soap Stand', price: 120 },
  '1003': { name: 'Wood Photo Frame', price: 250 },
  '1004': { name: 'Screws (Pack of 50)', price: 50 },
};

export default function WorkerBilling() {
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
  
  // useRef (useRef - a React Hook that lets you reference a value that’s not needed for rendering)
  const scannerInputRef = useRef(null); 

  // useEffect (useEffect - a React Hook that lets you synchronize a component with an external system or trigger side effects)
  useEffect(() => {
    scannerInputRef.current?.focus();
  }, [cart]); 

  const handleScan = (e) => {
    e.preventDefault(); 
    const item = INVENTORY[barcode];
    
    if (item) {
      setCart([...cart, { ...item, id: Date.now(), barcode, discountPct: 0 }]);
    } else {
      alert(`Item with barcode ${barcode} not found!`);
    }
    setBarcode(''); 
  };

  const updateDiscount = (id, newDiscount) => {
    const validDiscount = Math.min(100, Math.max(0, Number(newDiscount)));
    setCart(cart.map(item => 
      item.id === id ? { ...item, discountPct: validDiscount } : item
    ));
  };

  const calculateTotal = () => {
    return cart.reduce((total, item) => {
      // reduce (reduce - a JavaScript array method that executes a reducer function on each element of the array, resulting in a single output value)
      const finalPrice = item.price * (1 - item.discountPct / 100);
      return total + finalPrice;
    }, 0);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        
        <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Store Checkout</h1>
            <p className="text-slate-300 text-sm mt-1">Ready to scan items...</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-300">Total Amount</p>
            <p className="text-3xl font-bold">₹{calculateTotal().toFixed(2)}</p>
          </div>
        </div>

        {/* Hidden Form for Barcode Scanner */}
        <form onSubmit={handleScan} className="opacity-0 h-0 w-0 overflow-hidden">
          <input
            ref={scannerInputRef}
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onBlur={() => scannerInputRef.current?.focus()} // (onBlur - an event that fires when an element has lost focus)
            autoFocus
          />
          <button type="submit">Scan</button>
        </form>

        <div className="p-0 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 text-sm uppercase tracking-wider border-b border-gray-200">
                <th className="p-4 font-semibold">Item Name</th>
                <th className="p-4 font-semibold">Rate (₹)</th>
                <th className="p-4 font-semibold w-32">Discount (%)</th>
                <th className="p-4 font-semibold text-right">Final Price (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cart.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-8 text-center text-gray-400">
                    No items scanned yet. Start scanning to add to the bill.
                  </td>
                </tr>
              ) : (
                cart.map((item) => {
                  const finalPrice = item.price * (1 - item.discountPct / 100);
                  
                  return (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 font-medium text-gray-800">{item.name} <br/><span className="text-xs text-gray-400 font-normal">#{item.barcode}</span></td>
                      <td className="p-4 text-gray-600">{item.price.toFixed(2)}</td>
                      <td className="p-4">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={item.discountPct === 0 ? '' : item.discountPct}
                          onChange={(e) => updateDiscount(item.id, e.target.value)}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-4 text-right font-semibold text-gray-800">
                        {finalPrice.toFixed(2)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {cart.length > 0 && (
          <div className="p-6 bg-gray-50 border-t border-gray-200">
            <button 
              onClick={() => {
                alert(`Bill generated successfully for ₹${calculateTotal().toFixed(2)}!`);
                setCart([]); 
              }}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-lg font-bold transition-colors shadow-sm"
            >
              Complete Sale & Print Bill
            </button>
          </div>
        )}

      </div>
    </div>
  );
}