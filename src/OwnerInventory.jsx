import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { getInventoryByQuery } from './services/db';
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
  const [sortOption, setSortOption] = useState('barcode-asc');
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

  // Reset pagination when filters change
  useEffect(() => {
    setInvPage(0);
  }, [selectedCategory, selectedSubcategory]);

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
        viewType: viewType
      });
      return { items: data || [], total: totalCount || 0 };
    },
    staleTime: STALE_TIME_5MIN,
  });

  const updateItemMutation = useMutation({
    mutationFn: async (updatedItem) => {
      const { error } = await supabase.from('inventory').update({
        name: updatedItem.name,
        category: updatedItem.category,
        sub_category: updatedItem.sub_category,
        cost_price: Number(updatedItem.cost_price || 0),
        msp: Number(updatedItem.msp || 0),
        price: Number(updatedItem.price || 0),
        stock_warehouse: Number(updatedItem.stock_warehouse || 0),
        stock_store: Number(updatedItem.stock_store || 0),
        unit: updatedItem.unit,
      }).eq('barcode', updatedItem.barcode);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    onError: (e) => showAlert(e.message, "Update Failed"),
  });

  const handleRemove = (barcode) => {
    showConfirm("Remove this item from the active list?", async () => {
      const { error } = await supabase.from('inventory').update({ is_active: false }).eq('barcode', barcode);
      if (error) {
        showAlert(error.message, "Error Removing Item");
      } else {
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
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
            onChange={(e) => { setSelectedCategory(e.target.value); setSelectedSubcategory(''); }}
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
            onChange={(e) => setSelectedSubcategory(e.target.value)}
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
        <table className={`w-full text-center whitespace-nowrap border-collapse min-w-[${viewType === 'warehouse' ? '1100px' : '850px'}]`}>
          <thead className="sticky top-0" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className={`p-3 ${viewType === 'store' ? 'w-32' : 'w-24'}`} style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
              <th className="p-3" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
              <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Category</th>
              <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Sub-Cat</th>
              {viewType === 'warehouse' && (
                <>
                  <th className="p-3 text-center w-24" style={{ borderRight: '1px solid var(--border-light)' }}>Cost</th>
                  <th className="p-3 text-center w-24" style={{ borderRight: '1px solid var(--border-light)' }}>MSP</th>
                </>
              )}
              <th className={`p-3 text-center ${viewType === 'warehouse' ? 'w-24' : 'w-28'}`} style={{ borderRight: '1px solid var(--border-light)' }}>MRP</th>
              <th className={`p-3 text-center ${viewType === 'warehouse' ? 'w-24' : 'w-28'}`} style={viewType === 'warehouse' ? { borderRight: '1px solid var(--border-light)' } : {}}>
                {viewType === 'warehouse' ? 'Whse Qty' : 'Store Qty'}
              </th>
              {viewType === 'warehouse' && <th className="p-3 text-center w-32">Actions</th>}
            </tr>
          </thead>
          <tbody style={{ borderBottom: '1px solid var(--border-medium)' }}>
            {isLoading ? (
              <tr><td colSpan={viewType === 'warehouse' ? "9" : "6"} className="p-8 text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>Loading inventory...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={viewType === 'warehouse' ? "9" : "6"} className="p-8 text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No items found matching the search.</td></tr>
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