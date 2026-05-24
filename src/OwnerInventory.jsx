import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import InventoryRow from './InventoryRow';

export default function OwnerInventory({ viewType, showAlert, showConfirm }) {
  const [inventorySearch, setInventorySearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc'); 
  const [invPage, setInvPage] = useState(0);
  const INV_PER_PAGE = 50;
  const queryClient = useQueryClient();

  // Reset pagination (dividing data into separate pages) when filters change
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
    staleTime: 1000 * 60 * 5 // Cache (a temporary memory layer) for 5 minutes to prevent loading delays
  });

  const { data: subcategories } = useQuery({
    queryKey: ['subcategories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcategories').select('name, category_name').order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60 * 5
  });

  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['inventory', viewType, invPage, inventorySearch, sortOption, selectedCategory, selectedSubcategory],
    queryFn: async () => {
      const from = invPage * INV_PER_PAGE;
      let query = supabase.from('inventory').select('*', { count: 'exact' }).eq('is_active', true);
      
      if (inventorySearch.trim() !== '') {
        query = query.or(`name.ilike.%${inventorySearch}%,barcode.ilike.%${inventorySearch}%`);
      }
      if (selectedCategory) {
        query = query.eq('category', selectedCategory);
      }
      if (selectedSubcategory) {
        query = query.eq('sub_category', selectedSubcategory);
      }
      
      if (sortOption === 'barcode-asc') query = query.order('barcode', { ascending: true });
      else if (sortOption === 'barcode-desc') query = query.order('barcode', { ascending: false });
      else if (sortOption === 'name-asc') query = query.order('name', { ascending: true });
      else if (sortOption === 'name-desc') query = query.order('name', { ascending: false });
      else if (sortOption === 'stock-asc') query = query.order(viewType === 'warehouse' ? 'stock_warehouse' : 'stock_store', { ascending: true });
      else if (sortOption === 'stock-desc') query = query.order(viewType === 'warehouse' ? 'stock_warehouse' : 'stock_store', { ascending: false });

      const { data, count, error } = await query.range(from, from + INV_PER_PAGE - 1);
      if (error) throw error;
      
      return { items: data || [], total: count || 0 };
    },
    staleTime: 1000 * 60 * 5 // Cache data so it displays instantly on tab switch
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
        unit: updatedItem.unit
      }).eq('barcode', updatedItem.barcode);
      if (error) throw error;
    },
    // Invalidate (force a fresh fetch from the database to clear the cache)
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }), 
    onError: (e) => showAlert(e.message, "Update Failed")
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
          onChange={e => { setInventorySearch(e.target.value); setInvPage(0); }} 
          className={`h-9 border-2 border-gray-300 bg-white px-3 text-sm w-full md:flex-1 rounded-none focus:outline-none focus:border-[#0078D7]`} 
        />

        {/* Category Filter Dropdown */}
        <div className="relative w-full md:w-[200px] flex-shrink-0">
          <select 
            value={selectedCategory} 
            onChange={(e) => { 
              setSelectedCategory(e.target.value); 
              setSelectedSubcategory(''); 
            }} 
            className="h-9 w-full border-2 border-gray-300 bg-white pl-3 pr-8 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer font-medium text-gray-700"
          >
            <option value="">All Categories</option>
            {categories?.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
            <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
          </div>
        </div>

        {/* Sub-Category Filter Dropdown */}
        <div className="relative w-full md:w-[200px] flex-shrink-0">
          <select 
            value={selectedSubcategory} 
            onChange={(e) => setSelectedSubcategory(e.target.value)} 
            disabled={!selectedCategory}
            className="h-9 w-full border-2 border-gray-300 bg-white pl-3 pr-8 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer font-medium text-gray-700 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            <option value="">All Sub-categories</option>
            {subcategories?.filter(sub => sub.category_name === selectedCategory).map(s => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
            <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
          </div>
        </div>

        {/* Sort Filter Dropdown */}
        <div className="relative w-full md:w-[220px] flex-shrink-0">
          <select 
            value={sortOption} 
            onChange={(e) => { setSortOption(e.target.value); setInvPage(0); }} 
            className="h-9 w-full border-2 border-gray-300 bg-white pl-3 pr-8 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer font-medium text-gray-700"
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
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
            <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
          </div>
        </div>
      </div>

      <div className={`border border-gray-400 overflow-x-auto bg-white flex-1 min-h-[300px] rounded-none shadow-sm`}>
        <table className={`w-full text-center whitespace-nowrap border-collapse min-w-[${viewType === 'warehouse' ? '1100px' : '850px'}]`}>
          <thead className="bg-[#f9f9f9] sticky top-0 border-b border-gray-400">
            <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              <th className={`p-3 border-r border-gray-200 ${viewType === 'store' ? 'w-32' : 'w-24'}`}>Barcode</th>
              <th className="p-3 border-r border-gray-200">Item Name</th>
              <th className="p-3 border-r border-gray-200 w-28">Category</th>
              <th className="p-3 border-r border-gray-200 w-28">Sub-Cat</th>
              {viewType === 'warehouse' && (
                <>
                  <th className="p-3 border-r border-gray-200 text-center w-24">Cost</th>
                  <th className="p-3 border-r border-gray-200 text-center w-24">MSP</th>
                </>
              )}
              <th className={`p-3 border-r border-gray-200 text-center ${viewType === 'warehouse' ? 'w-24' : 'w-28'}`}>MRP</th>
              <th className={`p-3 text-center ${viewType === 'warehouse' ? 'border-r border-gray-200 w-24' : 'w-28'}`}>{viewType === 'warehouse' ? 'Whse Qty' : 'Store Qty'}</th>
              {viewType === 'warehouse' && <th className="p-3 text-center w-32">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 border-b border-gray-400">
            {isLoading ? (
              <tr><td colSpan={viewType === 'warehouse' ? "9" : "6"} className="p-8 text-center text-gray-500 text-sm font-semibold">Loading inventory...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={viewType === 'warehouse' ? "9" : "6"} className="p-8 text-center text-gray-500 text-sm font-semibold">No items found matching the search.</td></tr>
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

      <div className="flex justify-between items-center mt-4 bg-[#f3f3f3] p-3 border border-gray-400 rounded-none shadow-sm">
        <button 
          onClick={() => setInvPage(p => Math.max(0, p - 1))} 
          disabled={invPage === 0 || isLoading} 
          className="h-8 px-6 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none"
        >
          Previous
        </button>
        <span className="text-sm font-semibold text-gray-700">
          Page {safeInvPage + 1} of {maxPages}
        </span>
        <button 
          onClick={() => setInvPage(p => p + 1)} 
          disabled={(safeInvPage + 1) * INV_PER_PAGE >= totalInvItems || isLoading} 
          className="h-8 px-6 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none"
        >
          Next
        </button>
      </div>
    </div>
  );
}