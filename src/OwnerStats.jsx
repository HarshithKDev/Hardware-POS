import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function OwnerStats() {
  const [todaysTrueRevenue, setTodaysTrueRevenue] = useState(0);
  const [todaysGrossProfit, setTodaysGrossProfit] = useState(0); 
  const [lowStoreCount, setLowStoreCount] = useState(0);
  const [lowWarehouseCount, setLowWarehouseCount] = useState(0);
  const [totalInventoryValue, setTotalInventoryValue] = useState(0);
  const [warehouseCapital, setWarehouseCapital] = useState(0);
  const [storeCapital, setStoreCapital] = useState(0);

  useEffect(() => {
    const fetchDashboardStats = async () => {
      const now = new Date();
      const localDateStr = now.toLocaleDateString('en-CA'); 
      const start = `${localDateStr}T00:00:00`;
      const end = `${localDateStr}T23:59:59.999`;

      try {
        const { data: billsData } = await supabase.from('bills').select('id, total_amount').gte('created_at', start).lte('created_at', end).eq('location', 'Store'); 
        if (billsData) {
          const totalCents = billsData.reduce((sum, bill) => sum + Math.round(Number(bill.total_amount || 0) * 100), 0);
          setTodaysTrueRevenue(totalCents / 100);
          const billIds = billsData.map(b => b.id);
          if (billIds.length > 0) {
            const { data: itemsData } = await supabase.from('bill_items').select('quantity, price_at_sale, cost_at_sale').in('bill_id', billIds);
            if (itemsData) {
               const profitCents = itemsData.reduce((sum, item) => sum + ((Math.round(Number(item.price_at_sale || 0) * 100) - Math.round(Number(item.cost_at_sale || 0) * 100)) * Number(item.quantity || 0)), 0);
               setTodaysGrossProfit(profitCents / 100);
            }
          } else { setTodaysGrossProfit(0); }
        }

        let allStats = []; let p = 0;
        while(true) {
          const { data } = await supabase.from('inventory').select('price, cost_price, stock_warehouse, stock_store').eq('is_active', true).range(p * 1000, (p + 1) * 1000 - 1);
          if (!data || data.length === 0) break; allStats.push(...data); if (data.length < 1000) break; p++;
        }

        let lStore = 0, lWhse = 0, tValue = 0, wCap = 0, sCap = 0;
        allStats.forEach(i => {
          if (i.stock_store < 10) lStore++; if (i.stock_warehouse < 20) lWhse++;
          const c = Number(i.cost_price || i.price * 0.7); const wQty = Number(i.stock_warehouse || 0); const sQty = Number(i.stock_store || 0);
          tValue += c * (wQty + sQty); wCap += c * wQty; sCap += c * sQty;
        });

        setLowStoreCount(lStore); setLowWarehouseCount(lWhse); setTotalInventoryValue(tValue); setWarehouseCapital(wCap); setStoreCapital(sCap);
      } catch (err) { console.error(err); }
    };
    fetchDashboardStats();
  }, []);

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-light text-black mb-6">Executive Summary</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="border border-gray-400 bg-[#f9f9f9] p-5 border-l-4 border-l-[#107c10] rounded-none">
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Today Revenue</p>
          <p className="text-3xl font-light text-black">₹{todaysTrueRevenue.toFixed(2)}</p>
        </div>
        <div className="border border-gray-400 bg-[#f9f9f9] p-5 border-l-4 border-l-[#107c10] rounded-none">
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Today Profit</p>
          <p className="text-3xl font-light text-black">₹{todaysGrossProfit.toFixed(2)}</p>
        </div>
        <div className={`border border-gray-400 bg-[#f9f9f9] p-5 border-l-4 rounded-none ${lowStoreCount > 0 ? 'border-l-[#e81123]' : 'border-l-[#0078D7]'}`}>
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Floor Low Stock</p>
          <p className={`text-3xl font-light ${lowStoreCount > 0 ? 'text-[#e81123]' : 'text-black'}`}>{lowStoreCount}</p>
        </div>
        <div className={`border border-gray-400 bg-[#f9f9f9] p-5 border-l-4 rounded-none ${lowWarehouseCount > 0 ? 'border-l-[#e81123]' : 'border-l-[#0078D7]'}`}>
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Whse Low Stock</p>
          <p className={`text-3xl font-light ${lowWarehouseCount > 0 ? 'text-[#e81123]' : 'text-black'}`}>{lowWarehouseCount}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-gray-400 bg-white p-5 border-l-4 border-l-gray-500 rounded-none">
          <p className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-2">Total Asset Value</p>
          <p className="text-2xl font-light text-black">₹{totalInventoryValue.toFixed(2)}</p>
        </div>
        <div className="border border-gray-400 bg-white p-5 border-l-4 border-l-[#0078D7] rounded-none">
          <p className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-2">Warehouse Capital</p>
          <p className="text-2xl font-light text-black">₹{warehouseCapital.toFixed(2)}</p>
        </div>
        <div className="border border-gray-400 bg-white p-5 border-l-4 border-l-[#107c10] rounded-none">
          <p className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-2">Store Capital</p>
          <p className="text-2xl font-light text-black">₹{storeCapital.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}