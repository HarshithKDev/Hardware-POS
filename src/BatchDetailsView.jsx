import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { getPerformedBy, priceInputValue, formatINR } from './utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { casUpdateRow, scrapBatchStock } from './services/atomicStock';
import ScrapStockModal from './components/inventory/ScrapStockModal';
import { openScrewBox } from './services/screwBox';
import { isScrewBox } from './constants';
import { useApp } from './AppContext';
import { Spinner, PageLoader } from './SharedUI';
import { getInventoryItemByBarcode, saveInventoryBatch } from './services/db';
import PrintBatchModal from './PrintBatchModal';
import CreateBatchModal from './CreateBatchModal';
import { ConfirmDialog } from './Dialog';
import { useSessionState } from './hooks/useSessionState';
import { 
  ArrowLeft,
  Layers, 
  Printer, 
  Edit3, 
  Trash2, 
  Plus, 
  Check, 
  Scissors, 
  PackageCheck,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export default function BatchDetailsView({
  barcode,
  initialItem,
  onBack,
  viewType = 'warehouse'
}) {
  const { showAlert, showConfirm, isWarehouseDisabled } = useApp();
  const queryClient = useQueryClient();

  // Modals inside this view
  const [printBatchModal, setPrintBatchModal] = useState({ isOpen: false, batch: null });
  const [createBatchModalOpen, setCreateBatchModalOpen] = useState(false);
  const [batchToDelete, setBatchToDelete] = useState(null);
  const [scrapBatch, setScrapBatch] = useState(null);
  // Tab scroll state
  const tabScrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  const scrollTabs = useCallback((direction) => {
    const el = tabScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -160 : 160, behavior: 'smooth' });
  }, []);

  const shopId = localStorage.getItem('shop_id');

  // Fetch or bind the active product item (LOCAL-FIRST for 0ms instant loading)
  const { data: item = initialItem, isLoading: isLoadingItem } = useQuery({
    queryKey: ['inventory_item', shopId, barcode],
    queryFn: async () => {
      if (!barcode) return null;

      let local = null;
      // 1. FAST PATH: Read directly from local IndexedDB (0ms)
      try {
        local = await getInventoryItemByBarcode(barcode);
        if (local) {
          const activeBatches = (local.batches || [])
            .filter(b => b.is_active !== false)
            .sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1));

          // Costs and stock shown here must be exact: when online, always read the
          // database (below); this device's copy is used offline or if that fails.
          if (!navigator.onLine) {
            return { ...local, batches: activeBatches };
          }
        }
      } catch (err) {
        console.warn('Failed to read item from local IDB:', err);
      }

      // 2. Fetch full product & batch details (including cost_price & purchase_cost) from Supabase
      if (navigator.onLine) {
        try {
          let itemQuery = supabase
            .from('product_master')
            .select('*, batches:inventory_batches(*)')
            .eq('barcode', barcode);
          if (shopId) {
            itemQuery = itemQuery.eq('shop_id', shopId);
          }
          const { data, error } = await itemQuery.maybeSingle();
          if (!error && data) {
            if (data.batches) {
              data.batches = data.batches
                .filter(b => b.is_active !== false)
                .sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1));
            }
            // Save to local IndexedDB so subsequent views are 0ms with cost data intact
            await saveInventoryBatch([data]);
            return data;
          }

          // Fallback to separate queries if nested relationship query fails
          let pQ = supabase.from('product_master').select('*').eq('barcode', barcode);
          if (shopId) pQ = pQ.eq('shop_id', shopId);
          const { data: pData } = await pQ.maybeSingle();
          if (pData) {
            let bQ = supabase.from('inventory_batches').select('*').eq('barcode', barcode).eq('is_active', true);
            if (shopId) bQ = bQ.eq('shop_id', shopId);
            const { data: bData } = await bQ;
            const combined = {
              ...pData,
              batches: (bData || [])
                .filter(b => b.is_active !== false)
                .sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1))
            };
            await saveInventoryBatch([combined]);
            return combined;
          }
        } catch (err) {
          console.warn('Fallback Supabase query failed:', err);
        }
      }

      if (local) {
        return {
          ...local,
          batches: (local.batches || [])
            .filter(b => b.is_active !== false)
            .sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1))
        };
      }

      return initialItem || null;
    },
    placeholderData: () => {
      if (initialItem && initialItem.batches?.length > 0) return initialItem;
      // Instant placeholder hit from parent inventory table
      try {
        const cached = queryClient.getQueryData(['inventory', shopId]);
        if (cached?.items) {
          const found = cached.items.find(i => String(i.barcode) === String(barcode));
          if (found) return found;
        }
      } catch (e) {}
      return initialItem;
    },
    staleTime: 60 * 1000
  });

  // Active batch selection state (tab) - filter out any inactive/deleted batches
  const rawBatches = item?.batches || [];
  const batches = useMemo(() => {
    return rawBatches
      .filter(b => b.is_active !== false)
      .sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1));
  }, [rawBatches]);

  const [activeBatchId, setActiveBatchId] = useSessionState(`pos_batch_active_${shopId}_${barcode}`, batches[0]?.batch_id || null);

  useEffect(() => {
    if (batches.length > 0) {
      if (!activeBatchId || !batches.some(b => b.batch_id === activeBatchId)) {
        setActiveBatchId(batches[0].batch_id);
      }
    } else {
      setActiveBatchId(null);
    }
  }, [batches, barcode]);

  const activeBatch = batches.find(b => b.batch_id === activeBatchId) || batches[0] || null;

  // Initialize scroll arrow visibility and update on resize
  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    updateScrollButtons();
    const ro = new ResizeObserver(updateScrollButtons);
    ro.observe(el);
    return () => ro.disconnect();
  }, [batches, updateScrollButtons]);

  // Scroll active tab into view whenever active batch changes
  useEffect(() => {
    if (!activeBatchId || !tabScrollRef.current) return;
    const el = tabScrollRef.current;
    const activeBtn = el.querySelector(`[data-batch-id="${activeBatchId}"]`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeBatchId]);

  // Product name inline edit state
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameEditValue, setNameEditValue] = useState(item?.name || '');

  useEffect(() => {
    if (item?.name) {
      setNameEditValue(item.name);
    }
  }, [item?.name]);

  // Batch pricing inline edit state
  const [isEditingBatch, setIsEditingBatch] = useState(false);
  const [batchEditForm, setBatchEditForm] = useState({ 
    wholesaler: '',
    cost: '', 
    msp: '',
    mrp: ''
  });

  // Product description inline edit state
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionEditValue, setDescriptionEditValue] = useState(item?.description || '');

  useEffect(() => {
    if (item?.description !== undefined) {
      setDescriptionEditValue(item.description || '');
    }
  }, [item?.description]);



  // Min quantity inline edit state
  const [isEditingMinQty, setIsEditingMinQty] = useState(false);
  const [minQtyForm, setMinQtyForm] = useState({ store: '', warehouse: '' });

  useEffect(() => {
    if (item) {
      setMinQtyForm({
        store: item.min_quantity_store ?? 0,
        warehouse: item.min_quantity_warehouse ?? 0
      });
    }
  }, [item?.barcode, item?.min_quantity_store, item?.min_quantity_warehouse]);

  useEffect(() => {
    setIsEditingBatch(false);
    if (activeBatch) {
      setBatchEditForm({
        wholesaler: activeBatch.supplier || '',
        cost: priceInputValue(activeBatch.purchase_cost, item?.cost_price),
        msp: priceInputValue(activeBatch.msp, item?.msp, item?.cost_price),
        mrp: priceInputValue(activeBatch.selling_price, item?.price)
      });
    }
  }, [activeBatch?.batch_id, activeBatch?.supplier, activeBatch?.purchase_cost, activeBatch?.msp, activeBatch?.selling_price, item?.cost_price, item?.msp, item?.price]);

  // Self-healing: if warehouse is disabled but any batch has stranded warehouse stock, merge into store stock
  useEffect(() => {
    if (isWarehouseDisabled && item && item.batches && navigator.onLine) {
      const strandedBatches = item.batches.filter(b => Number(b.stock_warehouse) > 0);
      if (strandedBatches.length > 0) {
        const fixStranded = async () => {
          try {
            const currentShopId = shopId || localStorage.getItem('shop_id');
            let totalMoved = 0;
            for (const b of strandedBatches) {
              // Compare-and-swap against the live row (not the possibly stale cached batch),
              // so concurrent sales/receipts on other terminals are never overwritten.
              const res = await casUpdateRow({
                table: 'inventory_batches',
                match: { batch_id: b.batch_id, shop_id: currentShopId },
                columns: ['stock_warehouse', 'stock_store'],
                compute: (cur) => {
                  const whseQty = Number(cur.stock_warehouse || 0);
                  if (!(whseQty > 0)) return null;
                  return {
                    update: {
                      stock_warehouse: 0,
                      stock_store: Number(cur.stock_store || 0) + whseQty
                    },
                    result: whseQty
                  };
                }
              });
              if (res.applied) totalMoved += Number(res.result || 0);
            }

            if (totalMoved > 0) {
              // (product totals are recalculated from batches by the database)
              // Also update local IDB cache immediately so offline & instant views sync
              try {
                const localItem = await getInventoryItemByBarcode(item.barcode);
                if (localItem) {
                  if (localItem.batches) {
                    localItem.batches.forEach(b => {
                      if (Number(b.stock_warehouse) > 0) {
                        b.stock_store = Number(b.stock_store || 0) + Number(b.stock_warehouse || 0);
                        b.stock_warehouse = 0;
                      }
                    });
                  }
                  localItem.stock_store = Number(localItem.stock_store || 0) + Number(localItem.stock_warehouse || 0);
                  localItem.stock_warehouse = 0;
                  await saveInventoryBatch([localItem]);
                }
              } catch (idbErr) {
                console.warn("Could not sync self-healing to IDB:", idbErr);
              }

              queryClient.invalidateQueries({ queryKey: ['inventory_item', currentShopId, item.barcode] });
              queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
              queryClient.invalidateQueries({ queryKey: ['inventory'] });
              queryClient.invalidateQueries({ queryKey: ['product_master'] });
            }
          } catch (err) {
            console.warn("Could not auto-heal stranded warehouse stock:", err);
          }
        };
        fixStranded();
      }
    }
  }, [isWarehouseDisabled, item?.barcode, item?.batches, shopId, queryClient]);


  // Batch Pricing and Stock update mutation
  const updateBatchMutation = useMutation({
    mutationFn: async ({ batch_id, wholesaler, cost, msp, mrp, stock_store, stock_warehouse }) => {
      const oldBatch = batches.find(b => b.batch_id === batch_id);
      const effectiveMrp = mrp !== undefined ? Number(mrp) : Number(oldBatch?.selling_price ?? item?.price ?? 0);
      const updatePayload = {
        supplier: wholesaler !== undefined ? (wholesaler?.trim() || null) : undefined,
        purchase_cost: Number(cost),
        msp: Number(msp),
        selling_price: effectiveMrp
      };

      if (stock_store !== undefined) {
        updatePayload.stock_store = Math.max(0, Number(stock_store) || 0);
      }
      if (!isWarehouseDisabled && stock_warehouse !== undefined) {
        updatePayload.stock_warehouse = Math.max(0, Number(stock_warehouse) || 0);
      }

      let batchQuery = supabase
        .from('inventory_batches')
        .update(updatePayload)
        .eq('batch_id', batch_id);
      if (shopId) {
        batchQuery = batchQuery.eq('shop_id', shopId);
      }
      const { error } = await batchQuery;
      if (error) throw error;

      // Bump product_master directly so delta sync captures the update and product-level cost and price are updated
      try {
        const bumpPayload = { 
          cost_price: Number(cost),
          msp: Number(msp),
          updated_at: new Date().toISOString() 
        };
        if (mrp !== undefined) {
          bumpPayload.price = Number(mrp);
        }
        let bumpQuery = supabase
          .from('product_master')
          .update(bumpPayload)
          .eq('barcode', item.barcode);
        if (shopId) bumpQuery = bumpQuery.eq('shop_id', shopId);
        await bumpQuery;
      } catch (e) {}

      const changes = [];
      if (oldBatch) {
        if (wholesaler !== undefined && (oldBatch.supplier || '') !== (wholesaler?.trim() || '')) {
          changes.push(`Wholesaler: ${oldBatch.supplier || 'None'} -> ${wholesaler?.trim() || 'None'}`);
        }
        if (Number(oldBatch.purchase_cost ?? 0) !== Number(cost)) changes.push(`Cost: ₹${formatINR(oldBatch.purchase_cost ?? 0, 2)} -> ₹${formatINR(cost, 2)}`);
        if (Number(oldBatch.msp) !== Number(msp)) changes.push(`MSP: ₹${formatINR(oldBatch.msp, 2)} -> ₹${formatINR(msp, 2)}`);
        if (Number(oldBatch.selling_price ?? 0) !== Number(mrp)) changes.push(`MRP: ₹${formatINR(oldBatch.selling_price ?? 0, 2)} -> ₹${formatINR(mrp, 2)}`);
        if (stock_store !== undefined && Number(oldBatch.stock_store) !== Number(stock_store)) {
          changes.push(`Store Stock: ${oldBatch.stock_store} -> ${stock_store}`);
        }
        if (!isWarehouseDisabled && stock_warehouse !== undefined && Number(oldBatch.stock_warehouse) !== Number(stock_warehouse)) {
          changes.push(`Warehouse Stock: ${oldBatch.stock_warehouse} -> ${stock_warehouse}`);
        }
      }

      if (changes.length > 0) {
        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          action_type: 'UPDATE',
          barcode: item.barcode,
          item_name: item.name,
          changes: `Updated Batch ${oldBatch?.batch_number || 1}: ${changes.join(', ')}`,
          performed_by: getPerformedBy()
        }]);
      }
    },
    onSuccess: async (_, variables) => {
      // Captured before the refresh so we know whether the MRP changed
      const batchBefore = batches.find(b => b.batch_id === variables.batch_id);
      const oldMrp = Number(batchBefore?.selling_price ?? item?.price ?? 0);
      const newMrp = variables.mrp !== undefined ? Number(variables.mrp) : oldMrp;
      try {
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem) {
          localItem.cost_price = Number(variables.cost);
          localItem.msp = Number(variables.msp);
          if (variables.mrp !== undefined) {
            localItem.price = Number(variables.mrp);
          }
          if (localItem.batches) {
            const bIndex = localItem.batches.findIndex(b => b.batch_id === variables.batch_id);
            if (bIndex >= 0) {
              if (variables.wholesaler !== undefined) {
                localItem.batches[bIndex].supplier = variables.wholesaler?.trim() || null;
              }
              localItem.batches[bIndex].purchase_cost = Number(variables.cost);
              localItem.batches[bIndex].msp = Number(variables.msp);
              if (variables.mrp !== undefined) {
                localItem.batches[bIndex].selling_price = Number(variables.mrp);
              }
              if (variables.stock_store !== undefined) {
                localItem.batches[bIndex].stock_store = Math.max(0, Number(variables.stock_store) || 0);
              }
              if (variables.stock_warehouse !== undefined) {
                localItem.batches[bIndex].stock_warehouse = Math.max(0, Number(variables.stock_warehouse) || 0);
              }
            }
          }
          await saveInventoryBatch([localItem]);
        }
      } catch (e) {
        console.error('Failed to update IDB for batch', e);
      }
      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setIsEditingBatch(false);
      if (batchBefore && Math.abs(newMrp - oldMrp) >= 0.005) {
        // Labels already on the shelf still show the old MRP; offer to print new ones now
        showConfirm(
          `Batch updated. The MRP changed from ₹${formatINR(oldMrp, 2)} to ₹${formatINR(newMrp, 2)}, so labels already on the products still show the old price.\n\nPrint new labels for this batch now?`,
          () => setPrintBatchModal({ isOpen: true, batch: { ...batchBefore, selling_price: newMrp } }),
          'Price Changed',
          'Print Labels',
          'Later'
        );
      } else {
        showAlert('Batch details updated successfully.', 'Success');
      }
    },
    onError: (e) => {
      showAlert('Failed to update batch: ' + e.message, 'Error');
    }
  });



  // Product description mutation
  const updateProductDescriptionMutation = useMutation({
    mutationFn: async (newDesc) => {
      const cleanDesc = newDesc?.trim() || null;
      let query = supabase
        .from('product_master')
        .update({ description: cleanDesc, updated_at: new Date().toISOString() })
        .eq('barcode', item.barcode);
      if (shopId) query = query.eq('shop_id', shopId);
      let { error } = await query;
      if (error && (error.message?.includes('description') || error.code === '42703')) {
        console.warn('description column not yet present on remote product_master, updating local cache only');
        error = null;
      }
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        shop_id: shopId,
        action_type: 'UPDATE',
        barcode: item.barcode,
        item_name: item.name,
        changes: `Description: ${item.description || 'None'} -> ${cleanDesc || 'None'}`,
        performed_by: getPerformedBy()
      }]);
    },
    onSuccess: async (_, newDesc) => {
      try {
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem) {
          localItem.description = newDesc?.trim() || null;
          await saveInventoryBatch([localItem]);
        }
      } catch (e) {
        console.error('Failed to update IDB for description', e);
      }
      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setIsEditingDescription(false);
      showAlert('Product description updated successfully.', 'Success');
    },
    onError: (e) => {
      showAlert('Failed to update description: ' + e.message, 'Error');
    }
  });

  // Min quantity update mutation
  const updateMinQtyMutation = useMutation({
    mutationFn: async ({ storeQty, whseQty }) => {
      const parsedStore = Math.max(0, Number(storeQty) || 0);
      const parsedWhse = Math.max(0, Number(whseQty) || 0);

      let minQuery = supabase
        .from('product_master')
        .update({
          min_quantity_store: parsedStore,
          min_quantity_warehouse: parsedWhse
        })
        .eq('barcode', item.barcode);
      if (shopId) {
        minQuery = minQuery.eq('shop_id', shopId);
      }
      const { error } = await minQuery;

      if (error) throw error;

      // Audit log
      const changes = [];
      if (Number(item.min_quantity_store ?? 0) !== parsedStore) {
        changes.push(`Min Store: ${item.min_quantity_store ?? 0} -> ${parsedStore}`);
      }
      if (Number(item.min_quantity_warehouse ?? 0) !== parsedWhse) {
        changes.push(`Min Whse: ${item.min_quantity_warehouse ?? 0} -> ${parsedWhse}`);
      }

      if (changes.length > 0) {
        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          action_type: 'UPDATE',
          barcode: item.barcode,
          item_name: item.name,
          changes: `Updated Min Stock Thresholds: ${changes.join(', ')}`,
          performed_by: getPerformedBy()
        }]);
      }

      return { parsedStore, parsedWhse };
    },
    onSuccess: async ({ parsedStore, parsedWhse }) => {
      try {
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem) {
          localItem.min_quantity_store = parsedStore;
          localItem.min_quantity_warehouse = parsedWhse;
          await saveInventoryBatch([localItem]);
        }
      } catch (e) {
        console.error('Failed to update IDB for min quantities', e);
      }

      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['product_master'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setIsEditingMinQty(false);
      showAlert('Minimum quantities updated successfully.', 'Success');
    },
    onError: (e) => {
      showAlert('Failed to update minimum quantities: ' + e.message, 'Error');
    }
  });

  // Product name update mutation
  const updateProductNameMutation = useMutation({
    mutationFn: async (newName) => {
      const trimmed = (newName || '').trim();
      if (!trimmed) throw new Error('Product name cannot be empty');

      const currentShopId = shopId || localStorage.getItem('shop_id');
      let updateQuery = supabase
        .from('product_master')
        .update({
          name: trimmed,
          updated_at: new Date().toISOString()
        })
        .eq('barcode', item.barcode);
      if (currentShopId) {
        updateQuery = updateQuery.eq('shop_id', currentShopId);
      }
      const { error } = await updateQuery;
      if (error) throw error;

      if (item.name !== trimmed) {
        try {
          await supabase.from('audit_logs').insert([{
            shop_id: currentShopId,
            action_type: 'UPDATE',
            barcode: item.barcode,
            item_name: trimmed,
            changes: `Renamed product from "${item.name}" to "${trimmed}"`,
            performed_by: getPerformedBy()
          }]);
        } catch (err) {
          console.warn('Failed to record rename audit log:', err);
        }
      }
      return trimmed;
    },
    onSuccess: async (trimmed) => {
      try {
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem) {
          await saveInventoryBatch([{ ...localItem, name: trimmed }]);
        }
      } catch (e) {
        console.error('Failed to update IDB for product name', e);
      }

      queryClient.setQueriesData({ queryKey: ['inventory_item'] }, (old) => {
        if (!old) return old;
        return { ...old, name: trimmed };
      });

      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['product_master'] });
      setIsEditingName(false);
      showAlert('Product name updated successfully.', 'Success');
    },
    onError: (e) => {
      showAlert('Failed to update product name: ' + e.message, 'Error');
    }
  });

  // Delete batch execution
  const confirmDeleteBatch = async () => {
    if (!batchToDelete) return;
    const deletingId = batchToDelete;
    try {
      // 1. Delete from remote Supabase (attempt hard delete first, fallback to soft delete)
      let deletedRemotely = false;
      try {
        let delQuery = supabase.from('inventory_batches').delete().eq('batch_id', deletingId);
        if (shopId) delQuery = delQuery.eq('shop_id', shopId);
        const { error: delErr } = await delQuery;
        if (!delErr) deletedRemotely = true;
      } catch (e) {
        console.warn('Hard delete failed, falling back to soft delete', e);
      }

      if (!deletedRemotely) {
        let updateQuery = supabase
          .from('inventory_batches')
          .update({ is_active: false, stock_store: 0, stock_warehouse: 0 })
          .eq('batch_id', deletingId);
        if (shopId) updateQuery = updateQuery.eq('shop_id', shopId);
        const { error: updErr } = await updateQuery;
        if (updErr) throw updErr;
      }

      // Bump product_master.updated_at directly so delta sync captures the deletion
      try {
        let bumpQuery = supabase
          .from('product_master')
          .update({ updated_at: new Date().toISOString() })
          .eq('barcode', item.barcode);
        if (shopId) bumpQuery = bumpQuery.eq('shop_id', shopId);
        await bumpQuery;
      } catch (e) {}

      const oldBatch = batches.find(b => b.batch_id === deletingId);
      const removedStock = Number(oldBatch?.stock_store || 0) + Number(oldBatch?.stock_warehouse || 0);
      await supabase.from('audit_logs').insert([{
        shop_id: shopId,
        action_type: 'DELETE',
        barcode: item.barcode,
        item_name: item.name,
        changes: `Deleted Batch #${oldBatch?.batch_number || 1}${removedStock > 0 ? ` (removed ${removedStock} ${displayUnit} stock)` : ''}`,
        performed_by: getPerformedBy()
      }]);

      // 2. Immediately update local IndexedDB cache
      try {
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem && localItem.batches) {
          localItem.batches = localItem.batches.filter(b => b.batch_id !== deletingId && b.is_active !== false);
          await saveInventoryBatch([localItem]);
        }
      } catch (e) {
        console.error('Failed to update IDB on batch delete', e);
      }

      // 3. Update React Query memory caches immediately so UI updates with 0 latency
      queryClient.setQueriesData({ queryKey: ['inventory_item'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          batches: (old.batches || []).filter(b => b.batch_id !== deletingId && b.is_active !== false)
        };
      });

      // 4. Switch activeBatchId immediately to the first remaining batch
      const remainingBatches = batches.filter(b => b.batch_id !== deletingId && b.is_active !== false);
      setActiveBatchId(remainingBatches[0]?.batch_id || null);

      // 5. Invalidate queries across the app
      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      showAlert('Batch deleted successfully.', 'Success');
    } catch (err) {
      console.error(err);
      showAlert('Failed to delete batch: ' + err.message, 'Error');
    } finally {
      setBatchToDelete(null);
    }
  };



  if (!item && isLoadingItem) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[350px] p-12">
        <PageLoader text="Loading item details..." />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <p className="text-sm text-[var(--text-secondary)] mb-4">Item not found.</p>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg bg-[var(--color-accent-solid)] text-white text-xs font-bold uppercase"
        >
          Back to {isWarehouseDisabled ? 'Inventory' : 'Warehouse'}
        </button>
      </div>
    );
  }

  const displayUnit = (item.unit?.toLowerCase() === 'kg' || item.unit?.toLowerCase() === 'grams') ? 'kg' : item.unit?.toLowerCase() === 'meter' ? 'm' : item.unit?.toLowerCase() === 'sqft' ? 'sqft' : (item.unit || 'PCS');

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 animate-fade-in">
      {/* ROW 1: TOP NAVIGATION WITH BACK BUTTON */}
      <div className="flex items-center pb-3 mb-2 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-medium)] transition-all cursor-pointer shadow-sm hover:border-[var(--color-accent)]"
          title={isWarehouseDisabled ? "Back to Items" : "Back to Warehouse Items"}
        >
          <ArrowLeft className="w-4 h-4 text-[var(--color-accent)]" />
          <span>Back</span>
        </button>
      </div>

      {/* ROW 2: ITEM NAME, BARCODE, CATEGORY & MIN QUANTITY THRESHOLDS */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 mb-4 border-b border-[var(--border-light)] shrink-0">
        <div className="flex flex-col gap-1 min-w-0">
          {isEditingName ? (
            <div className="flex flex-wrap items-center gap-2 animate-fade-in w-full max-w-xl">
              <input
                type="text"
                value={nameEditValue}
                onChange={(e) => setNameEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (nameEditValue.trim() && !updateProductNameMutation.isPending) {
                      updateProductNameMutation.mutate(nameEditValue);
                    }
                  } else if (e.key === 'Escape') {
                    setIsEditingName(false);
                    setNameEditValue(item.name || '');
                  }
                }}
                placeholder="Product Name"
                className="w-full sm:w-auto sm:flex-1 min-w-0 h-9 sm:h-8 px-3 text-sm sm:text-base font-bold rounded-lg bg-[var(--bg-input)] border border-[var(--color-accent)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] shadow-sm"
                autoFocus
              />
              <button
                type="button"
                onClick={() => updateProductNameMutation.mutate(nameEditValue)}
                disabled={updateProductNameMutation.isPending || !nameEditValue.trim()}
                className="h-8 px-3 rounded-lg bg-[var(--color-success-solid)] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm hover:brightness-110 disabled:opacity-50 cursor-pointer"
                title="Save Name (Enter)"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{updateProductNameMutation.isPending ? 'Saving...' : 'Save'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingName(false);
                  setNameEditValue(item.name || '');
                }}
                className="h-8 px-3 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                title="Cancel (Esc)"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] truncate" title={item.name}>
                {item.name}
              </h1>

              {viewType !== 'recycle' && (
                <button
                  type="button"
                  onClick={() => {
                    setNameEditValue(item.name || '');
                    setIsEditingName(true);
                  }}
                  className="p-1.5 rounded-lg border border-[var(--border-medium)] hover:border-[var(--color-accent)] text-[var(--text-secondary)] hover:text-[var(--color-accent)] hover:bg-white/5 transition-all cursor-pointer shadow-sm active:scale-95"
                  title="Edit Product Name"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              )}

              <span 
                className="px-2.5 py-0.5 text-xs font-bold rounded tracking-wider shrink-0"
                style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', border: '1px solid rgba(59, 130, 246, 0.3)' }}
              >
                #{item.barcode}
              </span>

              {item.is_loose_item && (
                <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/25">
                  Loose
                </span>
              )}
            </div>
          )}

          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {item.category || 'General'} {item.sub_category ? `› ${item.sub_category}` : ''}
          </p>

          {/* PRODUCT DESCRIPTION */}
          {isEditingDescription ? (
            <div className="mt-2.5 flex flex-col gap-1.5 max-w-xl">
              <textarea
                value={descriptionEditValue}
                onChange={e => setDescriptionEditValue(e.target.value)}
                placeholder="Product description, notes, specifications..."
                className="w-full text-xs p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--color-accent)] text-[var(--text-primary)] focus:outline-none resize-y min-h-[58px]"
                autoFocus
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateProductDescriptionMutation.mutate(descriptionEditValue)}
                  disabled={updateProductDescriptionMutation.isPending}
                  className="h-6 px-2.5 rounded bg-[var(--color-success-solid)] text-white text-[11px] font-bold cursor-pointer hover:brightness-110 flex items-center gap-1 disabled:opacity-50"
                  title="Save Description"
                >
                  <Check className="w-3 h-3" />
                  <span>{updateProductDescriptionMutation.isPending ? 'Saving...' : 'Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDescriptionEditValue(item?.description || '');
                    setIsEditingDescription(false);
                  }}
                  className="h-6 px-2.5 rounded border border-red-500/40 text-red-400 text-[11px] font-bold cursor-pointer hover:bg-red-500/10 flex items-center gap-1"
                  title="Cancel"
                >
                  <X className="w-3 h-3" />
                  <span>Cancel</span>
                </button>
              </div>
            </div>
          ) : item?.description ? (
            <div className="mt-2 flex items-start gap-1.5 group max-w-2xl">
              <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 rounded-md border border-[var(--border-light)] leading-relaxed whitespace-pre-line flex-1">
                {item.description}
              </p>
              {viewType !== 'recycle' && (
                <button
                  type="button"
                  onClick={() => {
                    setDescriptionEditValue(item?.description || '');
                    setIsEditingDescription(true);
                  }}
                  className="p-1 rounded opacity-60 hover:opacity-100 hover:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--color-accent)] cursor-pointer shrink-0 transition-opacity"
                  title="Edit Description"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : (
            viewType !== 'recycle' && (
              <button
                type="button"
                onClick={() => {
                  setDescriptionEditValue('');
                  setIsEditingDescription(true);
                }}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--color-accent)] cursor-pointer transition-colors"
                title="Add product description"
              >
                <Plus className="w-3 h-3" />
                <span>Add Description</span>
              </button>
            )
          )}
        </div>

        {/* MIN QUANTITY (STORE & WHSE) THRESHOLDS & ADD BATCH */}
        <div className="shrink-0 self-start sm:self-center flex flex-wrap items-center gap-2.5">
          {isEditingMinQty ? (
            <div className="flex items-center gap-2 bg-[var(--bg-secondary)] px-3 py-1.5 rounded-lg border border-[var(--border-medium)] text-xs shadow-sm animate-fade-in">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Min Alert:
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[var(--text-secondary)]">{isWarehouseDisabled ? 'Min Qty' : 'Store'}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={minQtyForm.store}
                  onChange={e => setMinQtyForm(prev => ({ ...prev, store: e.target.value }))}
                  className="w-14 h-7 px-2 text-xs font-bold rounded bg-[var(--bg-input)] border border-[var(--border-medium)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)] text-center"
                  placeholder="0"
                  autoFocus
                />
              </div>
              {!isWarehouseDisabled && (
                <>
                  <span className="text-[var(--text-tertiary)] opacity-30">•</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[var(--text-secondary)]">Whse</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={minQtyForm.warehouse}
                      onChange={e => setMinQtyForm(prev => ({ ...prev, warehouse: e.target.value }))}
                      className="w-14 h-7 px-2 text-xs font-bold rounded bg-[var(--bg-input)] border border-[var(--border-medium)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)] text-center"
                      placeholder="0"
                    />
                  </div>
                </>
              )}
              <span className="text-[11px] text-[var(--text-tertiary)]">{displayUnit}</span>

              <div className="flex items-center gap-1 ml-1.5 pl-1.5 border-l border-[var(--border-light)]">
                <button
                  onClick={() => {
                    updateMinQtyMutation.mutate({
                      storeQty: minQtyForm.store,
                      whseQty: isWarehouseDisabled ? 0 : minQtyForm.warehouse
                    });
                  }}
                  disabled={updateMinQtyMutation.isPending}
                  className="h-7 px-2.5 rounded bg-[var(--color-success-solid)] text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all shadow-sm hover:brightness-110 disabled:opacity-50 cursor-pointer"
                  title="Save Minimum Quantities"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{updateMinQtyMutation.isPending ? '...' : 'Save'}</span>
                </button>
                <button
                  onClick={() => {
                    setIsEditingMinQty(false);
                    setMinQtyForm({
                      store: item.min_quantity_store ?? 0,
                      warehouse: item.min_quantity_warehouse ?? 0
                    });
                  }}
                  className="h-7 px-2 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 text-[11px] font-bold flex items-center justify-center transition-all cursor-pointer"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 bg-[var(--bg-secondary)] px-3 py-1.5 rounded-lg border border-[var(--border-light)] text-xs text-[var(--text-secondary)] shadow-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Min Alert:</span>
              <span className="text-[var(--text-primary)] font-medium">{isWarehouseDisabled ? '' : 'Store '}<strong className="text-[var(--text-primary)] font-bold">{item.min_quantity_store ?? 0} {displayUnit}</strong></span>
              {!isWarehouseDisabled && (
                <>
                  <span className="text-[var(--text-tertiary)] opacity-30">•</span>
                  <span className="text-[var(--text-primary)] font-medium">Whse <strong className="text-[var(--text-primary)] font-bold">{item.min_quantity_warehouse ?? 0} {displayUnit}</strong></span>
                </>
              )}
              
              <div className="w-[1px] h-3.5 bg-[var(--border-light)] mx-0.5" />
              
              <button
                onClick={() => setIsEditingMinQty(true)}
                className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                title={isWarehouseDisabled ? "Edit Minimum Stock Alert" : "Edit Minimum Quantities for Store and Warehouse"}
              >
                <Edit3 className="w-3 h-3 text-[var(--color-accent)]" />
                <span>Edit</span>
              </button>
            </div>
          )}

          {viewType !== 'recycle' && batches.length > 0 && (
            <button
              onClick={() => setCreateBatchModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent-solid)] text-white text-xs font-bold tracking-wide hover:brightness-110 active:scale-95 shadow-sm transition-all cursor-pointer"
              title="Create New Batch for this item"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Batch</span>
            </button>
          )}
        </div>
      </div>

      {/* BROWSER-STYLE TAB BAR */}
      <div className="relative flex items-stretch border-b border-[var(--border-light)] shrink-0">
        {/* Left scroll arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scrollTabs('left')}
            className="flex items-center justify-center px-2 shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors z-10"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}

        {/* Scrollable tab list */}
        <div
          ref={tabScrollRef}
          className="flex items-end gap-1 overflow-x-auto overflow-y-hidden flex-1 min-w-0"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            overflowY: 'hidden'
          }}
          onScroll={updateScrollButtons}
        >
          {batches.length === 0 ? (
            <div className="px-4 py-2 text-xs font-medium text-[var(--text-tertiary)] italic">
              No batches available
            </div>
          ) : (() => {
            const seenBatchNums = new Set();
            return batches.map((batch, idx) => {
              const isActive = activeBatch?.batch_id === batch.batch_id;
              let batchNum = batch.batch_number;
              if (!batchNum || seenBatchNums.has(batchNum)) {
                batchNum = idx + 1;
                while (seenBatchNums.has(batchNum)) batchNum++;
              }
              seenBatchNums.add(batchNum);
              const batchCode = `${item.barcode}-${String(batchNum).padStart(2, '0')}`;

              const totalBatchStock = isWarehouseDisabled
                ? (Number(batch.stock_store || 0) + Number(batch.stock_warehouse || 0))
                : (Number(batch.stock_store || 0) + Number(batch.stock_warehouse || 0));
              const tabCountLabel = `${totalBatchStock} ${displayUnit}`;

              return (
                <button
                  key={batch.batch_id}
                  data-batch-id={batch.batch_id}
                  onClick={() => setActiveBatchId(batch.batch_id)}
                  className={`group relative flex items-center gap-2.5 px-4 py-2.5 rounded-t-lg text-xs transition-colors cursor-pointer whitespace-nowrap select-none shrink-0 ${
                    isActive
                      ? 'font-bold text-[var(--text-primary)] z-10'
                      : 'font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                  }`}
                  style={{
                    backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent',
                    borderTop: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                    borderLeft: isActive ? '1px solid var(--border-light)' : '1px solid transparent',
                    borderRight: isActive ? '1px solid var(--border-light)' : '1px solid transparent',
                    borderBottom: isActive ? '1px solid var(--bg-tertiary)' : '1px solid transparent',
                    marginBottom: isActive ? '-1px' : '0px'
                  }}
                  title={`View Batch ${batchCode}${batch.supplier ? ` • Wholesaler: ${batch.supplier}` : ''}`}
                >
                  <Layers className={`w-3.5 h-3.5 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]'}`} />
                  <span>Batch {batchCode}</span>
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${
                      isActive
                        ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]'
                        : 'bg-white/5 text-[var(--text-tertiary)]'
                    }`}
                  >
                    {tabCountLabel}
                  </span>
                </button>
              );
            });
          })()}
        </div>

        {/* Right scroll arrow */}
        {canScrollRight && (
          <button
            onClick={() => scrollTabs('right')}
            className="flex items-center justify-center px-2 shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors z-10"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* MAIN DETAILS AREA */}
      <div 
        className="flex-1 overflow-y-auto p-5 sm:p-6 flex flex-col gap-6 rounded-b-xl border border-t-0 border-[var(--border-light)]"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      >
        {!activeBatch ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-[var(--border-medium)] rounded-xl my-auto">
            <PackageCheck className="w-12 h-12 text-[var(--text-tertiary)] mb-3" />
            <h3 className="text-base font-bold text-[var(--text-primary)]">No Active Batch</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
              This product currently does not have any inventory batches. Click "Create Batch" to initialize stock, cost price, and selling prices.
            </p>
            <button
              onClick={() => setCreateBatchModalOpen(true)}
              className="mt-5 px-4 py-2 rounded-lg bg-[var(--color-accent-solid)] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md hover:brightness-110 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create Batch
            </button>
          </div>
        ) : (
          <>
            {/* BATCH TOP BAR */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border-light)]">
              <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] block">
                      Active Batch ID
                    </span>
                    <span className="text-base font-bold text-[var(--text-primary)]">
                      {item.barcode}-{String(activeBatch.batch_number || 1).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Active
                  </span>

                  {/* Wholesaler / Supplier Display or Edit Input */}
                  {isEditingBatch ? (
                    <div className="flex items-center gap-1.5 bg-[var(--bg-secondary)] px-2.5 py-1 rounded-lg border border-[var(--border-medium)]">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] shrink-0">
                        Wholesaler:
                      </span>
                      <input
                        type="text"
                        value={batchEditForm.wholesaler || ''}
                        onChange={e => setBatchEditForm(prev => ({ ...prev, wholesaler: e.target.value }))}
                        placeholder="Wholesaler / Supplier"
                        className="h-6 px-2 text-xs font-semibold rounded bg-[var(--bg-input)] border border-[var(--color-accent)] text-[var(--text-primary)] focus:outline-none w-36 sm:w-44"
                      />
                    </div>
                  ) : activeBatch.supplier ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-light)] text-xs text-[var(--text-secondary)]" title="Wholesaler / Supplier">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Wholesaler:</span>
                      <span className="font-semibold text-[var(--text-primary)]">{activeBatch.supplier}</span>
                    </div>
                  ) : null}
                </div>

                    {/* Batch Action Buttons */}
                    <div className="flex items-center gap-2">
                      {isEditingBatch ? (
                        <>
                          <button
                            onClick={() => {
                              const numCost = Number(batchEditForm.cost);
                              if (batchEditForm.cost === '' || isNaN(numCost) || numCost < 0) {
                                showAlert("Please enter a valid non-negative Cost Price.", "Validation Error");
                                return;
                              }
                              const numMsp = Number(batchEditForm.msp);
                              if (isNaN(numMsp) || numMsp <= 0 || batchEditForm.msp === '') {
                                showAlert("Please enter a valid positive Minimum Selling Price (MSP).", "Validation Error");
                                return;
                              }
                              const numMrp = Number(batchEditForm.mrp);
                              if (isNaN(numMrp) || numMrp <= 0 || batchEditForm.mrp === '') {
                                showAlert("Please enter a valid positive Selling Price (MRP).", "Validation Error");
                                return;
                              }
                              if (numMsp < numCost) {
                                showAlert(`MSP (₹${formatINR(numMsp, 2)}) cannot be lower than the purchase cost (₹${formatINR(numCost, 2)}).`, "Validation Error");
                                return;
                              }
                              if (numMrp < numMsp) {
                                showAlert(`Selling Price / MRP (₹${formatINR(numMrp, 2)}) cannot be lower than MSP (₹${formatINR(numMsp, 2)}).`, "Validation Error");
                                return;
                              }
                              updateBatchMutation.mutate({
                                batch_id: activeBatch.batch_id,
                                wholesaler: batchEditForm.wholesaler,
                                cost: batchEditForm.cost,
                                msp: batchEditForm.msp,
                                mrp: batchEditForm.mrp
                              });
                            }}
                            disabled={updateBatchMutation.isPending}
                            className="h-8 px-3 rounded-lg bg-[var(--color-success-solid)] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm hover:brightness-110 disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {updateBatchMutation.isPending ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => {
                              setIsEditingBatch(false);
                              setBatchEditForm({
                                wholesaler: activeBatch.supplier || '',
                                cost: priceInputValue(activeBatch.purchase_cost, item?.cost_price),
                                msp: priceInputValue(activeBatch.msp, item?.msp, item?.cost_price),
                                mrp: priceInputValue(activeBatch.selling_price, item?.price)
                              });
                            }}
                            className="h-8 px-3 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          {viewType !== 'recycle' && (
                            <button
                              onClick={() => setIsEditingBatch(true)}
                              className="h-8 px-3 rounded-lg border border-[var(--border-medium)] hover:border-[var(--color-accent)] text-[var(--text-primary)] hover:bg-white/5 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                              title="Edit Batch Cost, MSP, MRP and Wholesaler"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                              Edit Batch
                            </button>
                          )}
                          <button
                            onClick={() => setPrintBatchModal({ isOpen: true, batch: activeBatch })}
                            className="h-8 px-3 rounded-lg border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-bg)] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                            title="Print Barcode Labels for this batch"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Print Labels
                          </button>
                          {viewType !== 'recycle' && (
                            <>
                            {isScrewBox(item) && (
                              <button
                                onClick={() => {
                                  const inStore = Number(activeBatch.stock_store || 0) + (isWarehouseDisabled ? Number(activeBatch.stock_warehouse || 0) : 0);
                                  if (inStore < 1) {
                                    showAlert('There are no boxes of this batch in store stock to open.', 'No Boxes in Store');
                                    return;
                                  }
                                  showConfirm(
                                    `Open 1 box of ${item.name} (Batch ${String(activeBatch.batch_number || 1).padStart(2, '0')}) for loose sale?\n\nIt is removed from store stock and inventory value. This is not a sale.`,
                                    async () => {
                                      try {
                                        await openScrewBox({ item, batch: activeBatch, shopId, isWarehouseDisabled });
                                        queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
                                        queryClient.invalidateQueries({ queryKey: ['inventory'] });
                                        queryClient.invalidateQueries({ queryKey: ['unifiedAuditLogs'] });
                                        showAlert(`1 box of ${item.name} opened for loose sale.`, 'Box Opened');
                                      } catch (err) {
                                        showAlert(err.message || 'Could not open the box.', 'Error');
                                      }
                                    },
                                    'Open Screw Box',
                                    'Open 1 Box',
                                    'Cancel'
                                  );
                                }}
                                className="h-8 px-3 rounded-lg border border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                                title="Remove 1 box from store stock to sell its screws loose (not a sale)"
                              >
                                Open 1 Box
                              </button>
                            )}
                            {/* Scrap (write off offcuts) is only for cut-length items */}
                            {item.is_cuttable && (
                            <button
                              onClick={() => setScrapBatch(activeBatch)}
                              className="h-8 px-3 rounded-lg border border-amber-500/50 text-amber-500 hover:bg-amber-500/10 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                              title="Write off offcuts / scrap length from this batch"
                            >
                              Scrap
                            </button>
                            )}
                            </>
                          )}
                          {viewType !== 'recycle' && (
                            <button
                              onClick={() => {
                                setBatchToDelete(activeBatch.batch_id);
                              }}
                              className="h-8 px-3 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                              title="Delete batch and remove its stock"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
              </div>

              {/* Metrics Grid */}
              <div className={`grid grid-cols-2 sm:grid-cols-3 ${isWarehouseDisabled ? 'lg:grid-cols-4' : 'lg:grid-cols-5'} gap-3`}>
                {/* Cost Price */}
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                    Cost
                  </span>
                  {isEditingBatch ? (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={batchEditForm.cost}
                      onChange={e => setBatchEditForm(prev => ({ ...prev, cost: e.target.value }))}
                      className="w-full h-7 px-2 text-sm font-bold rounded bg-[var(--bg-input)] border border-[var(--color-accent)] text-[var(--text-primary)] focus:outline-none"
                      placeholder="0.00"
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                      ₹{formatINR(Number(activeBatch.purchase_cost ?? item.cost_price ?? 0), 2)}
                    </span>
                  )}
                </div>

                {/* MSP */}
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                    MSP
                  </span>
                  {isEditingBatch ? (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={batchEditForm.msp}
                      onChange={e => setBatchEditForm(prev => ({ ...prev, msp: e.target.value }))}
                      className="w-full h-7 px-2 text-sm font-bold rounded bg-[var(--bg-input)] border border-[var(--color-accent)] text-[var(--text-primary)] focus:outline-none"
                      placeholder="0.00"
                    />
                  ) : (
                    <span className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                      ₹{formatINR(Number(activeBatch.msp ?? item.msp ?? item.cost_price ?? 0), 2)}
                    </span>
                  )}
                </div>

                {/* MRP */}
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                    MRP
                  </span>
                  {isEditingBatch ? (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={batchEditForm.mrp}
                      onChange={e => setBatchEditForm(prev => ({ ...prev, mrp: e.target.value }))}
                      className="w-full h-7 px-2 text-sm font-bold rounded bg-[var(--bg-input)] border border-[var(--color-accent)] text-[var(--text-primary)] focus:outline-none"
                      placeholder="0.00"
                    />
                  ) : (
                    <span className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                      ₹{formatINR(Number(activeBatch.selling_price ?? item.price ?? 0), 2)}
                    </span>
                  )}
                </div>

                {/* Warehouse Stock */}
                {!isWarehouseDisabled && (
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                      Warehouse Stock
                    </span>
                    <span className="text-sm sm:text-base font-bold text-[var(--color-accent)]">
                      {activeBatch.stock_warehouse ?? 0}
                      <span className="text-xs font-normal text-[var(--text-secondary)] ml-1">
                        {displayUnit}
                      </span>
                    </span>
                  </div>
                )}

                {/* Store Stock */}
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                    {isWarehouseDisabled ? 'Current Stock' : 'Store Stock'}
                  </span>
                  <span className="text-sm sm:text-base font-bold text-[var(--color-success)]">
                    {isWarehouseDisabled ? (Number(activeBatch?.stock_store || 0) + Number(activeBatch?.stock_warehouse || 0)) : (activeBatch?.stock_store ?? 0)}
                    <span className="text-xs font-normal text-[var(--text-secondary)] ml-1">
                      {displayUnit}
                    </span>
                  </span>
                </div>
              </div>

            {/* CUTTABLE ITEM SPECIFICATION CARD */}
            {item.is_cuttable && (
              <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-light)] flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                    <Scissors className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                      Cut-Length Item
                    </h4>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      Stocked and sold by total {String(item.unit || 'ft').toLowerCase()} (no pieces). Use <strong>Scrap</strong> on a batch to write off offcuts.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
                    Billed By
                  </span>
                  <span className="text-xs font-bold text-[var(--color-accent)]">
                    Strictly per {item.unit === 'SQFT' ? 'sq.ft' : (item.unit || 'ft')}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* PRINT BATCH MODAL */}
      {printBatchModal.isOpen && printBatchModal.batch && (
        <PrintBatchModal 
          isOpen={printBatchModal.isOpen} 
          onClose={() => setPrintBatchModal({ isOpen: false, batch: null })} 
          item={item} 
          selectedBatch={printBatchModal.batch}
        />
      )}

      {/* SCRAP STOCK MODAL */}
      <ScrapStockModal
        isOpen={!!scrapBatch}
        item={item}
        batch={scrapBatch}
        isWarehouseDisabled={isWarehouseDisabled}
        onClose={() => setScrapBatch(null)}
        onConfirm={async ({ qty, location, reason }) => {
          const currentShopId = shopId || localStorage.getItem('shop_id');
          const scrapNote = `Scrapped ${qty} ${item.unit || ''} from Batch ${scrapBatch.batch_number || 1}${reason ? ` — ${reason}` : ''}`;
          const { fromStore, fromWarehouse, audited } = await scrapBatchStock({
            batchId: scrapBatch.batch_id,
            barcode: item.barcode,
            shopId: currentShopId,
            qty,
            location,
            allowOtherLocation: isWarehouseDisabled,
            actionType: 'SCRAP',
            note: scrapNote,
            performedBy: getPerformedBy(),
          });
          if (!audited) try {
            await supabase.from('audit_logs').insert([{
              shop_id: currentShopId,
              action_type: 'SCRAP',
              barcode: item.barcode,
              item_name: item.name,
              changes: `Scrapped ${qty} ${item.unit || ''} from Batch ${scrapBatch.batch_number || 1}${fromWarehouse > 0 && fromStore > 0 ? ` (store ${fromStore}, warehouse ${fromWarehouse})` : fromWarehouse > 0 ? ' (warehouse)' : ' (store)'}${reason ? ` — ${reason}` : ''}`,
              performed_by: getPerformedBy()
            }]);
          } catch (e) {
            console.warn('Could not write scrap audit log:', e);
          }
          // Update the local copy immediately; the background sync confirms it
          try {
            const localItem = await getInventoryItemByBarcode(item.barcode);
            if (localItem?.batches) {
              const b = localItem.batches.find(x => x.batch_id === scrapBatch.batch_id);
              if (b) {
                b.stock_store = Math.max(0, Number(b.stock_store || 0) - fromStore);
                b.stock_warehouse = Math.max(0, Number(b.stock_warehouse || 0) - fromWarehouse);
                await saveInventoryBatch([localItem]);
              }
            }
          } catch (e) {
            console.warn('Could not update local stock after scrap:', e);
          }
          queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          queryClient.invalidateQueries({ queryKey: ['unifiedAuditLogs'] });
          setScrapBatch(null);
          showAlert(`Scrapped ${qty} ${item.unit || ''} of ${item.name}.`, 'Stock Updated');
        }}
      />

      {/* CREATE BATCH MODAL */}
      {createBatchModalOpen && (
        <CreateBatchModal 
          item={item} 
          onBatchCreated={(newBatch) => {
            if (newBatch?.batch_id) {
              setActiveBatchId(newBatch.batch_id);
            }
          }}
          onClose={() => setCreateBatchModalOpen(false)} 
        />
      )}

      {/* CONFIRM DELETE BATCH DIALOG */}
      <ConfirmDialog
        isOpen={!!batchToDelete}
        title="Delete Batch"
        message={
          (() => {
            const batchObj = batches.find(b => b.batch_id === batchToDelete);
            const totalStock = batchObj ? (Number(batchObj.stock_store || 0) + Number(batchObj.stock_warehouse || 0)) : 0;
            if (totalStock > 0) {
              return `Are you sure you want to delete Batch #${batchObj?.batch_number || 1}? This batch contains ${totalStock} ${displayUnit} of stock, which will be completely removed.`;
            }
            return 'Are you sure you want to delete this batch? This action will remove the batch from inventory.';
          })()
        }
        confirmLabel="Delete Batch"
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={confirmDeleteBatch}
        onCancel={() => setBatchToDelete(null)}
      />

    </div>
  );
}
