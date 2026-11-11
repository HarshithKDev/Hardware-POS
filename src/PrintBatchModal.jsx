import React, { useState, useEffect } from 'react';
import { formatINR } from './utils';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient';
import BarcodeLabelSheet, { MAX_LABELS_PER_PRINT, clampLabelQty } from './components/print/BarcodeLabelSheet';
import { buttonClass } from './components/ui';

export default function PrintBatchModal({ isOpen, onClose, item, selectedBatch }) {
  const [qty, setQty] = useState(10);
  const [isPrinting, setIsPrinting] = useState(false);

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
              <p className="text-xs font-bold text-black mt-1">₹{formatINR(Number(selectedBatch.selling_price || 0), 2)}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Number of Labels</label>
              <input 
                type="number" 
                value={qty} 
                onChange={e => setQty(e.target.value === '' ? '' : clampLabelQty(e.target.value))}
                className="w-full h-10 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm font-bold focus:outline-none focus:border-[var(--color-accent)]"
                min="1"
                max={MAX_LABELS_PER_PRINT}
              />
            </div>

            <div className="mt-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] p-3 rounded-md border border-[var(--border-light)]">
              <p><strong>Batch {batchNumberStr}:</strong> Labels will be printed with MRP ₹{formatINR(Number(selectedBatch.selling_price || 0), 2)}.</p>
            </div>
          </div>

          <div className="px-5 py-4 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] flex justify-end gap-3">
            <button 
              onClick={onClose}
              className={buttonClass({ variant: 'secondary', size: 'md' })}
            >
              Cancel
            </button>
            <button 
              onClick={handlePrint}
              disabled={isPrinting}
              className={buttonClass({ variant: 'primary', size: 'md' })}
            >
              {isPrinting ? 'Printing...' : 'Print Labels'}
            </button>
          </div>
        </div>
      </div>

      {/* Hidden container for printing */}
      {isPrinting && (
        <BarcodeLabelSheet
          name={item.name}
          barcodeValue={printBarcodeValue}
          mrp={selectedBatch.selling_price}
          count={qty}
        />
      )}
    </>
  );
}
