import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
           qItem.instanceBarcodes = Array.from({ length: qItem.printQty }).map((_, i) => `${item.barcode}${String(qItem.nextSeq + i).padStart(6, '0')}`);
         }
         setPrintQueue(updatedQueue);
      } else {
        let nextSeq = 1001;
        if (item.is_cuttable) {
          const { data: latest } = await supabase.from('stock_instances')
            .select('instance_barcode')
            .eq('parent_barcode', item.barcode)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (latest && latest.length > 0) {
            const lastBarcode = latest[0].instance_barcode;
            let lastSeqStr = "";
            if (lastBarcode.includes('-')) {
              lastSeqStr = lastBarcode.split('-')[1];
            } else {
              lastSeqStr = lastBarcode.slice(-6);
            }
            if (!isNaN(lastSeqStr) && lastSeqStr.trim() !== '') {
              nextSeq = Number(lastSeqStr) + 1;
            }
          }
          
          // Check local cache in case labels were printed but not yet inwarded
          const localSeqs = JSON.parse(localStorage.getItem('printed_seqs') || '{}');
          if (localSeqs[item.barcode]) {
            nextSeq = Math.max(nextSeq, localSeqs[item.barcode]);
          }
        }

        const newQueueItem = { ...item, printQty: 1, nextSeq };
        if (item.is_cuttable) {
          newQueueItem.instanceBarcodes = [`${item.barcode}${String(nextSeq).padStart(6, '0')}`];
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
          updatedItem.instanceBarcodes = Array.from({ length: targetLength }).map((_, i) => `${item.barcode}${String(item.nextSeq + i).padStart(6, '0')}`);
        }
        return updatedItem;
      }
      return item;
    }));
  };

  const removeFromQueue = (barcode) => {
    setPrintQueue(printQueue.filter(item => item.barcode !== barcode));
  };

  const handlePrint = () => {
    // Save sequences to cache so the next print session won't overlap un-inwarded stickers
    const localSeqs = JSON.parse(localStorage.getItem('printed_seqs') || '{}');
    let hasUpdates = false;
    
    printQueue.forEach(item => {
      if (item.is_cuttable && item.nextSeq) {
         const nextAvailableSeq = item.nextSeq + (Number(item.printQty) || 0);
         localSeqs[item.barcode] = Math.max(localSeqs[item.barcode] || 1001, nextAvailableSeq);
         hasUpdates = true;
      }
    });
    
    if (hasUpdates) {
      localStorage.setItem('printed_seqs', JSON.stringify(localSeqs));
    }
    
    window.print();
  };

  const totalLabels = printQueue.reduce((sum, item) => sum + (Number(item.printQty) || 0), 0);

  return (
    <div className="flex flex-col h-full animate-fade-in pb-4">
      
      <div className="flex flex-col flex-1 w-full rounded-xl print:hidden overflow-hidden border border-[var(--border-light)] shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="p-4 shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
          <h1 className="text-2xl font-medium">Print Barcode Labels</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Build a queue of products to print multiple labels at once.</p>
        </div>

        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 h-full">
            
            <div className="space-y-6">
              
              <div className="relative">
                <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Search Product Name or Barcode</label>
                <input 
                  type="text" 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  placeholder="e.g., Brass Handle or 1001..." 
                  className="w-full px-3 py-2 focus:outline-none text-sm rounded-md"
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
                        <p className="font-medium text-sm flex items-center gap-2">{item.name} {item.is_cuttable && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shadow-sm" style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>CUTTABLE</span>}</p>
                        <p className="text-xs opacity-80">#{item.barcode} • ₹{Number(item.price).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {printQueue.length > 0 && (
                <div className="rounded-lg border border-[var(--border-light)] shadow-sm overflow-x-auto" style={{ backgroundColor: 'var(--bg-secondary)' }}>
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
                            <div className="flex justify-center">
                              <input 
                                type="number" min="1" max="100" 
                                value={item.printQty} 
                                onChange={(e) => updateQuantity(item.barcode, e.target.value)}
                                className="w-16 px-2 py-1 text-sm text-center focus:outline-none rounded-md"
                                style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                              />
                            </div>
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
                    className="flex-1 px-4 py-3 font-semibold rounded-md border border-[var(--border-medium)] transition-colors focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  >
                    Clear All
                  </button>
                  <button 
                    onClick={handlePrint}
                    className="flex-[3] px-4 py-3 font-semibold text-white rounded-md transition-opacity focus:outline-none shadow-sm"
                    style={{ backgroundColor: 'var(--color-accent)' }}
                  >
                    Print All {totalLabels} Labels
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 flex flex-col items-center justify-center min-h-75 rounded-lg border border-[var(--border-light)] shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <p className="text-xs uppercase mb-4" style={{ color: 'var(--text-secondary)' }}>Label Format Preview</p>
              {printQueue.length > 0 ? (
                <div className="text-center p-3 shadow-sm inline-block w-[50mm]" style={{ backgroundColor: '#ffffff', border: '1px solid #dddddd' }}>
                  <p className="text-xs font-bold mb-1 truncate mx-auto" style={{ color: '#000000' }}>{printQueue[0].name}</p>
                  <div className="flex justify-center">
                    {/* React Barcode will render inline styles automatically, but ensure it receives standard colors */}
                    <Barcode value={printQueue[0].is_cuttable && printQueue[0].instanceBarcodes?.length > 0 ? printQueue[0].instanceBarcodes[0] : printQueue[0].barcode} width={1.8} height={50} fontSize={12} margin={0} lineColor="#000000" background="#ffffff" />
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

      {printQueue.length > 0 && createPortal(
        <div id="printable-barcodes" className="absolute -top-[9999px] left-0 opacity-0 pointer-events-none print:static print:opacity-100 print:pointer-events-auto grid grid-cols-5 gap-x-1 gap-y-4 pt-4 px-2 content-start place-items-center w-full bg-white text-black" style={{ backgroundColor: '#ffffff' }}>
          {printQueue.map((item) => (
            item.is_cuttable ? (
              (item.instanceBarcodes || []).map((instBarcode, index) => (
                <div key={`${item.barcode}-inst-${index}`} className="thermal-barcode" style={{ backgroundColor: '#ffffff' }}>
                   <p className="text-[9px] font-bold truncate w-full text-center leading-none mb-1" style={{ color: '#000000' }}>{item.name}</p>
                   <Barcode value={instBarcode} width={1.5} height={35} fontSize={11} margin={0} displayValue={true} lineColor="#000000" background="#ffffff" />
                   <p className="text-[10px] font-bold leading-none mt-1" style={{ color: '#000000' }}>₹{Number(item.price).toFixed(2)}</p>
                </div>
              ))
            ) : (
              Array.from({ length: Number(item.printQty) || 0 }).map((_, index) => (
                <div key={`${item.barcode}-${index}`} className="thermal-barcode" style={{ backgroundColor: '#ffffff' }}>
                   <p className="text-[9px] font-bold truncate w-full text-center leading-none mb-1" style={{ color: '#000000' }}>{item.name}</p>
                   <Barcode value={item.barcode} width={1.5} height={35} fontSize={11} margin={0} displayValue={true} lineColor="#000000" background="#ffffff" />
                   <p className="text-[10px] font-bold leading-none mt-1" style={{ color: '#000000' }}>₹{Number(item.price).toFixed(2)}</p>
                </div>
              ))
            )
          ))}
        </div>,
        document.body
      )}
      
    </div>
  );
}