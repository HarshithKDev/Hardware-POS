import React, { useState, useEffect } from 'react';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient'; 

export default function BarcodePrinter() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredInventory, setFilteredInventory] = useState([]);
  const [printQueue, setPrintQueue] = useState([]);

  // Server-side debounced search replaces the local array filtering
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchTerm.trim() === '') { setFilteredInventory([]); return; }
      
      const { data } = await supabase.from('inventory')
        .select('*')
        .or(`name.ilike.%${searchTerm}%,barcode.ilike.%${searchTerm}%`)
        .eq('is_active', true)
        .limit(10);
        
      if (data) setFilteredInventory(data);
    }, 300); // Waits 300ms after user stops typing to ping database

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const handleSelectItem = (item) => {
    const existingIndex = printQueue.findIndex(qItem => qItem.barcode === item.barcode);
    
    if (existingIndex >= 0) {
       const updatedQueue = [...printQueue];
       updatedQueue[existingIndex].printQty += 1;
       setPrintQueue(updatedQueue);
    } else {
       setPrintQueue([...printQueue, { ...item, printQty: 1 }]);
    }
    setSearchTerm(''); 
  };

  const updateQuantity = (barcode, newQty) => {
    // Allow empty string so user can clear the input to type a new number
    const qty = newQty === '' ? '' : Math.max(1, Number(newQty)); 
    setPrintQueue(printQueue.map(item => 
      item.barcode === barcode ? { ...item, printQty: qty } : item
    ));
  };

  const removeFromQueue = (barcode) => {
    setPrintQueue(printQueue.filter(item => item.barcode !== barcode));
  };

  const totalLabels = printQueue.reduce((sum, item) => sum + (Number(item.printQty) || 0), 0);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh]">
      
      <div className="w-full max-w-4xl rounded-none shadow-none print:hidden animate-fade-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="p-4" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
          <h1 className="text-xl font-light">Print Barcode Labels</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Build a queue of products to print multiple labels at once.</p>
        </div>

        <div className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            <div className="space-y-6">
              
              <div className="relative">
                <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Search Product Name or Barcode</label>
                <input 
                  type="text" 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  placeholder="e.g., Brass Handle or 1001..." 
                  className="w-full px-3 py-2 focus:outline-none text-sm rounded-none"
                  style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                />
                
                {filteredInventory.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 shadow-lg max-h-60 overflow-y-auto" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
                    {filteredInventory.map(item => (
                      <div 
                        key={item.id} 
                        onClick={() => handleSelectItem(item)}
                        className="p-3 cursor-pointer transition-colors group"
                        style={{ borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                      >
                        <p className="font-medium text-sm">{item.name}</p>
                        <p className="text-xs opacity-80">#{item.barcode} • ₹{Number(item.price).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {printQueue.length > 0 && (
                <div className="rounded-none overflow-x-auto" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-xs uppercase" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
                        <th className="p-2" style={{ borderRight: '1px solid var(--border-light)' }}>Item</th>
                        <th className="p-2 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Qty</th>
                        <th className="p-2 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ divideColor: 'var(--border-light)' }}>
                      {printQueue.map((item) => (
                        <tr key={item.barcode} className="transition-colors hover:bg-[var(--bg-hover)]">
                          <td className="p-2 text-sm" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                            {item.name} <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>#{item.barcode}</span>
                          </td>
                          <td className="p-2 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                            <input 
                              type="number" 
                              min="1" 
                              value={item.printQty} 
                              onChange={(e) => updateQuantity(item.barcode, e.target.value)} 
                              className="w-full px-1 py-1 focus:outline-none text-sm rounded-none text-center"
                              style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                            />
                          </td>
                          <td className="p-2 text-center">
                            <button onClick={() => removeFromQueue(item.barcode)} className="font-bold text-lg leading-none" style={{ color: 'var(--color-error)' }}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {printQueue.length > 0 && (
                <div className="flex gap-4">
                  <button 
                    onClick={() => setPrintQueue([])}
                    className="px-4 py-2 text-sm transition-colors rounded-none focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                  >
                    Clear All
                  </button>
                  <button 
                    onClick={() => window.print()}
                    className="flex-1 py-2 text-white text-sm transition-colors rounded-none border-transparent focus:outline-none"
                    style={{ backgroundColor: 'var(--color-accent)' }}
                  >
                    Print All {totalLabels} Label{totalLabels !== 1 ? 's' : ''}
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 flex flex-col items-center justify-center min-h-75" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}>
              <p className="text-xs uppercase mb-4" style={{ color: 'var(--text-secondary)' }}>Label Format Preview</p>
              {printQueue.length > 0 ? (
                <div className="text-center p-3 shadow-sm inline-block w-[50mm]" style={{ backgroundColor: '#ffffff', border: '1px solid #dddddd' }}>
                  <p className="text-xs font-bold mb-1 truncate mx-auto" style={{ color: '#000000' }}>{printQueue[0].name}</p>
                  <div className="flex justify-center">
                    {/* React Barcode will render inline styles automatically, but ensure it receives standard colors */}
                    <Barcode value={printQueue[0].barcode} width={1.2} height={40} fontSize={12} margin={0} lineColor="#000000" background="#ffffff" />
                  </div>
                  <p className="text-sm font-bold mt-1" style={{ color: '#000000' }}>₹{Number(printQueue[0].price).toFixed(2)}</p>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Add items to queue to see preview</p>
              )}
            </div>

          </div>
        </div>
      </div>

      {printQueue.length > 0 && (
        <div id="printable-barcodes" className="absolute -top-[9999px] left-0 opacity-0 pointer-events-none print:static print:opacity-100 print:pointer-events-auto grid grid-cols-5 gap-x-1 gap-y-4 pt-4 px-2 content-start place-items-center w-full bg-white text-black" style={{ backgroundColor: '#ffffff' }}>
          {printQueue.map((item) => (
            Array.from({ length: Number(item.printQty) || 0 }).map((_, index) => (
              <div key={`${item.barcode}-${index}`} className="thermal-barcode" style={{ backgroundColor: '#ffffff' }}>
                 <p className="text-[9px] font-bold truncate w-full text-center leading-none mb-1" style={{ color: '#000000' }}>{item.name}</p>
                 <Barcode value={item.barcode} width={1} height={25} fontSize={10} margin={0} displayValue={true} lineColor="#000000" background="#ffffff" />
                 <p className="text-[10px] font-bold leading-none mt-1" style={{ color: '#000000' }}>₹{Number(item.price).toFixed(2)}</p>
              </div>
            ))
          ))}
        </div>
      )}
      
    </div>
  );
}