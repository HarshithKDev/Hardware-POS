import { useCallback, useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { Spinner, PageLoader } from './SharedUI';
import OwnerFailedSyncsModal from './OwnerFailedSyncsModal';
import { getFailedTransactions } from './services/db';
import {
  STORE_LOW_STOCK_THRESHOLD,
  WAREHOUSE_LOW_STOCK_THRESHOLD,
  DEAD_STOCK_ALARM_VALUE,
  STALE_TIME_5MIN,
} from './constants';

// ---------------------------------------------------------------
// Extracted sub-components (Phase 5 decomposition)
// ---------------------------------------------------------------

/** Animates a number counting up from 0 */
function AnimatedNumber({ valueStr, duration = 1000 }) {
  const [displayValue, setDisplayValue] = useState('');
  
  useEffect(() => {
    let prefix = '';
    let numStr = String(valueStr);
    
    if (numStr.startsWith('₹')) {
      prefix = '₹';
      numStr = numStr.substring(1);
    }
    
    const target = parseFloat(numStr);
    if (isNaN(target)) {
      setDisplayValue(valueStr);
      return;
    }
    
    const hasDecimals = numStr.includes('.');
    const decimals = hasDecimals ? numStr.split('.')[1].length : 0;
    
    let startTimestamp = null;
    let animationFrameId;

    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      
      // easeOutExpo for smooth deceleration
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentVal = target * easeProgress;
      
      setDisplayValue(`${prefix}${currentVal.toFixed(decimals)}`);
      
      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      } else {
        setDisplayValue(valueStr);
      }
    };
    
    animationFrameId = window.requestAnimationFrame(step);

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [valueStr, duration]);

  return <>{displayValue || valueStr}</>;
}

/** Reusable stat card */
function StatCard({ title, value, accentColor, borderColor, onClick, clickLabel, children }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`p-5 rounded-lg border border-[var(--border-light)] text-left w-full ${onClick ? 'cursor-pointer group' : ''}`}
      style={{
        backgroundColor: 'var(--bg-secondary)',
      }}
      aria-label={onClick ? clickLabel : undefined}
    >
      <div className="flex justify-between items-start">
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </p>
        {onClick && (
          <span className="text-[10px] uppercase font-bold opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-accent)' }}>
            View Details ↗
          </span>
        )}
      </div>
      <p className="text-2xl md:text-3xl font-semibold truncate" style={{ color: accentColor || 'var(--text-primary)' }} title={value}>
        <AnimatedNumber valueStr={value} duration={1200} />
      </p>
      {children}
    </Tag>
  );
}

/** Sales trend bar chart with timeframe selector */
function SalesTrendChart() {
  const [timeframe, setTimeframe] = useState('7_days');
  const [isAnimated, setIsAnimated] = useState(false);

  const { data: trend, isLoading } = useQuery({
    queryKey: ['sales-trend', timeframe],
    queryFn: async () => {
      const now = new Date();
      let startDate;
      let trendData = {};

      if (timeframe === '7_days') {
        const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(now);
        monday.setDate(monday.getDate() - diffToMonday);
        startDate = `${monday.toLocaleDateString('en-CA')}T00:00:00`;
        
        for (let i = 0; i < 7; i++) {
          const dt = new Date(monday);
          dt.setDate(dt.getDate() + i);
          const key = dt.toLocaleDateString('en-CA');
          trendData[key] = { label: dt.toLocaleDateString('en-US', { weekday: 'short' }), rev: 0 };
        }
      } else if (timeframe === '1_month') {
        const d = new Date(now);
        d.setDate(d.getDate() - 29);
        startDate = `${d.toLocaleDateString('en-CA')}T00:00:00`;

        for (let i = 29; i >= 0; i--) {
          const dt = new Date(now);
          dt.setDate(dt.getDate() - i);
          const key = dt.toLocaleDateString('en-CA');
          trendData[key] = { label: dt.getDate().toString(), rev: 0 };
        }
      } else if (timeframe === '6_months') {
        const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        startDate = `${d.toLocaleDateString('en-CA')}T00:00:00`;

        for (let i = 5; i >= 0; i--) {
          const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
          trendData[key] = { label: dt.toLocaleDateString('en-US', { month: 'short' }), rev: 0 };
        }
      }

      const { data: billsData } = await supabase
        .from('bills')
        .select('total_amount, created_at')
        .gte('created_at', startDate)
        .eq('location', 'Store');

      let maxRev = 0;
      
      if (billsData) {
        billsData.forEach(bill => {
          const dateStr = bill.created_at.split('T')[0];
          let key = timeframe === '6_months' ? dateStr.substring(0, 7) : dateStr;

          if (trendData[key]) {
            trendData[key].rev += Number(bill.total_amount || 0);
            if (trendData[key].rev > maxRev) maxRev = trendData[key].rev;
          }
        });
      }

      return Object.values(trendData).map(item => ({
        ...item,
        heightPct: maxRev === 0 ? 0 : (item.rev / maxRev) * 100
      }));
    },
    staleTime: STALE_TIME_5MIN
  });

  useEffect(() => {
    if (trend && trend.length > 0) {
      setIsAnimated(false);
      const timer = setTimeout(() => setIsAnimated(true), 100);
      return () => clearTimeout(timer);
    }
  }, [trend]);

  return (
    <div className="p-5 rounded-lg border border-[var(--border-light)] flex flex-col justify-between lg:col-span-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="flex justify-between items-center mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Sales Trend</p>
        <div className="relative inline-flex items-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)]" style={{ border: '1px solid var(--border-medium)' }}>
          <select 
            value={timeframe} 
            onChange={(e) => setTimeframe(e.target.value)}
            className="text-[10px] font-bold uppercase focus:outline-none bg-transparent cursor-pointer appearance-none pl-4 pr-10 py-2 w-32"
            style={{ color: 'var(--text-primary)' }}
          >
            <option value="7_days">7 Days</option>
            <option value="1_month">1 Month</option>
            <option value="6_months">6 Months</option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4" style={{ color: 'var(--text-secondary)' }}>
             <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
          </div>
        </div>
      </div>

      <div className="flex items-end h-32 gap-1 md:gap-3 w-full px-2 mb-4" role="img" aria-label="sales trend chart">
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="premium-wave-loader scale-75">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
        ) : (trend || []).map((point, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group cursor-crosshair relative">
            <div
              className={`w-full relative rounded-t-sm transition-all duration-700 opacity-80 group-hover:opacity-100 ${!isAnimated ? 'ease-in' : 'ease-out'}`}
              style={{
                height: isAnimated ? `${point.heightPct}%` : '0%',
                minHeight: (isAnimated && point.rev > 0) ? '4px' : '0px',
                backgroundColor: 'var(--color-accent)',
              }}
            >
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-sm flex items-center gap-1" style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
                ₹{point.rev.toFixed(0)} <span className="font-medium text-[9px]" style={{ color: 'var(--text-tertiary)' }}>({point.label})</span>
              </span>
            </div>
            <span className={`absolute -bottom-4 left-1/2 -translate-x-1/2 text-[6px] sm:text-[7px] md:text-[8px] font-bold uppercase whitespace-nowrap text-center`} style={{ color: 'var(--text-tertiary)' }}>
              {point.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Top products list */
function TopProductsList({ products }) {
  return (
    <div className="p-5 rounded-lg border border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-light)' }}>
        Top 5 Profit Makers (30 Days)
      </p>
      <ul>
        {products.length === 0 ? (
          <li className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>Not enough data.</li>
        ) : products.map((p, idx) => (
          <li key={p.name} className="py-2 flex justify-between items-center" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-3 overflow-hidden pr-2">
              <span className="text-xs font-bold w-3" style={{ color: 'var(--text-tertiary)' }}>{idx + 1}.</span>
              <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
            </div>
            <span className="text-sm font-bold shrink-0" style={{ color: 'var(--color-success)' }}>
              <AnimatedNumber valueStr={`₹${p.profit.toFixed(0)}`} duration={1200} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------
// Main OwnerStats component
// ---------------------------------------------------------------
export default function OwnerStats({ isActive }) {
  const { showAlert } = useApp();

  const fetchDashboardStats = useCallback(async () => {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const todayStart = `${todayStr}T00:00:00`;
    const todayEnd = `${todayStr}T23:59:59.999`;
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthStart = `${thirtyDaysAgo.toLocaleDateString('en-CA')}T00:00:00`;

    // --- Sales data ---
    const { data: billsData } = await supabase
      .from('bills')
      .select('id, total_amount, created_at')
      .gte('created_at', monthStart)
      .eq('location', 'Store');

    let soldNames30Days = new Set();
    let productStats30Days = {};

    let todaysTrueRevenue = 0, todaysGrossProfit = 0, todaysTotalCost = 0;
    let todaysSalesDetails = [];
    let topProducts = [];

    if (billsData && billsData.length > 0) {
      const billIds = billsData.map(b => b.id);
      const chunkSize = 100;
      const chunks = [];
      for (let i = 0; i < billIds.length; i += chunkSize) {
        chunks.push(billIds.slice(i, i + chunkSize));
      }
      const batchResults = await Promise.all(
        chunks.map(batch =>
          supabase.from('bill_items')
            .select('name, quantity, price_at_sale, cost_at_sale, unit, bill_id')
            .in('bill_id', batch)
        )
      );
      const itemsData = batchResults.flatMap(r => r.data || []);

      if (itemsData.length > 0) {
        let tProfitCents = 0, tCostCents = 0;
        const todaySalesMap = {};
        const todayBillIds = new Set(
          billsData.filter(b => b.created_at >= todayStart && b.created_at <= todayEnd).map(b => b.id)
        );

        itemsData.forEach(item => {
          const cleanName = item.name.split(' (Cut from ')[0];
          soldNames30Days.add(cleanName);
          const qty = Number(item.quantity || 0);
          const cost = Number(item.cost_at_sale || 0);
          const price = Number(item.price_at_sale || 0);
          const lineCost = cost * qty;
          const lineRev = price * qty;
          const lineProfit = lineRev - lineCost;

          if (productStats30Days[cleanName]) {
            productStats30Days[cleanName].profit += lineProfit;
            productStats30Days[cleanName].qty += qty;
          } else {
            productStats30Days[cleanName] = { name: cleanName, profit: lineProfit, qty, unit: item.unit };
          }

          if (todayBillIds.has(item.bill_id)) {
            tProfitCents += Math.round(lineProfit * 100);
            tCostCents += Math.round(lineCost * 100);
            if (todaySalesMap[cleanName]) {
              todaySalesMap[cleanName].qty += qty;
              todaySalesMap[cleanName].lineCost += lineCost;
              todaySalesMap[cleanName].lineRev += lineRev;
              todaySalesMap[cleanName].lineProfit += lineProfit;
            } else {
              todaySalesMap[cleanName] = { name: cleanName, unit: item.unit, qty, lineCost, lineRev, lineProfit };
            }
          }
        });

        const todayTotalRevCents = billsData
          .filter(b => todayBillIds.has(b.id))
          .reduce((sum, bill) => sum + Math.round(Number(bill.total_amount || 0) * 100), 0);

        todaysTrueRevenue = todayTotalRevCents / 100;
        todaysGrossProfit = tProfitCents / 100;
        todaysTotalCost = tCostCents / 100;
        todaysSalesDetails = Object.values(todaySalesMap).sort((a, b) => b.lineProfit - a.lineProfit);
        topProducts = Object.values(productStats30Days).sort((a, b) => b.profit - a.profit).slice(0, 5);
      }
    }

    // --- Inventory ---
    const { count: totalCount } = await supabase
      .from('inventory')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const pageSize = 1000;
    const pageCount = Math.ceil((totalCount || 0) / pageSize);
    const invPages = await Promise.all(
      Array.from({ length: pageCount }, (_, i) =>
        supabase.from('inventory')
          .select('barcode, name, price, cost_price, stock_warehouse, stock_store, min_quantity_warehouse, min_quantity_store')
          .eq('is_active', true)
          .range(i * pageSize, (i + 1) * pageSize - 1)
      )
    );
    const allStats = invPages.flatMap(r => r.data || []);

    let lowStoreItems = [], lowWarehouseItems = [], deadStockItems = [];
    let totalInventoryValue = 0, warehouseCapital = 0, storeCapital = 0, deadStockValue = 0;

    allStats.forEach(item => {
      if (item.stock_store < (item.min_quantity_store || STORE_LOW_STOCK_THRESHOLD)) lowStoreItems.push(item);
      if (item.stock_warehouse < (item.min_quantity_warehouse || WAREHOUSE_LOW_STOCK_THRESHOLD)) lowWarehouseItems.push(item);

      const c = Number(item.cost_price || item.price * 0.7);
      const wQty = Number(item.stock_warehouse || 0);
      const sQty = Number(item.stock_store || 0);
      const totalQty = wQty + sQty;

      totalInventoryValue += c * totalQty;
      warehouseCapital += c * wQty;
      storeCapital += c * sQty;

      if (totalQty > 0 && !soldNames30Days.has(item.name)) {
        const itemDeadValue = c * totalQty;
        deadStockValue += itemDeadValue;
        deadStockItems.push({ ...item, totalQty, deadValue: itemDeadValue });
      }
    });

    return {
      todaysTrueRevenue,
      todaysGrossProfit,
      todaysTotalCost,
      todaysSalesDetails,
      lowStoreItems: lowStoreItems.sort((a, b) => a.name.localeCompare(b.name)),
      lowWarehouseItems: lowWarehouseItems.sort((a, b) => a.name.localeCompare(b.name)),
      deadStockItems: deadStockItems.sort((a, b) => b.deadValue - a.deadValue),
      deadStockValue,
      totalInventoryValue,
      warehouseCapital,
      storeCapital,
      topProducts,
      failedSyncs: await getFailedTransactions(),
    };
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-stats', isActive],
    queryFn: fetchDashboardStats,
    staleTime: STALE_TIME_5MIN,
    enabled: isActive,
    refetchOnWindowFocus: true,
  });

  // Modal state (local — only used here)
  const [activeModal, setActiveModal] = useState(null);

  if (isLoading || !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center min-h-[300px]">
        <PageLoader text="Loading dashboard..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center min-h-[300px]">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>Failed to load dashboard stats. Please try again.</p>
      </div>
    );
  }

  const {
    todaysTrueRevenue, todaysGrossProfit, todaysTotalCost, todaysSalesDetails,
    lowStoreItems, deadStockItems, deadStockValue,
    totalInventoryValue, warehouseCapital, storeCapital,
    topProducts, failedSyncs
  } = data;

  return (
    <div className="h-full relative pb-10">
      <h1 className="text-2xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>Business Overview</h1>

      {failedSyncs && failedSyncs.length > 0 && (
        <div className="mb-6 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid var(--color-error)' }}>
          <div className="flex items-center gap-4">
            <span className="text-3xl">⚠️</span>
            <div>
              <p className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-error)' }}>{failedSyncs.length} Offline Transaction(s) Failed to Sync</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>These transactions encountered errors when uploading to the cloud and require manual review to resolve.</p>
            </div>
          </div>
          <button onClick={() => setActiveModal('failed-syncs')} className="px-5 py-2.5 text-xs font-bold text-white uppercase tracking-wider shrink-0 shadow-sm hover:opacity-90 transition-opacity" style={{ backgroundColor: 'var(--color-error)' }}>
            Review Issues
          </button>
        </div>
      )}

      {/* ROW 1: TODAY'S VITALS */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="Today Revenue" value={`₹${todaysTrueRevenue.toFixed(2)}`} borderColor="var(--color-success)" />
        <StatCard
          title="Today Profit"
          value={`₹${todaysGrossProfit.toFixed(2)}`}
          borderColor="var(--color-success)"
          onClick={() => setActiveModal('profit')}
          clickLabel="View today's profit details"
        />
        <StatCard
          title="Shop Low Stock"
          value={lowStoreItems.length}
          accentColor={lowStoreItems.length > 0 ? 'var(--color-error)' : undefined}
          borderColor={lowStoreItems.length > 0 ? 'var(--color-error)' : 'var(--color-accent)'}
          onClick={() => setActiveModal('low-store')}
          clickLabel="View low stock items"
        />
        <StatCard
          title="Dead Stock Value"
          value={`₹${deadStockValue.toFixed(0)}`}
          accentColor={deadStockValue > DEAD_STOCK_ALARM_VALUE ? 'var(--color-error)' : 'var(--color-warning)'}
          borderColor={deadStockValue > DEAD_STOCK_ALARM_VALUE ? 'var(--color-error)' : 'var(--color-warning)'}
          onClick={() => setActiveModal('dead-stock')}
          clickLabel="View dead stock items"
        />
      </div>

      {/* ROW 2: TRENDS & LEADERBOARD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <SalesTrendChart />
        <TopProductsList products={topProducts} />
      </div>

      {/* ROW 3: CAPITAL */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard title="Total Asset Value" value={`₹${totalInventoryValue.toFixed(2)}`} borderColor="var(--text-tertiary)" />
        <StatCard title="Warehouse Capital" value={`₹${warehouseCapital.toFixed(2)}`} borderColor="var(--color-accent)" />
        <div className="col-span-2 md:col-span-1">
          <StatCard title="Store Capital" value={`₹${storeCapital.toFixed(2)}`} borderColor="var(--color-accent)" />
        </div>
      </div>

      {/* MODALS */}
      {activeModal && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[200] px-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="stats-modal-title"
        >
          <div className="w-full max-w-4xl flex flex-col max-h-[85vh] rounded-xl overflow-hidden shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-2 shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
              <span id="stats-modal-title" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                {activeModal === 'profit' && "Today's Profit & Sales Breakdown"}
                {activeModal === 'low-store' && `Items Running Low in Store Front (< ${STORE_LOW_STOCK_THRESHOLD})`}
                {activeModal === 'dead-stock' && 'Dead Stock (0 Sales in Last 30 Days)'}
                {activeModal === 'failed-syncs' && 'Failed Offline Transactions'}
              </span>
              <button onClick={() => setActiveModal(null)} className="px-3 py-1.5 focus:outline-none" aria-label="Close details" style={{ color: 'var(--text-secondary)' }}>✕</button>
            </div>

            <div className="overflow-y-auto flex-1 p-0">
              {activeModal === 'profit' && (
                <div>
                  <div className="grid grid-cols-3 p-4" style={{ backgroundColor: 'var(--color-success-bg)', borderBottom: '1px solid var(--border-light)' }}>
                    <div className="text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                      <p className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>Total Cost of Goods</p>
                      <p className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>₹{todaysTotalCost.toFixed(2)}</p>
                    </div>
                    <div className="text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                      <p className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>Total Sold For</p>
                      <p className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>₹{todaysTrueRevenue.toFixed(2)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--color-success)' }}>Net Profit Generated</p>
                      <p className="text-xl font-bold" style={{ color: 'var(--color-success)' }}>₹{todaysGrossProfit.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 shadow-sm" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-light)' }}>
                        <tr className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                          <th className="p-3" style={{ borderRight: '1px solid var(--border-light)' }}>Item Sold</th>
                          <th className="p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Total Qty</th>
                          <th className="p-3 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>Total Cost</th>
                          <th className="p-3 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>Total Sold For</th>
                          <th className="p-3 text-right">Profit Generated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todaysSalesDetails.length === 0 ? (
                          <tr><td colSpan="5" className="h-[50vh] align-middle text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No sales recorded today.</td></tr>
                        ) : todaysSalesDetails.map((item, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                            <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.name}</td>
                            <td className="p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)' }}>{item.qty} {item.unit}</td>
                            <td className="p-3 text-sm text-right" style={{ borderRight: '1px solid var(--border-light)' }}>₹{item.lineCost.toFixed(2)}</td>
                            <td className="p-3 text-sm text-right" style={{ borderRight: '1px solid var(--border-light)' }}>₹{item.lineRev.toFixed(2)}</td>
                            <td className="p-3 text-sm text-right font-bold" style={{ color: 'var(--color-success)' }}>₹{item.lineProfit.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(activeModal === 'low-store' || activeModal === 'dead-stock') && (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 shadow-sm" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-light)' }}>
                      <tr className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                        <th className="p-3 w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
                        <th className="p-3" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
                        {activeModal === 'dead-stock' ? (
                          <>
                            <th className="p-3 text-center w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Locked Qty</th>
                            <th className="p-3 text-right w-32">Capital Tied Up</th>
                          </>
                        ) : (
                          <th className="p-3 text-center w-32">Current Qty</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {activeModal === 'low-store' && lowStoreItems.map(item => (
                        <tr key={item.barcode} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td className="p-3 text-sm font-mono" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)' }}>{item.barcode}</td>
                          <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.name}</td>
                          <td className="p-3 text-sm text-center font-bold" style={{ color: 'var(--color-error)' }}>{item.stock_store}</td>
                        </tr>
                      ))}
                      {activeModal === 'dead-stock' && deadStockItems.length === 0 && (
                        <tr><td colSpan="4" className="h-[50vh] align-middle text-center text-sm font-semibold" style={{ color: 'var(--color-success)' }}>Great job! All your stock is active and moving.</td></tr>
                      )}
                      {activeModal === 'dead-stock' && deadStockItems.map(item => (
                        <tr key={item.barcode} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td className="p-3 text-sm font-mono" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)' }}>{item.barcode}</td>
                          <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.name}</td>
                          <td className="p-3 text-sm text-center font-bold" style={{ color: 'var(--color-warning)', borderRight: '1px solid var(--border-light)' }}>{item.totalQty}</td>
                          <td className="p-3 text-sm text-right font-bold" style={{ color: 'var(--color-error)' }}>₹{item.deadValue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeModal === 'failed-syncs' && (
                <OwnerFailedSyncsModal failedSyncs={failedSyncs} onClose={() => setActiveModal(null)} />
              )}
            </div>

            <div className="p-3 flex justify-end shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
              <button onClick={() => setActiveModal(null)} className="h-9 px-8 text-white rounded-md text-sm font-semibold focus:outline-none transition-opacity hover:opacity-90" style={{ backgroundColor: 'var(--color-accent)' }}>Close Window</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}