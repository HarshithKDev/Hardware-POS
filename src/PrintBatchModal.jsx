import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient';
import { useQueryClient } from '@tanstack/react-query';

export default function PrintBatchModal({ isOpen, onClose, item, selectedBatch }) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(10);
  const [cost, setCost] = useState(item?.cost_price || 0);
  const [msp, setMsp] = useState(item?.msp || 0);
  const [mrp, setMrp] = useState(item?.price || 0);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printBarcodeValue, setPrintBarcodeValue] = useState(item?.barcode);

  useEffect(() => {
    if (item) {
      const targetBatch = selectedBatch || item.batches?.[0];
      setCost(targetBatch ? targetBatch.purchase_cost : item.cost_price);
      setMsp(targetBatch ? targetBatch.msp : item.msp);
      setMrp(targetBatch ? targetBatch.selling_price : item.price);
      setPrintBarcodeValue(targetBatch && targetBatch.batch_number ? `${item.barcode}-${String(targetBatch.batch_number).padStart(2, '0')}` : item.barcode);
    }
  }, [item, selectedBatch]);

  if (!isOpen || !item) return null;

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      let currentBarcodeValue = item.barcode;

      // Check if price/cost changed from the target batch
      const targetBatch = selectedBatch || item.batches?.[0];
      const isChanged = !targetBatch || 
        Number(cost) !== Number(targetBatch.purchase_cost) ||
        Number(msp) !== Number(targetBatch.msp) ||
        Number(mrp) !== Number(targetBatch.selling_price);

      if (isChanged) {
        // Create a new batch
        const batchId = crypto.randomUUID();
        
        // Call RPC or execute query to get next batch number
        const { data: maxSeqData, error: seqError } = await supabase
          .from('inventory_batches')
          .select('batch_number')
          .eq('barcode', item.barcode)
          .order('batch_number', { ascending: false })
          .limit(1);

        let nextSeq = 1;
        if (!seqError && maxSeqData && maxSeqData.length > 0) {
          nextSeq = (maxSeqData[0].batch_number || 0) + 1;
        }

        const newBatch = {
          batch_id: batchId,
          barcode: item.barcode,
          purchase_cost: Number(cost),
          msp: Number(msp),
          selling_price: Number(mrp),
          stock_warehouse: 0,
          stock_store: 0,
          is_active: true,
          batch_number: nextSeq,
          created_at: new Date().toISOString()
        };

        const { error: insertError } = await supabase.from('inventory_batches').insert([{
          batch_id: newBatch.batch_id,
          barcode: newBatch.barcode,
          purchase_cost: newBatch.purchase_cost,
          msp: newBatch.msp,
          selling_price: newBatch.selling_price,
          stock_warehouse: newBatch.stock_warehouse,
          stock_store: newBatch.stock_store,
          is_active: newBatch.is_active,
          batch_number: newBatch.batch_number
        }]);

        if (insertError) throw insertError;

        // Immediately update IndexedDB and invalidate inventory cache so the new batch appears in the table
        const { saveInventoryBatch } = await import('./services/db.js');
        const updatedItem = { ...item, batches: [...(item.batches || []), newBatch] };
        await saveInventoryBatch([updatedItem]);
        queryClient.invalidateQueries({ queryKey: ['inventory'] });

        // The printed barcode suffix will be -01, -02 etc
        currentBarcodeValue = `${item.barcode}-${String(nextSeq).padStart(2, '0')}`;
      } else if (targetBatch && targetBatch.batch_number) {
        // Use existing batch's sequence
        currentBarcodeValue = `${item.barcode}-${String(targetBatch.batch_number).padStart(2, '0')}`;
      } else {
         currentBarcodeValue = `${item.barcode}-01`;
      }

      setPrintBarcodeValue(currentBarcodeValue);

      // Give React a tick to render the portal before calling print
      setTimeout(() => {
        window.print();
        setIsPrinting(false);
        onClose();
      }, 500);

    } catch (err) {
      console.error("Print error:", err);
      alert("Failed to print: " + err.message);
      setIsPrinting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[600] px-4 print:hidden animate-fade-in">
        <div className="w-[90%] max-w-[450px] rounded-xl overflow-hidden flex flex-col shadow-2xl bg-[var(--bg-secondary)] border border-[var(--border-light)]">
          <div className="flex justify-between items-center px-5 py-3 border-b border-[var(--border-light)]">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">Print Labels: {item.name}</h2>
            <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>
          </div>
          
          <div className="p-5 flex flex-col gap-5">
            {/* Visual Preview */}
            <div className="flex flex-col items-center justify-center p-4 bg-white border border-[var(--border-medium)] rounded-lg mx-auto w-[250px] shadow-sm">
              <p className="text-[10px] font-bold text-black mb-1 w-full text-center truncate">{item.name}</p>
              <Barcode 
                value={printBarcodeValue} 
                width={1.5} 
                height={30} 
                fontSize={12} 
                margin={0} 
                displayValue={true} 
                lineColor="#000000" 
                background="#ffffff" 
              />
              <p className="text-xs font-bold text-black mt-1">₹{Number(mrp).toFixed(2)}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Number of Labels</label>
              <input 
                type="number" 
                value={qty} 
                onChange={e => setQty(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm font-bold focus:outline-none focus:border-[var(--color-accent)]"
                min="1"
                max="500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Cost (₹)</label>
                <input 
                  type="number" 
                  value={cost} 
                  onChange={e => setCost(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">MSP (₹)</label>
                <input 
                  type="number" 
                  value={msp} 
                  onChange={e => setMsp(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">MRP (₹)</label>
                <input 
                  type="number" 
                  value={mrp} 
                  onChange={e => setMrp(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm font-bold focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="mt-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] p-3 rounded-md border border-[var(--border-light)]">
              <p><strong>Note:</strong> If you change the prices above, a new batch will automatically be created and unique labels will be printed.</p>
            </div>
          </div>

          <div className="px-5 py-4 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] flex justify-end gap-3">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold rounded-md border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button 
              onClick={handlePrint}
              disabled={isPrinting}
              className="px-6 py-2 text-sm font-bold rounded-md text-white shadow-sm flex items-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {isPrinting ? 'Printing...' : 'Print Labels'}
            </button>
          </div>
        </div>
      </div>

      {/* Hidden container for printing */}
      {isPrinting && createPortal(
        <div id="printable-barcodes" className="absolute -top-[9999px] left-0 opacity-0 pointer-events-none print:static print:opacity-100 print:pointer-events-auto" style={{ backgroundColor: '#ffffff', margin: 0, padding: 0 }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              @page { size: 50mm 25mm; margin: 0 !important; }
              body { margin: 0 !important; padding: 0 !important; }
              #printable-barcodes { display: block !important; margin: 0 !important; padding: 0 !important; }
            }
          `}} />
          {Array.from({ length: Number(qty) || 1 }).map((_, index) => (
            <div key={`${printBarcodeValue}-${index}`} className="thermal-barcode" style={{ backgroundColor: '#ffffff', width: '50mm', height: '25mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', pageBreakAfter: 'always' }}>
              <p style={{ color: '#000000', fontSize: '9px', fontWeight: 'bold', lineHeight: 1, margin: 0, marginBottom: '2px', textAlign: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</p>
              <Barcode value={printBarcodeValue} width={1.25} height={24} fontSize={10} margin={0} displayValue={true} lineColor="#000000" background="#ffffff" />
              <p style={{ color: '#000000', fontSize: '10px', fontWeight: 'bold', lineHeight: 1, margin: 0, marginTop: '2px' }}>₹{Number(mrp).toFixed(2)}</p>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
