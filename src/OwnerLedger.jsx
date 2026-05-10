import React, { useState, useEffect, Fragment, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';

export default function OwnerLedger({ isActive }) {
  const [bills, setBills] = useState([]);
  const [isLoadingBills, setIsLoadingBills] = useState(false);
  const [salesPage, setSalesPage] = useState(0);
  const [hasMoreBills, setHasMoreBills] = useState(true);
  
  const [filter, setFilter] = useState('ALL'); 
  const [dateFilter, setDateFilter] = useState('ALL'); 
  const [customDate, setCustomDate] = useState('');    
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  const [expandedBillId, setExpandedBillId] = useState(null);
  const [billItemsCache, setBillItemsCache] = useState({});
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  
  const isFirstRender = useRef(true);
  const SALES_PER_PAGE = 20;

  const fetchBills = async (page, currentFilter, currentDateFilter, currentCustomDate, currentStart, currentEnd) => {
    try {
      setIsLoadingBills(true);
      const from = page * SALES_PER_PAGE;
      let query = supabase.from('bills').select('*').order('created_at', { ascending: false }).range(from, from + SALES_PER_PAGE - 1);
      
      if (currentFilter === 'SALE') query = query.eq('location', 'Store');
      else if (currentFilter === 'RECEIVE') query = query.eq('location', 'Warehouse-Inbound');
      else if (currentFilter === 'TRANSFER') query = query.eq('location', 'Warehouse-Transfer');

      if (currentDateFilter !== 'ALL') {
        let start, end;
        const now = new Date();
        
        if (currentDateFilter === 'TODAY') {
          const localDateStr = now.toLocaleDateString('en-CA');
          start = `${localDateStr}T00:00:00`;
          end = `${localDateStr}T23:59:59.999`;
        } else if (currentDateFilter === 'YESTERDAY') {
          now.setDate(now.getDate() - 1);
          const localDateStr = now.toLocaleDateString('en-CA');
          start = `${localDateStr}T00:00:00`;
          end = `${localDateStr}T23:59:59.999`;
        } else if (currentDateFilter === 'CUSTOM' && currentCustomDate) {
          start = `${currentCustomDate}T00:00:00`;
          end = `${currentCustomDate}T23:59:59.999`;
        } else if (currentDateFilter === 'RANGE' && currentStart && currentEnd) {
          start = `${currentStart}T00:00:00`;
          end = `${currentEnd}T23:59:59.999`;
        }

        if (start && end) {
          query = query.gte('created_at', start).lte('created_at', end);
        }
      }

      const { data } = await query;
      if (data) { setBills(data); setHasMoreBills(data.length === SALES_PER_PAGE); }
    } finally { setIsLoadingBills(false); }
  };

  useEffect(() => {
    fetchBills(salesPage, filter, dateFilter, customDate, startDate, endDate);
  }, [salesPage, filter, dateFilter, customDate, startDate, endDate]);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (isActive) fetchBills(salesPage, filter, dateFilter, customDate, startDate, endDate);
  }, [isActive]);

  const toggleRow = async (bill) => {
    if (expandedBillId === bill.id) { setExpandedBillId(null); return; }
    setExpandedBillId(bill.id);
    if (!billItemsCache[bill.id]) {
      setIsLoadingItems(true);
      try {
        const { data } = await supabase.from('bill_items').select('*').eq('bill_id', bill.id);
        if (data) setBillItemsCache(prev => ({ ...prev, [bill.id]: data }));
      } finally { setIsLoadingItems(false); }
    }
  };

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter); setSalesPage(0); setExpandedBillId(null); 
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${datePart}, ${(hours % 12 || 12).toString().padStart(2, '0')}:${minutes} ${ampm}`;
  };

  const getOperationType = (location) => {
    if (location === 'Store') return 'Sale (Checkout)';
    if (location === 'Warehouse-Inbound') return 'Received New Stock';
    if (location === 'Warehouse-Transfer') return 'Moved Stock to Store';
    return location;
  };

  return (
    <div className="flex flex-col h-full">
      <h1 className="text-2xl font-light text-black mb-6">Sales & Activity History</h1>

      <div className="flex flex-col flex-1 pb-4">
        
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-4 mb-6 border-b border-gray-300 pb-0">
          <div className="flex gap-1 overflow-x-auto w-full xl:w-auto">
            <button onClick={() => handleFilterChange('ALL')} className={`h-10 px-6 text-sm uppercase tracking-wider focus:outline-none rounded-none ${filter === 'ALL' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>All Activity</button>
            <button onClick={() => handleFilterChange('SALE')} className={`h-10 px-6 text-sm uppercase tracking-wider focus:outline-none rounded-none ${filter === 'SALE' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Sales</button>
            <button onClick={() => handleFilterChange('RECEIVE')} className={`h-10 px-6 text-sm uppercase tracking-wider focus:outline-none rounded-none ${filter === 'RECEIVE' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Received Stock</button>
            <button onClick={() => handleFilterChange('TRANSFER')} className={`h-10 px-6 text-sm uppercase tracking-wider focus:outline-none rounded-none ${filter === 'TRANSFER' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Moved to Store</button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pb-2 w-full xl:w-auto">
            <span className="text-xs font-semibold uppercase text-gray-600 whitespace-nowrap">Date Filter:</span>
            <div className="relative shrink-0">
              <select value={dateFilter} onChange={(e) => { setDateFilter(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-9 border border-gray-400 bg-white pl-3 pr-8 text-sm focus:outline-none focus:border-[#0078D7] rounded-none cursor-pointer appearance-none shadow-sm">
                <option value="ALL">All Time</option>
                <option value="TODAY">Today</option>
                <option value="YESTERDAY">Yesterday</option>
                <option value="CUSTOM">Specific Date...</option>
                <option value="RANGE">Date Range...</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600">
                <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
              </div>
            </div>
            
            {dateFilter === 'CUSTOM' && (
              <input type="date" value={customDate} onChange={(e) => { setCustomDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-9 border border-gray-400 bg-white px-2 text-sm focus:outline-none focus:border-[#0078D7] rounded-none shadow-sm" />
            )}

            {dateFilter === 'RANGE' && (
              <div className="flex items-center gap-2 shrink-0">
                <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-9 border border-gray-400 bg-white px-2 text-sm focus:outline-none focus:border-[#0078D7] rounded-none shadow-sm" title="Start Date" />
                <span className="text-gray-500 font-bold text-xs uppercase">to</span>
                <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setSalesPage(0); setExpandedBillId(null); }} className="h-9 border border-gray-400 bg-white px-2 text-sm focus:outline-none focus:border-[#0078D7] rounded-none shadow-sm" title="End Date" />
              </div>
            )}
          </div>
        </div>
        
        <div className="border border-gray-400 bg-white flex-1 overflow-y-auto rounded-none shadow-sm min-h-[400px]">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead className="bg-[#f9f9f9] sticky top-0 border-b border-gray-400 z-10">
              <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                <th className="p-3 border-r border-gray-200 w-48">Date & Time</th>
                <th className="p-3 border-r border-gray-200 w-48">Action Taken</th>
                <th className="p-3 border-r border-gray-200 w-32 text-center">Operator</th>
                <th className="p-3 border-r border-gray-200 text-right w-32">Total (₹)</th>
                <th className="p-3 text-center w-16">Details</th>
              </tr>
            </thead>
            {/* ADDED border-b border-gray-300 HERE */}
            <tbody className="divide-y divide-gray-200 border-b border-gray-300">
              {isLoadingBills && bills.length === 0 ? (
                <tr><td colSpan="5" className="p-10 text-center"><Spinner className="w-8 h-8 text-[#0078D7] mx-auto" /></td></tr>
              ) : bills.length === 0 ? (
                <tr><td colSpan="5" className="p-8 text-center text-gray-500 text-sm font-semibold">No records found.</td></tr>
              ) : bills.map(bill => {
                const isExpanded = expandedBillId === bill.id;
                const items = billItemsCache[bill.id] || [];
                const isSale = bill.location === 'Store';

                return (
                  <Fragment key={bill.id}>
                    <tr onClick={() => toggleRow(bill)} className={`cursor-pointer transition-none group ${isExpanded ? 'bg-[#cce8ff]' : 'hover:bg-[#e6e6e6] bg-white'}`}>
                      <td className="p-3 border-r border-gray-200 text-sm text-black">{formatDateTime(bill.created_at)}</td>
                      <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{getOperationType(bill.location)}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-center text-gray-700 capitalize">{bill.cashier_name}</td>
                      <td className="p-3 border-r border-gray-200 text-right text-sm font-bold text-[#0078D7]">{isSale ? `₹${Number(bill.total_amount).toFixed(2)}` : '--'}</td>
                      <td className="p-3 text-center flex justify-center items-center h-full">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-5 h-5 text-gray-600 group-hover:text-[#0078D7] transition-transform duration-200 ${isExpanded ? 'rotate-180 text-[#0078D7]' : 'rotate-0'}`}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-[#f3f3f3] shadow-[inset_0_4px_6px_-4px_rgba(0,0,0,0.1)]">
                        <td colSpan="5" className="p-0 border-b-2 border-[#0078D7]">
                          {isLoadingItems ? (
                            <div className="p-6 flex justify-center"><Spinner className="w-6 h-6 text-[#0078D7]" /></div>
                          ) : (
                            <div className="p-6 px-8">
                              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-300 pb-2">Record #{bill.id.split('-')[0]} Details</p>
                              <table className="w-full text-left bg-white border border-gray-300 rounded-none shadow-sm">
                                <thead className="bg-[#e6e6e6] border-b border-gray-300">
                                  <tr className="text-xs font-semibold uppercase text-gray-700">
                                    <th className="px-4 py-2 border-r border-gray-300">Item Name</th><th className="px-4 py-2 border-r border-gray-300 text-center w-32">Qty</th>
                                    {isSale && (<><th className="px-4 py-2 border-r border-gray-300 text-right w-32">Unit Price</th><th className="px-4 py-2 text-right w-32">Total</th></>)}
                                  </tr>
                                </thead>
                                {/* ADDED border-b border-gray-300 HERE AS WELL */}
                                <tbody className="divide-y divide-gray-200 border-b border-gray-300">
                                  {items.map(item => (
                                    <tr key={item.id} className="hover:bg-[#f9f9f9]">
                                      <td className="px-4 py-2 border-r border-gray-200 text-sm font-medium text-black">{item.name}</td>
                                      <td className="px-4 py-2 border-r border-gray-200 text-sm text-center">{item.quantity} {item.unit}</td>
                                      {isSale && (<><td className="px-4 py-2 border-r border-gray-200 text-sm text-right">₹{Number(item.price_at_sale).toFixed(2)}</td><td className="px-4 py-2 text-sm text-right font-bold text-black">₹{(item.price_at_sale * item.quantity).toFixed(2)}</td></>)}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
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
        <div className="flex justify-between items-center bg-[#f3f3f3] p-3 border border-gray-400 mt-4 rounded-none shadow-sm">
          <button onClick={()=>setSalesPage(p=>Math.max(0,p-1))} disabled={salesPage===0} className="h-8 px-6 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none">Newer</button>
          <button onClick={()=>setSalesPage(p=>p+1)} disabled={!hasMoreBills} className="h-8 px-6 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none">Older</button>
        </div>
      </div>
    </div>
  );
}