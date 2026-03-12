import React, { useState, useEffect } from 'react';
import Barcode from 'react-barcode';

export default function BarcodePrinter({ inventory }) {
  const [selectedItem, setSelectedItem] = useState(inventory[0] || null);
  const [copies, setCopies] = useState(12);

  useEffect(() => {
    if (inventory.length > 0 && !selectedItem) {
      setSelectedItem(inventory[0]);
    }
  }, [inventory]);

  const handlePrint = () => {
    window.print(); 
  };

  if (!selectedItem) return <div className="p-8 text-center text-gray-500">No items in inventory to print.</div>;

  return (
    <div className="min-h-screen bg-[#f3f3f3] p-8 text-black">
      
      {/* Sharp, Windows-style settings panel */}
      <div className="max-w-4xl mx-auto bg-white p-6 border border-gray-400 rounded-none mb-8 print:hidden">
        <h1 className="text-2xl font-light text-black mb-6">Print Barcode Labels</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Select Item</label>
            <select 
              className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm bg-white"
              value={selectedItem.barcode}
              onChange={(e) => setSelectedItem(inventory.find(item => item.barcode === e.target.value))}
            >
              {inventory.map((item) => (
                <option key={item.barcode} value={item.barcode}>
                  {item.name} - #{item.barcode}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Number of Copies</label>
            <input type="number" min="1" max="100" value={copies} onChange={(e) => setCopies(Number(e.target.value))} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" />
          </div>
          <button onClick={handlePrint} className="w-full py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white transition-colors rounded-none border border-[#005a9e] text-sm h-[34px]">Print Stickers</button>
        </div>
      </div>

      {/* Printable Area - removes borders when printing */}
      <div className="max-w-4xl mx-auto bg-white p-8 border border-gray-400 rounded-none print:border-none print:p-0">
        <div className="grid grid-cols-3 md:grid-cols-4 gap-4 print:grid-cols-4">
          {Array.from({ length: copies }).map((_, index) => (
            // Sharp borders for the sticker outline
            <div key={index} className="border border-gray-400 p-2 flex flex-col items-center justify-center text-center rounded-none">
              <p className="text-xs font-semibold text-black truncate w-full">{selectedItem.name}</p>
              <p className="text-xs text-gray-600 mb-1">₹{selectedItem.price.toFixed(2)}</p>
              <div className="scale-75 origin-top">
                <Barcode value={selectedItem.barcode} height={40} width={1.5} fontSize={14} margin={0} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}