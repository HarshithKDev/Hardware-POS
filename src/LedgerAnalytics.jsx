import { useState, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { Spinner, PageLoader, EmptyState } from './SharedUI';

export default function LedgerAnalytics({ dateFilter, customDate, startDate, endDate, isActive }) {
  const fetchAnalytics = async () => {
    let query = supabase.from('bills').select('id').eq('location', 'Store');

    if (dateFilter !== 'ALL') {
      let start, end;
      const now = new Date();
      if (dateFilter === 'TODAY') {
        const s = now.toLocaleDateString('en-CA');
        start = `${s}T00:00:00`; end = `${s}T23:59:59.999`;
      } else if (dateFilter === 'YESTERDAY') {
        now.setDate(now.getDate() - 1);
        const s = now.toLocaleDateString('en-CA');
        start = `${s}T00:00:00`; end = `${s}T23:59:59.999`;
      } else if (dateFilter === 'CUSTOM' && customDate) {
        start = `${customDate}T00:00:00`; end = `${customDate}T23:59:59.999`;
      } else if (dateFilter === 'RANGE' && startDate && endDate) {
        start = `${startDate}T00:00:00`; end = `${endDate}T23:59:59.999`;
      }
      if (start && end) query = query.gte('created_at', start).lte('created_at', end);
    }

    const { data: billsData, error: billsError } = await query;
    if (billsError) throw billsError;
    
    if (!billsData || billsData.length === 0) return { productStats: [], batchStats: [] };

    const billIds = billsData.map(b => b.id);
    
    // Fetch items in chunks of 500 bill_ids
    const chunks = [];
    for (let i = 0; i < billIds.length; i += 500) {
      chunks.push(billIds.slice(i, i + 500));
    }
    
    const batchResults = await Promise.all(
      chunks.map(batch =>
        supabase.from('bill_items')
          .select('name, batch_id, quantity, billable_quantity, price_at_sale, cost_allocated, profit, system_price')
          .in('bill_id', batch)
      )
    );
    const itemsData = batchResults.flatMap(r => r.data || []);

    const productMap = {};
    const batchMap = {};

    itemsData.forEach(item => {
      const cleanName = item.name.split(' (Cut from ')[0];
      const qty = Number(item.billable_quantity || item.quantity || 0);
      const price = Number(item.price_at_sale || 0);
      const sysPrice = Number(item.system_price || price);
      
      const lineCost = item.cost_allocated !== undefined && item.cost_allocated !== null ? Number(item.cost_allocated) : 0;
      const lineRev = price * qty;
      const lineSystemRev = sysPrice * qty;
      const lineProfit = item.profit !== undefined && item.profit !== null ? Number(item.profit) : (lineRev - lineCost);
      const discount = lineSystemRev - lineRev;

      // Product Aggregation
      if (!productMap[cleanName]) {
        productMap[cleanName] = { name: cleanName, qty: 0, revenue: 0, cost: 0, profit: 0, discount: 0 };
      }
      productMap[cleanName].qty += qty;
      productMap[cleanName].revenue += lineRev;
      productMap[cleanName].cost += lineCost;
      productMap[cleanName].profit += lineProfit;
      productMap[cleanName].discount += discount;

      // Batch Aggregation
      if (item.batch_id) {
        const batchKey = `${cleanName}_${item.batch_id}`;
        if (!batchMap[batchKey]) {
          batchMap[batchKey] = { name: cleanName, batch_id: item.batch_id, qty: 0, revenue: 0, cost: 0, profit: 0, discount: 0 };
        }
        batchMap[batchKey].qty += qty;
        batchMap[batchKey].revenue += lineRev;
        batchMap[batchKey].cost += lineCost;
        batchMap[batchKey].profit += lineProfit;
        batchMap[batchKey].discount += discount;
      }
    });

    return {
      productStats: Object.values(productMap).sort((a, b) => b.profit - a.profit),
      batchStats: Object.values(batchMap).sort((a, b) => b.profit - a.profit)
    };
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['ledger-analytics', dateFilter, customDate, startDate, endDate, isActive],
    queryFn: fetchAnalytics,
    enabled: isActive,
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });

  const [activeTab, setActiveTab] = useState('product'); // 'product' or 'batch'

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
        <PageLoader text="Crunching analytics..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>Failed to load analytics.</p>
      </div>
    );
  }

  const { productStats, batchStats } = data || { productStats: [], batchStats: [] };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-secondary)] rounded-lg shadow-sm border border-[var(--border-light)] overflow-hidden">
      <div className="flex border-b border-[var(--border-light)] bg-[var(--bg-tertiary)] shrink-0">
        <button
          onClick={() => setActiveTab('product')}
          className={`px-6 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'product' ? 'border-b-2 text-[var(--color-accent)] border-[var(--color-accent)] bg-[var(--bg-secondary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
        >
          Product Profitability
        </button>
        <button
          onClick={() => setActiveTab('batch')}
          className={`px-6 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'batch' ? 'border-b-2 text-[var(--color-accent)] border-[var(--color-accent)] bg-[var(--bg-secondary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
        >
          Batch Profitability
        </button>
      </div>

      <div className="flex-1 overflow-auto hide-x-scrollbar relative">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-[10px] sm:text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-3 sm:p-4">Product Name</th>
              {activeTab === 'batch' && <th className="p-3 sm:p-4 text-center">Batch ID</th>}
              <th className="p-3 sm:p-4 text-center">Qty Sold</th>
              <th className="p-3 sm:p-4 text-right">Revenue</th>
              <th className="p-3 sm:p-4 text-right">Cost</th>
              <th className="p-3 sm:p-4 text-right">Discount</th>
              <th className="p-3 sm:p-4 text-right">Gross Profit</th>
            </tr>
          </thead>
          <tbody>
            {(activeTab === 'product' ? productStats : batchStats).length === 0 ? (
              <tr>
                <td colSpan={activeTab === 'batch' ? 7 : 6} className="p-8 text-center text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                  No sales data found for this period.
                </td>
              </tr>
            ) : (
              (activeTab === 'product' ? productStats : batchStats).map((row, idx) => (
                <tr key={idx} className="premium-hover border-b border-[var(--border-light)] transition-colors" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <td className="p-3 sm:p-4 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{row.name}</td>
                  {activeTab === 'batch' && (
                    <td className="p-3 sm:p-4 text-xs text-center font-mono" style={{ color: 'var(--text-tertiary)' }}>
                      {row.batch_id ? row.batch_id.substring(0, 8) + '...' : 'N/A'}
                    </td>
                  )}
                  <td className="p-3 sm:p-4 text-sm text-center font-medium" style={{ color: 'var(--text-secondary)' }}>{row.qty}</td>
                  <td className="p-3 sm:p-4 text-sm text-right font-medium" style={{ color: 'var(--color-success)' }}>₹{row.revenue.toFixed(2)}</td>
                  <td className="p-3 sm:p-4 text-sm text-right font-medium" style={{ color: 'var(--color-error)' }}>₹{row.cost.toFixed(2)}</td>
                  <td className="p-3 sm:p-4 text-sm text-right font-medium" style={{ color: 'var(--color-warning)' }}>₹{row.discount.toFixed(2)}</td>
                  <td className="p-3 sm:p-4 text-sm text-right font-bold" style={{ color: row.profit >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    ₹{row.profit.toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
