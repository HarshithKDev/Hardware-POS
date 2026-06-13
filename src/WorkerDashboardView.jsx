import { useState, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Spinner, PageLoader } from './SharedUI';
import { escapeIlike, debounce } from './utils';
import { STORE_LOW_STOCK_THRESHOLD, WAREHOUSE_LOW_STOCK_THRESHOLD, INV_PER_PAGE, STALE_TIME_5MIN } from './constants';

export default function WorkerDashboardView() {
  const [inventorySearch, setInventorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [lowStockModal, setLowStockModal] = useState({ isOpen: false, type: null });

  // Debounced search
  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 300),
    []
  );

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

  const { 
    data: inventoryData, 
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['workerInventory', debouncedSearch, sortOption],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * INV_PER_PAGE;
      let query = supabase.from('inventory').select('*', { count: 'exact' }).eq('is_active', true);
      
      // Sanitized search (fixes #1)
      if (debouncedSearch.trim() !== '') {
        const safe = escapeIlike(debouncedSearch.trim());
        query = query.or(`name.ilike.%${safe}%,barcode.ilike.%${safe}%`);
      }
      
      if (sortOption === 'name-asc') query = query.order('name', { ascending: true });
      else if (sortOption === 'barcode-asc') query = query.order('barcode', { ascending: true });

      const { data, count, error } = await query.range(from, from + INV_PER_PAGE - 1);
      if (error) throw error;
      const hasMore = from + INV_PER_PAGE < (count || 0);
      return { items: data || [], nextPage: hasMore ? pageParam + 1 : undefined };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: STALE_TIME_5MIN,
  });

  const paginatedInventory = inventoryData?.pages.flatMap(page => page.items) || [];
  const storeAlerts = lowStockCounts?.store || 0;
  const whseAlerts = lowStockCounts?.warehouse || 0;

  const handleScroll = useCallback((e) => {
    const bottom = e.target.scrollHeight - e.target.scrollTop - e.target.clientHeight < 100;
    if (bottom && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

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
        <div className="relative w-[150px] md:w-auto md:min-w-[200px] flex-shrink-0">
          <button 
            type="button"
            onClick={() => setIsSortOpen(!isSortOpen)}
            className="w-full flex justify-between items-center px-2 md:px-4 py-1.5 md:py-2 border rounded-none text-xs md:text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
          >
            <span className="truncate">{sortOption === 'barcode-asc' ? 'Barcode (Low to High)' : 'Item Name (A-Z)'}</span>
            <svg className="w-3 h-3 md:w-4 md:h-4 ml-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {isSortOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsSortOpen(false)}></div>
              <div className="absolute top-full right-0 w-full mt-1 border rounded-none shadow-xl z-50 animate-fade-in flex flex-col" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-medium)' }}>
                <button 
                  className="w-full text-left px-3 md:px-4 py-2.5 md:py-2 text-xs md:text-sm transition-colors hover:bg-[var(--bg-hover)] focus:outline-none"
                  style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border-light)' }}
                  onClick={() => { setSortOption('barcode-asc'); setIsSortOpen(false); }}
                >
                  Barcode (Low to High)
                </button>
                <button 
                  className="w-full text-left px-3 md:px-4 py-2.5 md:py-2 text-xs md:text-sm transition-colors hover:bg-[var(--bg-hover)] focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => { setSortOption('name-asc'); setIsSortOpen(false); }}
                >
                  Item Name (A-Z)
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 md:min-h-[300px] rounded-none shadow-sm flex flex-col" 
        style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }}
      >
        
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
              {isFetchingNextPage && (
                <tr>
                  <td colSpan="5" className="py-4 text-center text-sm font-semibold align-middle" style={{ color: 'var(--text-tertiary)' }}>
                    Loading more...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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