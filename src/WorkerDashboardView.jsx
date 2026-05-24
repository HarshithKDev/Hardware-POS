import { useState, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from './SharedUI';
import { escapeIlike, debounce } from './utils';
import { STORE_LOW_STOCK_THRESHOLD, WAREHOUSE_LOW_STOCK_THRESHOLD, INV_PER_PAGE, STALE_TIME_5MIN } from './constants';

export default function WorkerDashboardView() {
  const [inventorySearch, setInventorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc');
  const [invPage, setInvPage] = useState(0);

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

  const { data: lowStockCounts } = useQuery({
    queryKey: ['lowStockCounts'],
    queryFn: async () => {
      const { count: storeCount } = await supabase.from('inventory').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('stock_store', STORE_LOW_STOCK_THRESHOLD);
      const { count: whseCount } = await supabase.from('inventory').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('stock_warehouse', WAREHOUSE_LOW_STOCK_THRESHOLD);
      return { store: storeCount || 0, warehouse: whseCount || 0 };
    },
    staleTime: STALE_TIME_5MIN,
  });

  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['workerInventory', invPage, debouncedSearch, sortOption],
    queryFn: async () => {
      const from = invPage * INV_PER_PAGE;
      let query = supabase.from('inventory').select('*', { count: 'exact' }).eq('is_active', true);
      
      // Sanitized search (fixes #1)
      if (debouncedSearch.trim() !== '') {
        const safe = escapeIlike(debouncedSearch.trim());
        query = query.or(`name.ilike.%${safe}%,barcode.ilike.%${safe}%`);
      }
      
      if (sortOption === 'low-store') query = query.lt('stock_store', STORE_LOW_STOCK_THRESHOLD).order('stock_store', { ascending: true });
      else if (sortOption === 'low-warehouse') query = query.lt('stock_warehouse', WAREHOUSE_LOW_STOCK_THRESHOLD).order('stock_warehouse', { ascending: true });
      else if (sortOption === 'name-asc') query = query.order('name', { ascending: true });
      else if (sortOption === 'barcode-asc') query = query.order('barcode', { ascending: true });

      const { data, count, error } = await query.range(from, from + INV_PER_PAGE - 1);
      if (error) throw error;
      return { items: data || [], total: count || 0 };
    },
    staleTime: STALE_TIME_5MIN,
  });

  const paginatedInventory = inventoryData?.items || [];
  const totalInvItems = inventoryData?.total || 0;
  const storeAlerts = lowStockCounts?.store || 0;
  const whseAlerts = lowStockCounts?.warehouse || 0;

  const maxPages = Math.max(1, Math.ceil(totalInvItems / INV_PER_PAGE));
  const safeInvPage = Math.min(invPage, maxPages - 1);

  return (
    <div className="flex flex-col h-full rounded-none p-4 md:p-6 animate-fade-in flex-1" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
      <h2 className="text-2xl font-light mb-6" style={{ color: 'var(--text-primary)' }}>Staff Dashboard</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-5 border-l-4 rounded-none shadow-sm" style={{ backgroundColor: 'var(--bg-quaternary)', border: '1px solid var(--border-medium)', borderLeftColor: storeAlerts > 0 ? 'var(--color-error)' : 'var(--color-accent)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Low Store Stock Alerts</p>
          <p className="text-3xl font-light" style={{ color: storeAlerts > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{storeAlerts} Items</p>
        </div>
        <div className="p-5 border-l-4 rounded-none shadow-sm" style={{ backgroundColor: 'var(--bg-quaternary)', border: '1px solid var(--border-medium)', borderLeftColor: whseAlerts > 0 ? 'var(--color-error)' : 'var(--color-accent)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Low Warehouse Stock Alerts</p>
          <p className="text-3xl font-light" style={{ color: whseAlerts > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{whseAlerts} Items</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <input 
          type="text" 
          placeholder="Search Barcode or Name..." 
          value={inventorySearch} 
          onChange={handleSearchChange} 
          className="px-3 py-1.5 text-sm w-full md:w-[400px] rounded-none focus:outline-none" 
          style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
          aria-label="Search inventory"
        />
        <div className="relative w-full md:w-auto">
          <select 
            value={sortOption} 
            onChange={(e) => {setSortOption(e.target.value); setInvPage(0);}} 
            className="w-full h-full pl-3 pr-8 py-1.5 text-sm rounded-none focus:outline-none cursor-pointer appearance-none" 
            style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
            aria-label="Sort inventory"
          >
              <option value="barcode-asc">Barcode (Low to High)</option>
              <option value="name-asc">Item Name (A-Z)</option>
              <option value="low-store">Low Store Stock (&lt; {STORE_LOW_STOCK_THRESHOLD})</option>
              <option value="low-warehouse">Low Whse Stock (&lt; {WAREHOUSE_LOW_STOCK_THRESHOLD})</option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}>
            <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto flex-1 min-h-[300px] rounded-none shadow-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }}>
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-3 w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
              <th className="p-3" style={{ borderRight: '1px solid var(--border-light)' }}>Product Name</th>
              <th className="p-3 text-center w-32" style={{ borderRight: '1px solid var(--border-light)' }}>MRP</th>
              <th className="p-3 text-center w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Store Qty</th>
              <th className="p-3 text-center w-32">Whse Qty</th>
            </tr>
          </thead>
          <tbody style={{ borderBottom: '1px solid var(--border-medium)' }}>
            {isLoading ? (
               <tr><td colSpan="5" className="p-8 text-center"><Spinner className="w-6 h-6 mx-auto" style={{ color: 'var(--color-accent)' }} /></td></tr>
            ) : paginatedInventory.length === 0 ? (
              <tr><td colSpan="5" className="p-8 text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No items found.</td></tr>
            ) : paginatedInventory.map(item => (
              <tr key={item.id} className="transition-colors hover:bg-[var(--bg-hover)]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="p-3 text-sm font-semibold tracking-wider font-mono" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)' }}>{item.barcode}</td>
                <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.name}</td>
                <td className="p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)' }}>₹{Number(item.price).toFixed(2)}</td>
                <td className="p-3 text-sm text-center font-bold" style={{ color: item.stock_store < STORE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.stock_store}</td>
                <td className="p-3 text-sm text-center font-bold" style={{ color: item.stock_warehouse < WAREHOUSE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-primary)' }}>{item.stock_warehouse}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4 p-3 rounded-none shadow-sm" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
        <button onClick={()=>setInvPage(p=>Math.max(0,p-1))} disabled={invPage===0 || isLoading} className="px-6 py-1.5 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Previous</button>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Page {safeInvPage + 1} of {maxPages}</span>
        <button onClick={()=>setInvPage(p=>p+1)} disabled={(safeInvPage+1)*INV_PER_PAGE>=totalInvItems || isLoading} className="px-6 py-1.5 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Next</button>
      </div>
    </div>
  );
}