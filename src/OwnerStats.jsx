import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

export default function OwnerStats({ isActive }) {
  const [todaysTrueRevenue, setTodaysTrueRevenue] = useState(0);
  const [todaysGrossProfit, setTodaysGrossProfit] = useState(0);
  const [todaysTotalCost, setTodaysTotalCost] = useState(0);
  const [todaysSalesDetails, setTodaysSalesDetails] = useState([]);

  const [lowStoreItems, setLowStoreItems] = useState([]);
  const [lowWarehouseItems, setLowWarehouseItems] = useState([]);
  const [totalInventoryValue, setTotalInventoryValue] = useState(0);
  const [warehouseCapital, setWarehouseCapital] = useState(0);
  const [storeCapital, setStoreCapital] = useState(0);

  const [deadStockItems, setDeadStockItems] = useState([]);
  const [deadStockValue, setDeadStockValue] = useState(0);
  const [weeklyTrend, setWeeklyTrend] = useState([]);
  const [topProducts, setTopProducts] = useState([]);

  const [activeModal, setActiveModal] = useState(null);

  // Wrap fetchDashboardStats in useCallback so we can safely list it as a dependency
  const fetchDashboardStats = useCallback(async () => {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const todayStart = `${todayStr}T00:00:00`;
    const todayEnd = `${todayStr}T23:59:59.999`;
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthStart = `${thirtyDaysAgo.toLocaleDateString('en-CA')}T00:00:00`;

    try {
      // --- Sales data ---
      const { data: billsData } = await supabase
        .from('bills')
        .select('id, total_amount, created_at')
        .gte('created_at', monthStart)
        .eq('location', 'Store');

      let soldNames30Days = new Set();
      let productStats30Days = {};
      let tempTrend = {};
      let maxRev = 0;

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateKey = d.toLocaleDateString('en-CA');
        tempTrend[dateKey] = { label: d.toLocaleDateString('en-US', { weekday: 'short' }), rev: 0 };
      }

      if (billsData && billsData.length > 0) {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const sevenDayStart = `${sevenDaysAgo.toLocaleDateString('en-CA')}T00:00:00`;

        billsData.forEach(bill => {
          if (bill.created_at >= sevenDayStart) {
            const billDate = bill.created_at.split('T')[0];
            if (tempTrend[billDate]) {
              tempTrend[billDate].rev += Number(bill.total_amount || 0);
              if (tempTrend[billDate].rev > maxRev) maxRev = tempTrend[billDate].rev;
            }
          }
        });

        const billIds = billsData.map(b => b.id);

        // Batch bill_items in parallel chunks of 100 instead of sequential while(true)
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
          let tProfitCents = 0;
          let tCostCents = 0;
          const todaySalesMap = {};
          const todayBillIds = new Set(
            billsData
              .filter(b => b.created_at >= todayStart && b.created_at <= todayEnd)
              .map(b => b.id)
          );

          itemsData.forEach(item => {
            soldNames30Days.add(item.name);
            const qty = Number(item.quantity || 0);
            const cost = Number(item.cost_at_sale || 0);
            const price = Number(item.price_at_sale || 0);
            const lineCost = cost * qty;
            const lineRev = price * qty;
            const lineProfit = lineRev - lineCost;

            if (productStats30Days[item.name]) {
              productStats30Days[item.name].profit += lineProfit;
              productStats30Days[item.name].qty += qty;
            } else {
              productStats30Days[item.name] = { name: item.name, profit: lineProfit, qty, unit: item.unit };
            }

            if (todayBillIds.has(item.bill_id)) {
              tProfitCents += Math.round(lineProfit * 100);
              tCostCents += Math.round(lineCost * 100);
              if (todaySalesMap[item.name]) {
                todaySalesMap[item.name].qty += qty;
                todaySalesMap[item.name].lineCost += lineCost;
                todaySalesMap[item.name].lineRev += lineRev;
                todaySalesMap[item.name].lineProfit += lineProfit;
              } else {
                todaySalesMap[item.name] = { name: item.name, unit: item.unit, qty, lineCost, lineRev, lineProfit };
              }
            }
          });

          const todayTotalRevCents = billsData
            .filter(b => todayBillIds.has(b.id))
            .reduce((sum, bill) => sum + Math.round(Number(bill.total_amount || 0) * 100), 0);

          setTodaysTrueRevenue(todayTotalRevCents / 100);
          setTodaysGrossProfit(tProfitCents / 100);
          setTodaysTotalCost(tCostCents / 100);
          setTodaysSalesDetails(Object.values(todaySalesMap).sort((a, b) => b.lineProfit - a.lineProfit));
          setTopProducts(Object.values(productStats30Days).sort((a, b) => b.profit - a.profit).slice(0, 5));
        }
      } else {
        setTodaysTrueRevenue(0);
        setTodaysGrossProfit(0);
        setTodaysTotalCost(0);
        setTodaysSalesDetails([]);
        setTopProducts([]);
      }

      setWeeklyTrend(
        Object.values(tempTrend).map(day => ({
          ...day,
          heightPct: maxRev === 0 ? 0 : (day.rev / maxRev) * 100,
        }))
      );

      // --- Inventory: use count + single paginated fetch instead of while(true) ---
      const { count: totalCount } = await supabase
        .from('inventory')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      const pageSize = 1000;
      const pageCount = Math.ceil((totalCount || 0) / pageSize);
      const invPages = await Promise.all(
        Array.from({ length: pageCount }, (_, i) =>
          supabase.from('inventory')
            .select('barcode, name, price, cost_price, stock_warehouse, stock_store')
            .eq('is_active', true)
            .range(i * pageSize, (i + 1) * pageSize - 1)
        )
      );
      const allStats = invPages.flatMap(r => r.data || []);

      let lStore = [], lWhse = [], deadItems = [];
      let tValue = 0, wCap = 0, sCap = 0, dValue = 0;

      allStats.forEach(item => {
        if (item.stock_store < 10) lStore.push(item);
        if (item.stock_warehouse < 20) lWhse.push(item);

        const c = Number(item.cost_price || item.price * 0.7);
        const wQty = Number(item.stock_warehouse || 0);
        const sQty = Number(item.stock_store || 0);
        const totalQty = wQty + sQty;

        tValue += c * totalQty;
        wCap += c * wQty;
        sCap += c * sQty;

        if (totalQty > 0 && !soldNames30Days.has(item.name)) {
          const itemDeadValue = c * totalQty;
          dValue += itemDeadValue;
          deadItems.push({ ...item, totalQty, deadValue: itemDeadValue });
        }
      });

      setLowStoreItems(lStore.sort((a, b) => a.name.localeCompare(b.name)));
      setLowWarehouseItems(lWhse.sort((a, b) => a.name.localeCompare(b.name)));
      setDeadStockItems(deadItems.sort((a, b) => b.deadValue - a.deadValue));
      setDeadStockValue(dValue);
      setTotalInventoryValue(tValue);
      setWarehouseCapital(wCap);
      setStoreCapital(sCap);

    } catch (err) {
      console.error('Dashboard stats error:', err);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchDashboardStats();
  }, [fetchDashboardStats]);

  // Re-fetch when the tab becomes active (parent toggles isActive)
  useEffect(() => {
    if (isActive) fetchDashboardStats();
  }, [isActive, fetchDashboardStats]);

  return (
    <div className="h-full relative pb-10">
      <h1 className="text-2xl font-light text-black mb-6">Business Overview</h1>

      {/* ROW 1: TODAY'S VITALS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="border border-gray-400 bg-[#f9f9f9] p-5 border-l-4 border-l-[#107c10] rounded-none shadow-sm">
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Today Revenue</p>
          <p className="text-3xl font-light text-black">₹{todaysTrueRevenue.toFixed(2)}</p>
        </div>

        <div onClick={() => setActiveModal('profit')} className="border border-gray-400 bg-white hover:bg-[#f3f3f3] cursor-pointer p-5 border-l-4 border-l-[#107c10] rounded-none shadow-sm relative group">
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Today Profit</p>
            <span className="text-[10px] uppercase font-bold text-[#0078D7] opacity-0 group-hover:opacity-100 transition-opacity">View Details ↗</span>
          </div>
          <p className="text-3xl font-light text-black">₹{todaysGrossProfit.toFixed(2)}</p>
        </div>

        <div onClick={() => setActiveModal('low-store')} className={`border border-gray-400 bg-white hover:bg-[#f3f3f3] cursor-pointer p-5 border-l-4 rounded-none shadow-sm relative group ${lowStoreItems.length > 0 ? 'border-l-[#e81123]' : 'border-l-[#0078D7]'}`}>
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">Shop Low Stock</p>
            <span className="text-[10px] uppercase font-bold text-[#0078D7] opacity-0 group-hover:opacity-100 transition-opacity">View Details ↗</span>
          </div>
          <p className={`text-3xl font-light ${lowStoreItems.length > 0 ? 'text-[#e81123]' : 'text-black'}`}>{lowStoreItems.length}</p>
        </div>

        <div onClick={() => setActiveModal('dead-stock')} className={`border border-gray-400 bg-white hover:bg-[#f3f3f3] cursor-pointer p-5 border-l-4 rounded-none shadow-sm relative group ${deadStockValue > 5000 ? 'border-l-[#e81123]' : 'border-l-[#d2691e]'}`}>
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2" title="Items with 0 sales in 30 days">Dead Stock Value</p>
            <span className="text-[10px] uppercase font-bold text-[#0078D7] opacity-0 group-hover:opacity-100 transition-opacity">View Items ↗</span>
          </div>
          <p className={`text-3xl font-light ${deadStockValue > 5000 ? 'text-[#e81123]' : 'text-[#d2691e]'}`}>₹{deadStockValue.toFixed(0)}</p>
        </div>
      </div>

      {/* ROW 2: TRENDS & LEADERBOARD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 border border-gray-400 bg-white p-5 rounded-none shadow-sm flex flex-col justify-between">
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-2">7-Day Sales Trend</p>
          <div className="flex items-end h-32 gap-3 mt-4 w-full px-2">
            {weeklyTrend.map(day => (
              <div key={day.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group cursor-crosshair">
                <div
                  className="w-full bg-[#cce8ff] relative rounded-t-sm group-hover:bg-[#0078D7] transition-colors"
                  style={{ height: `${day.heightPct}%`, minHeight: day.rev > 0 ? '4px' : '0px' }}
                >
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    ₹{day.rev.toFixed(0)}
                  </span>
                </div>
                <span className="text-[10px] font-bold text-gray-500 uppercase">{day.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-gray-400 bg-white p-5 rounded-none shadow-sm">
          <p className="text-xs font-semibold uppercase text-gray-600 tracking-wider mb-4 border-b border-gray-200 pb-2">Top 5 Profit Makers (30 Days)</p>
          <ul className="divide-y divide-gray-100">
            {topProducts.length === 0 ? (
              <li className="text-sm text-gray-400 py-4 text-center">Not enough data.</li>
            ) : topProducts.map((p, idx) => (
              <li key={p.name} className="py-2 flex justify-between items-center group">
                <div className="flex items-center gap-3 overflow-hidden pr-2">
                  <span className="text-xs font-bold text-gray-400 w-3">{idx + 1}.</span>
                  <span className="text-sm font-medium text-black truncate">{p.name}</span>
                </div>
                <span className="text-sm font-bold text-[#107c10] shrink-0">₹{p.profit.toFixed(0)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ROW 3: CAPITAL */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-gray-400 bg-white p-5 border-l-4 border-l-gray-500 rounded-none shadow-sm">
          <p className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-2">Total Asset Value</p>
          <p className="text-2xl font-light text-black">₹{totalInventoryValue.toFixed(2)}</p>
        </div>
        <div className="border border-gray-400 bg-white p-5 border-l-4 border-l-[#0078D7] rounded-none shadow-sm">
          <p className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-2">Warehouse Capital</p>
          <p className="text-2xl font-light text-black">₹{warehouseCapital.toFixed(2)}</p>
        </div>
        <div className="border border-gray-400 bg-white p-5 border-l-4 border-l-[#0078D7] rounded-none shadow-sm">
          <p className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-2">Store Capital</p>
          <p className="text-2xl font-light text-black">₹{storeCapital.toFixed(2)}</p>
        </div>
      </div>

      {/* MODALS */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] px-4">
          <div className="bg-white border border-gray-400 w-full max-w-4xl shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none max-h-[85vh]">
            <div className="bg-[#f3f3f3] flex justify-between items-center pr-1 pl-4 py-2 border-b border-gray-300 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-wider text-black">
                {activeModal === 'profit'     && "Today's Profit & Sales Breakdown"}
                {activeModal === 'low-store'  && 'Items Running Low in Store Front (< 10)'}
                {activeModal === 'dead-stock' && 'Dead Stock (0 Sales in Last 30 Days)'}
              </span>
              <button onClick={() => setActiveModal(null)} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 focus:outline-none rounded-none">✕</button>
            </div>

            <div className="overflow-y-auto flex-1 p-0 bg-white">
              {activeModal === 'profit' && (
                <div>
                  <div className="grid grid-cols-3 bg-[#e6f4ea] border-b border-gray-300 p-4">
                    <div className="text-center border-r border-[#107c10]/30">
                      <p className="text-xs font-bold uppercase text-gray-600 mb-1">Total Cost of Goods</p>
                      <p className="text-xl font-medium text-black">₹{todaysTotalCost.toFixed(2)}</p>
                    </div>
                    <div className="text-center border-r border-[#107c10]/30">
                      <p className="text-xs font-bold uppercase text-gray-600 mb-1">Total Sold For</p>
                      <p className="text-xl font-medium text-black">₹{todaysTrueRevenue.toFixed(2)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-bold uppercase text-[#107c10] mb-1">Net Profit Generated</p>
                      <p className="text-xl font-bold text-[#107c10]">₹{todaysGrossProfit.toFixed(2)}</p>
                    </div>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#f9f9f9] sticky top-0 border-b border-gray-300 shadow-sm">
                      <tr className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        <th className="p-3 border-r border-gray-200">Item Sold</th>
                        <th className="p-3 border-r border-gray-200 text-center">Total Qty</th>
                        <th className="p-3 border-r border-gray-200 text-right">Total Cost</th>
                        <th className="p-3 border-r border-gray-200 text-right">Total Sold For</th>
                        <th className="p-3 text-right">Profit Generated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {todaysSalesDetails.length === 0 ? (
                        <tr><td colSpan="5" className="p-8 text-center text-gray-500 text-sm font-semibold">No sales recorded today.</td></tr>
                      ) : todaysSalesDetails.map((item, idx) => (
                        <tr key={idx} className="hover:bg-[#f3f3f3]">
                          <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{item.name}</td>
                          <td className="p-3 border-r border-gray-200 text-sm text-center">{item.qty} {item.unit}</td>
                          <td className="p-3 border-r border-gray-200 text-sm text-right">₹{item.lineCost.toFixed(2)}</td>
                          <td className="p-3 border-r border-gray-200 text-sm text-right">₹{item.lineRev.toFixed(2)}</td>
                          <td className="p-3 text-sm text-right font-bold text-[#107c10]">₹{item.lineProfit.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(activeModal === 'low-store' || activeModal === 'dead-stock') && (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#f9f9f9] sticky top-0 border-b border-gray-300 shadow-sm">
                    <tr className="text-xs font-bold uppercase tracking-wider text-gray-500">
                      <th className="p-3 border-r border-gray-200 w-32">Barcode</th>
                      <th className="p-3 border-r border-gray-200">Item Name</th>
                      {activeModal === 'dead-stock' ? (
                        <>
                          <th className="p-3 border-r border-gray-200 text-center w-32">Locked Qty</th>
                          <th className="p-3 text-right w-32">Capital Tied Up</th>
                        </>
                      ) : (
                        <th className="p-3 text-center w-32">Current Qty</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {activeModal === 'low-store' && lowStoreItems.map(item => (
                      <tr key={item.barcode} className="hover:bg-[#f3f3f3]">
                        <td className="p-3 border-r border-gray-200 text-sm font-mono text-[#0078D7]">{item.barcode}</td>
                        <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{item.name}</td>
                        <td className="p-3 text-sm text-center font-bold text-[#e81123]">{item.stock_store}</td>
                      </tr>
                    ))}
                    {activeModal === 'dead-stock' && deadStockItems.length === 0 && (
                      <tr><td colSpan="4" className="p-8 text-center text-[#107c10] text-sm font-semibold">Great job! All your stock is active and moving.</td></tr>
                    )}
                    {activeModal === 'dead-stock' && deadStockItems.map(item => (
                      <tr key={item.barcode} className="hover:bg-[#f3f3f3]">
                        <td className="p-3 border-r border-gray-200 text-sm font-mono text-[#0078D7]">{item.barcode}</td>
                        <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{item.name}</td>
                        <td className="p-3 border-r border-gray-200 text-sm text-center font-bold text-[#d2691e]">{item.totalQty}</td>
                        <td className="p-3 text-sm text-right font-bold text-[#e81123]">₹{item.deadValue.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-3 bg-[#f3f3f3] border-t border-gray-300 flex justify-end shrink-0">
              <button onClick={() => setActiveModal(null)} className="h-9 px-8 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold rounded-none focus:outline-none">Close Window</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}