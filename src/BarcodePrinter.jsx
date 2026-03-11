import React, { useState } from 'react';
import Barcode from 'react-barcode';

// Using our standard hardware shop inventory
const INVENTORY = [
  { barcode: '1001', name: 'Brass Door Handle', price: 450 },
  { barcode: '1002', name: 'Steel Soap Stand', price: 120 },
  { barcode: '1003', name: 'Ceramic Mug', price: 150 },
  { barcode: '1004', name: 'Screws (Pack of 50)', price: 50 },
];

export default function BarcodePrinter() {
  const [selectedItem, setSelectedItem] = useState(INVENTORY[0]);
  const [copies, setCopies] = useState(12); // Default to printing 12 stickers

  const handlePrint = () => {
    window.print(); // (window.print() - a built-in browser command that automatically opens the print dialog box)
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      
      {/* Settings Panel - This gets hidden during actual printing */}
      <div className="max-w-4xl mx-auto bg-white p-6 rounded-xl shadow-md border border-gray-200 mb-8 print:hidden">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Print Barcode Labels</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-2">Select Item</label>
            <select 
              className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              onChange={(e) => setSelectedItem(INVENTORY.find(item => item.barcode === e.target.value))}
            >
              {INVENTORY.map((item) => (
                <option key={item.barcode} value={item.barcode}>
                  {item.name} - #{item.barcode}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-gray-600 mb-2">Number of Copies</label>
            <input 
              type="number" 
              min="1"
              max="100"
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <button 
            onClick={handlePrint}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded transition-colors h-[42px]"
          >
            Print Stickers
          </button>
        </div>
      </div>

      {/* Printable Area - This is what actually goes to the printer */}
      <div className="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-md print:shadow-none print:p-0">
        <div className="grid grid-cols-3 md:grid-cols-4 gap-4 print:grid-cols-4">
          
          {/* Array.from (Array.from - a JavaScript method that creates a new array from a given length, useful for repeating elements) */}
          {Array.from({ length: copies }).map((_, index) => (
            <div key={index} className="border border-gray-300 p-2 flex flex-col items-center justify-center text-center rounded">
              <p className="text-xs font-bold text-gray-800 truncate w-full">{selectedItem.name}</p>
              <p className="text-xs text-gray-600 mb-1">₹{selectedItem.price.toFixed(2)}</p>
              
              {/* The actual barcode graphic */}
              <div className="scale-75 origin-top">
                <Barcode 
                  value={selectedItem.barcode} 
                  height={40} 
                  width={1.5} 
                  fontSize={14} 
                  margin={0}
                />
              </div>
            </div>
          ))}
          
        </div>
      </div>
      
    </div>
  );
}