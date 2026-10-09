import { useState, Fragment, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { formatDateTime } from './utils';
import { SALES_PER_PAGE } from './constants';
import { ConfirmDialog, DialogOverlay } from './Dialog';
import * as XLSX from 'xlsx';

export default function OwnerLedger({ isActive }) {
  const { showAlert } = useApp();
  const queryClient = useQueryClient();

  const [salesPage, setSalesPage] = useState(0);
  const [dateFilter, setDateFilter] = useState('ALL');
  const [customDate, setCustomDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [expandedBillId, setExpandedBillId] = useState(null);
  const [billItemsCache, setBillItemsCache] = useState({});
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [returnModalState, setReturnModalState] = useState(null); // { bill, items }

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

  const handleOpenReturnModal = (bill) => {
    const items = billItemsCache[bill.id] || [];
    setReturnModalState({ bill, items });
  };

  const executeReturnItems = async (itemsToReturn, isAll, bill) => {
    try {
      if (itemsToReturn.length === 0) return;

      const shopId = localStorage.getItem('shop_id');

      if (isAll) {
        // Mark entire bill as voided
        const { error: billError } = await supabase
          .from('bills')
          .update({ status: 'voided' })
          .eq('id', bill.id);
        if (billError) throw billError;
      } else {
        // Calculate partial refund
        const refundAmount = itemsToReturn.reduce((sum, item) => sum + (Number(item.price_at_sale) * item.returnQuantity), 0);
        const newTotal = Math.max(0, Number(bill.total_amount) - refundAmount);
        const { error: billError } = await supabase.from('bills').update({ total_amount: newTotal }).eq('id', bill.id);
        if (billError) throw billError;
      }
      // Restore stock for selected items
      for (const item of itemsToReturn) {
        const qtyToRestore = item.returnQuantity;
        if (item.instance_barcode) {
          const { data: inst } = await supabase.from('stock_instances').select('original_length').eq('instance_barcode', item.instance_barcode).single();
          if (inst) {
            await supabase.from('stock_instances').update({ status: 'available', current_length: inst.original_length }).eq('instance_barcode', item.instance_barcode);
          }
        } else if (item.batch_id) {
          const { data: batch } = await supabase.from('inventory_batches').select('stock_store').eq('batch_id', item.batch_id).single();
          if (batch) {
            const newStock = Number(batch.stock_store || 0) + qtyToRestore;
            await supabase.from('inventory_batches').update({ stock_store: newStock }).eq('batch_id', item.batch_id);
          }
        }

        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          item_name: item.name,
          barcode: item.barcode,
          action_type: isAll ? 'VOID' : 'RETURN',
          changes: isAll 
            ? `Restored ${qtyToRestore} ${item.unit} (Bill #${bill.id.split('-')[0]})` 
            : `Returned ${qtyToRestore} ${item.unit} of ${item.name} from Bill #${bill.id.split('-')[0]}`,
          performed_by: localStorage.getItem('owner_name') || 'Owner'
        }]);

        if (!isAll) {
          const currentQty = Number(item.billable_quantity || item.quantity);
          if (qtyToRestore >= currentQty) {
            // Delete individual returned item from bill_items
            await supabase.from('bill_items').delete().eq('id', item.id);
          } else {
            // Update quantity for partial return
            const newQty = currentQty - qtyToRestore;
            const actQty = Number(item.actual_quantity || item.quantity) - qtyToRestore;
            await supabase.from('bill_items').update({
                quantity: newQty,
                billable_quantity: newQty,
                actual_quantity: actQty
            }).eq('id', item.id);
          }
        }
      }
      
      showAlert(`Successfully returned ${isAll ? 'full bill' : 'selected items'}.`, "Success");
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      
      if (!isAll) {
         // re-fetch bill items to update cache correctly for partial qtys
         const { data: updatedItems } = await supabase.from('bill_items').select('*').eq('bill_id', bill.id);
         setBillItemsCache(prev => ({
           ...prev,
           [bill.id]: updatedItems || []
         }));
      } else {
         setExpandedBillId(null);
      }
      setReturnModalState(null);
    } catch (e) {
      console.error(e);
      showAlert(e.message, "Return Failed");
    }
  };

  return (
    <div className="h-full flex flex-col relative w-full">
      <div className="flex justify-between items-end mb-6">
        <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>Sales History</h1>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-4 mb-6 pb-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            <span className="text-xs font-semibold uppercase whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Date Filter:</span>
            <div className="relative shrink-0">
              <select
                value={dateFilter}
                onChange={(e) => { setDateFilter(e.target.value); setSalesPage(0); setExpandedBillId(null); }}
                className="py-2 pl-3 pr-8 text-sm focus:outline-none rounded-md appearance-none cursor-pointer shadow-sm leading-normal"
                style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
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

        <div className="flex-1 overflow-auto hide-x-scrollbar overflow-x-hidden md:overflow-x-hidden md:overflow-x-auto shadow-sm min-h-[400px] md:rounded-lg border border-[var(--border-light)] mb-4" style={{ backgroundColor: 'transparent' }}>
              <div className="overflow-x-hidden md:overflow-x-auto w-full max-w-full h-full">
                <table className={`w-full text-left border-collapse min-w-full ${(isLoadingBills && bills.length === 0 || bills.length === 0) ? 'h-full' : ''}`}>
            <thead className="hidden md:table-header-group sticky top-0 z-10 glass-header" style={{ borderBottom: '1px solid var(--border-medium)' }}>
              <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                <th className="py-4 px-3 w-56 text-left border-none">Date & Time</th>
                <th className="py-4 px-3 text-left border-none">Cashier</th>
                <th className="py-4 px-3 w-32 text-center border-none">Payment</th>
                <th className="py-4 px-3 w-32 text-right border-none">Total (₹)</th>
                <th className="py-4 px-3 text-center w-16 border-none">Details</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group p-2 md:p-0">
              {isLoadingBills && bills.length === 0 ? (
                <tr className="block md:table-row border-none" style={{ borderBottom: 'none' }}><td colSpan="5" className="block md:table-cell h-[300px] text-center p-4 border-none" style={{ borderBottom: 'none' }}><PageLoader text="Loading sales..." /></td></tr>
              ) : bills.length === 0 ? (
                <tr className="block md:table-row border-none" style={{ borderBottom: 'none' }}><td colSpan="5" className="block md:table-cell h-[300px] p-0 border-none" style={{ borderBottom: 'none' }}><EmptyState message="No sales found for this period." /></td></tr>
              ) : bills.map(bill => {
                const isExpanded = expandedBillId === bill.id;
                const items = billItemsCache[bill.id] || [];
                return (
                  <Fragment key={bill.id}>
                    <tr
                      onClick={() => toggleRow(bill)}
                      className={`cursor-pointer premium-hover block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none border md:border-b md:border-t-0 md:border-l-0 md:border-r-0 border-[var(--border-medium)] md:border-[var(--border-light)] mb-3 md:mb-0 relative ${isExpanded ? 'bg-[var(--bg-hover)]' : ''}`}
                      style={{
                        backgroundColor: isExpanded ? 'var(--color-accent-bg)' : 'var(--bg-secondary)',
                      }}
                    >
                      <td className="md:hidden block p-4 border-none">
                        <div className="flex justify-between items-center mb-2">
                          <div className="text-[11px] font-bold text-[var(--text-secondary)]">{formatDateTime(bill.created_at).full}</div>
                          <div className={`text-base font-bold ${bill.status === 'voided' ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--color-accent)]'}`}>₹{Number(bill.total_amount).toFixed(2)}</div>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>Cashier: {bill.cashier_name}</div>
                            {bill.payment_method && (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded" style={{ backgroundColor: bill.payment_method === 'CASH' ? 'rgba(16, 185, 129, 0.15)' : bill.payment_method === 'UPI' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(234, 179, 8, 0.15)', color: bill.payment_method === 'CASH' ? 'var(--color-success)' : bill.payment_method === 'UPI' ? 'var(--color-accent)' : 'var(--color-warning)' }}>{bill.payment_method}</span>
                            )}
                          </div>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} style={{ color: isExpanded ? 'var(--color-accent)' : 'var(--text-secondary)' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </td>

                      <td className="hidden md:table-cell py-4 px-3 text-sm text-left border-none" style={{ color: 'var(--text-primary)' }}>
                        {formatDateTime(bill.created_at).full}
                      </td>
                      <td className="hidden md:table-cell py-4 px-3 text-sm text-left capitalize border-none" style={{ color: 'var(--text-secondary)' }}>
                        {bill.cashier_name}
                      </td>
                      <td className="hidden md:table-cell py-4 px-3 text-center border-none">
                        {bill.status === 'voided' ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>RETURNED</span>
                        ) : bill.payment_method ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded" style={{ backgroundColor: bill.payment_method === 'CASH' ? 'rgba(16, 185, 129, 0.15)' : bill.payment_method === 'UPI' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(234, 179, 8, 0.15)', color: bill.payment_method === 'CASH' ? 'var(--color-success)' : bill.payment_method === 'UPI' ? 'var(--color-accent)' : 'var(--color-warning)' }}>{bill.payment_method}</span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>--</span>
                        )}
                      </td>
                      <td className="hidden md:table-cell py-4 px-3 text-right text-sm font-bold border-none" style={{ color: bill.status === 'voided' ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: bill.status === 'voided' ? 'line-through' : 'none' }}>
                        ₹{Number(bill.total_amount).toFixed(2)}
                      </td>
                      <td className="hidden md:table-cell py-4 px-3 text-center h-full border-none">
                        <div className="flex justify-center items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} style={{ color: isExpanded ? 'var(--color-accent)' : 'var(--text-secondary)' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="block md:table-row" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <td colSpan="5" className="block md:table-cell p-0" style={{ borderBottom: '2px solid var(--color-accent)' }}>
                          {isLoadingItems ? (
                            <div className="p-6 flex justify-center"><PageLoader text="" /></div>
                          ) : (
                            <div className="p-6 px-8">
                              <div className="flex justify-between items-center mb-3 pb-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
                                <div className="flex items-center gap-4 flex-wrap">
                                  <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
                                    Bill #{bill.id.split('-')[0]} Items
                                  </p>
                                  {(bill.customer_name || bill.customer_phone) && (
                                    <div className="flex items-center gap-3 px-3 py-1 rounded bg-[var(--bg-hover)] border border-[var(--border-light)]">
                                      {bill.customer_name && (
                                        <div className="flex items-center gap-1.5">
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                          <span className="text-xs font-semibold text-[var(--text-primary)]">{bill.customer_name}</span>
                                        </div>
                                      )}
                                      {bill.customer_phone && (
                                        <div className="flex items-center gap-1.5">
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                          <span className="text-xs font-semibold text-[var(--text-primary)]">{bill.customer_phone}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="overflow-x-hidden md:overflow-x-auto overflow-y-hidden w-full rounded-lg shadow-sm" style={{ border: '1px solid var(--border-light)' }}>
                                <div className="overflow-x-hidden md:overflow-x-auto w-full">
                                  <table className="w-full text-left border-collapse min-w-full" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                                  <thead className="hidden md:table-header-group" style={{ backgroundColor: 'var(--bg-hover)', borderBottom: '1px solid var(--border-light)' }}>
                                    <tr className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)' }}>
                                      <th className="py-3 px-4 text-left border-none">Item Name</th>
                                      <th className="py-3 px-4 text-center w-24 border-none">Qty</th>
                                      <th className="py-3 px-4 text-center w-24 border-none">MRP</th>
                                      <th className="py-3 px-4 text-center w-24 border-none">Sold At</th>
                                      <th className="py-3 px-4 text-center w-24 border-none">Disc %</th>
                                      <th className="py-3 px-4 text-center w-24 border-none">Total</th>
                                      <th className="py-3 px-4 text-right w-24 border-none" style={{ color: 'var(--color-success)' }}>Profit</th>
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
                                            {item.quantity} {item.unit} × ₹{Number(item.price_at_sale).toFixed(2)} <span className="opacity-70">(MRP: ₹{Number(item.selling_price || item.system_price || item.price_at_sale).toFixed(2)})</span>
                                          </div>
                                        </td>
                                        <td className="hidden md:table-cell py-3 px-4 text-sm font-medium text-left border-none" style={{ color: 'var(--text-primary)' }}>{item.name}</td>
                                        <td className="hidden md:table-cell py-3 px-4 text-sm text-center border-none">
                                          {Number(item.actual_quantity) !== Number(item.billable_quantity) && (
                                             <div className="text-[10px] text-[var(--text-tertiary)]">Act: {item.actual_quantity}</div>
                                          )}
                                          {item.billable_quantity || item.quantity} {item.unit}
                                        </td>
                                        <td className="hidden md:table-cell py-3 px-4 text-sm text-center border-none">
                                          ₹{Number(item.selling_price || item.system_price || item.price_at_sale).toFixed(2)}
                                        </td>
                                        <td className="hidden md:table-cell py-3 px-4 text-sm text-center border-none" style={{ color: Number(item.price_at_sale) < Number(item.selling_price || item.system_price || item.price_at_sale) ? 'var(--color-accent)' : 'inherit' }}>
                                          ₹{Number(item.price_at_sale).toFixed(2)}
                                        </td>
                                        <td className="hidden md:table-cell py-3 px-4 text-sm text-center border-none">
                                          {Number(item.negotiated_discount || 0).toFixed(1)}%
                                        </td>
                                        <td className="hidden md:table-cell py-3 px-4 text-sm text-center font-bold border-none" style={{ color: 'var(--text-primary)' }}>₹{(item.price_at_sale * (item.billable_quantity || item.quantity)).toFixed(2)}</td>
                                        <td className="hidden md:table-cell py-3 px-4 text-sm text-right font-bold border-none" style={{ color: bill.status === 'voided' ? 'var(--text-secondary)' : 'var(--color-success)' }}>
                                          <div className="flex flex-col items-end gap-1">
                                            {bill.status === 'voided' ? '₹0.00' : `₹${Number(item.profit || 0).toFixed(2)}`}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  </table>
                                </div>
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
        </div>

        <div className="flex justify-between items-center p-3 mt-auto shadow-sm rounded-lg shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
          <button onClick={() => setSalesPage(p => Math.max(0, p - 1))} disabled={salesPage === 0} className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] btn-press" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>Previous</button>
          <button onClick={() => setSalesPage(p => p + 1)} disabled={!hasMoreBills} className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] btn-press" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>Next</button>
        </div>
      </div>

      {returnModalState && (
        <ReturnItemsModal 
          isOpen={true}
          onClose={() => setReturnModalState(null)}
          bill={returnModalState.bill}
          items={returnModalState.items}
          onReturnItems={executeReturnItems}
        />
      )}
    </div>
  );
}

function ReturnItemsModal({ isOpen, onClose, bill, items, onReturnItems }) {
  const [returnQuantities, setReturnQuantities] = useState({});
  const [isReturning, setIsReturning] = useState(false);

  if (!isOpen || !bill) return null;

  const handleQtyChange = (item, delta) => {
    setReturnQuantities(prev => {
      const current = prev[item.id] || 0;
      const maxQty = Number(item.billable_quantity || item.quantity);
      let newQty = current + delta;
      if (newQty < 0) newQty = 0;
      if (newQty > maxQty) newQty = maxQty;
      
      const updated = { ...prev, [item.id]: newQty };
      if (newQty === 0) delete updated[item.id];
      return updated;
    });
  };

  const handleCheckbox = (item) => {
    setReturnQuantities(prev => {
      if (prev[item.id]) {
        const updated = { ...prev };
        delete updated[item.id];
        return updated;
      } else {
        return { ...prev, [item.id]: Number(item.billable_quantity || item.quantity) };
      }
    });
  };

  const itemsToReturn = Object.keys(returnQuantities).map(id => {
    const item = items.find(i => i.id === id);
    return { ...item, returnQuantity: returnQuantities[id] };
  });

  const refundAmount = itemsToReturn.reduce((sum, item) => sum + (Number(item.price_at_sale) * item.returnQuantity), 0);
  const isAll = items.length === itemsToReturn.length && items.every(item => returnQuantities[item.id] === Number(item.billable_quantity || item.quantity));

  const handleConfirm = async () => {
    setIsReturning(true);
    try {
      await onReturnItems(itemsToReturn, isAll, bill);
    } finally {
      setIsReturning(false);
    }
  };

  return (
    <DialogOverlay isOpen={isOpen} onClose={onClose} labelId="return-items-title" maxWidth="500px">
      <div className="flex justify-between items-center px-6 pt-6 pb-4 border-b border-[var(--border-light)]">
        <span id="return-items-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Return Items
        </span>
        <button onClick={onClose} className="p-2 hover:bg-[var(--bg-hover)] rounded-full transition-colors" style={{ color: 'var(--text-secondary)' }}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-6 max-h-[60vh] overflow-y-auto">
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Select the quantity you want to return from Bill #{bill.id.split('-')[0]}:</p>
        
        <div className="flex flex-col gap-3">
          {items.map(item => {
            const maxQty = Number(item.billable_quantity || item.quantity);
            const returnQty = returnQuantities[item.id] || 0;
            const isSelected = returnQty > 0;

            return (
              <div key={item.id} className="flex flex-col gap-3 p-3 rounded-lg border border-[var(--border-light)] transition-colors" style={{ backgroundColor: isSelected ? 'var(--color-accent-bg)' : 'transparent', borderColor: isSelected ? 'var(--color-accent)' : 'var(--border-light)' }}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-3 cursor-pointer flex-1" onClick={(e) => { e.preventDefault(); handleCheckbox(item); }}>
                    <input 
                      type="checkbox" 
                      checked={isSelected} 
                      readOnly
                      className="w-5 h-5 rounded cursor-pointer pointer-events-none"
                      style={{ accentColor: 'var(--color-accent)' }}
                    />
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Paid: ₹{Number(item.price_at_sale).toFixed(2)}/ea</div>
                    </div>
                  </label>

                  <div className="flex items-center gap-2">
                    <button onClick={() => handleQtyChange(item, -1)} disabled={returnQty <= 0} className="w-8 h-8 rounded-full border border-[var(--border-medium)] flex items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50 hover:bg-[var(--bg-hover)] transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                    </button>
                    <div className="w-10 text-center font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {returnQty}
                    </div>
                    <button onClick={() => handleQtyChange(item, 1)} disabled={returnQty >= maxQty} className="w-8 h-8 rounded-full border border-[var(--border-medium)] flex items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50 hover:bg-[var(--bg-hover)] transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    </button>
                  </div>
                </div>
                
                <div className="flex justify-between items-center text-xs pt-2 border-t border-[var(--border-light)]">
                  <span style={{ color: 'var(--text-secondary)' }}>Purchased: {maxQty} {item.unit}</span>
                  <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Refund: ₹{(Number(item.price_at_sale) * returnQty).toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-6 py-4 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Total Refund:</span>
          <span className="text-2xl font-bold" style={{ color: 'var(--color-error)' }}>₹{refundAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isReturning}
            className="h-10 px-6 text-sm font-medium rounded-md border border-[var(--border-light)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'transparent', color: 'var(--text-primary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={itemsToReturn.length === 0 || isReturning}
            className="h-10 px-6 text-sm font-medium rounded-md transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
            style={{ backgroundColor: 'var(--color-error)', color: '#fff' }}
          >
            {isReturning ? <Spinner className="w-5 h-5 text-white" /> : (isAll ? 'Return Full Bill' : 'Confirm Return')}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}