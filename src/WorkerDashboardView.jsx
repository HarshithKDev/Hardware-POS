import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function WorkerDashboardView() {
  const [inventorySearch, setInventorySearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc');
  const [invPage, setInvPage] = useState(0);
  const [paginatedInventory, setPaginatedInventory] = useState([]);
  const [totalInvItems, setTotalInvItems] = useState(0);
  const [lowStockCounts, setLowStockCounts] = useState({ store: 0, warehouse: 0 });
  const INV_PER_PAGE = 50;

  useEffect(() => {
    const fetchLowStockCounts = async () => {
      try {
        const { count: storeCount } = await supabase.from('inventory').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('stock_store', 10);
        const { count: whseCount } = await supabase.from('inventory').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('stock_warehouse', 20);
        setLowStockCounts({ store: storeCount || 0, warehouse: whseCount || 0 });
      } catch (err) { console.error(err); }
    };
    
    const loadInventory = async () => {
      const from = invPage * INV_PER_PAGE;
      let query = supabase.from('inventory').select('*', { count: 'exact' }).eq('is_active', true);
      if (inventorySearch.trim() !== '') query = query.or(`name.ilike.%${inventorySearch}%,barcode.ilike.%${inventorySearch}%`);
      
      if (sortOption === 'low-store') query = query.lt('stock_store', 10).order('stock_store', { ascending: true });
      else if (sortOption === 'low-warehouse') query = query.lt('stock_warehouse', 20).order('stock_warehouse', { ascending: true });
      else if (sortOption === 'name-asc') query = query.order('name', { ascending: true });
      else if (sortOption === 'barcode-asc') query = query.order('barcode', { ascending: true });

      const { data, count } = await query.range(from, from + INV_PER_PAGE - 1);
      if (data) { setPaginatedInventory(data); setTotalInvItems(count || 0); }
    };

    loadInventory(); fetchLowStockCounts();
  }, [invPage, inventorySearch, sortOption]);

  const maxPages = Math.max(1, Math.ceil(totalInvItems / INV_PER_PAGE));
  const safeInvPage = Math.min(invPage, maxPages - 1);

  return (
    <div className="flex flex-col h-full bg-white border border-gray-400 rounded-none p-6 animate-fade-in flex-1">
      <h2 className="text-2xl font-light text-black mb-6">Staff Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className={`border border-gray-400 bg-[#f9f9f9] p-5 border-l-4 rounded-none ${lowStockCounts.store > 0 ? 'border-l-[#e81123]' : 'border-l-[#0078D7]'}`}>
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Low Store Stock Alerts</p>
          <p className={`text-3xl font-light ${lowStockCounts.store > 0 ? 'text-[#e81123]' : 'text-black'}`}>{lowStockCounts.store} Items</p>
        </div>
        <div className={`border border-gray-400 bg-[#f9f9f9] p-5 border-l-4 rounded-none ${lowStockCounts.warehouse > 0 ? 'border-l-[#e81123]' : 'border-l-[#0078D7]'}`}>
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Low Warehouse Stock Alerts</p>
          <p className={`text-3xl font-light ${lowStockCounts.warehouse > 0 ? 'text-[#e81123]' : 'text-black'}`}>{lowStockCounts.warehouse} Items</p>
        </div>
      </div>
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <input type="text" placeholder="Search Barcode or Name..." value={inventorySearch} onChange={e=>{setInventorySearch(e.target.value); setInvPage(0);}} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm w-full md:w-[400px] rounded-none focus:outline-none focus:border-[#0078D7]" />
        <select value={sortOption} onChange={(e) => {setSortOption(e.target.value); setInvPage(0);}} className="w-full md:w-auto border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7] cursor-pointer">
            <option value="barcode-asc">Barcode (Low to High)</option><option value="name-asc">Item Name (A-Z)</option>
            <option value="low-store">Low Store Stock (&lt; 10)</option><option value="low-warehouse">Low Whse Stock (&lt; 20)</option>
        </select>
      </div>
      <div className="border border-gray-400 overflow-x-auto bg-white flex-1 min-h-[300px] rounded-none">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-400">
            <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              <th className="p-3 border-r border-gray-300 w-32">Barcode</th><th className="p-3 border-r border-gray-300">Product Name</th>
              <th className="p-3 border-r border-gray-300 text-center w-32">MRP</th><th className="p-3 border-r border-gray-300 text-center w-32">Store Qty</th>
              <th className="p-3 text-center w-32">Whse Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 border-b border-gray-400">
            {paginatedInventory.length === 0 ? (
              <tr><td colSpan="5" className="p-8 text-center text-gray-500 text-sm font-semibold">No items found.</td></tr>
            ) : paginatedInventory.map(item => (
              <tr key={item.id} className="hover:bg-[#f9f9f9]">
                <td className="p-3 border-r border-gray-200 text-sm font-semibold tracking-wider text-[#0078D7]">{item.barcode}</td>
                <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{item.name}</td>
                <td className="p-3 border-r border-gray-200 text-sm text-center">₹{Number(item.price).toFixed(2)}</td>
                <td className={`p-3 border-r border-gray-200 text-sm text-center font-bold ${item.stock_store < 10 ? 'text-[#e81123]' : 'text-black'}`}>{item.stock_store}</td>
                <td className={`p-3 text-sm text-center font-bold ${item.stock_warehouse < 20 ? 'text-[#e81123]' : 'text-black'}`}>{item.stock_warehouse}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between items-center mt-4 bg-[#f3f3f3] p-3 border border-gray-400 rounded-none">
        <button onClick={()=>setInvPage(p=>Math.max(0,p-1))} disabled={invPage===0} className="px-6 py-1.5 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none focus:border-[#0078D7]">Previous</button>
        <span className="text-sm font-semibold text-gray-700">Page {safeInvPage + 1} of {maxPages}</span>
        <button onClick={()=>setInvPage(p=>p+1)} disabled={(safeInvPage+1)*INV_PER_PAGE>=totalInvItems} className="px-6 py-1.5 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none focus:border-[#0078D7]">Next</button>
      </div>
    </div>
  );
}