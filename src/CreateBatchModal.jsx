import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { generateId } from './utils';
import { useApp } from './AppContext';

export default function CreateBatchModal({ item, onClose, onBatchCreated }) {
  const { showAlert } = useApp();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ 
    wholesaler: '',
    cost_price: item?.cost_price !== undefined && item?.cost_price !== null ? String(item.cost_price) : '', 
    msp: item?.msp !== undefined && item?.msp !== null ? String(item.msp) : '', 
    price: item?.price !== undefined && item?.price !== null ? String(item.price) : '' 
  });

  const createBatchMutation = useMutation({
    mutationFn: async (batchData) => {
      // Find max batch_number for this barcode across both remote and local batches
      let existingBatches = [];
      try {
        const { data } = await supabase
          .from('inventory_batches')
          .select('batch_number')
          .eq('barcode', item.barcode);
        if (data) existingBatches = data;
      } catch (err) {
        console.warn('Failed to query remote batches for batch_number', err);
      }
        
      const allBatchNums = [
        ...(item.batches || []).map(b => Number(b.batch_number) || 0),
        ...existingBatches.map(b => Number(b.batch_number) || 0)
      ];
      let nextBatchNum = (allBatchNums.length > 0 ? Math.max(...allBatchNums) : 0) + 1;
      if (nextBatchNum <= 0) nextBatchNum = 1;

      const shopId = localStorage.getItem('shop_id');
      const newBatchId = generateId();
      const insertPayload = {
        batch_id: newBatchId,
        shop_id: shopId,
        barcode: item.barcode,
        batch_number: nextBatchNum,
        supplier: batchData.wholesaler?.trim() || null,
        purchase_cost: Number(batchData.cost_price),
        msp: Number(batchData.msp),
        selling_price: Number(batchData.price),
        stock_warehouse: 0,
        stock_store: 0,
        is_active: true
      };

      const { error } = await supabase.from('inventory_batches').insert([insertPayload]);
      if (error) throw error;

      // Bump product_master.updated_at and pricing so delta sync and listeners recognize the change
      try {
        let bumpQuery = supabase
          .from('product_master')
          .update({ 
            cost_price: Number(batchData.cost_price),
            msp: Number(batchData.msp),
            price: Number(batchData.price),
            updated_at: new Date().toISOString() 
          })
          .eq('barcode', item.barcode);
        if (shopId) bumpQuery = bumpQuery.eq('shop_id', shopId);
        await bumpQuery;
      } catch (e) {}

      try {
        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          action_type: 'CREATE',
          barcode: item.barcode,
          item_name: item.name,
          changes: `Created Batch #${nextBatchNum}${insertPayload.supplier ? ` | Wholesaler: ${insertPayload.supplier}` : ''} | Cost: ₹${insertPayload.purchase_cost} | MSP: ₹${insertPayload.msp} | MRP: ₹${insertPayload.selling_price}`,
          performed_by: localStorage.getItem('owner_name') || 'Owner'
        }]);
      } catch (err) {
        console.error("Failed to log batch creation", err);
      }
      
      // Update local IDB cache immediately
      try {
        const { getInventoryItemByBarcode, saveInventoryBatch } = await import('./services/db.js');
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem) {
          const currentBatches = (localItem.batches || []).filter(b => b.is_active !== false);
          if (!currentBatches.some(b => b.batch_id === insertPayload.batch_id)) {
            const updatedBatches = [...currentBatches, insertPayload].sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1));
            await saveInventoryBatch([{ ...localItem, batches: updatedBatches }]);
          }
        }
      } catch (e) {
        console.error("Local IDB batch creation failed", e);
      }

      // Update React Query memory caches directly with 0 latency
      queryClient.setQueriesData({ queryKey: ['inventory_item'] }, (old) => {
        if (!old) return old;
        if (String(old.barcode) !== String(item.barcode)) return old;
        const currentBatches = (old.batches || []).filter(b => b.is_active !== false);
        if (currentBatches.some(b => b.batch_id === insertPayload.batch_id)) return old;
        return {
          ...old,
          batches: [...currentBatches, insertPayload].sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1))
        };
      });

      queryClient.setQueriesData({ queryKey: ['inventory'] }, (old) => {
        if (!old || !old.items) return old;
        return {
          ...old,
          items: old.items.map(p => {
            if (String(p.barcode) !== String(item.barcode)) return p;
            const currentBatches = (p.batches || []).filter(b => b.is_active !== false);
            if (currentBatches.some(b => b.batch_id === insertPayload.batch_id)) return p;
            return {
              ...p,
              batches: [...currentBatches, insertPayload].sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1))
            };
          })
        };
      });

      return insertPayload;
    },
    onSuccess: (data) => {
      onBatchCreated?.(data);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
      queryClient.invalidateQueries({ queryKey: ['product_master'] });
      showAlert(`Batch ${data.batch_number} created successfully!`, "Success");
      onClose();
    },
    onError: (e) => {
      showAlert(e.message, "Failed to Create Batch");
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (createBatchMutation.isPending) return;
    const cost = Number(form.cost_price);
    const msp = Number(form.msp);
    const price = Number(form.price);

    if (form.cost_price === '' || isNaN(cost) || cost < 0) {
      return showAlert("Please enter a valid Cost Price (greater than or equal to 0).", "Validation Error");
    }
    if (form.msp === '' || isNaN(msp) || msp < 0) {
      return showAlert("Please enter a valid Minimum Selling Price (MSP).", "Validation Error");
    }
    if (form.price === '' || isNaN(price) || price < 0) {
      return showAlert("Please enter a valid Selling Price (MRP).", "Validation Error");
    }
    if (msp < cost) {
      return showAlert("MSP cannot be lower than Cost Price.", "Validation Error");
    }
    if (price < msp) {
      return showAlert("Selling Price (MRP) cannot be lower than MSP.", "Validation Error");
    }

    createBatchMutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" onClick={() => { if (!createBatchMutation.isPending) onClose(); }}>
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 md:p-6 border-b border-[var(--border-light)] flex justify-between items-center glass-header sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] leading-tight">Create New Batch</h2>
            <p className="text-xs text-[var(--text-tertiary)] font-medium mt-1 uppercase tracking-wider">{item.name} ({item.barcode})</p>
          </div>
        </div>

        <div className="p-4 md:p-6 overflow-y-auto custom-scrollbar">
          <form id="createBatchForm" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="batch-wholesaler">Wholesaler / Supplier Name (Optional)</label>
              <input id="batch-wholesaler" type="text" value={form.wholesaler} onChange={(e) => setForm({ ...form, wholesaler: e.target.value })} placeholder="e.g. Acme Hardware Wholesale" className="w-full h-11 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="batch-cost">Cost Price (₹){item.unit ? ` PER ${item.unit.toUpperCase()}` : ''}</label>
              <input id="batch-cost" type="number" step="any" min="0" required autoFocus value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} placeholder="0.00" className="w-full h-11 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="batch-msp">Min Selling Price (₹){item.unit ? ` PER ${item.unit.toUpperCase()}` : ''}</label>
              <input id="batch-msp" type="number" step="any" min="0" required value={form.msp} onChange={(e) => setForm({ ...form, msp: e.target.value })} placeholder="0.00" className="w-full h-11 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="batch-mrp">Max Retail Price (₹){item.unit ? ` PER ${item.unit.toUpperCase()}` : ''}</label>
              <input id="batch-mrp" type="number" step="any" min="0" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" className="w-full h-11 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            </div>
          </form>
        </div>

        <div className="p-4 md:p-6 border-t border-[var(--border-light)] bg-[var(--bg-secondary)] flex justify-end gap-3 sticky bottom-0 z-10">
          <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-bold uppercase tracking-wider rounded-md transition-colors" style={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', backgroundColor: 'transparent' }}>
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
