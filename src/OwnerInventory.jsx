import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { getInventoryByQuery, saveInventoryBatch, getInventoryItemByBarcode } from './services/db';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { escapeIlike, debounce } from './utils';
import { INV_PER_PAGE, STALE_TIME_5MIN } from './constants';
import InventoryRow from './InventoryRow';

export default function OwnerInventory({ viewType }) {
  const { showAlert, showConfirm } = useApp();

  const [inventorySearch, setInventorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [sortOption, setSortOption] = useState('barcode-desc');
  const [invPage, setInvPage] = useState(0);
  const queryClient = useQueryClient();

  // Debounced search (fixes #17)
  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 300),
    []
  );

  const handleSearchChange = useCallback((e) => {
    setInventorySearch(e.target.value);
    setInvPage(0);
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
    queryKey: ['inventory', viewType, invPage, debouncedSearch, sortOption, selectedCategory, selectedSubcategory],
    queryFn: async () => {
      if (!navigator.onLine) {
        // Fallback or primarily use local IDB
      }
      // Actually, since we sync to local IDB in the background, we can just query IDB directly for lightning fast pagination!
      const from = invPage * INV_PER_PAGE;
      const { data, totalCount } = await getInventoryByQuery({
        limit: INV_PER_PAGE,
        offset: from,
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

  const items = inventoryData?.items || [];
  const totalInvItems = inventoryData?.total || 0;
  const maxPages = Math.max(1, Math.ceil(totalInvItems / INV_PER_PAGE));
  const safeInvPage = Math.min(invPage, maxPages - 1);

  return (
    <div className="flex flex-col flex-1 pb-4">
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <input
          type="text"
          placeholder="Search Barcode or Name..."
          value={inventorySearch}
          onChange={handleSearchChange}
          className="h-9 px-3 text-sm w-full md:flex-1 focus:outline-none"
          style={{ border: '2px solid var(--border-input)' }}
          aria-label="Search inventory"
        />

        {/* Category Filter */}
        <div className="relative w-full md:w-[200px] flex-shrink-0">
          <select
            value={selectedCategory}
            onChange={(e) => { setSelectedCategory(e.target.value); setSelectedSubcategory(''); setInvPage(0); }}
            className="h-9 w-full pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer font-medium"
            style={{ border: '2px solid var(--border-input)', color: 'var(--text-secondary)' }}
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
            onChange={(e) => { setSelectedSubcategory(e.target.value); setInvPage(0); }}
            disabled={!selectedCategory}
            className="h-9 w-full pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer font-medium disabled:cursor-not-allowed"
            style={{ border: '2px solid var(--border-input)', color: 'var(--text-secondary)' }}
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
            onChange={(e) => { setSortOption(e.target.value); setInvPage(0); }}
            className="h-9 w-full pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer font-medium"
            style={{ border: '2px solid var(--border-input)', color: 'var(--text-secondary)' }}
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

      <div className="overflow-x-auto flex-1 min-h-[300px] shadow-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }}>
        <table className={`w-full text-center whitespace-nowrap border-collapse min-w-[1100px] ${(isLoading || items.length === 0) ? 'h-full' : ''}`}>
          <thead className="sticky top-0" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-3 min-w-[120px]" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
              <th className="p-3 min-w-[160px]" style={{ borderRight: '1px solid var(--border-light)' }}>Item Details</th>
              <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Category</th>
              <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Sub-category</th>
              <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Cost</th>
              <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>MSP</th>
              <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>MRP</th>
              <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Whse Qty</th>
              <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Store Qty</th>
              <th className="p-2 w-36 text-center">Actions</th>
            </tr>
          </thead>
          <tbody style={{ borderBottom: '1px solid var(--border-medium)' }}>
            {isLoading ? (
              <tr><td colSpan="10" className="h-full align-middle text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>Loading inventory...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan="10" className="h-full align-middle text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No items found matching the search.</td></tr>
            ) : (
              items.map(item => (
                <InventoryRow
                  key={item.barcode}
                  item={item}
                  viewType={viewType}
                  categories={categories}
                  subcategories={subcategories}
                  onSave={(data) => updateItemMutation.mutate(data)}
                  onRemove={handleRemove}
                  onRestore={handleRestore}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4 p-3 shadow-sm" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
        <button
          onClick={() => setInvPage(p => Math.max(0, p - 1))}
          disabled={invPage === 0 || isLoading}
          className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}
        >
          Previous
        </button>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Page {safeInvPage + 1} of {maxPages}
        </span>
        <button
          onClick={() => setInvPage(p => p + 1)}
          disabled={(safeInvPage + 1) * INV_PER_PAGE >= totalInvItems || isLoading}
          className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}