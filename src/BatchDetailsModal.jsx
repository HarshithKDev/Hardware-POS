import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { Spinner } from './SharedUI';
import { getInventoryItemByBarcode, saveInventoryBatch } from './services/db';
import { 
  X, 
  Layers, 
  Printer, 
  Edit3, 
  Trash2, 
  Plus, 
  Check, 
  Copy, 
  Scissors, 
  Search, 
  PackageCheck
} from 'lucide-react';

export default function BatchDetailsModal({
  isOpen,
  onClose,
  item,
  onPrintBatch,
  onDeleteBatch,
  onOpenCreateBatch,
  viewType = 'warehouse'
}) {
  const { showAlert, showConfirm } = useApp();
  const queryClient = useQueryClient();

  // Active batch selection state (tab)
  const batches = item?.batches || [];
  const [activeBatchId, setActiveBatchId] = useState(batches[0]?.batch_id || null);

  // When batches or item changes, make sure activeBatchId is valid
  useEffect(() => {
    if (batches.length > 0) {
      if (!activeBatchId || !batches.some(b => b.batch_id === activeBatchId)) {
        setActiveBatchId(batches[0].batch_id);
      }
    } else {
      setActiveBatchId(null);
    }
  }, [item?.barcode, batches.length]);

  const activeBatch = batches.find(b => b.batch_id === activeBatchId) || batches[0] || null;

  // Batch pricing inline edit state
  const [isEditingBatch, setIsEditingBatch] = useState(false);
  const [batchEditForm, setBatchEditForm] = useState({ cost: '', msp: '', mrp: '' });

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

  // Reset editing mode when active batch changes
  useEffect(() => {
    setIsEditingBatch(false);
    if (activeBatch) {
      setBatchEditForm({
        cost: activeBatch.purchase_cost ?? item?.cost_price ?? 0,
        msp: activeBatch.msp ?? item?.msp ?? item?.cost_price ?? 0,
        mrp: activeBatch.selling_price ?? item?.price ?? 0
      });
    }
  }, [activeBatch?.batch_id]);

  // Cuttable instances state
  const [locationFilter, setLocationFilter] = useState('ALL'); // 'ALL' | 'STORE' | 'WAREHOUSE'
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedBarcode, setCopiedBarcode] = useState(null);

  // Piece Print Preview Modal
  const [printPieceModal, setPrintPieceModal] = useState({ isOpen: false, piece: null, qty: 1 });
  const [isPrintingPiece, setIsPrintingPiece] = useState(false);

  const shopId = localStorage.getItem('shop_id');

  // Fetch cuttable instances for this parent item
  const { data: instances = [], isLoading: isLoadingInstances } = useQuery({
    queryKey: ['stock_instances', shopId, item?.barcode],
    queryFn: async () => {
      if (!item?.barcode) return [];
      try {
        const { data, error } = await supabase.rpc('get_stock_instances', { p_barcode: String(item.barcode) });
        if (!error && data) return data;
      } catch (err) {
        console.warn('RPC get_stock_instances failed, falling back to direct table select', err);
      }
      let instQuery = supabase
        .from('stock_instances')
        .select('*')
        .eq('parent_barcode', String(item.barcode));
      if (shopId) {
        instQuery = instQuery.eq('shop_id', shopId);
      }
      const { data, error } = await instQuery;
      if (error) throw error;
      return data || [];
    },
    enabled: !!(isOpen && item?.is_cuttable && item?.barcode),
    staleTime: 10 * 1000
  });

  // Batch MSP update mutation
  const updateBatchMutation = useMutation({
    mutationFn: async ({ batch_id, msp }) => {
      let batchQuery = supabase
        .from('inventory_batches')
        .update({
          msp: Number(msp)
        })
        .eq('batch_id', batch_id);
      if (shopId) {
        batchQuery = batchQuery.eq('shop_id', shopId);
      }
      const { error } = await batchQuery;
      if (error) throw error;

      const oldBatch = batches.find(b => b.batch_id === batch_id);
      const changes = [];
      if (oldBatch) {
        if (Number(oldBatch.msp) !== Number(msp)) changes.push(`MSP: ₹${oldBatch.msp} -> ₹${msp}`);
      }

      if (changes.length > 0) {
        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          action_type: 'UPDATE',
          barcode: item.barcode,
          item_name: item.name,
          changes: `Updated Batch ${oldBatch?.batch_number || 1} MSP: ${changes.join(', ')}`,
          performed_by: localStorage.getItem('owner_name') || 'Owner'
        }]);
      }
    },
    onSuccess: async (_, variables) => {
      try {
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem && localItem.batches) {
          const bIndex = localItem.batches.findIndex(b => b.batch_id === variables.batch_id);
          if (bIndex >= 0) {
            localItem.batches[bIndex].msp = Number(variables.msp);
            await saveInventoryBatch([localItem]);
          }
        }
      } catch (e) {
        console.error('Failed to update IDB for batch', e);
      }
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setIsEditingBatch(false);
      showAlert('Batch MSP updated successfully.', 'Success');
    },
    onError: (e) => {
      showAlert('Failed to update batch MSP: ' + e.message, 'Error');
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
          performed_by: localStorage.getItem('owner_name') || 'Owner'
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

      queryClient.invalidateQueries({ queryKey: ['inventory_item', item.barcode] });
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

  // Filter instances belonging to the active batch
  const activeBatchInstances = useMemo(() => {
    if (!item?.is_cuttable || !instances) return [];
    if (!activeBatch) return [];

    return instances.filter(inst => {
      if (!inst.is_active) return false;
      // Match batch_id directly
      if (inst.batch_id === activeBatch.batch_id) return true;
      // Match barcode prefix if legacy record
      const batchPrefix = `${item.barcode}-${String(activeBatch.batch_number || 1).padStart(2, '0')}`;
      if (!inst.batch_id && inst.instance_barcode?.startsWith(batchPrefix)) return true;
      // If item has only 1 batch, include unassigned instances
      if (!inst.batch_id && batches.length === 1) return true;
      return false;
    });
  }, [instances, activeBatch, item, batches.length]);

  // Computed pieces metrics for the active batch
  const activeBatchPieceStats = useMemo(() => {
    const whse = activeBatchInstances.filter(i => (i.location || '').toLowerCase() === 'warehouse');
    const store = activeBatchInstances.filter(i => (i.location || 'store').toLowerCase() === 'store');
    const whseLen = whse.reduce((sum, i) => sum + Number(i.current_length || 0), 0);
    const storeLen = store.reduce((sum, i) => sum + Number(i.current_length || 0), 0);
    return {
      whseCount: whse.length,
      storeCount: store.length,
      totalCount: activeBatchInstances.length,
      whseLen,
      storeLen,
      totalLen: whseLen + storeLen
    };
  }, [activeBatchInstances]);

  // Filtered instances to display in the table based on location and search
  const displayedInstances = useMemo(() => {
    let result = activeBatchInstances;
    if (locationFilter === 'STORE') {
      result = result.filter(i => (i.location || 'store').toLowerCase() === 'store');
    } else if (locationFilter === 'WAREHOUSE') {
      result = result.filter(i => (i.location || '').toLowerCase() === 'warehouse');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(i => 
        String(i.instance_barcode || '').toLowerCase().includes(q) ||
        String(i.current_length || '').includes(q) ||
        String(i.original_length || '').includes(q)
      );
    }
    return result;
  }, [activeBatchInstances, locationFilter, searchQuery]);

  // Handle Piece Discard
  const handleTogglePiece = async (piece) => {
    const action = piece.is_active ? 'discard' : 'restore';
    showConfirm(`Are you sure you want to ${action} piece #${piece.instance_barcode}?`, async () => {
      try {
        const { error } = await supabase.rpc('toggle_stock_instance', {
          p_id: piece.id,
          p_is_active: !piece.is_active
        });
        if (error) throw error;

        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          action_type: 'UPDATE',
          barcode: item.barcode,
          item_name: item.name,
          changes: `Piece #${piece.instance_barcode} was ${action}ed (Length: ${piece.current_length} ${item.unit === 'SQFT' ? 'ft' : (item.unit || 'PCS')})`,
          performed_by: localStorage.getItem('owner_name') || 'Owner'
        }]);

        showAlert(`Piece #${piece.instance_barcode} ${action}ed successfully.`, 'Success');
        queryClient.invalidateQueries({ queryKey: ['stock_instances', item.barcode] });
        queryClient.invalidateQueries({ queryKey: ['piece_counts', item.barcode] });
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
      } catch (err) {
        console.error(err);
        showAlert(`Failed to ${action} piece: ` + err.message, 'Error');
      }
    });
  };

  // Copy piece barcode to clipboard
  const handleCopyBarcode = (barcode) => {
    if (!barcode) return;
    navigator.clipboard.writeText(barcode);
    setCopiedBarcode(barcode);
    setTimeout(() => setCopiedBarcode(null), 2000);
  };

  // Print piece execution
  const executePiecePrint = () => {
    setIsPrintingPiece(true);
    setTimeout(() => {
      window.print();
      setIsPrintingPiece(false);
      setPrintPieceModal({ isOpen: false, piece: null, qty: 1 });
    }, 500);
  };

  if (!isOpen || !item) return null;

  const displayUnit = (item.unit?.toLowerCase() === 'kg' || item.unit?.toLowerCase() === 'grams') ? 'kg' : item.unit?.toLowerCase() === 'meter' ? 'm' : item.unit?.toLowerCase() === 'sqft' ? 'ft' : (item.unit || 'PCS');

  return createPortal(
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[500] flex items-center justify-center p-2 sm:p-4 md:p-6 animate-fade-in">
      <div 
        className="w-full max-w-5xl h-[88vh] max-h-[880px] flex flex-col rounded-2xl overflow-hidden border border-[var(--border-light)] shadow-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        {/* MODAL TOP HEADER */}
        <div 
          className="px-5 py-4 flex items-center justify-between gap-4 border-b border-[var(--border-light)] shrink-0"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base sm:text-lg font-bold text-[var(--text-primary)] truncate" title={item.name}>
                  {item.name}
                </h2>
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
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                {item.category || 'General'} {item.sub_category ? `› ${item.sub_category}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* MIN QUANTITY (STORE & WHSE) THRESHOLDS */}
            {isEditingMinQty ? (
              <div className="flex items-center gap-2 bg-[var(--bg-secondary)] px-2.5 py-1 rounded-lg border border-[var(--border-medium)] text-xs shadow-sm animate-fade-in">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                  Min Alert:
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text-secondary)]">Store</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={minQtyForm.store}
                    onChange={e => setMinQtyForm(prev => ({ ...prev, store: e.target.value }))}
                    className="w-14 h-6 px-1.5 text-xs font-bold rounded bg-[var(--bg-input)] border border-[var(--border-medium)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)] text-center"
                    placeholder="0"
                    autoFocus
                  />
                </div>
                <span className="text-[var(--text-tertiary)] opacity-30">•</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text-secondary)]">Whse</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={minQtyForm.warehouse}
                    onChange={e => setMinQtyForm(prev => ({ ...prev, warehouse: e.target.value }))}
                    className="w-14 h-6 px-1.5 text-xs font-bold rounded bg-[var(--bg-input)] border border-[var(--border-medium)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-accent)] text-center"
                    placeholder="0"
                  />
                </div>
                <span className="text-[11px] text-[var(--text-tertiary)]">{displayUnit}</span>

                <div className="flex items-center gap-1 ml-1 pl-1 border-l border-[var(--border-light)]">
                  <button
                    onClick={() => {
                      updateMinQtyMutation.mutate({
                        storeQty: minQtyForm.store,
                        whseQty: minQtyForm.warehouse
                      });
                    }}
                    disabled={updateMinQtyMutation.isPending}
                    className="h-6 px-2 rounded bg-[var(--color-success)] text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all shadow-sm hover:brightness-110 disabled:opacity-50 cursor-pointer"
                    title="Save Minimum Quantities"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingMinQty(false);
                      setMinQtyForm({
                        store: item.min_quantity_store ?? 0,
                        warehouse: item.min_quantity_warehouse ?? 0
                      });
                    }}
                    className="h-6 px-1.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 text-[10px] font-bold flex items-center justify-center transition-all cursor-pointer"
                    title="Cancel"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2.5 bg-[var(--bg-secondary)] px-3 py-1 rounded-lg border border-[var(--border-light)] text-xs text-[var(--text-secondary)] shadow-sm">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Min Alert:</span>
                <span className="text-[var(--text-primary)] font-medium">Store <strong className="text-[var(--text-primary)] font-bold">{item.min_quantity_store ?? 0} {displayUnit}</strong></span>
                <span className="text-[var(--text-tertiary)] opacity-30">•</span>
                <span className="text-[var(--text-primary)] font-medium">Whse <strong className="text-[var(--text-primary)] font-bold">{item.min_quantity_warehouse ?? 0} {displayUnit}</strong></span>
                
                <div className="w-[1px] h-3.5 bg-[var(--border-light)] mx-0.5" />
                
                <button
                  onClick={() => setIsEditingMinQty(true)}
                  className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                  title="Edit Minimum Quantities for Store and Warehouse"
                >
                  <Edit3 className="w-3 h-3 text-[var(--color-accent)]" />
                  <span>Edit</span>
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="p-2 text-[var(--text-secondary)] hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* BROWSER-STYLE TAB BAR */}
        <div 
          className="flex items-end pl-0 pr-4 border-b border-[var(--border-light)] gap-1 overflow-x-auto overflow-y-hidden hide-scrollbar no-scrollbar shrink-0"
          style={{ 
            scrollbarWidth: 'none', 
            msOverflowStyle: 'none',
            overflowY: 'hidden'
          }}
        >
          {batches.length === 0 ? (
            <div className="px-4 py-2 text-xs font-medium text-[var(--text-tertiary)] italic">
              No batches available
            </div>
          ) : (
            batches.map((batch) => {
              const isActive = activeBatch?.batch_id === batch.batch_id;
              const batchNum = batch.batch_number || 1;
              const batchCode = `${item.barcode}-${String(batchNum).padStart(2, '0')}`;
              
              // Calculate tab count
              let tabCountLabel = '';
              if (item.is_cuttable) {
                const bCount = instances.filter(i => i.is_active && (i.batch_id === batch.batch_id || (!i.batch_id && i.instance_barcode?.startsWith(batchCode)))).length;
                tabCountLabel = `${bCount} pcs`;
              } else {
                tabCountLabel = `${Number(batch.stock_warehouse || 0) + Number(batch.stock_store || 0)} ${displayUnit}`;
              }

              return (
                <button
                  key={batch.batch_id}
                  onClick={() => setActiveBatchId(batch.batch_id)}
                  className={`group relative flex items-center gap-2.5 px-4 py-2.5 rounded-t-lg text-xs transition-colors cursor-pointer whitespace-nowrap select-none ${
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
                  title={`View Batch ${batchCode}`}
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
            })
          )}

          {/* NEW BATCH TAB BUTTON */}
          <button
            onClick={() => {
              if (onOpenCreateBatch) {
                onOpenCreateBatch(item);
              } else {
                window.dispatchEvent(new CustomEvent('openCreateBatchModal', { detail: item }));
              }
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors cursor-pointer text-[var(--color-accent)] hover:bg-[var(--color-accent-bg)] ml-1 mb-0.5"
            title="Create New Batch for this item"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Batch</span>
          </button>
        </div>

        {/* MAIN DETAILS AREA */}
        <div 
          className="flex-1 overflow-y-auto p-5 sm:p-6 flex flex-col gap-6"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        >
          {!activeBatch ? (
            <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-[var(--border-medium)] rounded-xl my-auto">
              <PackageCheck className="w-12 h-12 text-[var(--text-tertiary)] mb-3" />
              <h3 className="text-base font-bold text-[var(--text-primary)]">No Active Batch</h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                This product currently does not have any inventory batches. Click "Add Batch" to initialize stock and pricing.
              </p>
              <button
                onClick={() => {
                  if (onOpenCreateBatch) onOpenCreateBatch(item);
                  else window.dispatchEvent(new CustomEvent('openCreateBatchModal', { detail: item }));
                }}
                className="mt-4 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md hover:brightness-110"
              >
                <Plus className="w-4 h-4" />
                Create Batch
              </button>
            </div>
          ) : (
            <>
              {/* BATCH TOP BAR */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border-light)]">
                <div className="flex items-center gap-3">
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
                  </div>

                  {/* Batch Action Buttons */}
                  <div className="flex items-center gap-2">
                    {isEditingBatch ? (
                      <>
                        <button
                          onClick={() => {
                            updateBatchMutation.mutate({
                              batch_id: activeBatch.batch_id,
                              msp: batchEditForm.msp
                            });
                          }}
                          disabled={updateBatchMutation.isPending}
                          className="h-8 px-3 rounded-lg bg-[var(--color-success)] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm hover:brightness-110 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {updateBatchMutation.isPending ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setIsEditingBatch(false);
                            setBatchEditForm({
                              cost: activeBatch.purchase_cost ?? item?.cost_price ?? 0,
                              msp: activeBatch.msp ?? item?.msp ?? item?.cost_price ?? 0,
                              mrp: activeBatch.selling_price ?? item?.price ?? 0
                            });
                          }}
                          className="h-8 px-3 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
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
                            title="Edit Batch Floor Price (MSP)"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                            Edit Price
                          </button>
                        )}
                        <button
                          onClick={() => onPrintBatch && onPrintBatch(activeBatch)}
                          className="h-8 px-3 rounded-lg border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-bg)] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                          title="Print Barcode Labels for this batch"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print
                        </button>
                        {viewType !== 'recycle' && (
                          <button
                            onClick={() => {
                              const canDelete = Number(activeBatch.stock_warehouse) === 0 && Number(activeBatch.stock_store) === 0 && activeBatchPieceStats.totalCount === 0;
                              if (canDelete && onDeleteBatch) {
                                onDeleteBatch(activeBatch.batch_id);
                              }
                            }}
                            disabled={!(Number(activeBatch.stock_warehouse) === 0 && Number(activeBatch.stock_store) === 0 && activeBatchPieceStats.totalCount === 0)}
                            className={`h-8 px-3 rounded-lg border text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                              Number(activeBatch.stock_warehouse) === 0 && Number(activeBatch.stock_store) === 0 && activeBatchPieceStats.totalCount === 0
                                ? 'border-red-500/50 text-red-400 hover:bg-red-500/10 cursor-pointer'
                                : 'border-white/10 text-[var(--text-tertiary)] opacity-40 cursor-not-allowed'
                            }`}
                            title={
                              Number(activeBatch.stock_warehouse) === 0 && Number(activeBatch.stock_store) === 0 && activeBatchPieceStats.totalCount === 0
                                ? 'Delete empty batch'
                                : 'Cannot delete batch with existing stock or pieces'
                            }
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
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {/* Cost Price */}
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                      Purchase Cost
                    </span>
                    <span className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                      ₹{Number(activeBatch.purchase_cost ?? item.cost_price ?? 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">Acquisition</span>
                  </div>

                  {/* MSP */}
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                      MSP (Min Price)
                    </span>
                    {isEditingBatch ? (
                      <input
                        type="number"
                        step="any"
                        value={batchEditForm.msp}
                        onChange={e => setBatchEditForm(prev => ({ ...prev, msp: e.target.value }))}
                        className="w-full h-7 px-2 text-sm font-bold rounded bg-[var(--bg-input)] border border-[var(--color-accent)] text-[var(--text-primary)] focus:outline-none"
                      />
                    ) : (
                      <span className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                        ₹{Number(activeBatch.msp ?? item.msp ?? item.cost_price ?? 0).toFixed(2)}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">Floor Price</span>
                  </div>

                  {/* MRP */}
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                      Selling Price (MRP)
                    </span>
                    <span className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                      ₹{Number(activeBatch.selling_price ?? item.price ?? 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">List Price</span>
                  </div>

                  {/* Warehouse Stock */}
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                      Warehouse Stock
                    </span>
                    <span className="text-sm sm:text-base font-bold text-[var(--color-accent)]">
                      {item.is_cuttable ? activeBatchPieceStats.whseCount : (activeBatch.stock_warehouse ?? 0)}
                      <span className="text-xs font-normal text-[var(--text-secondary)] ml-1">
                        {item.is_cuttable ? 'PCS' : displayUnit}
                      </span>
                    </span>
                    {item.is_cuttable && activeBatchPieceStats.whseLen > 0 && (
                      <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">
                        {activeBatchPieceStats.whseLen.toFixed(1)} {item.unit === 'SQFT' ? 'ft' : item.unit} total
                      </span>
                    )}
                  </div>

                  {/* Store Stock */}
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                      Store Stock
                    </span>
                    <span className="text-sm sm:text-base font-bold text-[var(--color-success)]">
                      {item.is_cuttable ? activeBatchPieceStats.storeCount : (activeBatch.stock_store ?? 0)}
                      <span className="text-xs font-normal text-[var(--text-secondary)] ml-1">
                        {item.is_cuttable ? 'PCS' : displayUnit}
                      </span>
                    </span>
                    {item.is_cuttable && activeBatchPieceStats.storeLen > 0 && (
                      <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">
                        {activeBatchPieceStats.storeLen.toFixed(1)} {item.unit === 'SQFT' ? 'ft' : item.unit} total
                      </span>
                    )}
                  </div>
                </div>

              {/* INSTANCES SECTION */}
              {item.is_cuttable ? (
                <div className="flex flex-col gap-3.5 pt-2">
                  {/* Header: Instances title */}
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text-primary)]">
                      Instances
                    </h3>
                    <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-[var(--bg-secondary)] border border-[var(--border-light)] text-[var(--text-secondary)]">
                      {activeBatchInstances.length} Available
                    </span>
                  </div>

                  {/* Location Filter Box (on the left below Instances) */}
                  <div className="inline-flex items-center bg-[var(--bg-secondary)] p-1 rounded-lg border border-[var(--border-light)] w-fit shadow-sm">
                    <button
                      onClick={() => setLocationFilter('ALL')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        locationFilter === 'ALL'
                          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] shadow-sm border border-[var(--border-light)]'
                          : 'text-[var(--text-secondary)] hover:text-white'
                      }`}
                    >
                      All ({activeBatchInstances.length})
                    </button>
                    <button
                      onClick={() => setLocationFilter('STORE')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        locationFilter === 'STORE'
                          ? 'bg-[var(--bg-tertiary)] text-[var(--color-success)] shadow-sm border border-[var(--border-light)]'
                          : 'text-[var(--text-secondary)] hover:text-white'
                      }`}
                    >
                      Store ({activeBatchPieceStats.storeCount})
                    </button>
                    <button
                      onClick={() => setLocationFilter('WAREHOUSE')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        locationFilter === 'WAREHOUSE'
                          ? 'bg-[var(--bg-tertiary)] text-[var(--color-accent)] shadow-sm border border-[var(--border-light)]'
                          : 'text-[var(--text-secondary)] hover:text-white'
                      }`}
                    >
                      Whse ({activeBatchPieceStats.whseCount})
                    </button>
                  </div>

                  {/* Instances Table */}
                  <div 
                    className="overflow-x-auto rounded-xl border border-[var(--border-light)] shadow-sm"
                    style={{ backgroundColor: 'var(--bg-secondary)', overscrollBehavior: 'none' }}
                  >
                    <div className="max-h-[380px] overflow-y-auto">
                      <table className="w-full text-center border-collapse text-xs">
                        <thead 
                          className="sticky top-0 z-20"
                          style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}
                        >
                          <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                            <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Piece Barcode</th>
                            <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Original Length</th>
                            <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Current Length</th>
                            {item.unit === 'SQFT' && (
                              <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Width & Area</th>
                            )}
                            <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Location</th>
                            <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Status</th>
                            <th className="p-3.5 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {isLoadingInstances ? (
                            <tr>
                              <td colSpan={item.unit === 'SQFT' ? 7 : 6} className="p-8 text-center" style={{ borderBottom: '1px solid var(--border-light)' }}>
                                <Spinner className="w-6 h-6 text-[var(--color-accent)] mx-auto" />
                              </td>
                            </tr>
                          ) : displayedInstances.length === 0 ? (
                            <tr>
                              <td colSpan={item.unit === 'SQFT' ? 7 : 6} className="p-8 text-center text-xs text-[var(--text-tertiary)] font-medium" style={{ borderBottom: '1px solid var(--border-light)' }}>
                                No cut pieces recorded under this batch for this filter.
                              </td>
                            </tr>
                          ) : (
                            displayedInstances.map(piece => {
                              const isStore = String(piece.location || 'store').toLowerCase() === 'store';
                              const isCut = Number(piece.current_length) < Number(piece.original_length);
                              const unitName = item.unit === 'SQFT' ? 'ft' : (item.unit || '');

                              return (
                                <tr 
                                  key={piece.id || piece.instance_barcode}
                                  className="transition-colors hover:bg-[var(--bg-hover)]"
                                  style={{ borderBottom: '1px solid var(--border-light)' }}
                                >
                                  {/* PIECE BARCODE */}
                                  <td className="p-3.5 text-center text-sm font-medium" style={{ borderRight: '1px solid var(--border-light)' }}>
                                    <div className="flex items-center justify-center gap-1.5 font-bold text-[var(--color-accent)]">
                                      <span>{piece.instance_barcode}</span>
                                      <button
                                        onClick={() => handleCopyBarcode(piece.instance_barcode)}
                                        className="p-1 rounded text-[var(--text-tertiary)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                                        title="Copy Barcode"
                                      >
                                        {copiedBarcode === piece.instance_barcode ? (
                                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                  </td>

                                  {/* ORIGINAL LENGTH */}
                                  <td className="p-3.5 text-center text-sm font-medium text-[var(--text-secondary)]" style={{ borderRight: '1px solid var(--border-light)' }}>
                                    {piece.original_length} {unitName}
                                  </td>

                                  {/* CURRENT LENGTH */}
                                  <td className="p-3.5 text-center text-sm" style={{ borderRight: '1px solid var(--border-light)' }}>
                                    <div className="flex items-center justify-center gap-1.5">
                                      <span className="font-bold text-[var(--text-primary)]">
                                        {piece.current_length} {unitName}
                                      </span>
                                      {isCut && (
                                        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                          Cut
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  {/* SQFT WIDTH & AREA */}
                                  {item.unit === 'SQFT' && (
                                    <td className="p-3.5 text-center text-sm text-[var(--text-secondary)]" style={{ borderRight: '1px solid var(--border-light)' }}>
                                      <span>
                                        {item.default_width || 0} ft × {piece.current_length} ft = {' '}
                                        <strong className="text-[var(--text-primary)]">
                                          {(Number(piece.current_length) * Number(item.default_width || 0)).toFixed(2)} SQFT
                                        </strong>
                                      </span>
                                    </td>
                                  )}

                                  {/* LOCATION */}
                                  <td className="p-3.5 text-center text-sm" style={{ borderRight: '1px solid var(--border-light)' }}>
                                    <span 
                                      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                        isStore 
                                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                      }`}
                                    >
                                      {isStore ? 'Store' : 'Warehouse'}
                                    </span>
                                  </td>

                                  {/* STATUS */}
                                  <td className="p-3.5 text-center text-sm" style={{ borderRight: '1px solid var(--border-light)' }}>
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                      Available
                                    </span>
                                  </td>

                                  {/* ACTIONS */}
                                  <td className="p-3.5 text-center text-sm">
                                    <div className="flex items-center justify-center gap-2">
                                      <button
                                        onClick={() => setPrintPieceModal({ isOpen: true, piece, qty: 1 })}
                                        className="p-1.5 rounded-md border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-bg)] transition-colors cursor-pointer"
                                        title="Print Barcode Label for this piece"
                                      >
                                        <Printer className="w-3.5 h-3.5" />
                                      </button>
                                      {viewType !== 'recycle' && (
                                        <button
                                          onClick={() => handleTogglePiece(piece)}
                                          className="p-1.5 rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                          title="Discard this piece"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* MODAL BOTTOM BAR */}
        <div 
          className="px-5 py-3 border-t border-[var(--border-light)] flex items-center justify-between shrink-0"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        >
          <div className="text-xs text-[var(--text-tertiary)]">
            Total Batches: <strong className="text-[var(--text-secondary)]">{batches.length}</strong>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border border-[var(--border-medium)] text-[var(--text-primary)] hover:bg-white/5 transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* PIECE PRINT PREVIEW MODAL */}
      {printPieceModal.isOpen && printPieceModal.piece && createPortal(
        <div className="fixed inset-0 flex items-center justify-center z-[600] px-4 bg-black/60 animate-fade-in">
          <div className="w-[90%] max-w-[420px] rounded-xl overflow-hidden flex flex-col shadow-2xl bg-[var(--bg-secondary)] border border-[var(--border-light)]">
            <div className="flex justify-between items-center px-5 py-3 border-b border-[var(--border-light)]">
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                Print Piece Label
              </h2>
              <button 
                onClick={() => setPrintPieceModal({ isOpen: false, piece: null, qty: 1 })}
                className="text-[var(--text-tertiary)] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              {/* Thermal Label Preview */}
              <div className="flex flex-col items-center justify-center p-3 bg-white border border-gray-300 rounded-lg mx-auto w-[240px] shadow-sm text-black">
                <p className="text-[9px] font-bold mb-1 w-full text-center truncate">
                  {item.name} ({printPieceModal.piece.current_length} {item.unit === 'SQFT' ? 'ft' : (item.unit || 'PCS')})
                </p>
                <Barcode 
                  value={printPieceModal.piece.instance_barcode}
                  width={1.25}
                  height={26}
                  fontSize={10}
                  margin={0}
                  displayValue={true}
                  lineColor="#000000"
                  background="#ffffff"
                />
                <p className="text-[11px] font-bold mt-1">
                  ₹{Number(activeBatch?.selling_price || item.price || 0).toFixed(2)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">
                  Copies to Print
                </label>
                <input 
                  type="number" 
                  min="1" 
                  max="50"
                  value={printPieceModal.qty}
                  onChange={e => setPrintPieceModal(prev => ({ ...prev, qty: Math.max(1, Number(e.target.value)) }))}
                  className="w-full h-10 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm font-bold focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] flex justify-end gap-2.5">
              <button
                onClick={() => setPrintPieceModal({ isOpen: false, piece: null, qty: 1 })}
                className="px-4 py-2 text-xs font-semibold rounded-md border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={executePiecePrint}
                disabled={isPrintingPiece}
                className="px-5 py-2 text-xs font-bold rounded-md text-white bg-[var(--color-accent)] hover:brightness-110 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                {isPrintingPiece ? 'Printing...' : 'Print Label'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Hidden container for printing single piece label */}
      {isPrintingPiece && printPieceModal.piece && createPortal(
        <div 
          id="printable-piece-barcode" 
          className="absolute -top-[9999px] left-0 opacity-0 pointer-events-none print:static print:opacity-100 print:pointer-events-auto"
          style={{ backgroundColor: '#ffffff', margin: 0, padding: 0 }}
        >
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              @page { size: 50mm 25mm; margin: 0 !important; }
              body { margin: 0 !important; padding: 0 !important; }
              #printable-piece-barcode { display: block !important; margin: 0 !important; padding: 0 !important; }
            }
          `}} />
          {Array.from({ length: Number(printPieceModal.qty) || 1 }).map((_, index) => (
            <div 
              key={index} 
              className="thermal-barcode" 
              style={{ backgroundColor: '#ffffff', width: '50mm', height: '25mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', pageBreakAfter: 'always' }}
            >
              <p style={{ color: '#000000', fontSize: '9px', fontWeight: 'bold', lineHeight: 1, margin: 0, marginBottom: '2px', textAlign: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.name} ({printPieceModal.piece.current_length} {item.unit === 'SQFT' ? 'ft' : (item.unit || 'PCS')})
              </p>
              <Barcode 
                value={printPieceModal.piece.instance_barcode} 
                width={1.25} 
                height={24} 
                fontSize={10} 
                margin={0} 
                displayValue={true} 
                lineColor="#000000" 
                background="#ffffff" 
              />
              <p style={{ color: '#000000', fontSize: '10px', fontWeight: 'bold', lineHeight: 1, margin: 0, marginTop: '2px' }}>
                ₹{Number(activeBatch?.selling_price || item.price || 0).toFixed(2)}
              </p>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>,
    document.body
  );
}
