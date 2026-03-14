import React, { useState } from 'react';
import Barcode from 'react-barcode';

export default function BarcodePrinter({ inventory }) {
  const [searchTerm, setSearchTerm] = useState('');
  
  // NEW: A queue to hold multiple items and their print quantities
  const [printQueue, setPrintQueue] = useState([]);

  const filteredInventory = searchTerm.trim() === '' 
    ? [] 
    : inventory.filter(item => 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.barcode.includes(searchTerm)
      ).slice(0, 10); 

  const handleSelectItem = (item) => {
    // Check if the item is already in the queue
    const existingIndex = printQueue.findIndex(qItem => qItem.barcode === item.barcode);
    
    if (existingIndex >= 0) {
       // If it is, just increase the quantity by 1
       const updatedQueue = [...printQueue];
       updatedQueue[existingIndex].printQty += 1;
       setPrintQueue(updatedQueue);
    } else {
       // If it is new, add it to the queue with a quantity of 1
       setPrintQueue([...printQueue, { ...item, printQty: 1 }]);
    }
    setSearchTerm(''); // Clear the search bar
  };

  const updateQuantity = (barcode, newQty) => {
    const qty = Math.max(1, Number(newQty)); // Prevent negative or zero labels
    setPrintQueue(printQueue.map(item => 
      item.barcode === barcode ? { ...item, printQty: qty } : item
    ));
  };

  const removeFromQueue = (barcode) => {
    setPrintQueue(printQueue.filter(item => item.barcode !== barcode));
  };

  // Calculate the total number of labels to print for the button text
  const totalLabels = printQueue.reduce((sum, item) => sum + item.printQty, 0);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh]">
      
      {/* --- VISIBLE DASHBOARD UI --- */}
      <div className="w-full max-w-4xl bg-white border border-gray-400 rounded-none shadow-none print:hidden animate-fade-in">
        <div className="bg-[#f3f3f3] p-4 text-black border-b border-gray-400">
          <h1 className="text-xl font-light">Print Barcode Labels</h1>
          <p className="text-gray-500 text-xs mt-1">Build a queue of products to print multiple labels at once.</p>
        </div>

        <div className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Configuration Panel */}
            <div className="space-y-6">
              
              {/* Live Search Bar */}
              <div className="relative">
                <label className="block text-sm text-gray-600 mb-1">Search Product Name or Barcode</label>
                <input 
                  type="text" 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  placeholder="e.g., Brass Handle or 1001..." 
                  className="w-full px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none text-black"
                />
                
                {/* Autocomplete Dropdown */}
                {filteredInventory.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-400 shadow-lg max-h-60 overflow-y-auto">
                    {filteredInventory.map(item => (
                      <div 
                        key={item.id} 
                        onClick={() => handleSelectItem(item)}
                        className="p-3 hover:bg-[#0078D7] hover:text-white cursor-pointer border-b border-gray-200 last:border-0 transition-colors text-black"
                      >
                        <p className="font-medium text-sm">{item.name}</p>
                        <p className="text-xs opacity-80">#{item.barcode} • ₹{Number(item.price).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Print Queue List */}
              {printQueue.length > 0 && (
                <div className="bg-white border border-gray-400 rounded-none overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                        <th className="p-2 border-r border-gray-300">Item</th>
                        <th className="p-2 border-r border-gray-300 w-20 text-center">Qty</th>
                        <th className="p-2 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {printQueue.map((item) => (
                        <tr key={item.barcode} className="hover:bg-[#f0f0f0]">
                          <td className="p-2 border-r border-gray-200 text-sm text-black">
                            {item.name} <span className="block text-xs text-gray-400">#{item.barcode}</span>
                          </td>
                          <td className="p-2 border-r border-gray-200 text-center">
                            <input 
                              type="number" 
                              min="1" 
                              value={item.printQty} 
                              onChange={(e) => updateQuantity(item.barcode, e.target.value)} 
                              className="w-full px-1 py-1 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none text-center text-black"
                            />
                          </td>
                          <td className="p-2 text-center">
                            {/* A sharp red close button to remove the item from the queue */}
                            <button onClick={() => removeFromQueue(item.barcode)} className="text-[#e81123] hover:text-red-700 font-bold text-lg leading-none">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Print Button */}
              {printQueue.length > 0 && (
                <div className="flex gap-4">
                  <button 
                    onClick={() => setPrintQueue([])}
                    className="px-4 py-2 bg-[#e6e6e6] hover:bg-[#cccccc] text-black text-sm transition-colors rounded-none border border-gray-400"
                  >
                    Clear All
                  </button>
                  <button 
                    onClick={() => window.print()}
                    className="flex-1 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm transition-colors rounded-none border border-[#005a9e]"
                  >
                    Print All {totalLabels} Label{totalLabels !== 1 ? 's' : ''}
                  </button>
                </div>
              )}
            </div>

            {/* Live Preview Panel */}
            <div className="border border-gray-400 bg-[#f9f9f9] p-6 flex flex-col items-center justify-center min-h-[300px]">
              <p className="text-xs text-gray-500 uppercase mb-4">Label Format Preview</p>
              {printQueue.length > 0 ? (
                // We show a preview of just the first item in the queue so they know what the stickers will look like
                <div className="text-center bg-white p-3 border border-gray-300 shadow-sm inline-block w-[50mm]">
                  <p className="text-xs font-bold text-black mb-1 truncate mx-auto">{printQueue[0].name}</p>
                  <div className="flex justify-center">
                    <Barcode value={printQueue[0].barcode} width={1.2} height={40} fontSize={12} margin={0} />
                  </div>
                  <p className="text-sm font-bold text-black mt-1">₹{Number(printQueue[0].price).toFixed(2)}</p>
                </div>
              ) : (
                <p className="text-gray-400 text-sm">Add items to queue to see preview</p>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* --- THE HIDDEN PRINTABLE AREA (Only visible on paper) --- */}
      {printQueue.length > 0 && (
        <div className="hidden print:flex flex-wrap content-start justify-start bg-white w-full h-full">
          {printQueue.map((item) => (
            // We loop through each item, and then loop again based on its specific printQty
            Array.from({ length: item.printQty }).map((_, index) => (
              <div key={`${item.barcode}-${index}`} className="flex flex-col items-center justify-center p-1 border-gray-200 w-[50mm] h-[25mm] overflow-hidden break-inside-avoid mb-2 mr-2">
                 <p className="text-[9px] font-bold text-black truncate w-full text-center leading-none mb-1">{item.name}</p>
                 <Barcode value={item.barcode} width={1} height={25} fontSize={10} margin={0} displayValue={true} />
                 <p className="text-[10px] font-bold text-black leading-none mt-1">₹{Number(item.price).toFixed(2)}</p>
              </div>
            ))
          ))}
        </div>
      )}
      
    </div>
  );
}