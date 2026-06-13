import { useState, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { Spinner, PageLoader } from './SharedUI';
import { escapeIlike, debounce } from './utils';
import { STORE_LOW_STOCK_THRESHOLD, WAREHOUSE_LOW_STOCK_THRESHOLD, INV_PER_PAGE, STALE_TIME_5MIN } from './constants';

export default function WorkerDashboardView() {
  const [inventorySearch, setInventorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc');
  const [invPage, setInvPage] = useState(0);
  const [lowStockModal, setLowStockModal] = useState({ isOpen: false, type: null });

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

  const { data: modalItems, isLoading: isModalLoading } = useQuery({
    queryKey: ['lowStockModal', lowStockModal.type],
    queryFn: async () => {
      if (!lowStockModal.type) return [];
      const threshold = lowStockModal.type === 'store' ? STORE_LOW_STOCK_THRESHOLD : WAREHOUSE_LOW_STOCK_THRESHOLD;
      const col = lowStockModal.type === 'store' ? 'stock_store' : 'stock_warehouse';
      const { data, error } = await supabase.from('inventory').select('*').eq('is_active', true).lt(col, threshold).order(col, { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: lowStockModal.isOpen && !!lowStockModal.type,
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
    <div className="flex flex-col h-full rounded-none p-3 md:p-6 animate-fade-in flex-1" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
      <h2 className="text-xl md:text-2xl font-light mb-3 md:mb-6 hidden md:block" style={{ color: 'var(--text-primary)' }}>Staff Dashboard</h2>
      
      <div className="grid grid-cols-2 gap-3 md:gap-4 mb-3 md:mb-6">
        <button onClick={() => setLowStockModal({ isOpen: true, type: 'store' })} className="p-3 md:p-5 border-l-4 rounded-none shadow-sm text-left transition-colors hover:bg-[var(--bg-hover)] cursor-pointer focus:outline-none flex flex-col justify-center" style={{ backgroundColor: 'var(--bg-quaternary)', border: '1px solid var(--border-medium)', borderLeftColor: storeAlerts > 0 ? 'var(--color-error)' : 'var(--color-accent)' }}>
          <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wider mb-1 md:mb-2" style={{ color: 'var(--text-secondary)' }}>Low Store Stock</p>
          <p className="text-xl md:text-3xl font-light" style={{ color: storeAlerts > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{storeAlerts} Items</p>
        </button>
        <button onClick={() => setLowStockModal({ isOpen: true, type: 'warehouse' })} className="p-3 md:p-5 border-l-4 rounded-none shadow-sm text-left transition-colors hover:bg-[var(--bg-hover)] cursor-pointer focus:outline-none flex flex-col justify-center" style={{ backgroundColor: 'var(--bg-quaternary)', border: '1px solid var(--border-medium)', borderLeftColor: whseAlerts > 0 ? 'var(--color-error)' : 'var(--color-accent)' }}>
          <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wider mb-1 md:mb-2" style={{ color: 'var(--text-secondary)' }}>Low Whse Stock</p>
          <p className="text-xl md:text-3xl font-light" style={{ color: whseAlerts > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{whseAlerts} Items</p>
        </button>
      </div>

      <div className="flex flex-row gap-2 md:gap-4 mb-3 md:mb-4">
        <input 
          type="text" 
          placeholder="Search Barcode or Name..." 
          value={inventorySearch}
          onChange={(e) => {
            setInventorySearch(e.target.value);
            debouncedSetSearch(e.target.value);
          }}
          className="flex-1 min-w-0 px-3 md:px-4 py-1.5 md:py-2 border rounded-none text-xs md:text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
        />
        <select 
          value={sortOption}
          onChange={(e) => { setSortOption(e.target.value); setInvPage(0); }}
          className="w-[135px] md:w-auto md:min-w-[200px] flex-shrink-0 px-2 md:px-4 py-1.5 md:py-2 border rounded-none text-xs md:text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
        >
          <option value="barcode-asc">Barcode (Low to High)</option>
          <option value="name-asc">Item Name (A-Z)</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 md:min-h-[300px] rounded-none shadow-sm flex flex-col" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }}>
        
        <div className="w-full h-full">
          <table className="w-full text-center table-fixed text-[10px] md:text-sm border-collapse" style={{ color: 'var(--text-primary)' }}>
            <thead style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
              <tr className="text-xs font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-secondary)' }}>
                <th className="p-1.5 md:p-3 w-[15%] md:w-auto align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>BC</th>
                <th className="p-1.5 md:p-3 w-[40%] md:w-auto align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>Name</th>
                <th className="p-1.5 md:p-3 w-[15%] md:w-auto align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>MRP</th>
                <th className="p-1.5 md:p-3 w-[15%] md:w-auto align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>STR</th>
                <th className="p-1.5 md:p-3 w-[15%] md:w-auto align-middle">WHS</th>
              </tr>
            </thead>
            <tbody style={{ borderBottom: '1px solid var(--border-medium)' }}>
              {isLoading ? (
                 <tr><td colSpan="5" className="h-full text-center py-6 align-middle"><PageLoader text="Loading items..." /></td></tr>
              ) : paginatedInventory.length === 0 ? (
                <tr><td colSpan="5" className="h-full text-center py-6 text-sm font-semibold align-middle" style={{ color: 'var(--text-tertiary)' }}>No items found.</td></tr>
              ) : paginatedInventory.map(item => (
                <tr key={item.id} className="transition-colors hover:bg-[var(--bg-hover)] text-center" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td className="p-1.5 md:p-3 font-semibold tracking-wider font-mono truncate align-middle" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)' }}>{item.barcode}</td>
                  <td className="p-1.5 md:p-3 font-medium leading-tight break-words align-middle" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.name}</td>
                  <td className="p-1.5 md:p-3 align-middle" style={{ borderRight: '1px solid var(--border-light)' }}>₹{Number(item.price).toFixed(2)}</td>
                  <td className="p-1.5 md:p-3 font-bold align-middle" style={{ color: item.stock_store < STORE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.stock_store}</td>
                  <td className="p-1.5 md:p-3 font-bold align-middle" style={{ color: item.stock_warehouse < WAREHOUSE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-primary)' }}>{item.stock_warehouse}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-between items-center mt-3 md:mt-4 p-2 md:p-3 rounded-none shadow-sm flex-shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
        <button onClick={()=>setInvPage(p=>Math.max(0,p-1))} disabled={invPage===0 || isLoading} className="px-4 md:px-6 py-1.5 text-xs md:text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Previous</button>
        <span className="text-xs md:text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Page {safeInvPage + 1} of {maxPages}</span>
        <button onClick={()=>setInvPage(p=>p+1)} disabled={(safeInvPage+1)*INV_PER_PAGE>=totalInvItems || isLoading} className="px-4 md:px-6 py-1.5 text-xs md:text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Next</button>
      </div>

      {/* Low Stock Modal */}
      {lowStockModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[85%] max-w-[360px] flex flex-col shadow-2xl animate-scale-in max-h-[85vh]" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                {lowStockModal.type === 'store' ? 'Low Store Stock Items' : 'Low Warehouse Stock Items'}
              </span>
              <button type="button" onClick={() => setLowStockModal({ isOpen: false, type: null })} className="px-3 py-1.5 leading-none focus:outline-none text-lg">✕</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {isModalLoading ? (
                <div className="flex justify-center items-center py-10"><PageLoader text="Loading..." /></div>
              ) : modalItems?.length === 0 ? (
                <p className="text-center py-10 text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>All stock levels are good.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {modalItems?.map(item => (
                    <div key={item.id} className="p-3 border flex justify-between items-center shadow-sm" style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--bg-primary)' }}>
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                        <span className="font-mono text-[10px] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded-sm self-start" style={{ color: 'var(--color-accent)' }}>#{item.barcode}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Current Stock</span>
                        <span className="text-xl font-bold" style={{ color: 'var(--color-error)' }}>
                          {lowStockModal.type === 'store' ? item.stock_store : item.stock_warehouse}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}