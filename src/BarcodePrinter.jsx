import React, { useState, useEffect } from 'react';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient'; 

export default function BarcodePrinter() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredInventory, setFilteredInventory] = useState([]);
  const [printQueue, setPrintQueue] = useState([]);

  const getShortUnit = (unit) => {
    if (!unit) return '';
    const u = unit.toUpperCase();
    if (u === 'METER') return 'm';
    if (u === 'SQFT') return 'sqft';
    if (u === 'GRAMS') return 'g';
    if (u === 'PCS') return 'pcs';
    return unit.toLowerCase();
  };

  // Server-side debounced search replaces the local array filtering
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchTerm.trim() === '') { setFilteredInventory([]); return; }
      
      // 1. Fetch matching inventory items (both standard and cuttable)
      const { data: matchedInventory } = await supabase.from('inventory')
        .select('*')
        .or(`name.ilike.%${searchTerm}%,barcode.ilike.%${searchTerm}%`)
        .eq('is_active', true)
        .limit(10);

      const standardInv = (matchedInventory || []).filter(i => !i.is_cuttable);
      const cuttableInv = (matchedInventory || []).filter(i => i.is_cuttable);

      // 2. Fetch piece instances matching the searchTerm ONLY if it looks like a piece barcode search
      let instData = [];
      if (searchTerm.includes('-') || !isNaN(searchTerm)) {
        const { data: instResults } = await supabase.from('stock_instances')
          .select('*, inventory:parent_barcode (name, price, unit)')
          .eq('is_active', true)
          .ilike('instance_barcode', `%${searchTerm}%`)
          .limit(10);
        instData = instResults || [];
      }

      const combined = [];
      if (standardInv.length > 0) combined.push(...standardInv);
      
      // Add cuttable base items and groups
      if (cuttableInv.length > 0) {
        // Option 1: Base item to generate new barcodes
        combined.push(...cuttableInv);
      }

      if (instData.length > 0) {
        combined.push(...instData.map(inst => ({
          id: inst.id,
          barcode: inst.instance_barcode,
          name: `${inst.inventory?.name || 'Unknown'} (${inst.current_length}${getShortUnit(inst.inventory?.unit)})`,
          price: inst.inventory?.price || 0,
        })));
      }
      setFilteredInventory(combined);
    }, 300); // Waits 300ms after user stops typing to ping database

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const handleSelectItem = async (item) => {
    if (item.isGroup) {
      // Fetch all active pieces for this parent item
      const { data: instances } = await supabase.from('stock_instances')
        .select('*')
        .eq('parent_barcode', item.barcode)
        .eq('is_active', true);
        
      if (!instances || instances.length === 0) {
        alert("No active pieces found for this item.");
        return;
      }

      const newItems = [];
      const updatedQueue = [...printQueue];
      
      instances.forEach(inst => {
        const existingIndex = updatedQueue.findIndex(qItem => qItem.barcode === inst.instance_barcode);
        if (existingIndex >= 0) {
          updatedQueue[existingIndex].printQty += 1;
        } else {
          updatedQueue.push({
            id: inst.id,
            barcode: inst.instance_barcode,
            name: `${item.name.replace(' (Add All Pieces)', '')} (${inst.current_length}${getShortUnit(item.unit)})`,
            price: item.price,
            printQty: 1
          });
        }
      });
      setPrintQueue(updatedQueue);
    } else {
      const existingIndex = printQueue.findIndex(qItem => qItem.barcode === item.barcode);
      
      if (existingIndex >= 0) {
         const updatedQueue = [...printQueue];
         const qItem = updatedQueue[existingIndex];
         qItem.printQty += 1;
         if (item.is_cuttable) {
           qItem.instanceBarcodes = Array.from({ length: qItem.printQty }).map((_, i) => `${item.barcode}-${qItem.nextSeq + i}`);
         }
         setPrintQueue(updatedQueue);
      } else {
        let nextSeq = 1001;
        if (item.is_cuttable) {
          const { data: latest } = await supabase.from('stock_instances')
            .select('instance_barcode')
            .eq('item_barcode', item.barcode)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (latest && latest.length > 0) {
            const parts = latest[0].instance_barcode.split('-');
            if (parts.length === 2 && !isNaN(parts[1])) {
              nextSeq = Number(parts[1]) + 1;
            }
          }
        }

        const newQueueItem = { ...item, printQty: 1, nextSeq };
        if (item.is_cuttable) {
          newQueueItem.instanceBarcodes = [`${item.barcode}-${nextSeq}`];
        }
        setPrintQueue([...printQueue, newQueueItem]);
      }
    }
    setSearchTerm(''); 
  };

  const updateQuantity = (barcode, newQty) => {
    // Allow empty string so user can clear the input to type a new number
    const qty = newQty === '' ? '' : Math.max(1, Number(newQty)); 
    setPrintQueue(printQueue.map(item => {
      if (item.barcode === barcode) {
        const updatedItem = { ...item, printQty: qty };
        if (item.is_cuttable && qty !== '') {
          const targetLength = Number(qty);
          updatedItem.instanceBarcodes = Array.from({ length: targetLength }).map((_, i) => `${item.barcode}-${item.nextSeq + i}`);
        }
        return updatedItem;
      }
      return item;
    }));
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
                        <p className="font-medium text-sm">{item.name} {item.is_cuttable && <span className="ml-2 text-[10px] px-1 py-0.5 rounded bg-[var(--color-accent)] text-white">CUTTABLE</span>}</p>
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
                          <td className="p-2" style={{ borderRight: '1px solid var(--border-light)' }}>
                            {item.is_cuttable ? (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--color-accent)] font-semibold">Unique Rolls</span>
                                <input 
                                  type="number" min="1" max="100" 
                                  value={item.printQty} 
                                  onChange={(e) => updateQuantity(item.barcode, e.target.value)}
                                  className="w-16 px-2 py-1 text-sm focus:outline-none rounded-none"
                                  style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                                />
                              </div>
                            ) : (
                              <input 
                                type="number" min="1" max="100" 
                                value={item.printQty} 
                                onChange={(e) => updateQuantity(item.barcode, e.target.value)}
                                className="w-20 px-2 py-1 text-sm focus:outline-none rounded-none"
                                style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                              />
                            )}
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
            item.is_cuttable ? (
              (item.instanceBarcodes || []).map((instBarcode, index) => (
                <div key={`${item.barcode}-inst-${index}`} className="thermal-barcode" style={{ backgroundColor: '#ffffff' }}>
                   <p className="text-[9px] font-bold truncate w-full text-center leading-none mb-1" style={{ color: '#000000' }}>{item.name}</p>
                   <Barcode value={instBarcode} width={1} height={25} fontSize={10} margin={0} displayValue={true} lineColor="#000000" background="#ffffff" />
                   <p className="text-[10px] font-bold leading-none mt-1" style={{ color: '#000000' }}>₹{Number(item.price).toFixed(2)}</p>
                </div>
              ))
            ) : (
              Array.from({ length: Number(item.printQty) || 0 }).map((_, index) => (
                <div key={`${item.barcode}-${index}`} className="thermal-barcode" style={{ backgroundColor: '#ffffff' }}>
                   <p className="text-[9px] font-bold truncate w-full text-center leading-none mb-1" style={{ color: '#000000' }}>{item.name}</p>
                   <Barcode value={item.barcode} width={1} height={25} fontSize={10} margin={0} displayValue={true} lineColor="#000000" background="#ffffff" />
                   <p className="text-[10px] font-bold leading-none mt-1" style={{ color: '#000000' }}>₹{Number(item.price).toFixed(2)}</p>
                </div>
              ))
            )
          ))}
        </div>
      )}
      
    </div>
  );
}