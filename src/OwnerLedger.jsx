import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';

export default function OwnerLedger() {
  const [bills, setBills] = useState([]);
  const [isLoadingBills, setIsLoadingBills] = useState(false);
  const [salesPage, setSalesPage] = useState(0);
  const [hasMoreBills, setHasMoreBills] = useState(true);
  const [selectedBill, setSelectedBill] = useState(null);
  const [billItems, setBillItems] = useState([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const SALES_PER_PAGE = 20;

  useEffect(() => {
    const fetchBills = async (page) => {
      try {
        setIsLoadingBills(true);
        const from = page * SALES_PER_PAGE;
        const { data } = await supabase.from('bills').select('*').order('created_at', { ascending: false }).range(from, from + SALES_PER_PAGE - 1);
        if (data) { setBills(data); setHasMoreBills(data.length === SALES_PER_PAGE); }
      } finally { setIsLoadingBills(false); }
    };
    fetchBills(salesPage);
  }, [salesPage]);

  const handleBillClick = async (bill) => {
    setSelectedBill(bill); setIsLoadingItems(true);
    try {
      const { data } = await supabase.from('bill_items').select('*').eq('bill_id', bill.id);
      if (data) setBillItems(data);
    } finally { setIsLoadingItems(false); }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${datePart}, ${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
  };

  const getOperationType = (location) => {
    if (location === 'Store') return 'Sale (Checkout)';
    if (location === 'Warehouse-Inbound') return 'Received New Stock';
    if (location === 'Warehouse-Transfer') return 'Moved Stock to Store';
    return location;
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <h1 className="text-2xl font-light text-black mb-6">Sales & Activity History</h1>
      {selectedBill ? (
        <div className="flex flex-col flex-1 pb-4">
          <div className="mb-4"><button onClick={() => setSelectedBill(null)} className="text-sm font-semibold text-[#0078D7] hover:underline focus:outline-none">← Back to All History</button></div>
          <div className="border border-gray-400 bg-[#f9f9f9] p-6 mb-6 flex justify-between items-center rounded-none">
            <div><p className="font-light text-2xl mb-1">Bill #{selectedBill.id.split('-')[0]}</p><p className="text-xs font-semibold uppercase tracking-wider text-gray-600">Staff: {selectedBill.cashier_name}</p></div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">{selectedBill.location === 'Store' ? 'Total Bill' : 'Total Items'}</p>
              <p className="text-3xl font-light text-[#0078D7]">{selectedBill.location === 'Store' ? `₹${Number(selectedBill.total_amount).toFixed(2)}` : billItems.reduce((sum, item) => sum + Number(item.quantity), 0)}</p>
            </div>
          </div>
          {isLoadingItems ? <div className="p-10 flex justify-center"><Spinner className="w-8 h-8 text-[#0078D7]" /></div> : (
            <div className="border border-gray-400 bg-white overflow-x-auto flex-1 min-h-[250px] rounded-none">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-400">
                  <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                    <th className="p-3 border-r border-gray-300">Item Name</th>
                    <th className={`p-3 text-center ${selectedBill.location === 'Store' ? 'border-r border-gray-300 w-24' : 'w-32'}`}>Qty</th>
                    {selectedBill.location === 'Store' && (<><th className="p-3 border-r border-gray-300 text-right w-32">Price</th><th className="p-3 text-right w-32">Total</th></>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 border-b border-gray-400">
                  {billItems.map(item => (
                    <tr key={item.id} className="hover:bg-[#f9f9f9]">
                      <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{item.name}</td>
                      <td className={`p-3 text-sm text-center ${selectedBill.location === 'Store' ? 'border-r border-gray-200' : ''}`}>{item.quantity} {item.unit}</td>
                      {selectedBill.location === 'Store' && (<><td className="p-3 border-r border-gray-200 text-sm text-right">₹{Number(item.price_at_sale).toFixed(2)}</td><td className="p-3 text-sm text-right font-bold text-black">₹{(item.price_at_sale*item.quantity).toFixed(2)}</td></>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col flex-1 pb-4">
          <div className="flex justify-between items-center mb-4"><span className="text-sm font-semibold uppercase tracking-wider text-gray-600">Recent Activity</span></div>
          {isLoadingBills ? <div className="p-10 flex justify-center"><Spinner className="w-8 h-8 text-[#0078D7]" /></div> : (
            <>
              <div className="border border-gray-400 bg-white overflow-x-auto flex-1 min-h-[300px] rounded-none">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-400">
                    <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600"><th className="p-3 border-r border-gray-300 w-64">Date & Time</th><th className="p-3 border-r border-gray-300">Action Taken</th><th className="p-3 text-right w-40">Info</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 border-b border-gray-400">
                    {bills.length === 0 ? (<tr><td colSpan="3" className="p-8 text-center text-gray-500 text-sm font-semibold">No records found.</td></tr>) : bills.map(bill => (
                      <tr key={bill.id} onClick={()=>handleBillClick(bill)} className="hover:bg-[#cce8ff] cursor-pointer transition-none">
                        <td className="p-3 border-r border-gray-200 text-sm text-black">{formatDateTime(bill.created_at)}</td>
                        <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{getOperationType(bill.location)}</td>
                        <td className="p-3 text-right text-sm font-bold text-[#0078D7] hover:underline">View Details</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center bg-[#f3f3f3] p-3 border border-gray-400 mt-4 rounded-none">
                <button onClick={()=>setSalesPage(p=>Math.max(0,p-1))} disabled={salesPage===0} className="px-6 py-1.5 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none focus:border-[#0078D7]">Newer</button>
                <button onClick={()=>setSalesPage(p=>p+1)} disabled={!hasMoreBills} className="px-6 py-1.5 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none focus:border-[#0078D7]">Older</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}