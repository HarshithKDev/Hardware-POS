import React, { useState, useEffect, useMemo, useCallback, forwardRef } from 'react';
import { getPerformedBy, formatINR } from './utils';
import { TableVirtuoso } from 'react-virtuoso';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import PrintBatchModal from './PrintBatchModal';
import CreateBatchModal from './CreateBatchModal';
import { supabase } from './supabaseClient';
import { 
  getInventoryByQuery, 
  saveInventoryBatch, 
  getInventoryItemByBarcode,
  getLocalCategories,
  setLocalCategories,
  getLocalSubcategories,
  setLocalSubcategories
} from './services/db';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ConfirmDialog } from './Dialog';
import { useApp } from './AppContext';
import { escapeIlike, debounce, useSessionState } from './utils';
import { STALE_TIME_5MIN } from './constants';
import InventoryRow from './InventoryRow';
import BatchDetailsModal from './BatchDetailsModal';
import { buttonClass, TableSkeleton } from './components/ui';

export default function OwnerInventory({ viewType, onOpenBatchDetails }) {
  const { showAlert, showConfirm, shopSettings, isWarehouseDisabled } = useApp();
  const shopId = shopSettings?.id || localStorage.getItem('shop_id');

  const [inventorySearch, setInventorySearch] = useSessionState(`pos_inv_search_${shopId}_${viewType}`, '');
  const [debouncedSearch, setDebouncedSearch] = useSessionState(`pos_inv_debounced_${shopId}_${viewType}`, () => inventorySearch || '');
  const [sortOption, setSortOption] = useSessionState(`pos_inv_sort_${shopId}_${viewType}`, 'barcode-asc');
  const [filterCategory, setFilterCategory] = useSessionState(`pos_inv_cat_${shopId}_${viewType}`, '');
  const [filterSubcategory, setFilterSubcategory] = useSessionState(`pos_inv_subcat_${shopId}_${viewType}`, '');
  const [selectedBarcodes, setSelectedBarcodes] = useState([]);
  const [batchModalBarcode, setBatchModalBarcode] = useState(null);
  const [isGlobalEditMode, setIsGlobalEditMode] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({});
  const [printModal, setPrintModal] = useState({ isOpen: false, item: null, batch: null });
  const [createBatchModal, setCreateBatchModal] = useState({ isOpen: false, item: null });
  const [batchToDelete, setBatchToDelete] = useState(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const handleResetFilters = useCallback(() => {
    setInventorySearch('');
    setDebouncedSearch('');
    setSortOption('barcode-asc');
    setFilterCategory('');
    setFilterSubcategory('');
    setSelectedBarcodes([]);
    setIsSelectionMode(false);
    setIsGlobalEditMode(false);
    try {
      window.sessionStorage.removeItem(`pos_inv_search_${shopId}_${viewType}`);
      window.sessionStorage.removeItem(`pos_inv_debounced_${shopId}_${viewType}`);
      window.sessionStorage.removeItem(`pos_inv_sort_${shopId}_${viewType}`);
      window.sessionStorage.removeItem(`pos_inv_cat_${shopId}_${viewType}`);
      window.sessionStorage.removeItem(`pos_inv_subcat_${shopId}_${viewType}`);
    } catch (e) {}
  }, [shopId, viewType, setInventorySearch, setDebouncedSearch, setSortOption, setFilterCategory, setFilterSubcategory]);

  useEffect(() => {
    const handleReset = () => handleResetFilters();
    window.addEventListener('reset_inventory_filters', handleReset);
    return () => window.removeEventListener('reset_inventory_filters', handleReset);
  }, [handleResetFilters]);

  useEffect(() => {
    const handleOpenCreateBatchModal = (e) => setCreateBatchModal({ isOpen: true, item: e.detail });
    window.addEventListener('openCreateBatchModal', handleOpenCreateBatchModal);
    return () => window.removeEventListener('openCreateBatchModal', handleOpenCreateBatchModal);
  }, []);

  const queryClient = useQueryClient();

  useEffect(() => {
    // Reconcile and pull remote items on mount to ensure immediate consistency
    import('./services/sync').then(({ syncInventoryToLocal, reconcileDeletedItems }) => {
      if (navigator.onLine) {
        const forceFull = !sessionStorage.getItem('owner_inv_synced');
        syncInventoryToLocal('owner', { forceFull }).then(() => {
          sessionStorage.setItem('owner_inv_synced', 'true');
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
        });
      }
      reconcileDeletedItems('owner').then(() => {
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
      });
    }).catch(err => console.warn('Sync on mount error:', err));

    const handleSyncComplete = () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    };
    window.addEventListener('inventory_sync_complete', handleSyncComplete);
    return () => window.removeEventListener('inventory_sync_complete', handleSyncComplete);
  }, [queryClient]);

  // Debounced search (fixes #17)
  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 300),
    [setDebouncedSearch]
  );

  useEffect(() => {
    if (inventorySearch && debouncedSearch !== inventorySearch) {
      setDebouncedSearch(inventorySearch);
    }
  }, [inventorySearch, debouncedSearch, setDebouncedSearch]);

  const handleSearchChange = useCallback((e) => {
    setInventorySearch(e.target.value);
    debouncedSetSearch(e.target.value);
  }, [debouncedSetSearch, setInventorySearch]);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', shopId],
    queryFn: async () => {
      let query = supabase.from('categories').select('name').order('name', { ascending: true });
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const res = data || [];
      if (res.length > 0) setLocalCategories(shopId, res);
      return res;
    },
    initialData: () => getLocalCategories(shopId),
    staleTime: STALE_TIME_5MIN,
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories', shopId],
    queryFn: async () => {
      let query = supabase.from('subcategories').select('name, category_name').order('name', { ascending: true });
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const res = data || [];
      if (res.length > 0) setLocalSubcategories(shopId, res);
      return res;
    },
    initialData: () => getLocalSubcategories(shopId),
    staleTime: STALE_TIME_5MIN,
  });

  const handleCategoryChange = useCallback((e) => {
    setFilterCategory(e.target.value);
    setFilterSubcategory('');
  }, []);

  const availableSubcategories = useMemo(() => {
    if (!subcategories || !Array.isArray(subcategories)) return [];
    if (filterCategory) {
      return subcategories.filter(s => s.category_name === filterCategory);
    }
    const seen = new Set();
    return subcategories.filter(s => {
      if (!s.name || seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });
  }, [subcategories, filterCategory]);

  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['inventory', shopId, viewType, debouncedSearch, sortOption, filterCategory, filterSubcategory],
    queryFn: async () => {
      if (!navigator.onLine) {
        // Fallback or primarily use local IDB
      }
      // Actually, since we sync to local IDB in the background, we can just query IDB directly for lightning fast pagination!
      const { data, totalCount } = await getInventoryByQuery({
        limit: 1000000,
        offset: 0,
        search: debouncedSearch,
        category: filterCategory,
        subcategory: filterSubcategory,
        sortOption: sortOption,
        viewType: viewType === 'recycle' ? 'warehouse' : viewType,
        status: viewType === 'recycle' ? 'deactivated' : 'active'
      });
      return { items: data || [], total: totalCount || 0 };
    },
    staleTime: STALE_TIME_5MIN,
    placeholderData: keepPreviousData,
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
      const shopId = localStorage.getItem('shop_id');
      let delQuery = supabase.from('product_master').update({ is_active: false }).eq('barcode', barcode);
      if (shopId) {
        delQuery = delQuery.eq('shop_id', shopId);
      }
      const { error } = await delQuery;
      if (error) {
        showAlert(error.message, "Error Removing Item");
      } else {
        if (itemToDelete) {
          await supabase.from('audit_logs').insert([{
            action_type: 'DELETE',
            barcode: barcode,
            item_name: itemToDelete.name,
            changes: `${itemToDelete.name} was moved to Recycle Bin (Whse Stock: ${itemToDelete.stock_warehouse}, Store Stock: ${itemToDelete.stock_store})`,
            performed_by: getPerformedBy()
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
      const shopId = localStorage.getItem('shop_id');
      let resQuery = supabase.from('product_master').update({ is_active: true }).eq('barcode', barcode);
      if (shopId) {
        resQuery = resQuery.eq('shop_id', shopId);
      }
      const { error } = await resQuery;
      if (error) {
        showAlert(error.message, "Error Restoring Item");
      } else {
        if (itemToRestore) {
          await supabase.from('audit_logs').insert([{
            action_type: 'RESTORE',
            barcode: barcode,
            item_name: itemToRestore.name,
            changes: `${itemToRestore.name} was restored from Recycle Bin`,
            performed_by: getPerformedBy()
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
    setSelectedBarcodes(prev => {
      const next = prev.includes(barcode) ? prev.filter(b => b !== barcode) : [...prev, barcode];
      if (next.length === 0 && window.innerWidth < 768) {
        setIsSelectionMode(false);
      }
      return next;
    });
  };

  const handleLongPress = useCallback((barcode) => {
    setIsSelectionMode(true);
    setSelectedBarcodes(prev => prev.includes(barcode) ? prev : [...prev, barcode]);
  }, []);

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
        let updateQuery = supabase.from('inventory_batches').update({ is_active: false }).eq('batch_id', deletingId);
        if (shopId) updateQuery = updateQuery.eq('shop_id', shopId);
        const { error: updErr } = await updateQuery;
        if (updErr) throw updErr;
      }

      const itemToLog = items.find(i => i.batches && i.batches.some(b => b.batch_id === deletingId));
      if (itemToLog) {
        try {
          let bumpQuery = supabase.from('product_master').update({ updated_at: new Date().toISOString() }).eq('barcode', itemToLog.barcode);
          if (shopId) bumpQuery = bumpQuery.eq('shop_id', shopId);
          await bumpQuery;
        } catch (e) {}
      }

      try {
        const batchNum = itemToLog?.batches?.find(b => b.batch_id === deletingId)?.batch_number || 'Unknown';
        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          action_type: 'DELETE',
          barcode: itemToLog ? itemToLog.barcode : 'Unknown',
          item_name: itemToLog ? itemToLog.name : 'Unknown Item',
          changes: `Deleted Batch #${batchNum}`,
          performed_by: getPerformedBy()
        }]);
      } catch (err) {
        console.error("Failed to log batch deletion", err);
      }
      
      // Instantly update IndexedDB cache
      const { initDB, saveInventoryBatch } = await import('./services/db.js');
      const db = await initDB();
      const allItems = await db.getAll('product_master');
      const itemToUpdate = allItems.find(i => i.batches && i.batches.some(b => b.batch_id === deletingId));
      if (itemToUpdate) {
        itemToUpdate.batches = (itemToUpdate.batches || []).filter(b => b.batch_id !== deletingId && b.is_active !== false);
        await saveInventoryBatch([itemToUpdate]);
      }

      // Update React Query cache directly
      queryClient.setQueriesData({ queryKey: ['inventory_item'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          batches: (old.batches || []).filter(b => b.batch_id !== deletingId && b.is_active !== false)
        };
      });
      
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
    } catch (err) {
      console.error(err);
      showAlert("Failed to delete batch: " + err.message, "Error");
    } finally {
      setBatchToDelete(null);
    }
  };

  const saveBulkEdits = async () => {
    const itemsToSave = Object.values(bulkEditData);
    if (itemsToSave.length === 0) return;
    try {
      // First update Supabase
      const { error } = await supabase.from('product_master').upsert(itemsToSave, { onConflict: 'shop_id, barcode' });
      if (error) throw error;

      // Update active batches in inventory_batches for items where cost_price was edited
      for (const it of itemsToSave) {
        if (it.cost_price !== undefined && it.cost_price !== '') {
          let bQuery = supabase
            .from('inventory_batches')
            .update({ purchase_cost: Number(it.cost_price) })
            .eq('barcode', it.barcode)
            .eq('is_active', true);
          if (shopId) bQuery = bQuery.eq('shop_id', shopId);
          await bQuery;
        }
      }
      
      // Then update local IDB
      await saveInventoryBatch(itemsToSave);
      
      const auditLogs = itemsToSave.map(item => ({
        shop_id: shopId,
        action_type: 'UPDATE',
        barcode: item.barcode,
        item_name: item.name,
        changes: `Item updated via Global Edit${item.cost_price !== undefined ? ` (Cost Price: ₹${formatINR(item.cost_price, 2)})` : ''}`,
        performed_by: getPerformedBy()
      }));
      await supabase.from('audit_logs').insert(auditLogs);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
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
      const shopId = localStorage.getItem('shop_id');
      let bulkQuery = supabase.from('product_master').update({ is_active: updateValue }).in('barcode', selectedBarcodes);
      if (shopId) {
        bulkQuery = bulkQuery.eq('shop_id', shopId);
      }
      const { error } = await bulkQuery;
      
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
              changes: `${item.name} was ${isRecycle ? 'restored from' : 'moved to'} Recycle Bin`,
              performed_by: getPerformedBy()
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
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0 ml-1" style={{ color: 'var(--color-accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isAsc ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          )}
        </svg>
      );
    }
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0 opacity-60 ml-1" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  };

  const items = inventoryData?.items || [];
  const totalInvItems = inventoryData?.total || 0;

  const tableComponents = useMemo(() => ({
    Table: (props) => (
      <table
        {...props}
        className={`w-full text-center border-collapse table-fixed ${props.className || ''}`}
        style={{ ...props.style }}
      />
    ),
    TableHead: forwardRef((props, ref) => (
      <thead
        ref={ref}
        {...props}
        className="hidden md:table-header-group sticky top-0 z-20 glass-header"
        style={{
          ...props.style,
          borderBottom: '1px solid var(--border-medium)',
          backgroundColor: 'var(--bg-tertiary)'
        }}
      />
    )),
    TableRow: ({ item, context, ...props }) => {
      if (!item) return <tr {...props} />;
      const isSelected = context?.selectedBarcodes?.includes(item.barcode);
      const isEdit = context?.isGlobalEditMode && isSelected && context?.viewType === 'warehouse';
      return (
        <tr
          {...props}
          className={`hover-row premium-hover ${context?.isSelectionMode ? 'cursor-pointer' : ''} ${isSelected ? 'selected' : ''} block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none border md:border-b md:border-t-0 md:border-l-0 md:border-r-0 border-[var(--border-medium)] md:border-[var(--border-medium)] mb-2 md:mb-0 relative md:static ${isEdit ? 'transition-none' : ''}`}
          style={{
            ...props.style,
            borderBottom: '1px solid var(--border-medium)',
            ...(isEdit ? { backgroundColor: 'var(--bg-tertiary)' } : {})
          }}
          onClick={() => {
            if (context?.isSelectionMode && item?.barcode) {
              context.toggleSelect(item.barcode);
            }
          }}
        >
          {props.children}
        </tr>
      );
    },
    FillerRow: ({ height }) => (
      <tr className="block md:table-row" style={{ height: `${height}px` }}>
        <td colSpan={10} className="block md:table-cell" style={{ height: `${height}px`, padding: 0, border: 0, margin: 0 }} />
      </tr>
    )
  }), []);

  const fixedHeaderContent = useCallback(() => (
    <tr className="h-10 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
      {isSelectionMode && (
        <th className="p-3 w-12 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
          <input type="checkbox" checked={items.length > 0 && selectedBarcodes.length === items.length} onChange={toggleSelectAll} className="w-4 h-4 rounded text-accent focus:ring-accent cursor-pointer" />
        </th>
      )}
      <th 
        className="p-3 w-24 lg:w-28 cursor-pointer select-none group" 
        style={{ borderRight: '1px solid var(--border-medium)' }}
        onClick={() => handleSortClick('barcode')}
      >
        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
          Barcode
          {renderSortIcon('barcode')}
        </div>
      </th>
      <th 
        className="p-3 w-full min-w-[180px] cursor-pointer select-none group" 
        style={{ borderRight: '1px solid var(--border-medium)' }}
        onClick={() => handleSortClick('name')}
      >
        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
          Item Details
          {renderSortIcon('name')}
        </div>
      </th>
      <th 
        className="p-3 w-36 lg:w-48 cursor-pointer select-none text-center group" 
        style={{ borderRight: '1px solid var(--border-medium)' }}
        onClick={() => handleSortClick('category')}
      >
        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
          Category
          {renderSortIcon('category')}
        </div>
      </th>
      <th 
        className="p-3 w-32 lg:w-40 cursor-pointer select-none text-center group" 
        style={{ borderRight: '1px solid var(--border-medium)' }}
        onClick={() => handleSortClick('subcategory')}
      >
        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
          SUBCAT
          {renderSortIcon('subcategory')}
        </div>
      </th>
      <th className="p-3 w-28 lg:w-32 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Batches</th>
      {!isWarehouseDisabled && (
        <th 
          className="p-3 w-24 lg:w-28 text-center whitespace-nowrap cursor-pointer select-none group" 
          style={{ borderRight: '1px solid var(--border-medium)' }}
          onClick={() => handleSortClick('whsestock')}
        >
          <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
            Whse Qty
            {renderSortIcon('whsestock')}
          </div>
        </th>
      )}
      <th 
        className="p-3 w-24 lg:w-28 text-center whitespace-nowrap cursor-pointer select-none group" 
        style={{ borderRight: '1px solid var(--border-medium)' }}
        onClick={() => handleSortClick('storestock')}
      >
        <div className="flex items-center justify-center gap-1 group-hover:text-[var(--color-accent)] transition-colors">
          {isWarehouseDisabled ? 'Stock Qty' : 'Store Qty'}
          {renderSortIcon('storestock')}
        </div>
      </th>
      <th className="p-3 w-28 lg:w-32 text-center">Actions</th>
    </tr>
  ), [isSelectionMode, items.length, selectedBarcodes.length, sortOption, handleSortClick, renderSortIcon, toggleSelectAll, isWarehouseDisabled]);

  return (
    <div className="flex flex-col flex-1 h-full animate-fade-in w-full relative">
      {selectedBarcodes.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 mb-4 rounded-[10px]" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--color-accent)' }}>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {selectedBarcodes.length} item(s) selected
          </div>
          <div className="flex flex-wrap gap-2">
            {isGlobalEditMode ? (
              <>
                <button onClick={saveBulkEdits} className={buttonClass({ variant: 'primary', size: 'sm' })}>
                  Save Changes
                </button>
                <button onClick={cancelBulkEdit} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                {viewType === 'warehouse' && (
                  <button onClick={startBulkEdit} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                    Edit Selected
                  </button>
                )}
                <button onClick={bulkDelete} className={buttonClass({ variant: viewType === 'recycle' ? 'success' : 'danger', size: 'sm' })}>
                  {viewType === 'recycle' ? 'Restore Selected' : 'Delete Selected'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBarcodes([]);
                    setIsSelectionMode(false);
                  }}
                  className={buttonClass({ variant: 'secondary', size: 'sm', className: 'md:hidden' })}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 mb-4">
          <div className="flex flex-col md:flex-row gap-2">
            <input
              type="text"
              placeholder="Search Barcode or Name..."
              value={inventorySearch}
              onChange={handleSearchChange}
              className="h-11 md:h-10 px-3 text-sm flex-1 min-w-0 focus:outline-none rounded-md"
              style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }}
              aria-label="Search inventory"
            />
            
            <div className="grid grid-cols-2 md:flex gap-2 w-full md:w-auto">
              <div className="w-full md:w-48 lg:w-52 shrink-0">
                <select
                  value={filterCategory}
                  onChange={handleCategoryChange}
                  className="w-full h-11 md:h-10 pl-3 pr-8 text-sm focus:outline-none rounded-md cursor-pointer truncate"
                  style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  aria-label="Filter by category"
                >
                  <option value="">All Categories</option>
                  {categories?.map((c) => {
                    const name = typeof c === 'string' ? c : (c?.name || '');
                    if (!name) return null;
                    return <option key={name} value={name}>{name}</option>;
                  })}
                </select>
              </div>

              <div className="w-full md:w-48 lg:w-52 shrink-0">
                <select
                  value={filterSubcategory}
                  onChange={(e) => setFilterSubcategory(e.target.value)}
                  className="w-full h-11 md:h-10 pl-3 pr-8 text-sm focus:outline-none rounded-md cursor-pointer truncate disabled:opacity-50"
                  style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  aria-label="Filter by subcategory"
                  disabled={availableSubcategories.length === 0}
                >
                  <option value="">
                    {availableSubcategories.length === 0 && filterCategory ? 'No Subcategories' : 'All Subcategories'}
                  </option>
                  {availableSubcategories.map((s) => {
                    const name = typeof s === 'string' ? s : (s?.name || '');
                    if (!name) return null;
                    return <option key={name} value={name}>{name}</option>;
                  })}
                </select>
              </div>
            </div>

            {/* Select Items button: desktop only, since mobile uses long-press */}
            <button
              onClick={() => {
                if (isSelectionMode) {
                  setSelectedBarcodes([]);
                  setIsGlobalEditMode(false);
                }
                setIsSelectionMode(!isSelectionMode);
              }}
              className="hidden md:flex h-11 md:h-10 px-4 text-sm font-medium rounded-md items-center justify-center gap-2 transition-colors shrink-0 cursor-pointer"
              style={{ 
                backgroundColor: isSelectionMode ? 'var(--color-accent-bg)' : 'var(--bg-secondary)', 
                color: isSelectionMode ? 'var(--color-accent)' : 'var(--text-secondary)',
                border: `1px solid ${isSelectionMode ? 'var(--color-accent)' : 'var(--border-input)'}`
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <span>{isSelectionMode ? 'Cancel Selection' : 'Select Items'}</span>
            </button>
          </div>
        </div>
      )}

            <div className="flex-1 min-h-[300px] md:rounded-[10px] overflow-hidden flex flex-col md:border border-[var(--border-light)]" style={{ backgroundColor: 'transparent' }}>
        {isLoading ? (
          <TableSkeleton rows={10} cols={6} label="Loading inventory…" />
        ) : items.length === 0 ? (
          <EmptyState message="No items found matching the search." icon="search" />
        ) : (
          <TableVirtuoso
            data={items}
            computeItemKey={(index, item) => item?.barcode || index}
            useWindowScroll={false}
            style={{ height: '100%', width: '100%' }}
            className="overflow-x-hidden"
            defaultItemHeight={60}
            increaseViewportBy={{ top: 300, bottom: 300 }}
            fixedHeaderContent={fixedHeaderContent}
            components={tableComponents}
            context={{
              isSelectionMode,
              selectedBarcodes,
              isGlobalEditMode,
              viewType,
              toggleSelect
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
                onLongPress={handleLongPress}
                onOpenBatchDetails={(targetItem) => {
                  if (onOpenBatchDetails) {
                    onOpenBatchDetails(targetItem);
                  } else {
                    setBatchModalBarcode(targetItem.barcode);
                  }
                }}
              />
            )}
          />
        )}
      </div>

      {!onOpenBatchDetails && batchModalBarcode && (
        <BatchDetailsModal
          isOpen={!!batchModalBarcode}
          onClose={() => setBatchModalBarcode(null)}
          item={items.find(i => i.barcode === batchModalBarcode)}
          onPrintBatch={(batch) => {
            const currentItem = items.find(i => i.barcode === batchModalBarcode);
            setPrintModal({ isOpen: true, item: currentItem, batch });
          }}
          onDeleteBatch={handleDeleteBatch}
          onOpenCreateBatch={(targetItem) => {
            setCreateBatchModal({ isOpen: true, item: targetItem });
          }}
          viewType={viewType}
        />
      )}

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