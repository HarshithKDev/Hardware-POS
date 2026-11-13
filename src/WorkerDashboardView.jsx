import { useState, useMemo, useCallback, useEffect, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabaseClient';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useApp } from './AppContext';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import { TableVirtuoso, Virtuoso } from 'react-virtuoso';
import { usePhoneLayout } from './hooks/useMediaQuery';
import { escapeIlike, debounce, useSessionState, formatINR } from './utils';
import { STORE_LOW_STOCK_THRESHOLD, WAREHOUSE_LOW_STOCK_THRESHOLD, INV_PER_PAGE, STALE_TIME_5MIN } from './constants';
import { 
  getInventoryByQuery, 
  getLocalCategories, 
  setLocalCategories,
  getLocalSubcategories,
  setLocalSubcategories 
} from './services/db';
import PageTitleReset from './components/PageTitleReset';
import { buttonClass } from './components/ui';

export default function WorkerDashboardView({ isBillable = true }) {
  const { isWarehouseDisabled } = useApp();
  const navigate = useNavigate();
  const shopId = localStorage.getItem('shop_id');
  const [inventorySearch, setInventorySearch] = useSessionState(`pos_worker_dash_search_${shopId}`, '');
  const [debouncedSearch, setDebouncedSearch] = useSessionState(`pos_worker_dash_debounced_${shopId}`, () => inventorySearch || '');
  const [selectedCategory, setSelectedCategory] = useSessionState(`pos_worker_dash_cat_${shopId}`, 'ALL');
  const [selectedSubcategory, setSelectedSubcategory] = useSessionState(`pos_worker_dash_subcat_${shopId}`, 'ALL');
  const [lowStockModal, setLowStockModal] = useState({ isOpen: false, type: null });

  const handleResetWorkerDashboard = () => {
    setInventorySearch('');
    setDebouncedSearch('');
    setSelectedCategory('ALL');
    setSelectedSubcategory('ALL');
    try {
      window.sessionStorage.removeItem(`pos_worker_dash_search_${shopId}`);
      window.sessionStorage.removeItem(`pos_worker_dash_debounced_${shopId}`);
      window.sessionStorage.removeItem(`pos_worker_dash_cat_${shopId}`);
      window.sessionStorage.removeItem(`pos_worker_dash_subcat_${shopId}`);
    } catch (e) {}
  };

  const handleCategoryChange = (cat) => {
    setSelectedCategory(cat);
    setSelectedSubcategory('ALL');
  };

  const actionCards = useMemo(() => {
    const list = [
      {
        key: 'receive',
        path: '/terminal/receive',
        title: `Receiving Stock\n${isWarehouseDisabled ? 'Into Store' : 'From Wholesaler'}`,
        bg: '#2563EB',
        icon: (
          <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
        )
      }
    ];

    if (!isWarehouseDisabled) {
      list.push({
        key: 'transfer',
        path: '/terminal/transfer',
        title: 'Sending Stock\nWarehouse to Store',
        bg: '#B45309',
        icon: (
          <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
        )
      });
    }

    if (isBillable) {
      list.push(
        {
          key: 'checkout',
          path: '/terminal/checkout',
          title: 'Checkout\nCustomer',
          bg: '#047857',
          icon: (
            <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
          )
        },
        {
          key: 'sales',
          path: '/terminal/sales',
          title: 'Sales &\nReturns',
          bg: '#DC2626',
          icon: (
            <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
          )
        },
        {
          key: 'print-barcode',
          path: '/terminal/print-barcode',
          title: 'Print\nBarcodes',
          bg: '#0E7490',
          icon: (
            <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
          )
        },
        {
          key: 'expenses',
          path: '/terminal/expenses',
          title: 'Expenses &\nAdvances',
          bg: '#BE123C',
          icon: (
            <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>
          )
        },
        {
          key: 'screw-boxes',
          path: '/terminal/screw-boxes',
          title: 'Screw\nBoxes',
          bg: '#4338CA',
          icon: (
            <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
          )
        }
      );
    } else {
      list.push(
        {
          key: 'lookup',
          path: '/terminal/lookup',
          title: 'Item & Stock\nLookup',
          bg: '#6D28D9',
          icon: (
            <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )
        },
        {
          key: 'scanner',
          path: '/terminal/scanner',
          title: 'Floor\nScanner',
          bg: '#0E7490',
          icon: (
            <svg className="w-7 h-7 md:w-8 md:h-8 mb-1.5 md:mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm14 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          )
        }
      );
    }

    return list.map((card, idx) => ({ ...card, shortcut: String(idx + 1) }));
  }, [isWarehouseDisabled, isBillable]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (lowStockModal.isOpen) {
        if (e.key === 'Escape') setLowStockModal({ isOpen: false, type: null });
        return;
      }

      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

      if (e.key === 'F2') {
        e.preventDefault();
        document.getElementById('dashboard-inventory-search')?.focus();
        return;
      }

      if (isInput) return;

      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('dashboard-inventory-search')?.focus();
        return;
      }

      // Check numbers 1-5 or Alt+1-5
      const numKey = e.key;
      const matched = actionCards.find(c => c.shortcut === numKey);
      if (matched) {
        e.preventDefault();
        navigate(matched.path);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lowStockModal.isOpen, actionCards, navigate]);

  // Debounced search
  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 300),
    [setDebouncedSearch]
  );

  useEffect(() => {
    if (inventorySearch && debouncedSearch !== inventorySearch) {
      setDebouncedSearch(inventorySearch);
    }
  }, [inventorySearch, debouncedSearch, setDebouncedSearch]);

  // Local-first low stock alerts calculation (0ms instant)
  const { data: lowStockCounts } = useQuery({
    queryKey: ['lowStockCounts', shopId, isWarehouseDisabled],
    queryFn: async () => {
      try {
        const { data: localItems } = await getInventoryByQuery({ limit: 1000000, status: 'active' });
        if (localItems && localItems.length > 0) {
          const storeCount = localItems.filter(i => Number(i.stock_store || 0) < STORE_LOW_STOCK_THRESHOLD).length;
          const whseCount = isWarehouseDisabled ? 0 : localItems.filter(i => Number(i.stock_warehouse || 0) < WAREHOUSE_LOW_STOCK_THRESHOLD).length;
          return { store: storeCount, warehouse: whseCount };
        }
      } catch (e) {}

      // Fallback if local DB not yet populated
      if (navigator.onLine) {
        let storeQuery = supabase.from('product_master_public').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('stock_store', STORE_LOW_STOCK_THRESHOLD);
        if (shopId) storeQuery = storeQuery.eq('shop_id', shopId);
        const { count: storeCount } = await storeQuery;
        
        let whseCount = 0;
        if (!isWarehouseDisabled) {
          let whseQuery = supabase.from('product_master_public').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('stock_warehouse', WAREHOUSE_LOW_STOCK_THRESHOLD);
          if (shopId) whseQuery = whseQuery.eq('shop_id', shopId);
          const { count } = await whseQuery;
          whseCount = count || 0;
        }
        return { store: storeCount || 0, warehouse: whseCount || 0 };
      }
      return { store: 0, warehouse: 0 };
    },
    staleTime: STALE_TIME_5MIN,
  });

  const { data: modalItems, isLoading: isModalLoading } = useQuery({
    queryKey: ['lowStockModal', shopId, lowStockModal.type],
    queryFn: async () => {
      if (!lowStockModal.type) return [];
      const threshold = lowStockModal.type === 'store' ? STORE_LOW_STOCK_THRESHOLD : WAREHOUSE_LOW_STOCK_THRESHOLD;
      const col = lowStockModal.type === 'store' ? 'stock_store' : 'stock_warehouse';

      // 1. Local-first: filter directly from IndexedDB
      try {
        const { data: localItems } = await getInventoryByQuery({ limit: 1000000, status: 'active' });
        if (localItems && localItems.length > 0) {
          return localItems
            .filter(i => Number(i[col] || 0) < threshold)
            .sort((a, b) => Number(a[col] || 0) - Number(b[col] || 0));
        }
      } catch (e) {}

      if (navigator.onLine) {
        let query = supabase.from('product_master_public').select('*').eq('is_active', true).lt(col, threshold).order(col, { ascending: true });
        if (shopId) query = query.eq('shop_id', shopId);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      }
      return [];
    },
    enabled: lowStockModal.isOpen && !!lowStockModal.type,
    staleTime: STALE_TIME_5MIN,
  });

  // Fetch distinct categories: Local-First from cached products, 0ms load
  const { data: rawCategories = [] } = useQuery({
    queryKey: ['workerCategories', shopId],
    queryFn: async () => {
      const catSet = new Set();
      try {
        const { data: localItems } = await getInventoryByQuery({ limit: 1000000, status: 'active' });
        if (localItems && localItems.length > 0) {
          localItems.forEach(p => { if (p.category) catSet.add(p.category); });
        }
      } catch {}

      if (catSet.size === 0 && navigator.onLine) {
        try {
          let catQuery = supabase.from('categories').select('name').order('name', { ascending: true });
          if (shopId) catQuery = catQuery.eq('shop_id', shopId);
          const { data } = await catQuery;
          if (data) data.forEach(c => { if (c.name) catSet.add(c.name); });
        } catch {}
      }

      const res = Array.from(catSet).sort((a, b) => a.localeCompare(b));
      if (res.length > 0) setLocalCategories(shopId, res.map(name => ({ name })));
      return res;
    },
    initialData: () => getLocalCategories(shopId),
    staleTime: STALE_TIME_5MIN,
  });

  const categories = useMemo(() => {
    return (rawCategories || []).map(c => typeof c === 'string' ? c : (c?.name || '')).filter(Boolean);
  }, [rawCategories]);

  // Fetch distinct subcategories: Local-First from cached products + Supabase
  const { data: subcategories = [] } = useQuery({
    queryKey: ['workerSubcategories', shopId],
    queryFn: async () => {
      const subcatMap = new Map();
      try {
        const { data: localItems } = await getInventoryByQuery({ limit: 1000000, status: 'active' });
        if (localItems && localItems.length > 0) {
          localItems.forEach(p => {
            if (p.sub_category && p.sub_category.trim()) {
              const name = p.sub_category.trim();
              const key = name.toLowerCase();
              if (!subcatMap.has(key)) {
                subcatMap.set(key, { name, category_name: p.category || '' });
              }
            }
          });
        }
      } catch {}

      if (navigator.onLine) {
        try {
          let query = supabase.from('subcategories').select('name, category_name').order('name', { ascending: true });
          if (shopId) query = query.eq('shop_id', shopId);
          const { data } = await query;
          if (data && data.length > 0) {
            data.forEach(s => {
              if (s.name && s.name.trim()) {
                const name = s.name.trim();
                const key = name.toLowerCase();
                if (!subcatMap.has(key)) {
                  subcatMap.set(key, { name, category_name: s.category_name || '' });
                } else if (!subcatMap.get(key).category_name && s.category_name) {
                  subcatMap.set(key, { name, category_name: s.category_name });
                }
              }
            });
          }
        } catch {}
      }

      const res = Array.from(subcatMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      if (res.length > 0) setLocalSubcategories(shopId, res);
      return res;
    },
    initialData: () => getLocalSubcategories(shopId),
    staleTime: STALE_TIME_5MIN,
  });

  const availableSubcategories = useMemo(() => {
    if (!subcategories || !Array.isArray(subcategories)) return [];
    const normalized = subcategories.map(s => typeof s === 'string' ? { name: s, category_name: '' } : s).filter(s => s && s.name);
    if (selectedCategory && selectedCategory !== 'ALL') {
      const catLower = selectedCategory.trim().toLowerCase();
      return normalized.filter(s => (s.category_name || '').trim().toLowerCase() === catLower);
    }
    const seen = new Set();
    return normalized.filter(s => {
      const key = (s.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [subcategories, selectedCategory]);

  // PURE LOCAL-FIRST INFINITE QUERY: Instant 0ms results as worker types or navigates
  const { 
    data: inventoryData, 
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['workerInventory', shopId, debouncedSearch, selectedCategory, selectedSubcategory],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * INV_PER_PAGE;

      // 1. FAST LOCAL-FIRST: Always query local IndexedDB (0ms)
      try {
        const localRes = await getInventoryByQuery({
          limit: INV_PER_PAGE,
          offset: from,
          search: debouncedSearch.trim(),
          category: selectedCategory !== 'ALL' ? selectedCategory : undefined,
          subcategory: selectedSubcategory !== 'ALL' ? selectedSubcategory : undefined,
          sortOption: 'barcode-asc',
          status: 'active'
        });
        if (localRes && (localRes.data?.length > 0 || from > 0 || (localRes.totalCount === 0 && (debouncedSearch.trim() || selectedCategory !== 'ALL' || selectedSubcategory !== 'ALL')))) {
          const hasMore = from + INV_PER_PAGE < (localRes.totalCount || 0);
          return { items: localRes.data || [], nextPage: hasMore ? pageParam + 1 : undefined };
        }
      } catch (e) {
        console.warn("Local IDB query error:", e);
      }

      // 2. Fallback to Supabase if local DB was completely empty (e.g. cold start)
      if (navigator.onLine) {
        let query = supabase.from('product_master_public').select('*', { count: 'exact' }).eq('is_active', true);
        if (shopId) query = query.eq('shop_id', shopId);

        if (debouncedSearch.trim() !== '') {
          const safe = escapeIlike(debouncedSearch.trim());
          query = query.or(`name.ilike.%${safe}%,barcode.ilike.%${safe}%`);
        }
        if (selectedCategory && selectedCategory !== 'ALL') {
          query = query.eq('category', selectedCategory);
        }
        if (selectedSubcategory && selectedSubcategory !== 'ALL') {
          query = query.eq('sub_category', selectedSubcategory);
        }
        query = query.order('barcode', { ascending: true });

        const { data, count, error } = await query.range(from, from + INV_PER_PAGE - 1);
        if (error) throw error;
        const hasMore = from + INV_PER_PAGE < (count || 0);
        return { items: data || [], nextPage: hasMore ? pageParam + 1 : undefined };
      }

      return { items: [], nextPage: undefined };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: STALE_TIME_5MIN,
  });

  const paginatedInventory = inventoryData?.pages.flatMap(page => page.items) || [];

  const expandedRows = useMemo(() => {
    return paginatedInventory.flatMap(item => {
      const activeBatches = (item.batches || []).filter(b => b.is_active !== false);
      if (activeBatches.length === 0) {
        return [{ item, batch: null, batchIndex: 0, totalBatches: 1 }];
      }
      const sorted = [...activeBatches].sort((a, b) => {
        const an = Number(a.batch_number ?? 0);
        const bn = Number(b.batch_number ?? 0);
        return an - bn;
      });
      return sorted.map((batch, idx) => ({
        item,
        batch,
        batchIndex: idx,
        totalBatches: sorted.length,
      }));
    });
  }, [paginatedInventory]);

  // The product list is read from this device's local copy. When the background download
  // finishes (first login on a device, or new/changed items), show the fresh, complete list.
  const queryClient = useQueryClient();
  useEffect(() => {
    const onSyncComplete = () => {
      queryClient.invalidateQueries({ queryKey: ['workerInventory'] });
      queryClient.invalidateQueries({ queryKey: ['lowStockCounts'] });
      queryClient.invalidateQueries({ queryKey: ['lowStockModal'] });
    };
    window.addEventListener('inventory_sync_complete', onSyncComplete);
    return () => window.removeEventListener('inventory_sync_complete', onSyncComplete);
  }, [queryClient]);

  const isPhone = usePhoneLayout();
  const storeAlerts = lowStockCounts?.store || 0;
  const whseAlerts = lowStockCounts?.warehouse || 0;

  const tableComponents = useMemo(() => ({
    Table: (props) => (
      <table
        {...props}
        className={`w-full text-center table-fixed text-xs sm:text-xs md:text-sm min-w-full ${props.className || ''}`}
        style={{
          ...props.style,
          color: 'var(--text-primary)',
          borderCollapse: 'separate',
          borderSpacing: 0,
        }}
      />
    ),
    TableHead: forwardRef((props, ref) => (
      <thead
        ref={ref}
        {...props}
        className="sticky top-0 z-20 shadow-sm"
        style={{
          ...props.style,
          backgroundColor: 'var(--bg-tertiary)',
          transform: 'translate3d(0, 0, 0)',
          WebkitTransform: 'translate3d(0, 0, 0)',
        }}
      />
    )),
    TableRow: (props) => (
      <tr
        {...props}
        className={`transition-colors hover:bg-[var(--bg-hover)] text-center ${props.className || ''}`}
        style={{
          ...props.style,
          borderBottom: '1px solid var(--border-medium)',
        }}
      />
    ),
    TableBody: forwardRef((props, ref) => (
      <tbody
        ref={ref}
        {...props}
        style={{
          ...props.style,
          borderBottom: '1px solid var(--border-medium)',
        }}
      />
    )),
    TableFoot: () => isFetchingNextPage ? (
      <tfoot>
        <tr>
          <td colSpan={isWarehouseDisabled ? 5 : 6} className="py-3 text-center text-xs font-semibold align-middle" style={{ color: 'var(--text-tertiary)' }}>
            Loading more...
          </td>
        </tr>
      </tfoot>
    ) : null,
  }), [isFetchingNextPage, isWarehouseDisabled]);

  // Spread the dashboard boxes over one row (up to 5) or two even rows, on a 60-column grid
  const boxCount = actionCards.length + (isWarehouseDisabled ? 1 : 2);
  const firstRowCount = boxCount <= 5 ? boxCount : Math.ceil(boxCount / 2);
  const secondRowCount = boxCount - firstRowCount;
  const boxSpan = (index) => (index < firstRowCount ? 60 / firstRowCount : 60 / secondRowCount);
  // Low-stock boxes: full width below the tiles on phones/tablets, part of the rows on laptops
  const alertSpanClass = isWarehouseDisabled ? 'col-span-full lg:col-span-(--span)' : 'col-span-1 sm:col-span-full lg:col-span-(--span)';

  const fixedHeaderContent = useCallback(() => (
    <tr className="h-10 text-[11px] font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-secondary)' }}>
      <th className="p-2 md:p-3 w-[15%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>Barcode</th>
      <th className="p-2 md:p-3 w-[12%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>Batch</th>
      <th className={`p-2 md:p-3 ${isWarehouseDisabled ? 'w-[45%]' : 'w-[35%]'} md:w-auto align-middle`} style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>Name</th>
      <th className="p-2 md:p-3 w-[15%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>MRP</th>
      {!isWarehouseDisabled && (
        <th className="p-2 md:p-3 w-[15%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>Warehouse</th>
      )}
      <th className="p-2 md:p-3 w-[15%] md:w-auto align-middle" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>{isWarehouseDisabled ? 'Stock' : 'Store'}</th>
    </tr>
  ), [isWarehouseDisabled]);

  return (
    <div className="flex flex-col h-full p-3 md:p-4 animate-fade-in flex-1 m-0 rounded-none md:rounded-xl border-0 md:border border-transparent md:border-[var(--border-light)] shadow-sm min-h-0 overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
      <PageTitleReset
        title="Staff Dashboard"
        tag="h2"
        onReset={handleResetWorkerDashboard}
        className="mb-3 md:mb-4 hidden md:flex"
        tooltip="Click title to reset inventory search, category, and sub-category filters to default"
      />
      
      {/* Action tiles + low-stock box(es). Laptop/desktop: one or two rows that each fill the
          full width (e.g. 7 boxes = 4 on top, 3 below). Phones/tablets keep the simple grid. */}
      <div className={`grid gap-2.5 md:gap-4 mb-3 md:mb-4 lg:grid-cols-[repeat(60,minmax(0,1fr))] ${
        isBillable 
          ? 'grid-cols-2 sm:grid-cols-3'
          : (isWarehouseDisabled ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4')
      }`}>
        {actionCards.map((card, idx) => (
          <button 
            key={card.key}
            onClick={() => navigate(card.path)}
            className="lg:col-span-(--span) p-3 md:p-4 lg:p-5 rounded-xl flex flex-col items-center justify-center text-center transition-transform hover:scale-105 active:scale-95 shadow-md relative group cursor-pointer"
            style={{ backgroundColor: card.bg, color: 'white', '--span': boxSpan(idx) }}
          >
            {card.icon}
            <span className="font-bold text-xs md:text-sm lg:text-base leading-tight whitespace-pre-line">
              {card.title}
            </span>
          </button>
        ))}
        <button onClick={() => setLowStockModal({ isOpen: true, type: 'store' })}
          className={`${alertSpanClass} p-3 md:p-4 rounded-lg border border-[var(--border-light)] text-left cursor-pointer flex flex-col justify-center relative overflow-hidden h-full`} style={{ backgroundColor: 'var(--bg-secondary)', '--span': boxSpan(actionCards.length) }}>
          <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-r-full" style={{ backgroundColor: storeAlerts > 0 ? 'var(--color-error)' : 'var(--color-accent)' }} />
          <p className="text-[11px] md:text-xs font-semibold uppercase tracking-wider mb-1 ml-3" style={{ color: 'var(--text-secondary)' }}>{isWarehouseDisabled ? 'Low Stock Alerts' : 'Store Low Stock'}</p>
          <p className="text-xl md:text-2xl font-semibold ml-3" style={{ color: storeAlerts > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{storeAlerts} {storeAlerts === 1 ? 'Item' : 'Items'}</p>
        </button>
        {!isWarehouseDisabled && (
          <button onClick={() => setLowStockModal({ isOpen: true, type: 'warehouse' })}
            className={`${alertSpanClass} p-3 md:p-4 rounded-lg border border-[var(--border-light)] text-left cursor-pointer flex flex-col justify-center relative overflow-hidden h-full`} style={{ backgroundColor: 'var(--bg-secondary)', '--span': boxSpan(actionCards.length + 1) }}>
            <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-r-full" style={{ backgroundColor: whseAlerts > 0 ? 'var(--color-error)' : 'var(--color-accent)' }} />
            <p className="text-[11px] md:text-xs font-semibold uppercase tracking-wider mb-1 ml-3" style={{ color: 'var(--text-secondary)' }}>Low Warehouse Stock</p>
            <p className="text-xl md:text-2xl font-semibold ml-3" style={{ color: whseAlerts > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>{whseAlerts} {whseAlerts === 1 ? 'Item' : 'Items'}</p>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3 mb-2.5 md:mb-3">
        <div className="w-full relative flex items-center">
          <input 
            id="dashboard-inventory-search"
            type="text" 
            placeholder="Search Barcode or Name..." 
            value={inventorySearch}
            onChange={(e) => {
              setInventorySearch(e.target.value);
              debouncedSetSearch(e.target.value);
            }}
            className="w-full h-10 px-2.5 sm:px-3 text-xs sm:text-xs md:text-sm border shadow-sm focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30 rounded-lg leading-normal"
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-medium)', color: 'var(--text-primary)', colorScheme: 'dark' }}
          />
        </div>

        <div className="w-full">
          <select
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="w-full h-10 pl-2.5 sm:pl-3 pr-7 sm:pr-8 text-xs sm:text-xs md:text-sm border shadow-sm focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30 rounded-lg cursor-pointer font-medium leading-normal truncate"
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

        <div className="w-full">
          <select
            value={selectedSubcategory}
            onChange={(e) => setSelectedSubcategory(e.target.value)}
            disabled={availableSubcategories.length === 0}
            className="w-full h-10 pl-2.5 sm:pl-3 pr-7 sm:pr-8 text-xs sm:text-xs md:text-sm border shadow-sm focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30 rounded-lg cursor-pointer font-medium leading-normal truncate disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-medium)', color: 'var(--text-primary)', colorScheme: 'dark' }}
          >
            <option value="ALL" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              {availableSubcategories.length === 0 && selectedCategory !== 'ALL' ? 'No Sub-Categories' : 'All Sub-Categories'}
            </option>
            {availableSubcategories.map((sub) => (
              <option key={sub.name} value={sub.name} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                {sub.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div 
        className="flex-1 overflow-hidden min-h-0 rounded-lg border border-[var(--border-light)] relative" 
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        {isLoading ? (
          <div className="h-full flex items-center justify-center p-8">
            <PageLoader text="Loading items..." />
          </div>
        ) : paginatedInventory.length === 0 ? (
          <EmptyState message="No items found." />
        ) : isPhone ? (
          // Phones: one card per item/batch instead of a squeezed 5-column table
          <Virtuoso
            data={expandedRows}
            computeItemKey={(index, row) => `${row.item.id}-${row.batch?.batch_number ?? row.batchIndex ?? 'single'}`}
            style={{ height: '100%', width: '100%' }}
            defaultItemHeight={76}
            increaseViewportBy={{ top: 300, bottom: 300 }}
            endReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
            components={{ Footer: () => (isFetchingNextPage ? <div className="py-3 text-center text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>Loading more...</div> : null) }}
            itemContent={(index, { item, batch, batchIndex }) => {
              const batchNum = batch ? String(batch.batch_number || batchIndex + 1).padStart(2, '0') : null;
              const mrp = batch ? Number(batch.selling_price ?? item.price ?? 0) : Number(item.price ?? 0);
              const stockStore = batch ? Number(batch.stock_store ?? 0) : Number(item.stock_store ?? 0);
              const stockWarehouse = batch ? Number(batch.stock_warehouse ?? 0) : Number(item.stock_warehouse ?? 0);
              const lowStore = stockStore < STORE_LOW_STOCK_THRESHOLD;
              return (
                <div className="flex items-start justify-between gap-3 px-3.5 py-3" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug break-words" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                    <p className="mt-1 text-xs font-semibold tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--color-accent)' }}>{item.barcode}</span>
                      {batchNum && <span> · Batch #{batchNum}</span>}
                      <span> · MRP ₹{formatINR(mrp, 2)}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold leading-none tabular-nums" style={{ color: lowStore ? 'var(--color-error)' : 'var(--text-primary)' }}>{stockStore}</p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>{isWarehouseDisabled ? 'in stock' : 'store'}</p>
                    {!isWarehouseDisabled && (
                      <p className="mt-0.5 text-xs font-semibold tabular-nums" style={{ color: stockWarehouse < WAREHOUSE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-secondary)' }}>{stockWarehouse} whse</p>
                    )}
                  </div>
                </div>
              );
            }}
          />
        ) : (
          <TableVirtuoso
            data={expandedRows}
            computeItemKey={(index, row) => `${row.item.id}-${row.batch?.batch_number ?? row.batchIndex ?? 'single'}`}
            useWindowScroll={false}
            style={{ height: '100%', width: '100%' }}
            className="overflow-x-hidden"
            defaultItemHeight={44}
            // Render a first screenful straight away (also lets tests without a real screen see rows).
            // Must stay below the page size: at the full row count the list never reports reaching
            // the end, so further products were never loaded.
            initialItemCount={Math.min(expandedRows.length, 30)}
            increaseViewportBy={{ top: 300, bottom: 300 }}
            fixedHeaderContent={fixedHeaderContent}
            components={tableComponents}
            endReached={() => {
              if (hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }}
            itemContent={(index, { item, batch, batchIndex }) => {
              const batchNum = batch ? String(batch.batch_number || batchIndex + 1).padStart(2, '0') : null;
              const mrp = batch ? Number(batch.selling_price ?? item.price ?? 0) : Number(item.price ?? 0);
              const stockStore = batch ? Number(batch.stock_store ?? 0) : Number(item.stock_store ?? 0);
              const stockWarehouse = batch ? Number(batch.stock_warehouse ?? 0) : Number(item.stock_warehouse ?? 0);
              return (
                <>
                  <td className="p-1.5 md:p-3 font-semibold tracking-wider truncate align-middle" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>{item.barcode}</td>
                  <td className="p-1.5 md:p-3 align-middle font-semibold" style={{ color: batchNum ? 'var(--text-secondary)' : 'var(--text-tertiary)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)', letterSpacing: '0.04em', fontSize: '0.75rem' }}>
                    {batchNum ? `#${batchNum}` : '—'}
                  </td>
                  <td className="p-1.5 md:p-3 font-medium leading-tight break-words align-middle text-center" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>
                    {item.name}
                  </td>
                  <td className="p-1.5 md:p-3 align-middle font-semibold" style={{ borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>₹{formatINR(mrp, 2)}</td>
                  {!isWarehouseDisabled && (
                    <td className="p-1.5 md:p-3 font-bold align-middle" style={{ color: stockWarehouse < WAREHOUSE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-primary)', borderRight: '1px solid var(--border-medium)', borderBottom: '1px solid var(--border-medium)' }}>{stockWarehouse}</td>
                  )}
                  <td className="p-1.5 md:p-3 font-bold align-middle" style={{ color: stockStore < STORE_LOW_STOCK_THRESHOLD ? 'var(--color-error)' : 'var(--text-primary)', borderBottom: '1px solid var(--border-medium)' }}>{stockStore}</td>
                </>
              );
            }}
          />
        )}
      </div>

      {lowStockModal.isOpen && createPortal(
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-[10001] p-0 sm:p-6 md:p-8 bg-[var(--overlay-bg)] backdrop-blur-sm animate-fade-in"
          onClick={() => setLowStockModal({ isOpen: false, type: null })}
          role="dialog"
          aria-modal="true"
          aria-labelledby="low-stock-modal-title"
        >
          <div
            className="w-full max-w-3xl flex flex-col h-[85dvh] sm:h-[70vh] sm:max-h-[620px] rounded-t-2xl sm:rounded-[14px] overflow-hidden shadow-2xl border border-[var(--border-light)] animate-scale-in sm:my-auto"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex justify-between items-center px-5 py-3.5 shrink-0 border-b border-[var(--border-light)]"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            >
              <span id="low-stock-modal-title" className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {isWarehouseDisabled ? 'Low Stock Items' : (lowStockModal.type === 'store' ? 'Store Low Stock Items' : 'Low Warehouse Stock Items')}
              </span>
              <button
                onClick={() => setLowStockModal({ isOpen: false, type: null })}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
                title="Close (Esc)"
              >
                <span>Close</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3 modal-scroll">
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
                        <span className=" text-xs bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded-sm self-start" style={{ color: 'var(--color-accent)' }}>#{item.barcode}</span>
                      </div>
                      <div className="flex items-center gap-4 md:gap-6">
                        <div className="flex flex-col items-center">
                          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{isWarehouseDisabled ? 'Stock' : 'Store'}</span>
                          <span className={`text-lg font-bold ${lowStockModal.type === 'store' ? 'text-[var(--color-error)]' : 'text-[var(--text-primary)]'}`}>
                            {item.stock_store}
                          </span>
                        </div>
                        {!isWarehouseDisabled && (
                          <>
                            <div className="w-[1px] h-8 bg-[var(--border-light)]"></div>
                            <div className="flex flex-col items-center">
                              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Warehouse</span>
                              <span className={`text-lg font-bold ${lowStockModal.type === 'warehouse' ? 'text-[var(--color-error)]' : 'text-[var(--text-primary)]'}`}>
                                {item.stock_warehouse}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}