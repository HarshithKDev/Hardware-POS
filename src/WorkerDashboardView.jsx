import { useState, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import { escapeIlike, debounce } from './utils';
import { STORE_LOW_STOCK_THRESHOLD, WAREHOUSE_LOW_STOCK_THRESHOLD, INV_PER_PAGE, STALE_TIME_5MIN } from './constants';

export default function WorkerDashboardView({ isBillable = true }) {
  const navigate = useNavigate();
  const [inventorySearch, setInventorySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [lowStockModal, setLowStockModal] = useState({ isOpen: false, type: null });

  // Debounced search
  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 300),
    []
  );

  const { data: lowStockCounts } = useQuery({
    queryKey: ['lowStockCounts'],
    queryFn: async () => {
      const { count: storeCount } = await supabase.from('product_master_public').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('stock_store', STORE_LOW_STOCK_THRESHOLD);
      const { count: whseCount } = await supabase.from('product_master_public').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('stock_warehouse', WAREHOUSE_LOW_STOCK_THRESHOLD);
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
      const { data, error } = await supabase.from('product_master_public').select('*').eq('is_active', true).lt(col, threshold).order(col, { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: lowStockModal.isOpen && !!lowStockModal.type,
    staleTime: STALE_TIME_5MIN,
  });

  // Fetch distinct categories from categories table and products
  const { data: categories = [] } = useQuery({
    queryKey: ['workerCategories'],
    queryFn: async () => {
      const catSet = new Set();
      try {
        const { data } = await supabase.from('categories').select('name').order('name', { ascending: true });
        if (data) {
          data.forEach(c => { if (c.name) catSet.add(c.name); });
        }
      } catch {}

      try {
        const { data } = await supabase.from('product_master_public').select('category').eq('is_active', true);
        if (data) {
          data.forEach(p => { if (p.category) catSet.add(p.category); });
        }
      } catch {}

      return Array.from(catSet).sort((a, b) => a.localeCompare(b));
    },
    staleTime: STALE_TIME_5MIN,
  });

  const { 
    data: inventoryData, 
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['workerInventory', debouncedSearch, selectedCategory],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * INV_PER_PAGE;
      let query = supabase.from('product_master_public').select('*', { count: 'exact' }).eq('is_active', true);
      
      // Sanitized search (fixes #1)
      if (debouncedSearch.trim() !== '') {
        const safe = escapeIlike(debouncedSearch.trim());
        query = query.or(`name.ilike.%${safe}%,barcode.ilike.%${safe}%`);
      }

      // Filter by category
      if (selectedCategory && selectedCategory !== 'ALL') {
        query = query.eq('category', selectedCategory);
      }
      
      query = query.order('barcode', { ascending: true });

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
    <div className="flex flex-col h-full p-4 animate-fade-in flex-1 m-0 rounded-none md:rounded-xl border-0 md:border border-transparent md:border-[var(--border-light)] shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
      <h2 className="text-xl md:text-2xl font-medium mb-4 hidden md:block" style={{ color: 'var(--text-primary)' }}>Staff Dashboard</h2>
      
      {/* Big Action Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mb-6">
        <button 
          onClick={() => navigate('/terminal/receive')}
          className="p-4 md:p-8 rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 active:scale-95 shadow-md"
          style={{ backgroundColor: '#3b82f6', color: 'white' }}
        >
          <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          <span className="font-bold text-sm md:text-base leading-tight">Receiving Stock<br/>From Wholesaler</span>
        </button>
        
        <button 
          onClick={() => navigate('/terminal/transfer')}
          className="p-4 md:p-8 rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 active:scale-95 shadow-md"
          style={{ backgroundColor: '#f59e0b', color: 'white' }}
        >
          <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
          <span className="font-bold text-sm md:text-base leading-tight">Sending Stock<br/>Warehouse to Shop</span>
        </button>

        {isBillable ? (
          <>
            <button 
              onClick={() => navigate('/terminal/checkout')}
              className="p-4 md:p-8 rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 active:scale-95 shadow-md"
              style={{ backgroundColor: '#10b981', color: 'white' }}
            >
              <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              <span className="font-bold text-sm md:text-base leading-tight">Checkout<br/>Customer</span>
            </button>
            <button 
              onClick={() => navigate('/terminal/returns')}
              className="p-4 md:p-8 rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 active:scale-95 shadow-md"
              style={{ backgroundColor: '#ef4444', color: 'white' }}
            >
              <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
              <span className="font-bold text-sm md:text-base leading-tight">Process<br/>Returns</span>
            </button>
            <button 
              onClick={() => navigate('/terminal/expenses')}
              className="p-4 md:p-8 rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 active:scale-95 shadow-md"
              style={{ backgroundColor: '#e11d48', color: 'white' }}
            >
              <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>
              <span className="font-bold text-sm md:text-base leading-tight">Expenses &<br/>Advances</span>
            </button>
          </>
        ) : (
          <>
            <button 
              onClick={() => navigate('/terminal/lookup')}
              className="p-4 md:p-8 rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 active:scale-95 shadow-md"
              style={{ backgroundColor: '#8b5cf6', color: 'white' }}
            >
              <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="font-bold text-sm md:text-base leading-tight">Item & Stock<br/>Lookup</span>
            </button>
            <button 
              onClick={() => navigate('/terminal/scanner')}
              className="p-4 md:p-8 rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 active:scale-95 shadow-md"
              style={{ backgroundColor: '#06b6d4', color: 'white' }}
            >
              <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm14 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              <span className="font-bold text-sm md:text-base leading-tight">Floor<br/>Scanner</span>
            </button>
          </>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-3 md:gap-4 mb-3 md:mb-6">
        <button onClick={() => setLowStockModal({ isOpen: true, type: 'store' })} className="p-4 md:p-6 rounded-lg border border-[var(--border-light)] text-left cursor-pointer flex flex-col justify-center relative overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-r-full" style={{ backgroundColor: storeAlerts > 0 ? 'var(--color-error)' : 'var(--color-accent)' }} />
          <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wider mb-1 md:mb-2 ml-3" style={{ color: 'var(--text-secondary)' }}>Low Store Stock</p>
          <p className="text-xl md:text-3xl font-semibold ml-3" style={{ color: storeAlerts > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{storeAlerts} Items</p>
        </button>
        <button onClick={() => setLowStockModal({ isOpen: true, type: 'warehouse' })} className="p-4 md:p-6 rounded-lg border border-[var(--border-light)] text-left cursor-pointer flex flex-col justify-center relative overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-r-full" style={{ backgroundColor: whseAlerts > 0 ? 'var(--color-error)' : 'var(--color-accent)' }} />
          <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wider mb-1 md:mb-2 ml-3" style={{ color: 'var(--text-secondary)' }}>Low Whse Stock</p>
          <p className="text-xl md:text-3xl font-semibold ml-3" style={{ color: whseAlerts > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{whseAlerts} Items</p>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:gap-4 mb-3 md:mb-4">
        <div className="w-full">
          <input 
            type="text" 
            placeholder="Search Barcode or Name..." 
            value={inventorySearch}
            onChange={(e) => {
              setInventorySearch(e.target.value);
              debouncedSetSearch(e.target.value);
            }}
            className="w-full h-10 px-2.5 sm:px-3 text-[11px] sm:text-xs md:text-sm border shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 rounded-lg leading-normal"
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-medium)', color: 'var(--text-primary)', colorScheme: 'dark' }}
          />
        </div>

        <div className="w-full">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full h-10 pl-2.5 sm:pl-3 pr-7 sm:pr-8 text-[11px] sm:text-xs md:text-sm border shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 rounded-lg cursor-pointer font-medium leading-normal truncate"
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-medium)', color: 'var(--text-primary)', colorScheme: 'dark' }}
          >
            <option value="ALL" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>All Categories</option>
            {categories.map((catName) => (
              <option key={catName} value={catName} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                {catName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 md:min-h-[300px] rounded-lg border border-[var(--border-light)] relative overscroll-contain" 
        style={{ backgroundColor: 'var(--bg-secondary)', overscrollBehavior: 'contain' }}
      >
        <table 
          className="w-full text-center table-fixed text-[10px] md:text-sm min-w-full" 
          style={{ 
            color: 'var(--text-primary)', 
            borderCollapse: 'separate', 
            borderSpacing: 0 
          }}
        >
          <thead 
            className="sticky top-0 z-20 shadow-sm" 
            style={{ 
              backgroundColor: 'var(--bg-tertiary)',
              transform: 'translate3d(0, 0, 0)',
              WebkitTransform: 'translate3d(0, 0, 0)'
            }}
          >
            <tr className="text-xs font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-2 md:p-3 w-[15%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-medium)' }}>BC</th>
              <th className="p-2 md:p-3 w-[40%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-medium)' }}>Name</th>
              <th className="p-2 md:p-3 w-[15%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-medium)' }}>MRP</th>
              <th className="p-2 md:p-3 w-[15%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-medium)' }}>WHS</th>
              <th className="p-2 md:p-3 w-[15%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>STR</th>
            </tr>
          </thead>
          <tbody style={{ borderBottom: '1px solid var(--border-medium)' }}>
            {isLoading ? (
               <tr><td colSpan="5" className="h-full text-center py-6 align-middle"><PageLoader text="Loading items..." /></td></tr>
            ) : paginatedInventory.length === 0 ? (
              <tr className="border-none"><td colSpan="5" className="h-full p-0 border-none"><EmptyState message="No items found." /></td></tr>
            ) : paginatedInventory.map(item => (
              <tr key={item.id} className="transition-colors hover:bg-[var(--bg-hover)] text-center" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="p-1.5 md:p-3 font-semibold tracking-wider truncate align-middle" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>{item.barcode}</td>
                <td className="p-1.5 md:p-3 font-medium leading-tight break-words align-middle" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>{item.name}</td>
                <td className="p-1.5 md:p-3 align-middle" style={{ borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>₹{Number(item.price).toFixed(2)}</td>
                <td className="p-1.5 md:p-3 font-bold align-middle" style={{ color: item.stock_warehouse < WAREHOUSE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-primary)', borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>{item.stock_warehouse}</td>
                <td className="p-1.5 md:p-3 font-bold align-middle" style={{ color: item.stock_store < STORE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-primary)', borderBottom: '1px solid var(--border-light)' }}>{item.stock_store}</td>
              </tr>
            ))}
            {isFetchingNextPage && (
              <tr>
                <td colSpan="5" className="py-3 text-center text-xs font-semibold align-middle" style={{ color: 'var(--text-tertiary)' }}>
                  Loading more...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {lowStockModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[90%] max-w-[360px] md:max-w-3xl flex flex-col rounded-xl overflow-hidden animate-scale-in h-[400px] md:h-[600px] max-h-[85vh] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
            <div className="flex justify-between items-center pr-4 pl-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
                {lowStockModal.type === 'store' ? 'Low Store Stock Items' : 'Low Warehouse Stock Items'}
              </span>
              <button onClick={() => setLowStockModal({ isOpen: false, type: null })} className="px-3 py-1.5 rounded-lg border border-[var(--color-error)] text-[var(--color-error)] text-xs font-bold uppercase tracking-wider transition-colors hover:bg-[var(--color-error)] hover:text-white flex items-center justify-center gap-1.5 shadow-sm">
                <span>Close</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
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
                        <span className=" text-[10px] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded-sm self-start" style={{ color: 'var(--color-accent)' }}>#{item.barcode}</span>
                      </div>
                      <div className="flex items-center gap-4 md:gap-6">
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Store</span>
                          <span className={`text-lg font-bold ${lowStockModal.type === 'store' ? 'text-[var(--color-error)]' : 'text-[var(--text-primary)]'}`}>
                            {item.stock_store}
                          </span>
                        </div>
                        <div className="w-[1px] h-8 bg-[var(--border-light)]"></div>
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Warehouse</span>
                          <span className={`text-lg font-bold ${lowStockModal.type === 'warehouse' ? 'text-[var(--color-error)]' : 'text-[var(--text-primary)]'}`}>
                            {item.stock_warehouse}
                          </span>
                        </div>
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