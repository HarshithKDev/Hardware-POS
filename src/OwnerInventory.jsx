import React, { useState, useEffect, useMemo, useCallback, forwardRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import { supabase } from './supabaseClient';
import { getInventoryByQuery, saveInventoryBatch, getInventoryItemByBarcode } from './services/db';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { escapeIlike, debounce } from './utils';
import { STALE_TIME_5MIN } from './constants';
import InventoryRow from './InventoryRow';

export default function OwnerInventory({ viewType }) {
  const { showAlert, showConfirm } = useApp();

  const [inventorySearch, setInventorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [sortOption, setSortOption] = useState('barcode-desc');
  const [selectedBarcodes, setSelectedBarcodes] = useState([]);
  const [expandedBarcode, setExpandedBarcode] = useState(null);
  const [isGlobalEditMode, setIsGlobalEditMode] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

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
    queryKey: ['inventory', viewType, debouncedSearch, sortOption, selectedCategory, selectedSubcategory],
    queryFn: async () => {
      if (!navigator.onLine) {
        // Fallback or primarily use local IDB
      }
      // Actually, since we sync to local IDB in the background, we can just query IDB directly for lightning fast pagination!
      const { data, totalCount } = await getInventoryByQuery({
        limit: 1000000,
        offset: 0,
        search: debouncedSearch,
        category: selectedCategory,
        subcategory: selectedSubcategory,
        sortOption: sortOption,
        viewType: viewType === 'recycle' ? 'warehouse' : viewType,
        status: viewType === 'recycle' ? 'deactivated' : 'active'
      });
      return { items: data || [], total: totalCount || 0 };
    },
    staleTime: STALE_TIME_5MIN,
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ oldItem, newItem }) => {
      const { error } = await supabase.from('inventory').update({
        name: newItem.name,
        category: newItem.category,
        sub_category: newItem.sub_category,
        cost_price: Number(newItem.cost_price || 0),
        msp: Number(newItem.msp || 0),
        price: Number(newItem.price || 0),
        stock_warehouse: Number(newItem.stock_warehouse || 0),
        stock_store: Number(newItem.stock_store || 0),
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

  const handleRemove = (barcode) => {
    showConfirm("Remove this item from the active list?", async () => {
      const itemToDelete = items.find(i => i.barcode === barcode);
      const { error } = await supabase.from('inventory').update({ is_active: false }).eq('barcode', barcode);
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
    });
  };

  const handleRestore = (barcode) => {
    showConfirm("Restore this item to active inventory?", async () => {
      const itemToRestore = items.find(i => i.barcode === barcode);
      const { error } = await supabase.from('inventory').update({ is_active: true }).eq('barcode', barcode);
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
    });
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

  const saveBulkEdits = async () => {
    const itemsToSave = Object.values(bulkEditData);
    if (itemsToSave.length === 0) return;
    try {
      // First update Supabase
      const { error } = await supabase.from('inventory').upsert(itemsToSave, { onConflict: 'barcode' });
      if (error) throw error;
      
      // Then update local IDB
      await saveInventoryBatch(itemsToSave);
      
      const changesList = itemsToSave.map(item => `${item.name} (${item.barcode})`);
      await supabase.from('audit_logs').insert([{
        action_type: 'UPDATE',
        barcode: 'BULK',
        item_name: 'Multiple Items',
        changes: `Bulk updated items: ${changesList.join(', ')}`,
        performed_by: 'Owner'
      }]);
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
    showConfirm(`Are you sure you want to ${viewType === 'recycle' ? 'restore' : 'delete'} ${selectedBarcodes.length} items?`, async () => {
      const isRecycle = viewType === 'recycle';
      const updateValue = isRecycle ? true : false;
      const { error } = await supabase.from('inventory').update({ is_active: updateValue }).in('barcode', selectedBarcodes);
      
      if (error) {
        showAlert(error.message, `Error ${isRecycle ? 'Restoring' : 'Removing'} Items`);
      } else {
        await supabase.from('audit_logs').insert([{
          action_type: isRecycle ? 'RESTORE' : 'DELETE',
          barcode: 'BULK',
          item_name: 'Multiple Items',
          changes: `${isRecycle ? 'Restored' : 'Deleted'} ${selectedBarcodes.length} items`,
          performed_by: 'Owner'
        }]);
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        setSelectedBarcodes([]);
        setIsGlobalEditMode(false);
        showAlert(`Successfully ${isRecycle ? 'restored' : 'removed'} ${selectedBarcodes.length} items!`, "Success");
      }
    });
  };

  const items = inventoryData?.items || [];
  const totalInvItems = inventoryData?.total || 0;

  return (
    <div className="flex flex-col flex-1">
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
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className="h-11 md:h-10 px-4 text-sm font-medium rounded-md flex items-center gap-2 transition-colors flex-shrink-0"
              style={{ 
                backgroundColor: isFilterOpen ? 'var(--color-accent-bg)' : 'var(--bg-secondary)', 
                color: isFilterOpen ? 'var(--color-accent)' : 'var(--text-secondary)',
                border: `1px solid ${isFilterOpen ? 'var(--color-accent)' : 'var(--border-input)'}`
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {(selectedCategory || selectedSubcategory || sortOption !== 'barcode-desc') && (
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }}></span>
              )}
            </button>
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

          {isFilterOpen && (
            <div className="flex flex-col md:flex-row gap-4 p-4 rounded-lg animate-fade-in" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
              {/* Category Filter */}
              <div className="relative w-full md:w-[200px] flex-shrink-0">
                <select
                  value={selectedCategory}
                  onChange={(e) => { setSelectedCategory(e.target.value); setSelectedSubcategory(''); }}
                  className="h-11 md:h-10 w-full pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer font-medium rounded-md"
                  style={{ border: '1px solid var(--border-input)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-input)' }}
                  aria-label="Filter by category"
                >
                  <option value="">All Categories</option>
                  {categories?.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}>
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>

              {/* Sub-Category Filter */}
              <div className="relative w-full md:w-[200px] flex-shrink-0">
                <select
                  value={selectedSubcategory}
                  onChange={(e) => { setSelectedSubcategory(e.target.value); }}
                  disabled={!selectedCategory}
                  className="h-11 md:h-10 w-full pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer font-medium disabled:cursor-not-allowed rounded-md"
                  style={{ border: '1px solid var(--border-input)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-input)' }}
                  aria-label="Filter by sub-category"
                >
                  <option value="">All Sub-categories</option>
                  {subcategories?.filter(sub => sub.category_name === selectedCategory).map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}>
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>

              {/* Sort Filter */}
              <div className="relative w-full md:w-[220px] flex-shrink-0">
                <select
                  value={sortOption}
                  onChange={(e) => { setSortOption(e.target.value); }}
                  className="h-11 md:h-10 w-full pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer font-medium rounded-md"
                  style={{ border: '1px solid var(--border-input)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-input)' }}
                  aria-label="Sort inventory"
                >
                  <option value="barcode-asc">Barcode (Low to High)</option>
                  <option value="barcode-desc">Barcode (High to Low)</option>
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="name-desc">Name (Z-A)</option>
                  {viewType === 'warehouse' && (
                    <>
                      <option value="stock-asc">Quantity (Low-High)</option>
                      <option value="stock-desc">Quantity (High-Low)</option>
                    </>
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}>
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

            <div className="flex-1 min-h-[300px] md:shadow-sm md:rounded-lg overflow-hidden flex flex-col" style={{ backgroundColor: 'transparent' }}>
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
                        <th className="p-3 w-12 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                          <input type="checkbox" checked={items.length > 0 && selectedBarcodes.length === items.length} onChange={toggleSelectAll} className="w-4 h-4 rounded text-accent focus:ring-accent cursor-pointer" />
                        </th>
                      )}
                      <th className="p-3 min-w-[120px]" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
                      <th className="p-3 min-w-[160px]" style={{ borderRight: '1px solid var(--border-light)' }}>Item Details</th>
                      <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Category</th>
                      <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Sub-category</th>
                      <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Cost</th>
                      <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>MSP</th>
                      <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>MRP</th>
                      <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Whse Qty</th>
                      <th className="p-3 w-24 text-center">Store Qty</th>
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
              />
            )}
          />
        )}
      </div>
    </div>
  );
}