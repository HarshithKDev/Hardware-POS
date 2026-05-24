import { useState, useEffect, Fragment, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { formatDateTime } from './utils';
import { SALES_PER_PAGE } from './constants';

export default function OwnerLedger({ isActive }) {
  const { showAlert } = useApp();

  const [salesPage, setSalesPage] = useState(0);
  const [filter, setFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [customDate, setCustomDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [expandedBillId, setExpandedBillId] = useState(null);
  const [billItemsCache, setBillItemsCache] = useState({});
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  const fetchBills = useCallback(async () => {
    const from = salesPage * SALES_PER_PAGE;
    let query = supabase
      .from('bills')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + SALES_PER_PAGE - 1);

    if (filter === 'SALE') query = query.eq('location', 'Store');
    if (filter === 'RECEIVE') query = query.eq('location', 'Warehouse-Inbound');
    if (filter === 'TRANSFER') query = query.eq('location', 'Warehouse-Transfer');

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

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }, [salesPage, filter, dateFilter, customDate, startDate, endDate]);

  const { data: bills = [], isLoading: isLoadingBills } = useQuery({
    queryKey: ['bills', salesPage, filter, dateFilter, customDate, startDate, endDate, isActive],
    queryFn: fetchBills,
    enabled: isActive,
    staleTime: 1000 * 60 * 2,
  });

  const hasMoreBills = bills.length === SALES_PER_PAGE;

  const toggleRow = async (bill) => {
    if (expandedBillId === bill.id) { setExpandedBillId(null); return; }
    setExpandedBillId(bill.id);
    if (!billItemsCache[bill.id]) {
      setIsLoadingItems(true);
      try {
        const { data } = await supabase.from('bill_items').select('*').eq('bill_id', bill.id);
        if (data) setBillItemsCache(prev => ({ ...prev, [bill.id]: data }));
      } finally {
        setIsLoadingItems(false);
      }
    }
  };

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    setSalesPage(0);
    setExpandedBillId(null);
  };

  const getOperationType = (location) => {
    if (location === 'Store') return 'Sale (Checkout)';
    if (location === 'Warehouse-Inbound') return 'Received New Stock';
    if (location === 'Warehouse-Transfer') return 'Moved Stock to Store';
    return location;
  };

  return (
    <div className="flex flex-col h-full">
      <h1 className="text-2xl font-light mb-6" style={{ color: 'var(--text-primary)' }}>Sales & Activity History</h1>

      <div className="flex flex-col flex-1 pb-4">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-4 mb-6 pb-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex gap-1 overflow-x-auto w-full xl:w-auto" role="tablist" aria-label="Activity filters">
            {[
              { key: 'ALL', label: 'All Activity' },
              { key: 'SALE', label: 'Sales' },
              { key: 'RECEIVE', label: 'Received Stock' },
              { key: 'TRANSFER', label: 'Moved to Store' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleFilterChange(key)}
                className="h-10 px-6 text-sm uppercase tracking-wider focus:outline-none transition-colors"
                style={{
                  backgroundColor: filter === key ? 'var(--color-accent)' : 'var(--bg-secondary)',
                  color: filter === key ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: filter === key ? '600' : '500',
                  borderBottom: filter === key ? '2px solid var(--color-accent-hover)' : '2px solid transparent',
                }}
                role="tab"
                aria-selected={filter === key}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 pb-2 w-full xl:w-auto">
            <span className="text-xs font-semibold uppercase whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Date Filter:</span>
            <div className="relative shrink-0">
              <select
                value={dateFilter}
                onChange={(e) => { setDateFilter(e.target.value); setSalesPage(0); setExpandedBillId(null); }}
                className="h-9 pl-3 pr-8 text-sm focus:outline-none cursor-pointer shadow-sm"
                style={{ border: '1px solid var(--border-medium)' }}
                aria-label="Date filter"
              >
                <option value="ALL">All Time</option>
                <option value="TODAY">Today</option>
                <option value="YESTERDAY">Yesterday</option>
                <option value="CUSTOM">Specific Date...</option>
                <option value="RANGE">Date Range...</option>
              </select>
            </div>
            {dateFilter === 'CUSTOM' && (
              <input type="date" value={customDate} onChange={(e) => { setCustomDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-9 px-2 text-sm focus:outline-none shadow-sm" style={{ border: '1px solid var(--border-medium)' }} aria-label="Custom date" />
            )}
            {dateFilter === 'RANGE' && (
              <div className="flex items-center gap-2 shrink-0">
                <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-9 px-2 text-sm focus:outline-none shadow-sm" style={{ border: '1px solid var(--border-medium)' }} aria-label="Start date" />
                <span className="font-bold text-xs uppercase" style={{ color: 'var(--text-tertiary)' }}>to</span>
                <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-9 px-2 text-sm focus:outline-none shadow-sm" style={{ border: '1px solid var(--border-medium)' }} aria-label="End date" />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto shadow-sm min-h-[400px]" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }}>
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
              <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                <th className="p-3 w-48" style={{ borderRight: '1px solid var(--border-light)' }}>Date & Time</th>
                <th className="p-3 w-48" style={{ borderRight: '1px solid var(--border-light)' }}>Action Taken</th>
                <th className="p-3 w-32 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Operator</th>
                <th className="p-3 w-32 text-right" style={{ borderRight: '1px solid var(--border-light)' }}>Total (₹)</th>
                <th className="p-3 text-center w-16">Details</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingBills && bills.length === 0 ? (
                <tr><td colSpan="5" className="p-10 text-center"><Spinner className="w-8 h-8 mx-auto" style={{ color: 'var(--color-accent)' }} /></td></tr>
              ) : bills.length === 0 ? (
                <tr><td colSpan="5" className="p-8 text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No records found.</td></tr>
              ) : bills.map(bill => {
                const isExpanded = expandedBillId === bill.id;
                const items = billItemsCache[bill.id] || [];
                const isSale = bill.location === 'Store';
                return (
                  <Fragment key={bill.id}>
                    <tr
                      onClick={() => toggleRow(bill)}
                      className="cursor-pointer group"
                      style={{
                        backgroundColor: isExpanded ? 'var(--color-accent-bg)' : 'var(--bg-secondary)',
                        borderBottom: '1px solid var(--border-light)',
                      }}
                    >
                      <td className="p-3 text-sm" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>
                        {formatDateTime(bill.created_at).full}
                      </td>
                      <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>
                        {getOperationType(bill.location)}
                      </td>
                      <td className="p-3 text-sm text-center capitalize" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-light)' }}>
                        {bill.cashier_name}
                      </td>
                      <td className="p-3 text-right text-sm font-bold" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)' }}>
                        {isSale ? `₹${Number(bill.total_amount).toFixed(2)}` : '--'}
                      </td>
                      <td className="p-3 text-center flex justify-center items-center h-full">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} style={{ color: isExpanded ? 'var(--color-accent)' : 'var(--text-secondary)' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <td colSpan="5" className="p-0" style={{ borderBottom: '2px solid var(--color-accent)' }}>
                          {isLoadingItems ? (
                            <div className="p-6 flex justify-center"><Spinner className="w-6 h-6" style={{ color: 'var(--color-accent)' }} /></div>
                          ) : (
                            <div className="p-6 px-8">
                              <p className="text-xs font-bold uppercase tracking-widest mb-3 pb-2" style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
                                Record #{bill.id.split('-')[0]} Details
                              </p>
                              <div className="overflow-x-auto w-full">
                                <table className="w-full text-left border-collapse shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                                  <thead style={{ backgroundColor: 'var(--bg-hover)', borderBottom: '1px solid var(--border-light)' }}>
                                    <tr className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)' }}>
                                      <th className="px-4 py-2" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
                                      <th className="px-4 py-2 text-center w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Qty</th>
                                      {isSale && (
                                        <>
                                          <th className="px-4 py-2 text-right w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Unit Price</th>
                                          <th className="px-4 py-2 text-right w-32">Total</th>
                                        </>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map(item => (
                                      <tr key={item.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                        <td className="px-4 py-2 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.name}</td>
                                        <td className="px-4 py-2 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)' }}>{item.quantity} {item.unit}</td>
                                        {isSale && (
                                          <>
                                            <td className="px-4 py-2 text-sm text-right" style={{ borderRight: '1px solid var(--border-light)' }}>₹{Number(item.price_at_sale).toFixed(2)}</td>
                                            <td className="px-4 py-2 text-sm text-right font-bold" style={{ color: 'var(--text-primary)' }}>₹{(item.price_at_sale * item.quantity).toFixed(2)}</td>
                                          </>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center p-3 mt-4 shadow-sm" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
          <button onClick={() => setSalesPage(p => Math.max(0, p - 1))} disabled={salesPage === 0} className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>Newer</button>
          <button onClick={() => setSalesPage(p => p + 1)} disabled={!hasMoreBills} className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>Older</button>
        </div>
      </div>
    </div>
  );
}