import { useState, Fragment, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { formatDateTime } from './utils';
import { SALES_PER_PAGE } from './constants';
import * as XLSX from 'xlsx';

export default function OwnerLedger({ isActive }) {
  const { showAlert } = useApp();

  const [salesPage, setSalesPage] = useState(0);
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
      .eq('location', 'Store') // Only Sales
      .order('created_at', { ascending: false })
      .range(from, from + SALES_PER_PAGE - 1);

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
  }, [salesPage, dateFilter, customDate, startDate, endDate]);

  const { data: bills = [], isLoading: isLoadingBills } = useQuery({
    queryKey: ['bills', salesPage, dateFilter, customDate, startDate, endDate, isActive],
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

  const handleExportCSV = async () => {
    try {
      showAlert('Preparing CSV export...', 'Info');
      let query = supabase.from('bills').select('*').eq('location', 'Store').order('created_at', { ascending: false }).limit(10000);

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
      
      if (!data || data.length === 0) {
         return showAlert('No data to export for this filter.', 'Warning');
      }
      const exportData = data.map(b => ({
         'Bill ID': b.id,
         'Date': formatDateTime(b.created_at).datePart,
         'Time': formatDateTime(b.created_at).timePart,
         'Cashier': b.cashier_name || 'System',
         'Activity Type': 'Sale',
         'Total Amount': b.total_amount || 0,
         'Total Profit': b.total_profit || 0
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sales_Ledger");
      
      worksheet['!cols'] = [
        { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 20 },
        { wch: 15 }, { wch: 15 }, { wch: 15 },
      ];

      XLSX.writeFile(workbook, `Sales_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      showAlert(`Export failed: ${e.message}`, 'Error');
    }
  };

  return (
    <div className="h-full flex flex-col pb-4 md:pb-6 relative w-full">
      <h1 className="text-2xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>Sales History</h1>

      <div className="flex flex-col flex-1 pb-4">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-4 mb-6 pb-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            <span className="text-xs font-semibold uppercase whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Date Filter:</span>
            <div className="relative shrink-0">
              <select
                value={dateFilter}
                onChange={(e) => { setDateFilter(e.target.value); setSalesPage(0); setExpandedBillId(null); }}
                className="h-11 md:h-9 pl-3 pr-8 text-sm focus:outline-none rounded-md appearance-none cursor-pointer shadow-sm"
                style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                aria-label="Date filter"
              >
                <option value="ALL">All Time</option>
                <option value="TODAY">Today</option>
                <option value="YESTERDAY">Yesterday</option>
                <option value="CUSTOM">Specific Date...</option>
                <option value="RANGE">Date Range...</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}>
                <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
              </div>
            </div>
            {dateFilter === 'CUSTOM' && (
              <input type="date" value={customDate} onChange={(e) => { setCustomDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-11 md:h-9 px-2 text-sm focus:outline-none rounded-md shadow-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            )}
            {dateFilter === 'RANGE' && (
              <div className="flex items-center gap-2 shrink-0">
                <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-11 md:h-9 px-2 text-sm focus:outline-none rounded-md shadow-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
                <span className="font-bold text-xs uppercase" style={{ color: 'var(--text-tertiary)' }}>to</span>
                <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-11 md:h-9 px-2 text-sm focus:outline-none rounded-md shadow-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              </div>
            )}
            
            <button
              onClick={handleExportCSV}
              className="h-11 md:h-9 px-4 ml-auto xl:ml-2 text-xs font-semibold uppercase tracking-wider flex items-center gap-1 shadow-sm transition-colors shrink-0 rounded-md"
              style={{ backgroundColor: 'var(--color-success)', color: 'var(--text-primary)' }}
              title="Download Excel"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              <span className="hidden sm:inline">Export Excel</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto overflow-x-hidden md:overflow-x-auto shadow-sm min-h-[400px] md:rounded-lg" style={{ backgroundColor: 'transparent' }}>
          <table className={`w-full text-left border-collapse block md:table min-w-0 md:min-w-[700px] ${(isLoadingBills && bills.length === 0 || bills.length === 0) ? 'h-full' : ''}`}>
            <thead className="hidden md:table-header-group sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
              <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                <th className="p-3 w-48 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Date & Time</th>
                <th className="p-3 w-32 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Cashier</th>
                <th className="p-3 w-32 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Total (₹)</th>
                <th className="p-3 text-center w-16">Details</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group p-2 md:p-0">
              {isLoadingBills && bills.length === 0 ? (
                <tr className="block md:table-row"><td colSpan="4" className="block md:table-cell h-full text-center p-4"><PageLoader text="Loading sales..." /></td></tr>
              ) : bills.length === 0 ? (
                <tr className="block md:table-row"><td colSpan="4" className="block md:table-cell h-full align-middle text-center text-sm font-semibold p-4" style={{ color: 'var(--text-tertiary)' }}>No sales records found.</td></tr>
              ) : bills.map(bill => {
                const isExpanded = expandedBillId === bill.id;
                const items = billItemsCache[bill.id] || [];
                return (
                  <Fragment key={bill.id}>
                    <tr
                      onClick={() => toggleRow(bill)}
                      className="cursor-pointer group block md:table-row rounded-lg md:rounded-none mb-3 md:mb-0 border border-[var(--border-medium)] md:border-b md:border-t-0 md:border-l-0 md:border-r-0 md:border-[var(--border-light)]"
                      style={{
                        backgroundColor: isExpanded ? 'var(--color-accent-bg)' : 'var(--bg-secondary)',
                      }}
                    >
                      <td className="md:hidden block p-4 border-none">
                        <div className="flex justify-between items-center mb-2">
                          <div className="text-[11px] font-bold text-[var(--text-secondary)]">{formatDateTime(bill.created_at).full}</div>
                          <div className="text-base font-bold text-[var(--color-accent)]">₹{Number(bill.total_amount).toFixed(2)}</div>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>Cashier: {bill.cashier_name}</div>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} style={{ color: isExpanded ? 'var(--color-accent)' : 'var(--text-secondary)' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </td>

                      <td className="hidden md:table-cell p-3 text-sm text-center" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>
                        {formatDateTime(bill.created_at).full}
                      </td>
                      <td className="hidden md:table-cell p-3 text-sm text-center capitalize" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-light)' }}>
                        {bill.cashier_name}
                      </td>
                      <td className="hidden md:table-cell p-3 text-center text-sm font-bold" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)' }}>
                        ₹{Number(bill.total_amount).toFixed(2)}
                      </td>
                      <td className="hidden md:table-cell p-3 text-center h-full">
                        <div className="flex justify-center items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} style={{ color: isExpanded ? 'var(--color-accent)' : 'var(--text-secondary)' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="block md:table-row" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <td colSpan="4" className="block md:table-cell p-0" style={{ borderBottom: '2px solid var(--color-accent)' }}>
                          {isLoadingItems ? (
                            <div className="p-6 flex justify-center"><Spinner className="w-6 h-6" style={{ color: 'var(--color-accent)' }} /></div>
                          ) : (
                            <div className="p-6 px-8">
                              <p className="text-xs font-bold uppercase tracking-widest mb-3 pb-2" style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
                                Bill #{bill.id.split('-')[0]} Items
                              </p>
                              <div className="overflow-x-auto overflow-y-hidden w-full">
                                <table className="w-full text-left border-collapse shadow-sm block md:table" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                                  <thead className="hidden md:table-header-group" style={{ backgroundColor: 'var(--bg-hover)', borderBottom: '1px solid var(--border-light)' }}>
                                    <tr className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)' }}>
                                      <th className="px-4 py-2 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
                                      <th className="px-4 py-2 text-center w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Qty</th>
                                      <th className="px-4 py-2 text-center w-32" style={{ borderRight: '1px solid var(--border-light)' }}>Unit Price</th>
                                      <th className="px-4 py-2 text-center w-32">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody className="block md:table-row-group">
                                    {items.map(item => (
                                      <tr key={item.id} className="block md:table-row" style={{ borderBottom: '1px solid var(--border-light)' }}>
                                        <td className="md:hidden block p-3 border-none">
                                          <div className="flex justify-between items-center mb-1">
                                            <div className="text-sm font-semibold text-[var(--text-primary)]">{item.name}</div>
                                            <div className="text-sm font-bold text-[var(--text-primary)]">₹{(item.price_at_sale * item.quantity).toFixed(2)}</div>
                                          </div>
                                          <div className="text-xs text-[var(--text-secondary)]">
                                            {item.quantity} {item.unit} × ₹{Number(item.price_at_sale).toFixed(2)}
                                          </div>
                                        </td>
                                        <td className="hidden md:table-cell px-4 py-2 text-sm font-medium text-center" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{item.name}</td>
                                        <td className="hidden md:table-cell px-4 py-2 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)' }}>{item.quantity} {item.unit}</td>
                                        <td className="hidden md:table-cell px-4 py-2 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)' }}>₹{Number(item.price_at_sale).toFixed(2)}</td>
                                        <td className="hidden md:table-cell px-4 py-2 text-sm text-center font-bold" style={{ color: 'var(--text-primary)' }}>₹{(item.price_at_sale * item.quantity).toFixed(2)}</td>
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
          <button onClick={() => setSalesPage(p => Math.max(0, p - 1))} disabled={salesPage === 0} className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>Newer</button>
          <button onClick={() => setSalesPage(p => p + 1)} disabled={!hasMoreBills} className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>Older</button>
        </div>
      </div>
    </div>
  );
}