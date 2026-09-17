import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient';

export default function PrintBatchModal({ isOpen, onClose, item, selectedBatch }) {
  const [qty, setQty] = useState(10);
  const [isPrinting, setIsPrinting] = useState(false);
  const [nextSeqForCuttable, setNextSeqForCuttable] = useState(1);

  // When selectedBatch changes, calculate the next sequence number if cuttable
  useEffect(() => {
    if (item && selectedBatch && item.is_cuttable) {
      const fetchMaxSeq = async () => {
        const batchPrefix = `${item.barcode}-${String(selectedBatch.batch_number || 1).padStart(2, '0')}`;
        
        const { data } = await supabase
          .from('stock_instances')
          .select('instance_barcode')
          .eq('parent_barcode', item.barcode)
          .ilike('instance_barcode', `${batchPrefix}-%`);

        let maxSeq = 0;
        if (data && data.length > 0) {
          data.forEach(row => {
            const parts = row.instance_barcode.split('-');
            if (parts.length === 3) {
              const seq = parseInt(parts[2], 10);
              if (!isNaN(seq) && seq > maxSeq) {
                maxSeq = seq;
              }
            }
          });
        }
        setNextSeqForCuttable(maxSeq + 1);
      };
      fetchMaxSeq();
    }
  }, [item, selectedBatch]);

  if (!isOpen || !item || !selectedBatch) return null;

  const batchNumberStr = String(selectedBatch.batch_number || 1).padStart(2, '0');
  const printBarcodeValue = `${item.barcode}-${batchNumberStr}`;

  const handlePrint = async () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
      onClose();
    }, 500);
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
                value={item.is_cuttable ? `${printBarcodeValue}-${String(nextSeqForCuttable).padStart(2, '0')}` : printBarcodeValue} 
                width={1.5} 
                height={30} 
                fontSize={12} 
                margin={0} 
                displayValue={true} 
                lineColor="#000000" 
                background="#ffffff" 
              />
              <p className="text-xs font-bold text-black mt-1">₹{Number(selectedBatch.selling_price).toFixed(2)}</p>
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

            <div className="mt-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] p-3 rounded-md border border-[var(--border-light)]">
              <p><strong>Batch {batchNumberStr}:</strong> Labels will be printed with MRP ₹{Number(selectedBatch.selling_price).toFixed(2)}.</p>
              {item.is_cuttable && (
                <p className="mt-1">Unique sequence numbers will be generated starting from {String(nextSeqForCuttable).padStart(2, '0')}.</p>
              )}
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
          {Array.from({ length: Number(qty) || 1 }).map((_, index) => {
            const barcodeVal = item.is_cuttable ? `${printBarcodeValue}-${String(nextSeqForCuttable + index).padStart(2, '0')}` : printBarcodeValue;
            return (
              <div key={`${barcodeVal}-${index}`} className="thermal-barcode" style={{ backgroundColor: '#ffffff', width: '50mm', height: '25mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', pageBreakAfter: 'always' }}>
                <p style={{ color: '#000000', fontSize: '9px', fontWeight: 'bold', lineHeight: 1, margin: 0, marginBottom: '2px', textAlign: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</p>
                <Barcode value={barcodeVal} width={1.25} height={24} fontSize={10} margin={0} displayValue={true} lineColor="#000000" background="#ffffff" />
                <p style={{ color: '#000000', fontSize: '10px', fontWeight: 'bold', lineHeight: 1, margin: 0, marginTop: '2px' }}>₹{Number(selectedBatch.selling_price).toFixed(2)}</p>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
