import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import WorkerBilling from './WorkerBilling'; 
import { hashPassword } from './EntryFlow'; 
import { Spinner } from './App'; 

export default function OwnerDashboard({ inventory, refreshInventory, shopSettings, cashierName }) {
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('posOwnerActiveTab') || 'dashboard');
  const [warehouseSubTab, setWarehouseSubTab] = useState(() => sessionStorage.getItem('posOwnerWarehouseSubTab') || 'inventory'); 
  const [storeSubTab, setStoreSubTab] = useState(() => sessionStorage.getItem('posOwnerStoreSubTab') || 'inventory'); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 

  useEffect(() => { sessionStorage.setItem('posOwnerActiveTab', activeTab); }, [activeTab]);
  useEffect(() => { sessionStorage.setItem('posOwnerWarehouseSubTab', warehouseSubTab); }, [warehouseSubTab]);
  useEffect(() => { sessionStorage.setItem('posOwnerStoreSubTab', storeSubTab); }, [storeSubTab]);

  const [newItem, setNewItem] = useState({ name: '', price: '', cost_price: '', stock_warehouse: '', unit: 'PCS' });
  const [isSubmitting, setIsSubmitting] = useState(false); 
  const [editingBarcode, setEditingBarcode] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [workers, setWorkers] = useState([]);
  const [newWorker, setNewWorker] = useState({ name: '', password: '' });
  const [isAddingWorker, setIsAddingWorker] = useState(false);
  const [bills, setBills] = useState([]);
  const [isLoadingBills, setIsLoadingBills] = useState(false);
  const [salesPage, setSalesPage] = useState(0);
  const [hasMoreBills, setHasMoreBills] = useState(true);
  const SALES_PER_PAGE = 20;
  const [selectedBill, setSelectedBill] = useState(null);
  const [billItems, setBillItems] = useState([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'System Alert' });
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, message: '', title: 'Action Required', onConfirm: null });

  const [todaysTrueRevenue, setTodaysTrueRevenue] = useState(0);
  const [todaysGrossProfit, setTodaysGrossProfit] = useState(0); 
  
  const [inventorySearch, setInventorySearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc'); 
  const [invPage, setInvPage] = useState(0);
  const INV_PER_PAGE = 50;

  const showAlert = (message, title = 'System Alert') => setAlertConfig({ isOpen: true, message, title });
  const showConfirm = (message, onConfirmCallback, title = 'Action Required') => setConfirmConfig({ isOpen: true, message, title, onConfirm: onConfirmCallback });

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const paddedHours = hours.toString().padStart(2, '0');
    return `${datePart}, ${paddedHours}:${minutes} ${ampm}`;
  };

  useEffect(() => {
    if (activeTab === 'sales') fetchBills(salesPage);
    if (activeTab === 'dashboard') { fetchBills(salesPage); fetchDashboardStats(); }
    if (activeTab === 'staff') fetchWorkers();
    if (activeTab !== 'sales') setSelectedBill(null);
  }, [activeTab, salesPage]);

  const fetchDashboardStats = async () => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0); 
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    try {
      const { data: billsData } = await supabase.from('bills')
        .select('id, total_amount')
        .gte('created_at', startOfDay.toISOString())
        .lte('created_at', endOfDay.toISOString())
        .eq('location', 'Store'); 
        
      if (billsData) {
        setTodaysTrueRevenue(billsData.reduce((sum, bill) => sum + Number(bill.total_amount || 0), 0));
        const billIds = billsData.map(b => b.id);
        if (billIds.length > 0) {
          const { data: itemsData } = await supabase.from('bill_items').select('quantity, price_at_sale, cost_at_sale').in('bill_id', billIds);
          if (itemsData) setTodaysGrossProfit(itemsData.reduce((sum, item) => sum + ((Number(item.price_at_sale || 0) - Number(item.cost_at_sale || 0)) * Number(item.quantity || 0)), 0));
        } else {
          setTodaysGrossProfit(0);
        }
      }
    } catch (err) { console.error(err); }
  };

  const fetchBills = async (page) => {
    try {
      setIsLoadingBills(true);
      const from = page * SALES_PER_PAGE;
      const { data } = await supabase.from('bills').select('*').order('created_at', { ascending: false }).range(from, from + SALES_PER_PAGE - 1);
      if (data) { setBills(data); setHasMoreBills(data.length === SALES_PER_PAGE); }
    } finally { setIsLoadingBills(false); }
  };

  const handleBillClick = async (bill) => {
    setSelectedBill(bill); setIsLoadingItems(true);
    try {
      const { data } = await supabase.from('bill_items').select('*').eq('bill_id', bill.id);
      if (data) setBillItems(data);
    } finally { setIsLoadingItems(false); }
  };

  const fetchWorkers = async () => {
    const { data } = await supabase.from('workers').select('*').order('name', { ascending: true });
    if (data) setWorkers(data);
  };

  const handleAddWorker = async (e) => {
    e.preventDefault();
    if (!newWorker.name || !newWorker.password) return showAlert("Provide ID and PIN.", "Validation Error");
    try {
      setIsAddingWorker(true);
      const hashedPass = await hashPassword(newWorker.password); 
      await supabase.from('workers').insert([{ name: newWorker.name, password: hashedPass }]);
      setNewWorker({ name: '', password: '' }); fetchWorkers();
    } catch (e) { showAlert("Error saving personnel.", "System Error"); } finally { setIsAddingWorker(false); }
  };

  const handleDeleteWorker = (id) => {
    showConfirm("Revoke access for this operator?", async () => {
      await supabase.from('workers').delete().eq('id', id); fetchWorkers(); 
    });
  };

  const getNextBarcode = () => {
    if (inventory.length === 0) return '1001';
    const codes = inventory.map(i => parseInt(i.barcode, 10)).filter(c => !isNaN(c));
    return codes.length === 0 ? '1001' : (Math.max(...codes) + 1).toString();
  };

  const handleAddItem = async (e) => {
    e.preventDefault(); 
    const autoBarcode = getNextBarcode(); 
    if (!newItem.name || !newItem.price || !newItem.cost_price) return showAlert("Fill all mandatory fields.", "Validation Error");
    if (Number(newItem.cost_price) < 0 || Number(newItem.price) < 0) return showAlert("Values cannot be negative.", "Validation Error");
    try {
      setIsSubmitting(true);
      await supabase.from('inventory').insert([{ barcode: autoBarcode, name: newItem.name, cost_price: Number(newItem.cost_price), price: Number(newItem.price), stock_warehouse: Number(newItem.stock_warehouse || 0), stock_store: 0, unit: newItem.unit, is_active: true }]);
      setNewItem({ name: '', price: '', cost_price: '', stock_warehouse: '', unit: 'PCS' }); 
      refreshInventory(); 
    } catch (e) { showAlert("Error creating record.", "System Error"); } finally { setIsSubmitting(false); }
  };

  const handleSaveEdit = async () => {
    if (Number(editFormData.cost_price) < 0 || Number(editFormData.price) < 0) return showAlert("Values cannot be negative.", "Validation Error");
    try {
      await supabase.from('inventory').update({ name: editFormData.name, cost_price: Number(editFormData.cost_price), price: Number(editFormData.price), stock_warehouse: Number(editFormData.stock_warehouse), stock_store: Number(editFormData.stock_store), unit: editFormData.unit }).eq('barcode', editingBarcode);
      setEditingBarcode(null); refreshInventory(); 
    } catch (e) { showAlert("Error updating record.", "System Error"); }
  };

  const handleDeleteClick = (barcode) => {
    showConfirm("Archive this record? It will be removed from active views.", async () => {
      await supabase.from('inventory').update({ is_active: false }).eq('barcode', barcode); refreshInventory();
    });
  };

  const handleEditClick = (item) => { setEditingBarcode(item.barcode); setEditFormData({ ...item }); };

  const lowStoreCount = inventory.filter(i => (i.stock_store || 0) < 10).length;
  const lowWarehouseCount = inventory.filter(i => (i.stock_warehouse || 0) < 20).length;
  const totalInventoryValue = inventory.reduce((t, i) => t + (Number(i.cost_price || i.price * 0.7) * (Number(i.stock_warehouse || 0) + Number(i.stock_store || 0))), 0);
  const warehouseCapital = inventory.reduce((t, i) => t + (Number(i.cost_price || i.price * 0.7) * Number(i.stock_warehouse || 0)), 0);
  const storeCapital = inventory.reduce((t, i) => t + (Number(i.cost_price || i.price * 0.7) * Number(i.stock_store || 0)), 0);

  const processedInventory = [...inventory]
    .filter(i => (i.name || '').toLowerCase().includes(inventorySearch.toLowerCase()) || (i.barcode || '').toLowerCase().includes(inventorySearch.toLowerCase()))
    .sort((a, b) => {
      if(sortOption.includes('name')) return sortOption.includes('asc') ? (a.name||'').localeCompare(b.name||'') : (b.name||'').localeCompare(a.name||'');
      if(sortOption.includes('price')) return sortOption.includes('asc') ? Number(a.price||0) - Number(b.price||0) : Number(b.price||0) - Number(a.price||0);
      if(sortOption.includes('stock')) {
        const aStock = activeTab === 'warehouse' ? Number(a.stock_warehouse||0) : Number(a.stock_store||0);
        const bStock = activeTab === 'warehouse' ? Number(b.stock_warehouse||0) : Number(b.stock_store||0);
        return sortOption.includes('asc') ? aStock - bStock : bStock - aStock;
      }
      return sortOption.includes('asc') ? (a.barcode||'').localeCompare(b.barcode||'') : (b.barcode||'').localeCompare(a.barcode||'');
    });

  const maxPages = Math.max(1, Math.ceil(processedInventory.length / INV_PER_PAGE));
  const safeInvPage = Math.min(invPage, maxPages - 1);
  const paginatedInventory = processedInventory.slice(safeInvPage * INV_PER_PAGE, (safeInvPage + 1) * INV_PER_PAGE);

  return (
    <div className="flex flex-col md:flex-row bg-white border border-gray-400 h-full shadow-none rounded-none">
      
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] px-4">
          <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold text-black">{alertConfig.title}</span>
              <button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm text-black">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
              <button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">OK</button>
            </div>
          </div>
        </div>
      )}

      {confirmConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] px-4">
          <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold text-black">{confirmConfig.title}</span>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm text-black">{confirmConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => { if (confirmConfig.onConfirm) confirmConfig.onConfirm(); setConfirmConfig({ ...confirmConfig, isOpen: false }); }} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">Execute</button>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7] rounded-none">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="md:hidden flex justify-between items-center bg-[#f3f3f3] p-4 border-b border-gray-400">
        <span className="text-sm font-semibold uppercase text-gray-700 tracking-wider">Console Menu</span>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="border border-gray-400 bg-white px-4 py-1.5 text-sm focus:outline-none focus:border-[#0078D7] rounded-none">☰</button>
      </div>

      <aside className={`${isSidebarOpen ? 'block' : 'hidden'} md:block w-full md:w-[240px] bg-[#f3f3f3] border-b md:border-r border-gray-400 flex-shrink-0 pt-4`}>
        <div className="flex flex-col gap-1">
          <button onClick={() => {setActiveTab('dashboard'); setIsSidebarOpen(false);}} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'dashboard' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Dashboard</button>
          <button onClick={() => {setActiveTab('register'); setIsSidebarOpen(false);}} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'register' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Catalog</button>
          <button onClick={() => {setActiveTab('warehouse'); setIsSidebarOpen(false);}} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'warehouse' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Warehouse</button>
          <button onClick={() => {setActiveTab('store'); setIsSidebarOpen(false);}} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'store' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Store Floor</button>
          <button onClick={() => {setActiveTab('sales'); setIsSidebarOpen(false);}} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'sales' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Ledger</button>
          <button onClick={() => {setActiveTab('staff'); setIsSidebarOpen(false);}} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'staff' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Security</button>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-8 overflow-y-auto bg-white relative">
        
        {/* DASHBOARD */}
        {activeTab === 'dashboard' && (
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
        )}

        {/* CATALOG */}
        {activeTab === 'register' && (
          <div className="w-full">
            <h1 className="text-2xl font-light text-black mb-6">Catalog Management</h1>
            <div className="bg-[#f9f9f9] border border-gray-400 p-6 w-full rounded-none">
              <h2 className="text-sm font-semibold uppercase text-gray-600 mb-6 border-b border-gray-300 pb-2 tracking-wider">Registration Profile</h2>
              
              <form onSubmit={handleAddItem} className="flex flex-col lg:flex-row gap-4 items-end w-full">
                <div className="flex flex-col w-full lg:w-32 shrink-0">
                  <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">SKU Code</label>
                  <input type="text" value={getNextBarcode()} disabled className="border-2 border-gray-300 bg-[#e6e6e6] text-black px-3 py-1.5 text-sm rounded-none focus:outline-none" />
                </div>
                <div className="flex flex-col w-full lg:w-auto flex-1">
                  <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Nomenclature</label>
                  <input type="text" value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" />
                </div>
                <div className="flex flex-col w-full lg:w-28 shrink-0">
                  <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">UOM</label>
                  <div className="relative w-full">
                    <select value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} className="w-full border-2 border-gray-300 bg-white pl-3 pr-8 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer">
                      <option value="PCS">PCS</option><option value="GRAMS">GRAMS</option><option value="SQFT">SQFT</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600">
                      <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col w-full lg:w-28 shrink-0">
                  <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Cost (₹)</label>
                  <input type="number" step="0.01" min="0" value={newItem.cost_price} onChange={e=>setNewItem({...newItem,cost_price:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" />
                </div>
                <div className="flex flex-col w-full lg:w-28 shrink-0">
                  <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Retail (₹)</label>
                  <input type="number" step="0.01" min="0" value={newItem.price} onChange={e=>setNewItem({...newItem,price:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" />
                </div>
                <div className="flex flex-col w-full lg:w-24 shrink-0">
                  <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Init Qty</label>
                  <input type="number" step="any" min="0" value={newItem.stock_warehouse} onChange={e=>setNewItem({...newItem,stock_warehouse:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" />
                </div>
                <div className="w-full lg:w-32 shrink-0 mt-4 lg:mt-0">
                  <button type="submit" disabled={isSubmitting} className="bg-[#0078D7] hover:bg-[#005a9e] text-white px-4 h-[35px] text-sm font-semibold rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black w-full flex items-center justify-center">
                    {isSubmitting ? 'Wait...' : 'Commit'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* WAREHOUSE */}
        {activeTab === 'warehouse' && (
          <div className="flex flex-col h-full">
            <h1 className="text-2xl font-light text-black mb-6">Warehouse Operations</h1>
            <div className="flex gap-1 mb-6 border-b border-gray-300 pb-0">
              <button onClick={()=>setWarehouseSubTab('inventory')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${warehouseSubTab==='inventory'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Master List</button>
              <button onClick={()=>setWarehouseSubTab('receive')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${warehouseSubTab==='receive'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Receive Stock</button>
              <button onClick={()=>setWarehouseSubTab('transfer')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${warehouseSubTab==='transfer'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Transfer Stock</button>
            </div>
            
            {warehouseSubTab === 'inventory' && (
              <div className="flex flex-col flex-1 pb-4">
                <div className="flex flex-col md:flex-row gap-4 mb-4">
                  <input type="text" placeholder="Query Database..." value={inventorySearch} onChange={e=>{setInventorySearch(e.target.value); setInvPage(0);}} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm w-full md:w-[400px] rounded-none focus:outline-none focus:border-[#0078D7]" />
                  <div className="relative w-full md:w-auto">
                    <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="w-full border-2 border-gray-300 bg-white pl-3 pr-8 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer">
                      <option value="barcode-asc">SKU (Ascending)</option><option value="barcode-desc">SKU (Descending)</option>
                      <option value="name-asc">Name (A-Z)</option><option value="name-desc">Name (Z-A)</option>
                      <option value="stock-asc">Quantity (Low-High)</option><option value="stock-desc">Quantity (High-Low)</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600">
                      <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                    </div>
                  </div>
                </div>
                <div className="border border-gray-400 overflow-x-auto bg-white flex-1 min-h-[300px] rounded-none">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-400">
                      <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                        <th className="p-3 border-r border-gray-300 w-24">SKU</th>
                        <th className="p-3 border-r border-gray-300">Nomenclature</th>
                        <th className="p-3 border-r border-gray-300 text-center w-28">Cost</th>
                        <th className="p-3 border-r border-gray-300 text-center w-28">Retail</th>
                        <th className="p-3 border-r border-gray-300 text-center w-28">Whse Qty</th>
                        <th className="p-3 text-center w-40">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 border-b border-gray-400">
                      {paginatedInventory.length === 0 ? (
                        <tr><td colSpan="6" className="p-8 text-center text-gray-500 text-sm font-semibold">No items found matching the query.</td></tr>
                      ) : paginatedInventory.map(item => (
                        <tr key={item.id} className="hover:bg-[#f9f9f9] transition-none">
                          <td className="p-3 border-r border-gray-200 text-sm text-[#0078D7]">{item.barcode}</td>
                          {editingBarcode === item.barcode ? (
                            <>
                              <td className="p-1 border-r border-gray-200"><input type="text" value={editFormData.name} onChange={e=>setEditFormData({...editFormData,name:e.target.value})} className="border-2 border-gray-300 px-2 py-1.5 w-full text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                              <td className="p-1 border-r border-gray-200"><input type="number" step="0.01" min="0" value={editFormData.cost_price} onChange={e=>setEditFormData({...editFormData,cost_price:e.target.value})} className="border-2 border-gray-300 px-2 py-1.5 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                              <td className="p-1 border-r border-gray-200"><input type="number" step="0.01" min="0" value={editFormData.price} onChange={e=>setEditFormData({...editFormData,price:e.target.value})} className="border-2 border-gray-300 px-2 py-1.5 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                              <td className="p-1 border-r border-gray-200"><input type="number" step="any" min="0" value={editFormData.stock_warehouse} onChange={e=>setEditFormData({...editFormData,stock_warehouse:e.target.value})} className="border-2 border-gray-300 px-2 py-1.5 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                              <td className="p-2 flex gap-2 justify-center">
                                <button onClick={handleSaveEdit} className="bg-[#107c10] text-white px-3 py-1.5 text-xs font-semibold rounded-none focus:outline-none border border-transparent focus:border-black">Save</button>
                                <button onClick={()=>setEditingBarcode(null)} className="bg-[#e6e6e6] text-black px-3 py-1.5 text-xs font-semibold border border-gray-400 rounded-none focus:outline-none focus:border-[#0078D7]">Cancel</button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-3 border-r border-gray-200 text-sm text-black font-medium">{item.name}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-center">{Number(item.cost_price||0).toFixed(2)}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-center">{Number(item.price||0).toFixed(2)}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-center text-black font-bold">{item.stock_warehouse}</td>
                              <td className="p-2 flex gap-2 justify-center items-center h-full">
                                <button onClick={()=>handleEditClick(item)} className="bg-[#e6e6e6] hover:bg-[#cccccc] border border-gray-400 text-black px-4 py-1 text-xs font-semibold rounded-none focus:outline-none focus:border-[#0078D7]">Edit</button>
                                <button onClick={()=>handleDeleteClick(item.barcode)} className="bg-white border border-[#e81123] text-[#e81123] hover:bg-[#e81123] hover:text-white px-3 py-1 text-xs font-semibold rounded-none focus:outline-none">Archive</button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between items-center mt-4 bg-[#f3f3f3] p-3 border border-gray-400 rounded-none">
                  <button onClick={()=>setInvPage(p=>Math.max(0,p-1))} disabled={invPage===0} className="px-6 py-1.5 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none focus:border-[#0078D7]">Previous</button>
                  <span className="text-sm font-semibold text-gray-700">Page {safeInvPage + 1} of {maxPages}</span>
                  <button onClick={()=>setInvPage(p=>p+1)} disabled={(safeInvPage+1)*INV_PER_PAGE>=processedInventory.length} className="px-6 py-1.5 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none focus:border-[#0078D7]">Next</button>
                </div>
              </div>
            )}
            {warehouseSubTab === 'receive' && <div className="border border-gray-400 bg-white flex-1 mb-4 rounded-none"><WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Warehouse" defaultTab="receive" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
            {warehouseSubTab === 'transfer' && <div className="border border-gray-400 bg-white flex-1 mb-4 rounded-none"><WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Warehouse" defaultTab="transfer" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
          </div>
        )}

        {/* STORE */}
        {activeTab === 'store' && (
          <div className="flex flex-col h-full">
            <h1 className="text-2xl font-light text-black mb-6">Retail Operations</h1>
            <div className="flex gap-1 mb-6 border-b border-gray-300 pb-0">
              <button onClick={()=>setStoreSubTab('inventory')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${storeSubTab==='inventory'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Floor List</button>
              <button onClick={()=>setStoreSubTab('checkout')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${storeSubTab==='checkout'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>POS Terminal</button>
            </div>
            
            {storeSubTab === 'inventory' && (
              <div className="flex flex-col flex-1 pb-4">
                <div className="flex flex-col md:flex-row gap-4 mb-4">
                  <input type="text" placeholder="Query Floor Database..." value={inventorySearch} onChange={e=>{setInventorySearch(e.target.value); setInvPage(0);}} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm w-full md:w-[400px] rounded-none focus:outline-none focus:border-[#0078D7]" />
                  <div className="relative w-full md:w-auto">
                    <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="w-full border-2 border-gray-300 bg-white pl-3 pr-8 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer">
                      <option value="barcode-asc">SKU (Ascending)</option><option value="barcode-desc">SKU (Descending)</option>
                      <option value="name-asc">Name (A-Z)</option><option value="name-desc">Name (Z-A)</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600">
                      <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                    </div>
                  </div>
                </div>
                <div className="border border-gray-400 overflow-x-auto bg-white flex-1 min-h-[300px] rounded-none">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-400">
                      <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                        <th className="p-3 border-r border-gray-300 w-32">SKU Code</th>
                        <th className="p-3 border-r border-gray-300">Nomenclature</th>
                        <th className="p-3 border-r border-gray-300 text-center w-32">Retail Px</th>
                        <th className="p-3 text-center w-32">Floor Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 border-b border-gray-400">
                      {paginatedInventory.length === 0 ? (
                        <tr><td colSpan="4" className="p-8 text-center text-gray-500 text-sm font-semibold">No items found matching the query.</td></tr>
                      ) : paginatedInventory.map(item => (
                        <tr key={item.id} className="hover:bg-[#f9f9f9]">
                          <td className="p-3 border-r border-gray-200 text-sm font-mono text-[#0078D7]">{item.barcode}</td>
                          <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{item.name}</td>
                          <td className="p-3 border-r border-gray-200 text-sm text-center">{Number(item.price).toFixed(2)}</td>
                          <td className="p-3 text-sm text-center font-bold text-black">{item.stock_store}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between items-center mt-4 bg-[#f3f3f3] p-3 border border-gray-400 rounded-none">
                  <button onClick={()=>setInvPage(p=>Math.max(0,p-1))} disabled={invPage===0} className="px-6 py-1.5 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none focus:border-[#0078D7]">Previous</button>
                  <span className="text-sm font-semibold text-gray-700">Page {safeInvPage + 1} of {maxPages}</span>
                  <button onClick={()=>setInvPage(p=>p+1)} disabled={(safeInvPage+1)*INV_PER_PAGE>=processedInventory.length} className="px-6 py-1.5 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none focus:border-[#0078D7]">Next</button>
                </div>
              </div>
            )}
            {storeSubTab === 'checkout' && <div className="border border-gray-400 bg-white flex-1 mb-4 rounded-none"><WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Store" defaultTab="checkout" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
          </div>
        )}

        {/* LEDGER */}
        {activeTab === 'sales' && (
          <div className="flex flex-col h-full">
            <h1 className="text-2xl font-light text-black mb-6">Transaction Ledger</h1>
            {selectedBill ? (
              <div className="flex flex-col flex-1 pb-4">
                <div className="mb-4">
                  <button onClick={() => setSelectedBill(null)} className="text-sm font-semibold text-[#0078D7] hover:underline focus:outline-none">← Return to Master Ledger</button>
                </div>
                <div className="border border-gray-400 bg-[#f9f9f9] p-6 mb-6 flex justify-between items-center rounded-none">
                  <div>
                    <p className="font-light text-2xl mb-1">Record #{selectedBill.id.split('-')[0]}</p>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">Operator: {selectedBill.cashier_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Gross Value</p>
                    <p className="text-3xl font-light text-[#0078D7]">₹{Number(selectedBill.total_amount).toFixed(2)}</p>
                  </div>
                </div>
                {isLoadingItems ? <div className="p-10 flex justify-center"><Spinner className="w-8 h-8 text-[#0078D7]" /></div> : (
                  <div className="border border-gray-400 bg-white overflow-x-auto flex-1 min-h-[250px] rounded-none">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-400">
                        <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                          <th className="p-3 border-r border-gray-300">Nomenclature</th>
                          <th className="p-3 border-r border-gray-300 text-center w-24">Qty</th>
                          <th className="p-3 border-r border-gray-300 text-right w-32">Unit Rate</th>
                          <th className="p-3 text-right w-32">Line Net</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 border-b border-gray-400">
                        {billItems.map(item => (
                          <tr key={item.id} className="hover:bg-[#f9f9f9]">
                            <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{item.name}</td>
                            <td className="p-3 border-r border-gray-200 text-sm text-center">{item.quantity} {item.unit}</td>
                            <td className="p-3 border-r border-gray-200 text-sm text-right">₹{Number(item.price_at_sale).toFixed(2)}</td>
                            <td className="p-3 text-sm text-right font-bold text-black">₹{(item.price_at_sale*item.quantity).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col flex-1 pb-4">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm font-semibold uppercase tracking-wider text-gray-600">Recent Activity</span>
                  <button onClick={()=>fetchBills(salesPage)} className="border border-gray-400 bg-[#e6e6e6] hover:bg-[#cccccc] px-6 py-1.5 text-sm font-semibold rounded-none focus:outline-none focus:border-[#0078D7]">Refresh Data</button>
                </div>
                {isLoadingBills ? <div className="p-10 flex justify-center"><Spinner className="w-8 h-8 text-[#0078D7]" /></div> : (
                  <>
                    <div className="border border-gray-400 bg-white overflow-x-auto flex-1 min-h-[300px] rounded-none">
                      <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead className="bg-[#f3f3f3] sticky top-0 border-b border-gray-400">
                          <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                            <th className="p-3 border-r border-gray-300 w-64">Timestamp</th>
                            <th className="p-3 border-r border-gray-300">Operation Type</th>
                            <th className="p-3 text-right w-40">Gross Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 border-b border-gray-400">
                          {bills.length === 0 ? (
                            <tr><td colSpan="3" className="p-8 text-center text-gray-500 text-sm font-semibold">No transaction records found.</td></tr>
                          ) : bills.map(bill => (
                            <tr key={bill.id} onClick={()=>handleBillClick(bill)} className="hover:bg-[#cce8ff] cursor-pointer transition-none">
                              <td className="p-3 border-r border-gray-200 text-sm text-black">{formatDateTime(bill.created_at)}</td>
                              <td className="p-3 border-r border-gray-200 text-sm font-medium text-black">{bill.location==='Store'?'Point of Sale':'Inventory Move'}</td>
                              <td className="p-3 text-right text-sm font-bold text-[#0078D7]">₹{Number(bill.total_amount).toFixed(2)}</td>
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
        )}

        {/* SECURITY */}
        {activeTab === 'staff' && (
          <div className="animate-fade-in">
            <h1 className="text-2xl font-light text-black mb-6">Security & Access Control</h1>
            <div className="bg-[#f9f9f9] border border-gray-400 p-6 max-w-3xl mb-8 rounded-none">
              <h2 className="text-sm font-semibold uppercase text-gray-600 mb-6 border-b border-gray-300 pb-2 tracking-wider">Provision Terminal Operator</h2>
              <form onSubmit={handleAddWorker} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="flex flex-col"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Operator ID</label><input type="text" value={newWorker.name} onChange={e=>setNewWorker({...newWorker,name:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-2 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
                <div className="flex flex-col"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Auth PIN</label><input type="password" value={newWorker.password} onChange={e=>setNewWorker({...newWorker,password:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-2 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
                <button type="submit" disabled={isAddingWorker} className="bg-[#0078D7] hover:bg-[#005a9e] text-white py-2 text-sm font-semibold rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black">{isAddingWorker ? 'Wait...' : 'Grant Access'}</button>
              </form>
            </div>
            
            <div className="border border-gray-400 bg-white max-w-3xl overflow-x-auto rounded-none">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f3f3f3]">
                  <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600 border-b border-gray-400">
                    <th className="p-3 border-r border-gray-300">Operator ID</th>
                    <th className="p-3 border-r border-gray-300 text-center w-32">Auth State</th>
                    <th className="p-3 text-center w-32">Sys Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 border-b border-gray-400">
                  {workers.length === 0 ? (
                    <tr><td colSpan="3" className="p-6 text-center text-gray-500 text-sm font-semibold">No terminal operators provisioned.</td></tr>
                  ) : workers.map(w => (
                    <tr key={w.id} className="hover:bg-[#f9f9f9]">
                      <td className="p-3 border-r border-gray-200 text-sm text-black font-medium capitalize">{w.name}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-center text-gray-500 tracking-widest">••••</td>
                      <td className="p-2 text-center">
                        <button onClick={()=>handleDeleteWorker(w.id)} className="bg-white border border-[#e81123] text-[#e81123] hover:bg-[#e81123] hover:text-white px-4 py-1 text-xs font-semibold rounded-none focus:outline-none">Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}