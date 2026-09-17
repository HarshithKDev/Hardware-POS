import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { generateId } from './utils';
import { useApp } from './AppContext';

export default function CreateBatchModal({ item, onClose }) {
  const { showAlert } = useApp();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ cost_price: '', msp: '', price: '' });

  const createBatchMutation = useMutation({
    mutationFn: async (batchData) => {
      // Find max batch_number for this barcode
      const { data: existingBatches } = await supabase
        .from('inventory_batches')
        .select('batch_number')
        .eq('barcode', item.barcode);
        
      let nextBatchNum = 1;
      if (existingBatches && existingBatches.length > 0) {
        nextBatchNum = Math.max(...existingBatches.map(b => b.batch_number || 0)) + 1;
      }

      const newBatchId = generateId();
      const insertPayload = {
        batch_id: newBatchId,
        barcode: item.barcode,
        batch_number: nextBatchNum,
        purchase_cost: Number(batchData.cost_price),
        msp: Number(batchData.msp),
        selling_price: Number(batchData.price),
        stock_warehouse: 0,
        stock_store: 0,
        is_active: true
      };

      const { error } = await supabase.from('inventory_batches').insert([insertPayload]);
      if (error) throw error;

      try {
        await supabase.from('audit_logs').insert([{
          action_type: 'CREATE',
          barcode: item.barcode,
          item_name: item.name,
          changes: `Created Batch #${nextBatchNum} | Cost: ₹${insertPayload.purchase_cost} | MSP: ₹${insertPayload.msp} | MRP: ₹${insertPayload.selling_price}`,
          performed_by: 'Owner'
        }]);
      } catch (err) {
        console.error("Failed to log batch creation", err);
      }
      
      // Update local IDB cache
      try {
        const { getInventoryItemByBarcode, saveInventoryBatch } = await import('./services/db.js');
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem) {
          const updatedBatches = [...(localItem.batches || []), insertPayload];
          await saveInventoryBatch([{ ...localItem, batches: updatedBatches }]);
        }
      } catch (e) {
        console.error("Local IDB batch creation failed", e);
      }

      return insertPayload;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      showAlert(`Batch ${data.batch_number} created successfully!`, "Success");
      onClose();
    },
    onError: (e) => {
      showAlert(e.message, "Failed to Create Batch");
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createBatchMutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 md:p-6 border-b border-[var(--border-light)] flex justify-between items-center glass-header sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] leading-tight">Create New Batch</h2>
            <p className="text-xs text-[var(--text-tertiary)] font-medium mt-1 uppercase tracking-wider">{item.name} ({item.barcode})</p>
          </div>
          <button onClick={onClose} className="p-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">
            ✕
          </button>
        </div>

        <div className="p-4 md:p-6 overflow-y-auto custom-scrollbar">
          <form id="createBatchForm" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="batch-cost">Cost Price (₹)</label>
              <input id="batch-cost" type="number" step="any" min="0" required autoFocus value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} placeholder="0.00" className="w-full h-11 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="batch-msp">Min Selling Price (₹)</label>
              <input id="batch-msp" type="number" step="any" min="0" required value={form.msp} onChange={(e) => setForm({ ...form, msp: e.target.value })} placeholder="0.00" className="w-full h-11 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="batch-mrp">Max Retail Price (₹)</label>
              <input id="batch-mrp" type="number" step="any" min="0" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" className="w-full h-11 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            </div>
          </form>
        </div>

        <div className="p-4 md:p-6 border-t border-[var(--border-light)] bg-[var(--bg-secondary)] flex justify-end gap-3 sticky bottom-0 z-10">
          <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-bold uppercase tracking-wider rounded-md transition-colors" style={{ color: 'var(--text-primary)', border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-primary)' }}>
            Cancel
          </button>
          <button type="submit" form="createBatchForm" disabled={createBatchMutation.isPending} className="px-6 py-2 text-sm font-bold uppercase tracking-wider rounded-md text-white transition-colors disabled:opacity-50 flex items-center gap-2" style={{ backgroundColor: 'var(--color-accent)' }}>
            {createBatchMutation.isPending ? 'Creating...' : 'Create Batch'}
          </button>
        </div>
      </div>
    </div>
  );
}
