import { useState, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { PageLoader } from './SharedUI';
import { STALE_TIME_5MIN } from './constants';

// ---------------------------------------------------------------
// OwnerReports — Dedicated Analytics & Reporting Dashboard
// Two major tabs:
//   A) Batch-Level Profitability
//   B) Discount / Bargaining Leakage (by Employee, Product, Category)
// ---------------------------------------------------------------

export default function OwnerReports() {
  const [activeTab, setActiveTab] = useState('batch'); // 'batch' | 'leakage'
  const [dateRange, setDateRange] = useState('30_days'); // '7_days' | '30_days' | '90_days' | 'all' | 'custom'
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [leakageView, setLeakageView] = useState('employee'); // 'employee' | 'product' | 'category'

  // Build date boundaries
  const dateBounds = useMemo(() => {
    const now = new Date();
    if (dateRange === 'all') return { start: null, end: null };
    if (dateRange === 'custom' && customStart && customEnd) {
      return { start: `${customStart}T00:00:00`, end: `${customEnd}T23:59:59.999` };
    }
    const daysBack = dateRange === '7_days' ? 7 : dateRange === '90_days' ? 90 : 30;
    const past = new Date(now);
    past.setDate(past.getDate() - daysBack);
    return {
      start: `${past.toLocaleDateString('en-CA')}T00:00:00`,
      end: `${now.toLocaleDateString('en-CA')}T23:59:59.999`
    };
  }, [dateRange, customStart, customEnd]);

  // ------- DATA FETCHING -------
  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-reports', dateBounds.start, dateBounds.end],
    queryFn: async () => {
      // 1. Fetch all sale bills in the date range
      let billQuery = supabase.from('bills').select('id, cashier_name, created_at, total_amount').eq('location', 'Store');
      if (dateBounds.start) billQuery = billQuery.gte('created_at', dateBounds.start);
      if (dateBounds.end) billQuery = billQuery.lte('created_at', dateBounds.end);

      const { data: billsData, error: billsError } = await billQuery;
      if (billsError) throw billsError;
      if (!billsData || billsData.length === 0) {
        return { batchStats: [], employeeLeakage: [], productLeakage: [], categoryLeakage: [], summary: { systemTotal: 0, collectedTotal: 0, totalLeakage: 0, billCount: 0 } };
      }

      const billIds = billsData.map(b => b.id);
      const cashierMap = {};
      billsData.forEach(b => { cashierMap[b.id] = b.cashier_name || 'Unknown'; });

      // 2. Fetch all bill_items in chunks
      const chunks = [];
      for (let i = 0; i < billIds.length; i += 500) {
        chunks.push(billIds.slice(i, i + 500));
      }
      const batchResults = await Promise.all(
        chunks.map(batch =>
          supabase.from('bill_items')
            .select('bill_id, barcode, name, batch_id, quantity, billable_quantity, price_at_sale, system_price, cost_allocated, profit, negotiated_discount, unit')
            .in('bill_id', batch)
        )
      );
      const itemsData = batchResults.flatMap(r => r.data || []);

      // 3. Fetch product categories
      const uniqueBarcodes = [...new Set(itemsData.map(i => i.barcode).filter(Boolean))];
      let categoryMap = {};
      if (uniqueBarcodes.length > 0) {
        const catChunks = [];
        for (let i = 0; i < uniqueBarcodes.length; i += 500) {
          catChunks.push(uniqueBarcodes.slice(i, i + 500));
        }
        const catResults = await Promise.all(
          catChunks.map(batch =>
            supabase.from('product_master').select('barcode, category').in('barcode', batch)
          )
        );
        catResults.flatMap(r => r.data || []).forEach(p => {
          categoryMap[p.barcode] = p.category || 'Uncategorized';
        });
      }

      // 4. Aggregate data
      const batchMap = {};
      const empMap = {};
      const prodMap = {};
      const catMap = {};
      let totalSystemRev = 0;
      let totalCollectedRev = 0;

      itemsData.forEach(item => {
        const cleanName = item.name ? item.name.split(' (Cut from ')[0] : 'Unknown';
        const qty = Number(item.billable_quantity || item.quantity || 0);
        const salePrice = Number(item.price_at_sale || 0);
        const sysPrice = Number(item.system_price || salePrice);
        const lineCost = Number(item.cost_allocated || 0);
        const lineRev = salePrice * qty;
        const lineSystemRev = sysPrice * qty;
        const lineProfit = item.profit != null ? Number(item.profit) : (lineRev - lineCost);
        const discount = Math.max(0, lineSystemRev - lineRev);
        const cashier = cashierMap[item.bill_id] || 'Unknown';
        const category = categoryMap[item.barcode] || 'Uncategorized';

        totalSystemRev += lineSystemRev;
        totalCollectedRev += lineRev;

        // -- Batch aggregation --
        if (item.batch_id) {
          const bKey = `${cleanName}__${item.batch_id}`;
          if (!batchMap[bKey]) {
            batchMap[bKey] = { name: cleanName, batch_id: item.batch_id, qty: 0, revenue: 0, cost: 0, profit: 0, discount: 0, unit: item.unit || 'PCS' };
          }
          batchMap[bKey].qty += qty;
          batchMap[bKey].revenue += lineRev;
          batchMap[bKey].cost += lineCost;
          batchMap[bKey].profit += lineProfit;
          batchMap[bKey].discount += discount;
        }

        // -- Employee leakage --
        if (!empMap[cashier]) {
          empMap[cashier] = { name: cashier, systemTotal: 0, collected: 0, discount: 0, billCount: new Set(), transactions: 0 };
        }
        empMap[cashier].systemTotal += lineSystemRev;
        empMap[cashier].collected += lineRev;
        empMap[cashier].discount += discount;
        empMap[cashier].billCount.add(item.bill_id);
        empMap[cashier].transactions += 1;

        // -- Product leakage --
        if (!prodMap[cleanName]) {
          prodMap[cleanName] = { name: cleanName, systemTotal: 0, collected: 0, discount: 0, qty: 0 };
        }
        prodMap[cleanName].systemTotal += lineSystemRev;
        prodMap[cleanName].collected += lineRev;
        prodMap[cleanName].discount += discount;
        prodMap[cleanName].qty += qty;

        // -- Category leakage --
        if (!catMap[category]) {
          catMap[category] = { name: category, systemTotal: 0, collected: 0, discount: 0, qty: 0 };
        }
        catMap[category].systemTotal += lineSystemRev;
        catMap[category].collected += lineRev;
        catMap[category].discount += discount;
        catMap[category].qty += qty;
      });

      // Finalize employee data (convert Sets to counts)
      const employeeLeakage = Object.values(empMap).map(e => ({
        ...e,
        billCount: e.billCount.size,
        leakagePct: e.systemTotal > 0 ? ((e.discount / e.systemTotal) * 100) : 0
      })).sort((a, b) => b.discount - a.discount);

      return {
        batchStats: Object.values(batchMap).sort((a, b) => b.profit - a.profit),
        employeeLeakage,
        productLeakage: Object.values(prodMap).sort((a, b) => b.discount - a.discount),
        categoryLeakage: Object.values(catMap).sort((a, b) => b.discount - a.discount),
        summary: {
          systemTotal: totalSystemRev,
          collectedTotal: totalCollectedRev,
          totalLeakage: Math.max(0, totalSystemRev - totalCollectedRev),
          billCount: billsData.length
        }
      };
    },
    staleTime: STALE_TIME_5MIN,
    refetchOnWindowFocus: true,
  });

  if (isLoading || !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center min-h-[400px]">
        <PageLoader text="Generating reports..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center min-h-[400px]">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>Failed to generate reports. Please try again.</p>
      </div>
    );
  }

  const { batchStats, employeeLeakage, productLeakage, categoryLeakage, summary } = data;

  const TABS = [
    { key: 'batch', label: 'Batch Profitability' },
    { key: 'leakage', label: 'Bargaining Leakage' },
  ];

  const LEAKAGE_VIEWS = [
    { key: 'employee', label: 'By Employee' },
    { key: 'product', label: 'By Product' },
    { key: 'category', label: 'By Category' },
  ];

  const DATE_OPTIONS = [
    { key: '7_days', label: 'Last 7 Days' },
    { key: '30_days', label: 'Last 30 Days' },
    { key: '90_days', label: 'Last 90 Days' },
    { key: 'all', label: 'All Time' },
    { key: 'custom', label: 'Custom Range' },
  ];

  const currentLeakageData = leakageView === 'employee' ? employeeLeakage
    : leakageView === 'product' ? productLeakage
    : categoryLeakage;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0">
        <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>Reports & Analytics</h1>
        
        {/* Date Range Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="h-10 pl-4 pr-10 text-sm font-semibold focus:outline-none rounded-md appearance-none cursor-pointer"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-medium)', color: 'var(--text-input)' }}
            >
              {DATE_OPTIONS.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}>
              <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
            </div>
          </div>
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-10 px-3 text-sm focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-medium)', color: 'var(--text-input)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-10 px-3 text-sm focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-medium)', color: 'var(--text-input)' }} />
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 shrink-0">
        <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Total Bills</p>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{summary.billCount}</p>
        </div>
        <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>System Calculated</p>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>₹{summary.systemTotal.toFixed(0)}</p>
        </div>
        <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Actual Collected</p>
          <p className="text-xl font-bold" style={{ color: 'var(--color-success)' }}>₹{summary.collectedTotal.toFixed(0)}</p>
        </div>
        <div className="p-4 rounded-lg" style={{ backgroundColor: summary.totalLeakage > 0 ? 'rgba(234, 179, 8, 0.05)' : 'var(--bg-tertiary)', border: summary.totalLeakage > 0 ? '1px solid rgba(234, 179, 8, 0.3)' : '1px solid var(--border-light)' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-warning)' }}>Bargaining Leakage</p>
          <p className="text-xl font-bold" style={{ color: 'var(--color-warning)' }}>₹{summary.totalLeakage.toFixed(0)}</p>
          {summary.systemTotal > 0 && (
            <p className="text-[10px] font-semibold mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {((summary.totalLeakage / summary.systemTotal) * 100).toFixed(1)}% of system total
            </p>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-0 pb-0 overflow-x-auto border-b border-[var(--border-light)] shrink-0" role="tablist">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="px-5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative"
            style={{
              color: activeTab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
              backgroundColor: 'transparent',
            }}
            role="tab"
            aria-selected={activeTab === key}
          >
            {label}
            {activeTab === key && (
              <div className="absolute bottom-0 left-0 w-full h-[2px]" style={{ backgroundColor: 'var(--color-accent)' }} />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-auto mt-4">
        {/* ===== TAB A: Batch Profitability ===== */}
        {activeTab === 'batch' && (
          <div className="rounded-lg overflow-hidden shadow-sm" style={{ border: '1px solid var(--border-light)' }}>
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
                <tr className="text-[10px] sm:text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  <th className="p-3 sm:p-4" style={{ borderRight: '1px solid var(--border-light)' }}>Product</th>
                  <th className="p-3 sm:p-4 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Batch</th>
                  <th className="p-3 sm:p-4 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Qty Sold</th>
                  <th className="p-3 sm:p-4 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>Cost</th>
                  <th className="p-3 sm:p-4 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>Revenue</th>
                  <th className="p-3 sm:p-4 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>Discount</th>
                  <th className="p-3 sm:p-4 text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {batchStats.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                      No batch-level sales data found for this period.
                    </td>
                  </tr>
                ) : batchStats.map((row, idx) => {
                  const margin = row.revenue > 0 ? ((row.profit / row.revenue) * 100).toFixed(1) : '0.0';
                  return (
                    <tr key={idx} className="transition-colors hover:bg-[var(--bg-hover)]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="p-3 sm:p-4 text-sm font-semibold" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{row.name}</td>
                      <td className="p-3 sm:p-4 text-xs text-center font-mono" style={{ color: 'var(--text-tertiary)', borderRight: '1px solid var(--border-light)' }}>
                        {row.batch_id ? row.batch_id.substring(0, 8) + '…' : '—'}
                      </td>
                      <td className="p-3 sm:p-4 text-sm text-center font-medium" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-light)' }}>
                        {row.qty % 1 === 0 ? row.qty : row.qty.toFixed(2)} {row.unit}
                      </td>
                      <td className="p-3 sm:p-4 text-sm text-right font-medium" style={{ color: 'var(--color-error)', borderRight: '1px solid var(--border-light)' }}>₹{row.cost.toFixed(2)}</td>
                      <td className="p-3 sm:p-4 text-sm text-right font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>₹{row.revenue.toFixed(2)}</td>
                      <td className="p-3 sm:p-4 text-sm text-right font-medium" style={{ color: row.discount > 0 ? 'var(--color-warning)' : 'var(--text-tertiary)', borderRight: '1px solid var(--border-light)' }}>₹{row.discount.toFixed(2)}</td>
                      <td className="p-3 sm:p-4 text-right">
                        <span className="text-sm font-bold" style={{ color: row.profit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>₹{row.profit.toFixed(2)}</span>
                        <div className="text-[10px] font-semibold mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{margin}% margin</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ===== TAB B: Bargaining Leakage ===== */}
        {activeTab === 'leakage' && (
          <div>
            {/* Sub-view switcher */}
            <div className="flex gap-2 mb-4">
              {LEAKAGE_VIEWS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLeakageView(key)}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-colors"
                  style={{
                    backgroundColor: leakageView === key ? 'var(--color-accent)' : 'var(--bg-tertiary)',
                    color: leakageView === key ? '#fff' : 'var(--text-secondary)',
                    border: leakageView === key ? '1px solid var(--color-accent)' : '1px solid var(--border-medium)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="rounded-lg overflow-hidden shadow-sm" style={{ border: '1px solid var(--border-light)' }}>
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
                  <tr className="text-[10px] sm:text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    <th className="p-3 sm:p-4" style={{ borderRight: '1px solid var(--border-light)' }}>
                      {leakageView === 'employee' ? 'Employee' : leakageView === 'product' ? 'Product' : 'Category'}
                    </th>
                    {leakageView === 'employee' && (
                      <th className="p-3 sm:p-4 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Bills</th>
                    )}
                    {leakageView !== 'employee' && (
                      <th className="p-3 sm:p-4 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Qty Sold</th>
                    )}
                    <th className="p-3 sm:p-4 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>System Total</th>
                    <th className="p-3 sm:p-4 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>Collected</th>
                    <th className="p-3 sm:p-4 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>Discount Given</th>
                    <th className="p-3 sm:p-4 text-right">Leakage %</th>
                  </tr>
                </thead>
                <tbody>
                  {currentLeakageData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                        No bargaining data found for this period.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {currentLeakageData.map((row, idx) => {
                        const leakPct = row.systemTotal > 0 ? ((row.discount / row.systemTotal) * 100) : 0;
                        // Color intensity based on leakage percentage
                        const isHigh = leakPct > 5;
                        const isMedium = leakPct > 2 && leakPct <= 5;
                        return (
                          <tr key={idx} className="transition-colors hover:bg-[var(--bg-hover)]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                            <td className="p-3 sm:p-4 text-sm font-semibold capitalize" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{row.name}</td>
                            {leakageView === 'employee' && (
                              <td className="p-3 sm:p-4 text-sm text-center font-medium" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-light)' }}>
                                {row.billCount}
                              </td>
                            )}
                            {leakageView !== 'employee' && (
                              <td className="p-3 sm:p-4 text-sm text-center font-medium" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-light)' }}>
                                {row.qty % 1 === 0 ? row.qty : row.qty.toFixed(2)}
                              </td>
                            )}
                            <td className="p-3 sm:p-4 text-sm text-right font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>₹{row.systemTotal.toFixed(2)}</td>
                            <td className="p-3 sm:p-4 text-sm text-right font-medium" style={{ color: 'var(--color-success)', borderRight: '1px solid var(--border-light)' }}>₹{row.collected.toFixed(2)}</td>
                            <td className="p-3 sm:p-4 text-sm text-right font-bold" style={{ color: row.discount > 0 ? 'var(--color-warning)' : 'var(--text-tertiary)', borderRight: '1px solid var(--border-light)' }}>
                              ₹{row.discount.toFixed(2)}
                            </td>
                            <td className="p-3 sm:p-4 text-right">
                              <span
                                className="inline-block px-2.5 py-1 rounded-full text-xs font-bold"
                                style={{
                                  backgroundColor: isHigh ? 'rgba(239, 68, 68, 0.1)' : isMedium ? 'rgba(234, 179, 8, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                                  color: isHigh ? 'var(--color-error)' : isMedium ? 'var(--color-warning)' : 'var(--color-success)',
                                }}
                              >
                                {leakPct.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Totals Row */}
                      <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '2px solid var(--border-medium)' }}>
                        <td className="p-3 sm:p-4 text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-light)' }}>
                          Total
                        </td>
                        <td className="p-3 sm:p-4" style={{ borderRight: '1px solid var(--border-light)' }}></td>
                        <td className="p-3 sm:p-4 text-sm text-right font-bold" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>
                          ₹{currentLeakageData.reduce((s, r) => s + r.systemTotal, 0).toFixed(2)}
                        </td>
                        <td className="p-3 sm:p-4 text-sm text-right font-bold" style={{ color: 'var(--color-success)', borderRight: '1px solid var(--border-light)' }}>
                          ₹{currentLeakageData.reduce((s, r) => s + r.collected, 0).toFixed(2)}
                        </td>
                        <td className="p-3 sm:p-4 text-sm text-right font-bold" style={{ color: 'var(--color-warning)', borderRight: '1px solid var(--border-light)' }}>
                          ₹{currentLeakageData.reduce((s, r) => s + r.discount, 0).toFixed(2)}
                        </td>
                        <td className="p-3 sm:p-4 text-right">
                          {(() => {
                            const totalSys = currentLeakageData.reduce((s, r) => s + r.systemTotal, 0);
                            const totalDisc = currentLeakageData.reduce((s, r) => s + r.discount, 0);
                            const pct = totalSys > 0 ? ((totalDisc / totalSys) * 100) : 0;
                            return (
                              <span className="text-xs font-bold" style={{ color: 'var(--color-warning)' }}>
                                {pct.toFixed(1)}%
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
