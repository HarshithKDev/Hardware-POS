import React, { useState, useEffect, useMemo, useCallback, forwardRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import PrintBatchModal from './PrintBatchModal';
import CreateBatchModal from './CreateBatchModal';
import { supabase } from './supabaseClient';
import { getInventoryByQuery, saveInventoryBatch, getInventoryItemByBarcode } from './services/db';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ConfirmDialog } from './Dialog';
import { useApp } from './AppContext';
import { escapeIlike, debounce } from './utils';
import { STALE_TIME_5MIN } from './constants';
import InventoryRow from './InventoryRow';

export default function OwnerInventory({ viewType }) {
  const { showAlert, showConfirm } = useApp();

  const [inventorySearch, setInventorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-desc');
  const [selectedBarcodes, setSelectedBarcodes] = useState([]);
  const [expandedBarcode, setExpandedBarcode] = useState(null);
  const [isGlobalEditMode, setIsGlobalEditMode] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({});
  const [printModal, setPrintModal] = useState({ isOpen: false, item: null, batch: null });
  const [createBatchModal, setCreateBatchModal] = useState({ isOpen: false, item: null });
  const [batchToDelete, setBatchToDelete] = useState(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  useEffect(() => {
    const handleOpenCreateBatchModal = (e) => setCreateBatchModal({ isOpen: true, item: e.detail });
    window.addEventListener('openCreateBatchModal', handleOpenCreateBatchModal);
    return () => window.removeEventListener('openCreateBatchModal', handleOpenCreateBatchModal);
  }, []);

  const queryClient = useQueryClient();

  // Debounced search (fixes #17)
  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 300),
    []
  );

  const handleSearchChange = useCallback((e) => {
    setInventorySearch(e.target.value);
    debouncedSetSearch(e.target.value);
  }, [debouncedSetSearch]);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('name').order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME_5MIN,
  });

  const { data: subcategories } = useQuery({
    queryKey: ['subcategories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcategories').select('name, category_name').order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME_5MIN,
  });

  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['inventory', viewType, debouncedSearch, sortOption],
    queryFn: async () => {
      if (!navigator.onLine) {
        // Fallback or primarily use local IDB
      }
      // Actually, since we sync to local IDB in the background, we can just query IDB directly for lightning fast pagination!
      const { data, totalCount } = await getInventoryByQuery({
        limit: 1000000,
        offset: 0,
        search: debouncedSearch,
        sortOption: sortOption,
        viewType: viewType === 'recycle' ? 'warehouse' : viewType,
        status: viewType === 'recycle' ? 'deactivated' : 'active'
      });
      return { items: data || [], total: totalCount || 0 };
    },
    staleTime: STALE_TIME_5MIN,
    placeholderData: keepPreviousData,
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ oldItem, newItem }) => {
      const { error } = await supabase.from('product_master').update({
        name: newItem.name,
        category: newItem.category,
        sub_category: newItem.sub_category,
        unit: newItem.unit,
        is_loose_item: Boolean(newItem.is_loose_item),
        default_length: newItem.unit === 'SQFT' ? (Number(newItem.default_length) || null) : null,
        default_width: newItem.unit === 'SQFT' ? (Number(newItem.default_width) || null) : null
      }).eq('barcode', newItem.barcode);
      if (error) throw error;

      // Calculate changes for audit log
      const changes = [];
      if (oldItem.name !== newItem.name) changes.push(`Name: ${oldItem.name} -> ${newItem.name}`);
      if (oldItem.category !== newItem.category) changes.push(`Category: ${oldItem.category} -> ${newItem.category}`);
      if (Number(oldItem.cost_price || 0) !== Number(newItem.cost_price || 0)) changes.push(`Cost: ${oldItem.cost_price} -> ${newItem.cost_price}`);
      if (Number(oldItem.msp || 0) !== Number(newItem.msp || 0)) changes.push(`MSP: ${oldItem.msp} -> ${newItem.msp}`);
      if (Number(oldItem.price || 0) !== Number(newItem.price || 0)) changes.push(`MRP: ${oldItem.price} -> ${newItem.price}`);
      if (Number(oldItem.stock_warehouse || 0) !== Number(newItem.stock_warehouse || 0)) changes.push(`Whse Stock: ${oldItem.stock_warehouse} -> ${newItem.stock_warehouse}`);
      if (Number(oldItem.stock_store || 0) !== Number(newItem.stock_store || 0)) changes.push(`Store Stock: ${oldItem.stock_store} -> ${newItem.stock_store}`);
      
      if (changes.length > 0) {
        const { error: logError } = await supabase.from('audit_logs').insert([{
          action_type: 'UPDATE',
          barcode: newItem.barcode,
          item_name: newItem.name,
          changes: changes.join(', '),
          performed_by: 'Owner'
        }]);
        if (logError) console.error("Failed to insert audit log", logError);
      }

      return newItem;
    },
    onSuccess: async (updatedItem) => {
      try {
        const localItem = await getInventoryItemByBarcode(updatedItem.barcode);
        if (localItem) {
          await saveInventoryBatch([{ ...localItem, ...updatedItem }]);
        }
      } catch (e) {
        console.error("Local IDB update failed", e);
      }
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (e) => showAlert(e.message, "Update Failed"),
  });

  const handleSortClick = (column) => {
    if (sortOption.startsWith(column)) {
      setSortOption(sortOption.endsWith('-asc') ? `${column}-desc` : `${column}-asc`);
    } else {
      setSortOption(`${column}-asc`);
    }
  };

  const handleRemove = (barcode) => {
    const itemToDelete = items.find(i => i.barcode === barcode);
    const itemName = itemToDelete?.name || barcode;
    showConfirm(`Deactivate ${itemName}?`, async () => {
      const itemToDelete = items.find(i => i.barcode === barcode);
      const { error } = await supabase.from('product_master').update({ is_active: false }).eq('barcode', barcode);
      if (error) {
        showAlert(error.message, "Error Removing Item");
      } else {
        if (itemToDelete) {
          await supabase.from('audit_logs').insert([{
            action_type: 'DELETE',
            barcode: barcode,
            item_name: itemToDelete.name,
            changes: `Item deactivated (Whse Stock: ${itemToDelete.stock_warehouse}, Store Stock: ${itemToDelete.stock_store})`,
            performed_by: 'Owner'
          }]);
        }
        try {
          const localItem = await getInventoryItemByBarcode(barcode);
          if (localItem) {
            await saveInventoryBatch([{ ...localItem, is_active: false }]);
          }
        } catch (e) {
          console.error("Local IDB remove failed", e);
        }
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
      }
    }, 'Deactivate Item', 'Deactivate', 'Cancel', true);
  };

  const handleRestore = (barcode) => {
    const itemToRestore = items.find(i => i.barcode === barcode);
    const itemName = itemToRestore?.name || barcode;
    showConfirm(`Restore ${itemName}?`, async () => {
      const itemToRestore = items.find(i => i.barcode === barcode);
      const { error } = await supabase.from('product_master').update({ is_active: true }).eq('barcode', barcode);
      if (error) {
        showAlert(error.message, "Error Restoring Item");
      } else {
        if (itemToRestore) {
          await supabase.from('audit_logs').insert([{
            action_type: 'RESTORE',
            barcode: barcode,
            item_name: itemToRestore.name,
            changes: `Item restored from Recycle Bin`,
            performed_by: 'Owner'
          }]);
        }
        try {
          const localItem = await getInventoryItemByBarcode(barcode);
          if (localItem) {
            await saveInventoryBatch([{ ...localItem, is_active: true }]);
          }
        } catch (e) {
          console.error("Local IDB restore failed", e);
        }
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        showAlert(`${itemToRestore?.name || barcode} restored successfully!`, "Item Restored");
      }
    }, 'Restore Item', 'Restore', 'Cancel', false);
  };

  const toggleSelect = (barcode) => {
    setSelectedBarcodes(prev => prev.includes(barcode) ? prev.filter(b => b !== barcode) : [...prev, barcode]);
  };

  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedBarcodes(items.map(i => i.barcode));
    } else {
      setSelectedBarcodes([]);
      setIsGlobalEditMode(false);
    }
  };

  const startBulkEdit = () => {
    const edits = {};
    selectedBarcodes.forEach(bc => {
      const item = items.find(i => i.barcode === bc);
      if (item) edits[bc] = { ...item };
    });
    setBulkEditData(edits);
    setIsGlobalEditMode(true);
  };

  const cancelBulkEdit = () => {
    setIsGlobalEditMode(false);
    setBulkEditData({});
  };

  const handleBulkEditChange = (barcode, field, value) => {
    setBulkEditData(prev => {
      const existing = prev[barcode] || items.find(i => i.barcode === barcode) || { barcode };
      return {
        ...prev,
        [barcode]: { ...existing, [field]: value }
      };
    });
  };

  const handleDeleteBatch = (batchId) => {
    setBatchToDelete(batchId);
  };

  const confirmDeleteBatch = async () => {
    if (!batchToDelete) return;
    try {
      const { error } = await supabase.from('inventory_batches').update({ is_active: false }).eq('batch_id', batchToDelete);
      if (error) throw error;

      try {
        const itemToLog = inventory.find(i => i.batches && i.batches.some(b => b.batch_id === batchToDelete));
        const batchNum = itemToLog?.batches?.find(b => b.batch_id === batchToDelete)?.batch_number || 'Unknown';
        await supabase.from('audit_logs').insert([{
          action_type: 'DELETE',
          barcode: itemToLog ? itemToLog.barcode : 'Unknown',
          item_name: itemToLog ? itemToLog.name : 'Unknown Item',
          changes: `Deleted Batch #${batchNum}`,
          performed_by: 'Owner'
        }]);
      } catch (err) {
        console.error("Failed to log batch deletion", err);
      }
      
      // Instantly update IndexedDB cache
      const { initDB, saveInventoryBatch } = await import('./services/db.js');
      const db = await initDB();
      const allItems = await db.getAll('product_master');
      const itemToUpdate = allItems.find(i => i.batches && i.batches.some(b => b.batch_id === batchToDelete));
      if (itemToUpdate) {
        itemToUpdate.batches = itemToUpdate.batches.filter(b => b.batch_id !== batchToDelete);
        await saveInventoryBatch([itemToUpdate]);
      }
      
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (err) {
      console.error(err);
      alert("Failed to delete batch: " + err.message);
    } finally {
      setBatchToDelete(null);
    }
  };

  const saveBulkEdits = async () => {
    const itemsToSave = Object.values(bulkEditData);
    if (itemsToSave.length === 0) return;
    try {
      // First update Supabase
      const { error } = await supabase.from('product_master').upsert(itemsToSave, { onConflict: 'barcode' });
      if (error) throw error;
      
      // Then update local IDB
      await saveInventoryBatch(itemsToSave);
      
      const auditLogs = itemsToSave.map(item => ({
        action_type: 'UPDATE',
        barcode: item.barcode,
        item_name: item.name,
        changes: `Item updated via Global Edit`,
        performed_by: 'Owner'
      }));
      await supabase.from('audit_logs').insert(auditLogs);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setIsGlobalEditMode(false);
      setBulkEditData({});
      setSelectedBarcodes([]);
      showAlert(`Successfully updated ${itemsToSave.length} items!`, "Success");
    } catch (error) {
      console.error("Bulk save error:", error);
      showAlert(error.message, "Error saving items");
    }
  };

  const bulkDelete = () => {
    const isRecycle = viewType === 'recycle';
    const actionText = isRecycle ? 'restore' : 'delete permanently';
    const title = isRecycle ? 'Restore Items' : 'Delete Items';
    const confirmLabel = isRecycle ? 'Restore' : 'Delete';
    showConfirm(`${actionText.charAt(0).toUpperCase() + actionText.slice(1)} ${selectedBarcodes.length} items?`, async () => {
      const updateValue = isRecycle ? true : false;
      const { error } = await supabase.from('product_master').update({ is_active: updateValue }).in('barcode', selectedBarcodes);
      
      if (error) {
        showAlert(error.message, `Error ${isRecycle ? 'Restoring' : 'Removing'} Items`);
      } else {
        try {
          const localItems = await Promise.all(selectedBarcodes.map(bc => getInventoryItemByBarcode(bc)));
          const validLocalItems = localItems.filter(Boolean);
          
          if (validLocalItems.length > 0) {
            const auditLogs = validLocalItems.map(item => ({
              action_type: isRecycle ? 'RESTORE' : 'DELETE',
              barcode: item.barcode,
              item_name: item.name,
              changes: `Item ${isRecycle ? 'restored from' : 'moved to'} Recycle Bin`,
              performed_by: 'Owner'
            }));
            await supabase.from('audit_logs').insert(auditLogs);
            
            const updatedItemsToSave = validLocalItems.map(item => ({ ...item, is_active: updateValue }));
            await saveInventoryBatch(updatedItemsToSave);
          }
        } catch (e) {
          console.error("Bulk remove/restore operations failed", e);
        }
        
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        setSelectedBarcodes([]);
        setIsGlobalEditMode(false);
        showAlert(`Successfully ${isRecycle ? 'restored' : 'removed'} ${selectedBarcodes.length} items!`, "Success");
      }
    }, title, confirmLabel, 'Cancel', !isRecycle);
  };

  const renderSortIcon = (column) => {
    if (sortOption.startsWith(column)) {
      const isAsc = sortOption.endsWith('-asc');
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" style={{ color: 'var(--color-accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isAsc ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          )}
        </svg>
      );
    }
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60 ml-1" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  };

  const items = inventoryData?.items || [];
  const totalInvItems = inventoryData?.total || 0;

  return (
    <div className="flex flex-col flex-1 h-full animate-fade-in w-full relative">
      {selectedBarcodes.length > 0 ? (
        <div className="flex items-center justify-between p-3 mb-4 rounded-lg shadow-sm" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--color-accent)' }}>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {selectedBarcodes.length} item(s) selected
          </div>
          <div className="flex gap-2">
            {isGlobalEditMode ? (
              <>
                <button onClick={saveBulkEdits} className="h-8 px-4 text-xs font-bold text-white rounded focus:outline-none transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--color-success)' }}>
                  Save Changes
                </button>
                <button onClick={cancelBulkEdit} className="h-8 px-4 text-xs font-bold rounded focus:outline-none transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                {viewType === 'warehouse' && (
                  <button onClick={startBulkEdit} className="h-8 px-4 text-xs font-bold rounded focus:outline-none transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }}>
                    Edit Selected
                  </button>
                )}
                <button onClick={bulkDelete} className="h-8 px-4 text-xs font-bold rounded focus:outline-none transition-colors hover:opacity-90 text-white" style={{ backgroundColor: viewType === 'recycle' ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {viewType === 'recycle' ? 'Restore Selected' : 'Delete Selected'}
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search Barcode or Name..."
              value={inventorySearch}
              onChange={handleSearchChange}
              className="h-11 md:h-10 px-3 text-sm flex-1 focus:outline-none rounded-md"
              style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)' }}
              aria-label="Search inventory"
            />
            <button
              onClick={() => {
                if (isSelectionMode) {
                  setSelectedBarcodes([]);
                  setIsGlobalEditMode(false);
                }
                setIsSelectionMode(!isSelectionMode);
              }}
              className="h-11 md:h-10 px-4 text-sm font-medium rounded-md flex items-center gap-2 transition-colors flex-shrink-0"
              style={{ 
                backgroundColor: isSelectionMode ? 'var(--color-accent-bg)' : 'var(--bg-secondary)', 
                color: isSelectionMode ? 'var(--color-accent)' : 'var(--text-secondary)',
                border: `1px solid ${isSelectionMode ? 'var(--color-accent)' : 'var(--border-input)'}`
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              {isSelectionMode ? 'Cancel Selection' : 'Select Items'}
            </button>
          </div>
        </div>
      )}

            <div className="flex-1 min-h-[300px] md:shadow-sm md:rounded-lg overflow-hidden flex flex-col md:border border-[var(--border-light)]" style={{ backgroundColor: 'transparent' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full"><p style={{color: 'var(--text-tertiary)'}}>Loading inventory...</p></div>
        ) : items.length === 0 ? (
          <EmptyState message="No items found matching the search." icon="search" />
        ) : (
          <Virtuoso
            data={items}
            useWindowScroll={false}
            style={{ height: '100%', width: '100%' }}
            className="hide-x-scrollbar"
            components={{
              List: forwardRef((props, ref) => (
                <table ref={ref} {...props} className="w-full max-w-full text-center border-collapse block md:table min-w-0 md:min-w-[1100px]" style={{...props.style}}>
                  <thead className="hidden md:table-header-group sticky top-0 z-10 glass-header" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                    <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      {isSelectionMode && (
                        <th className="p-3 w-12 text-center" style={{ boxShadow: 'inset -1px 0 0 var(--border-light)' }}>
                          <input type="checkbox" checked={items.length > 0 && selectedBarcodes.length === items.length} onChange={toggleSelectAll} className="w-4 h-4 rounded text-accent focus:ring-accent cursor-pointer" />
                        </th>
                      )}
                      <th 
                        className="p-3 w-20 cursor-pointer select-none group" 
                        style={{ boxShadow: 'inset -1px 0 0 var(--border-light)' }}
                        onClick={() => handleSortClick('barcode')}
                      >
                        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
                          Barcode
                          {renderSortIcon('barcode')}
                        </div>
                      </th>
                      <th 
                        className="p-3 min-w-[160px] cursor-pointer select-none group" 
                        style={{ boxShadow: 'inset -1px 0 0 var(--border-light)' }}
                        onClick={() => handleSortClick('name')}
                      >
                        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
                          Item Details
                          {renderSortIcon('name')}
                        </div>
                      </th>
                      <th 
                        className="p-3 w-36 cursor-pointer select-none text-center group" 
                        style={{ boxShadow: 'inset -1px 0 0 var(--border-light)' }}
                        onClick={() => handleSortClick('category')}
                      >
                        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
                          Category
                          {renderSortIcon('category')}
                        </div>
                      </th>
                      <th 
                        className="p-3 w-36 cursor-pointer select-none text-center group" 
                        style={{ boxShadow: 'inset -1px 0 0 var(--border-light)' }}
                        onClick={() => handleSortClick('subcategory')}
                      >
                        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
                          SUBCAT
                          {renderSortIcon('subcategory')}
                        </div>
                      </th>
                      <th className="p-3 w-28 text-center" style={{ boxShadow: 'inset -1px 0 0 var(--border-light)' }}>Batches</th>
                      {/* Pricing removed from parent row */}
                      <th 
                        className="p-3 w-28 text-center whitespace-nowrap cursor-pointer select-none group" 
                        style={{ boxShadow: 'inset -1px 0 0 var(--border-light)' }}
                        onClick={() => handleSortClick('whsestock')}
                      >
                        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
                          Whse Qty
                          {renderSortIcon('whsestock')}
                        </div>
                      </th>
                      <th 
                        className="p-3 w-28 text-center whitespace-nowrap cursor-pointer select-none group" 
                        style={{ boxShadow: 'inset -1px 0 0 var(--border-light)' }}
                        onClick={() => handleSortClick('storestock')}
                      >
                        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
                          Store Qty
                          {renderSortIcon('storestock')}
                        </div>
                      </th>
                      <th className="p-3 w-16 text-center">Actions</th>
                    </tr>
                  </thead>
                  {props.children}
                </table>
              )),
              Item: forwardRef((props, ref) => <tbody ref={ref} {...props} className="block md:table-row-group" />)
            }}
            itemContent={(index, item) => (
              <InventoryRow
                item={item}
                viewType={viewType}
                categories={categories}
                subcategories={subcategories}
                isSelected={selectedBarcodes.includes(item.barcode)}
                onSelect={toggleSelect}
                isGlobalEditMode={isGlobalEditMode}
                editData={bulkEditData[item.barcode]}
                onEditChange={handleBulkEditChange}
                onRestore={handleRestore}
                isSelectionMode={isSelectionMode}
                expandedBarcode={expandedBarcode}
                onToggleExpand={(barcode) => setExpandedBarcode(prev => prev === barcode ? null : barcode)}
                onPrint={(batch) => setPrintModal({ isOpen: true, item, batch: batch || null })}
                onDeleteBatch={handleDeleteBatch}
              />
            )}
          />
        )}
      </div>

      {printModal.isOpen && printModal.item && (
        <PrintBatchModal 
          isOpen={printModal.isOpen} 
          onClose={() => setPrintModal({ isOpen: false, item: null, batch: null })} 
          item={printModal.item} 
          selectedBatch={printModal.batch}
        />
      )}

      {createBatchModal.isOpen && createBatchModal.item && (
        <CreateBatchModal 
          item={createBatchModal.item} 
          onClose={() => setCreateBatchModal({ isOpen: false, item: null })} 
        />
      )}

      <ConfirmDialog
        isOpen={!!batchToDelete}
        title="Delete Batch"
        message="Are you sure you want to delete this empty batch? This action will hide the batch from this list."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={confirmDeleteBatch}
        onCancel={() => setBatchToDelete(null)}
      />
    </div>
  );
}