import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import WorkerBilling from './WorkerBilling'; 
import { hashPassword } from './EntryFlow'; 

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

  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'Notification' });
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, message: '', title: 'Confirm Action', onConfirm: null });

  const [todaysTrueRevenue, setTodaysTrueRevenue] = useState(0);
  const [todaysGrossProfit, setTodaysGrossProfit] = useState(0); 
  const [todaysTransactionCount, setTodaysTransactionCount] = useState(0); 
  
  const [inventorySearch, setInventorySearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc'); // Defaulted to Barcode Ascending
  const [invPage, setInvPage] = useState(0);
  const INV_PER_PAGE = 50;

  const showAlert = (message, title = 'Notification') => setAlertConfig({ isOpen: true, message, title });
  const showConfirm = (message, onConfirmCallback, title = 'Confirm') => setConfirmConfig({ isOpen: true, message, title, onConfirm: onConfirmCallback });

  useEffect(() => {
    if (activeTab === 'sales') fetchBills(salesPage);
    if (activeTab === 'dashboard') {
      fetchBills(salesPage);
      fetchDashboardStats();
    }
    if (activeTab === 'staff') fetchWorkers();
    if (activeTab !== 'sales') setSelectedBill(null);
  }, [activeTab, salesPage]);

  const fetchDashboardStats = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); 
    try {
      const { data: billsData, error: billsError } = await supabase.from('bills').select('id, total_amount').gte('created_at', today.toISOString()).eq('location', 'Store'); 
      if (!billsError && billsData) {
        const totalRev = billsData.reduce((sum, bill) => sum + Number(bill.total_amount), 0);
        setTodaysTrueRevenue(totalRev);
        setTodaysTransactionCount(billsData.length); 

        const billIds = billsData.map(b => b.id);
        if (billIds.length > 0) {
          const { data: itemsData, error: itemsError } = await supabase.from('bill_items').select('quantity, price_at_sale, cost_at_sale').in('bill_id', billIds);
          if (!itemsError && itemsData) {
            let profit = 0;
            itemsData.forEach(item => {
              profit += (Number(item.price_at_sale) - Number(item.cost_at_sale)) * Number(item.quantity);
            });
            setTodaysGrossProfit(profit);
          }
        }
      }
    } catch (err) { console.error("Error:", err.message); }
  };

  const fetchBills = async (page) => {
    try {
      setIsLoadingBills(true);
      const from = page * SALES_PER_PAGE;
      const to = from + SALES_PER_PAGE - 1;
      const { data, error } = await supabase.from('bills').select('*').order('created_at', { ascending: false }).range(from, to);
      if (error) throw error;
      if (data) { setBills(data); setHasMoreBills(data.length === SALES_PER_PAGE); }
    } catch (error) { console.error("Error:", error.message); } finally { setIsLoadingBills(false); }
  };

  const handleBillClick = async (bill) => {
    setSelectedBill(bill);
    setIsLoadingItems(true);
    try {
      const { data, error } = await supabase.from('bill_items').select('*').eq('bill_id', bill.id);
      if (error) throw error;
      if (data) setBillItems(data);
    } catch (error) { console.error("Error:", error.message); } finally { setIsLoadingItems(false); }
  };

  const fetchWorkers = async () => {
    try {
      const { data, error } = await supabase.from('workers').select('*').order('name', { ascending: true });
      if (!error && data) setWorkers(data);
    } catch (error) { console.error("Error:", error.message); }
  };

  const handleAddWorker = async (e) => {
    e.preventDefault();
    if (!newWorker.name || !newWorker.password) return showAlert("Provide name and password.", "Missing Info");
    try {
      setIsAddingWorker(true);
      const hashedPass = await hashPassword(newWorker.password); 
      const { error } = await supabase.from('workers').insert([{ name: newWorker.name, password: hashedPass }]);
      if (error) throw error;
      setNewWorker({ name: '', password: '' });
      fetchWorkers();
      showAlert("Worker added successfully.", "Success");
    } catch (error) { showAlert("Failed to add worker.", "Error"); } finally { setIsAddingWorker(false); }
  };

  const handleDeleteWorker = (id) => {
    showConfirm("Remove this worker's access?", async () => {
      try {
        const { error } = await supabase.from('workers').delete().eq('id', id);
        if (error) throw error;
        fetchWorkers();
        showAlert("Worker removed.", "Success");
      } catch (error) { showAlert("Failed to delete.", "Error"); }
    }, "Remove Staff");
  };

  const getNextBarcode = () => {
    if (inventory.length === 0) return '1001';
    const codes = inventory.map(item => parseInt(item.barcode, 10)).filter(code => !isNaN(code));
    const maxCode = Math.max(...codes);
    return (maxCode + 1).toString();
  };

  const handleAddItem = async (e) => {
    e.preventDefault(); 
    const autoBarcode = getNextBarcode(); 
    
    if (!newItem.name || !newItem.price || !newItem.cost_price) return showAlert("Fill in name, wholesale cost, and retail price.", "Validation Error");
    
    try {
      setIsSubmitting(true);
      const { error } = await supabase.from('inventory').insert([{ 
        barcode: autoBarcode, 
        name: newItem.name, 
        cost_price: Number(newItem.cost_price),
        price: Number(newItem.price), 
        stock_warehouse: Number(newItem.stock_warehouse || 0), 
        stock_store: 0, 
        unit: newItem.unit,
        is_active: true
      }]);
      if (error) throw error;
      setNewItem({ name: '', price: '', cost_price: '', stock_warehouse: '', unit: 'PCS' }); 
      refreshInventory(); 
      showAlert(`Product added successfully. Barcode: ${autoBarcode}`, "Success");
    } catch (error) { showAlert("Failed to save.", "Error"); } finally { setIsSubmitting(false); }
  };

  const handleSaveEdit = async () => {
    try {
      const { error } = await supabase.from('inventory').update({ 
        name: editFormData.name, 
        cost_price: Number(editFormData.cost_price),
        price: Number(editFormData.price), 
        stock_warehouse: Number(editFormData.stock_warehouse), 
        stock_store: Number(editFormData.stock_store), 
        unit: editFormData.unit 
      }).eq('barcode', editingBarcode);
      if (error) throw error;
      setEditingBarcode(null);
      refreshInventory(); 
      showAlert("Item updated successfully.", "Success");
    } catch (error) { showAlert("Failed to update.", "Error"); }
  };

  const handleDeleteClick = (barcode) => {
    showConfirm("WARNING: This will safely archive the item to preserve accounting history. Proceed?", async () => {
      try {
        const { error } = await supabase.from('inventory').update({ is_active: false }).eq('barcode', barcode);
        if (error) throw error;
        refreshInventory();
        showAlert("Item safely archived.", "Success");
      } catch (error) { showAlert("Failed to archive.", "Error"); }
    }, "Archive Item");
  };

  const lowStoreCount = inventory.filter(item => item.stock_store < 10).length;
  const lowWarehouseCount = inventory.filter(item => item.stock_warehouse < 20).length;

  const totalInventoryValue = inventory.reduce((total, item) => {
    return total + (Number(item.cost_price || item.price * 0.7) * (Number(item.stock_warehouse) + Number(item.stock_store)));
  }, 0);
  const warehouseCapital = inventory.reduce((total, item) => total + (Number(item.cost_price || item.price * 0.7) * Number(item.stock_warehouse)), 0);
  const storeCapital = inventory.reduce((total, item) => total + (Number(item.cost_price || item.price * 0.7) * Number(item.stock_store)), 0);

  const processedInventory = [...inventory]
    .filter(item => item.name.toLowerCase().includes(inventorySearch.toLowerCase()) || item.barcode.toLowerCase().includes(inventorySearch.toLowerCase()))
    .sort((a, b) => {
      switch (sortOption) {
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'price-asc': return Number(a.price) - Number(b.price);
        case 'price-desc': return Number(b.price) - Number(a.price);
        case 'stock-asc': return (activeTab === 'warehouse' ? Number(a.stock_warehouse || 0) - Number(b.stock_warehouse || 0) : Number(a.stock_store || 0) - Number(b.stock_store || 0));
        case 'stock-desc': return (activeTab === 'warehouse' ? Number(b.stock_warehouse || 0) - Number(a.stock_warehouse || 0) : Number(b.stock_store || 0) - Number(a.stock_store || 0));
        case 'barcode-desc': return b.barcode.localeCompare(a.barcode);
        case 'barcode-asc': default: return a.barcode.localeCompare(b.barcode);
      }
    });

  const paginatedInventory = processedInventory.slice(invPage * INV_PER_PAGE, (invPage + 1) * INV_PER_PAGE);

  const handleNavClick = (tab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false); 
  }

  return (
    <div className="min-h-screen bg-[#f3f3f3] flex flex-col md:flex-row text-black relative">
      
      {/* MODALS */}
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in px-4">
          <div className="bg-white border border-gray-400 w-full max-w-sm shadow-[4px_4px_0px_rgba(0,0,0,0.15)] rounded-none">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between items-center"><span className="text-sm font-semibold text-black px-1">{alertConfig.title}</span><button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="text-gray-500 hover:text-[#e81123] text-lg leading-none px-2 transition-colors">×</button></div>
            <div className="p-6"><p className="text-sm text-black">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end"><button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] transition-colors text-white text-sm rounded-none">OK</button></div>
          </div>
        </div>
      )}

      {confirmConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in px-4">
          <div className="bg-white border border-gray-400 w-full max-w-sm shadow-[4px_4px_0px_rgba(0,0,0,0.15)] rounded-none">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between items-center"><span className="text-sm font-semibold text-black px-1">{confirmConfig.title}</span><button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="text-gray-500 hover:text-[#e81123] text-lg leading-none px-2 transition-colors">×</button></div>
            <div className="p-6"><p className="text-sm text-black">{confirmConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end gap-3">
              <button onClick={() => { if (confirmConfig.onConfirm) confirmConfig.onConfirm(); setConfirmConfig({ ...confirmConfig, isOpen: false }); }} className="px-6 py-1.5 bg-[#e81123] hover:bg-[#b00d1a] transition-colors text-white text-sm rounded-none">Yes</button>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] transition-colors text-black border border-gray-400 text-sm rounded-none">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE HEADER */}
      <div className="md:hidden flex justify-between items-center bg-[#e6e6e6] p-4 border-b border-gray-400 z-20 sticky top-0">
        <h2 className="text-xl font-light text-black">Admin Panel</h2>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-2xl p-2 bg-[#cccccc] rounded-none border border-gray-400 flex items-center justify-center h-10 w-10">
          {isSidebarOpen ? '✕' : '☰'}
        </button>
      </div>

      <aside className={`${isSidebarOpen ? 'flex' : 'hidden'} md:flex w-full md:w-64 bg-[#e6e6e6] p-6 border-b md:border-r border-gray-400 flex-col h-auto md:h-screen sticky top-0 overflow-y-auto z-10`}>
        <h2 className="text-2xl font-light mb-8 text-black hidden md:block">Admin Panel</h2>
        <nav className="space-y-1">
          <button onClick={() => handleNavClick('dashboard')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'dashboard' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Dashboard Overview</button>
          <button onClick={() => handleNavClick('register')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'register' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Register New Product</button>
          <button onClick={() => handleNavClick('warehouse')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'warehouse' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Warehouse Management</button>
          <button onClick={() => handleNavClick('store')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'store' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Store Management</button>
          <button onClick={() => handleNavClick('sales')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'sales' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Recent Activity</button>
          <button onClick={() => handleNavClick('staff')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'staff' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Manage Staff</button>
        </nav>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen">
        
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
           <div className="animate-fade-in">
             <h1 className="text-3xl font-light text-black mb-8">Business Overview</h1>
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#107c10] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Today's Store Revenue</p>
                 <p className="text-3xl font-light text-[#107c10] mt-2">₹{todaysTrueRevenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
               
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#107c10] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Today's Gross Profit</p>
                 <p className="text-3xl font-light text-[#107c10] mt-2">₹{todaysGrossProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>

               <div className={`bg-white p-6 border border-gray-400 border-l-4 rounded-none shadow-sm flex flex-col justify-between ${lowStoreCount > 0 ? 'border-l-[#e81123]' : 'border-l-[#0078D7]'}`}>
                 <p className="text-xs text-gray-500 uppercase font-semibold">Low Store Stock</p>
                 <p className={`text-3xl font-light mt-2 ${lowStoreCount > 0 ? 'text-[#e81123]' : 'text-[#0078D7]'}`}>
                   {lowStoreCount > 0 ? `${lowStoreCount} Items` : 'Shelves Full'}
                 </p>
               </div>
               <div className={`bg-white p-6 border border-gray-400 border-l-4 rounded-none shadow-sm flex flex-col justify-between ${lowWarehouseCount > 0 ? 'border-l-[#e81123]' : 'border-l-[#0078D7]'}`}>
                 <p className="text-xs text-gray-500 uppercase font-semibold">Wholesaler Reorder Alert</p>
                 <p className={`text-3xl font-light mt-2 ${lowWarehouseCount > 0 ? 'text-[#e81123]' : 'text-[#0078D7]'}`}>
                   {lowWarehouseCount > 0 ? `${lowWarehouseCount} Items` : 'Stocked Up'}
                 </p>
               </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#605e5c] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">True Assets Value (Wholesale)</p>
                 <p className="text-2xl font-light text-black mt-2">₹{totalInventoryValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                 <p className="text-xs text-gray-500 mt-2">Across {inventory.length} active products</p>
               </div>
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#0078D7] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Capital in Warehouse (Cost)</p>
                 <p className="text-2xl font-light text-black mt-2">₹{warehouseCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#107c10] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Capital on Shelves (Cost)</p>
                 <p className="text-2xl font-light text-black mt-2">₹{storeCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
             </div>
           </div>
        )}

        {/* REGISTER NEW PRODUCT TAB */}
        {activeTab === 'register' && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-light text-black mb-8">Catalog Registration</h1>
            
            <div className="bg-white p-6 border border-gray-400 rounded-none mb-8 max-w-5xl">
              <h2 className="text-lg font-light text-black mb-4">Financial & Product Details</h2>
              <form onSubmit={handleAddItem} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                
                <div><label className="block text-sm text-gray-600 mb-1">Barcode</label><input type="text" value={getNextBarcode()} disabled className="w-full px-3 py-1.5 border border-gray-400 bg-gray-200 text-gray-500 focus:outline-none rounded-none text-sm cursor-not-allowed" /></div>
                <div className="md:col-span-2"><label className="block text-sm text-gray-600 mb-1">Item Name</label><input type="text" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                <div><label className="block text-sm text-gray-600 mb-1">Unit</label><select value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm bg-white"><option value="PCS">PCS</option><option value="GRAMS">GRAMS</option><option value="SQFT">SQFT</option></select></div>
                
                <div><label className="block text-sm text-gray-600 mb-1">Wholesale Cost (₹)</label><input type="number" step="0.01" value={newItem.cost_price} onChange={e => setNewItem({...newItem, cost_price: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                <div><label className="block text-sm text-gray-600 mb-1">Retail Price (₹)</label><input type="number" step="0.01" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                
                <div><label className="block text-sm text-gray-600 mb-1">Initial Whse Qty</label><input type="number" step="any" value={newItem.stock_warehouse} onChange={e => setNewItem({...newItem, stock_warehouse: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                
                <button type="submit" disabled={isSubmitting} className="w-full py-2 bg-[#0078D7] hover:bg-[#005a9e] transition-colors text-white rounded-none border border-[#005a9e] text-sm md:col-span-5 mt-4 font-medium h-8.5">Register Item</button>
              </form>
            </div>
          </div>
        )}

        {/* WAREHOUSE TAB */}
        {activeTab === 'warehouse' && (
          <div className="animate-fade-in flex flex-col h-full">
            <h1 className="text-3xl font-light text-black mb-6">Warehouse Management</h1>
            <div className="flex gap-2 mb-6 border-b border-gray-400 pb-4 overflow-x-auto whitespace-nowrap">
              <button onClick={() => setWarehouseSubTab('inventory')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${warehouseSubTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Inventory List</button>
              <button onClick={() => setWarehouseSubTab('receive')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${warehouseSubTab === 'receive' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Receive Inbound</button>
              <button onClick={() => setWarehouseSubTab('transfer')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${warehouseSubTab === 'transfer' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Move to Store</button>
            </div>

            {warehouseSubTab === 'inventory' && (
              <div className="animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
                  <input type="text" placeholder="Search by Name or Barcode..." value={inventorySearch} onChange={(e) => {setInventorySearch(e.target.value); setInvPage(0);}} className="w-full md:w-1/2 px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none" />
                  <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="w-full md:w-auto px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none bg-white cursor-pointer">
                    <option value="barcode-asc">Sort: Barcode (Ascending)</option>
                    <option value="barcode-desc">Sort: Barcode (Descending)</option>
                    <option value="name-asc">Sort: Name (A-Z)</option>
                    <option value="name-desc">Sort: Name (Z-A)</option>
                    <option value="price-asc">Sort: Price (Low to High)</option>
                    <option value="price-desc">Sort: Price (High to Low)</option>
                    <option value="stock-asc">Sort: Stock (Low to High)</option>
                    <option value="stock-desc">Sort: Stock (High to Low)</option>
                  </select>
                </div>

                <div className="bg-white border border-gray-400 rounded-none overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                        <th className="p-3 w-20">Code</th>
                        <th className="p-3">Item Name</th>
                        <th className="p-3 w-20 text-center">Cost</th>
                        <th className="p-3 w-20 text-center">Retail</th>
                        <th className="p-3 w-24 text-center">Whse</th>
                        <th className="p-3 w-32 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {paginatedInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-[#f0f0f0]">
                          <td className="p-3 border-r border-gray-200 text-sm font-medium text-[#0078D7]">{item.barcode}</td>
                          {editingBarcode === item.barcode ? (
                            <>
                              <td className="p-2 border-r border-gray-200"><input type="text" value={editFormData.name} onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} className="w-full px-1 py-1 border border-gray-400 text-sm rounded-none" /></td>
                              <td className="p-2 border-r border-gray-200"><input type="number" step="0.01" value={editFormData.cost_price} onChange={(e) => setEditFormData({...editFormData, cost_price: e.target.value})} className="w-full px-1 py-1 border border-gray-400 text-sm rounded-none" /></td>
                              <td className="p-2 border-r border-gray-200"><input type="number" step="0.01" value={editFormData.price} onChange={(e) => setEditFormData({...editFormData, price: e.target.value})} className="w-full px-1 py-1 border border-gray-400 text-sm rounded-none" /></td>
                              <td className="p-2 border-r border-gray-200"><input type="number" step="any" value={editFormData.stock_warehouse} onChange={(e) => setEditFormData({...editFormData, stock_warehouse: e.target.value})} className="w-full px-1 py-1 border border-gray-400 text-sm text-center rounded-none" /></td>
                              <td className="p-2 text-center flex justify-center">
                                <button onClick={handleSaveEdit} className="px-2 py-1 bg-[#107c10] text-white text-xs rounded-none">Save</button>
                                <button onClick={() => setEditingBarcode(null)} className="px-2 py-1 bg-[#e6e6e6] text-black border border-gray-400 text-xs rounded-none">Cancel</button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-gray-600 text-center">{Number(item.cost_price || 0).toFixed(2)}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-black text-center">{Number(item.price).toFixed(2)}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-black font-semibold text-center">{item.stock_warehouse || '0'}</td>
                              <td className="p-2 text-center flex gap-2 justify-center">
                                <button onClick={() => handleEditClick(item)} className="px-3 py-1 bg-[#e6e6e6] text-black border border-gray-400 text-xs rounded-none">Edit</button>
                                <button onClick={() => handleDeleteClick(item.barcode)} className="px-3 py-1 bg-transparent text-[#e81123] border border-[#e81123] text-xs rounded-none">Archive</button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Pagination Controls */}
                <div className="flex justify-between items-center mt-4">
                  <button onClick={() => setInvPage(p => Math.max(0, p - 1))} disabled={invPage === 0} className="px-4 py-1.5 bg-[#e6e6e6] text-black border border-gray-400 text-sm disabled:opacity-50 rounded-none">Previous</button>
                  <span className="text-sm text-gray-500">Page {invPage + 1} of {Math.max(1, Math.ceil(processedInventory.length / INV_PER_PAGE))}</span>
                  <button onClick={() => setInvPage(p => p + 1)} disabled={(invPage + 1) * INV_PER_PAGE >= processedInventory.length} className="px-4 py-1.5 bg-[#e6e6e6] text-black border border-gray-400 text-sm disabled:opacity-50 rounded-none">Next</button>
                </div>
              </div>
            )}
            {warehouseSubTab === 'receive' && <div className="flex-1 animate-fade-in"><WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Warehouse" defaultTab="receive" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
            {warehouseSubTab === 'transfer' && <div className="flex-1 animate-fade-in"><WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Warehouse" defaultTab="transfer" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
          </div>
        )}

        {/* STORE TAB */}
        {activeTab === 'store' && (
          <div className="animate-fade-in flex flex-col h-full">
            <h1 className="text-3xl font-light text-black mb-6">Store Management</h1>
            <div className="flex gap-2 mb-6 border-b border-gray-400 pb-4 overflow-x-auto whitespace-nowrap">
              <button onClick={() => setStoreSubTab('inventory')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${storeSubTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Inventory List</button>
              <button onClick={() => setStoreSubTab('checkout')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${storeSubTab === 'checkout' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Customer Checkout</button>
            </div>
            {storeSubTab === 'inventory' && (
              <div className="animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
                  <input type="text" placeholder="Search Store Shelves..." value={inventorySearch} onChange={(e) => {setInventorySearch(e.target.value); setInvPage(0);}} className="w-full md:w-1/2 px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none" />
                  <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="w-full md:w-auto px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none bg-white cursor-pointer">
                    <option value="barcode-asc">Sort: Barcode (Ascending)</option>
                    <option value="barcode-desc">Sort: Barcode (Descending)</option>
                    <option value="name-asc">Sort: Name (A-Z)</option>
                    <option value="name-desc">Sort: Name (Z-A)</option>
                    <option value="price-asc">Sort: Price (Low to High)</option>
                    <option value="price-desc">Sort: Price (High to Low)</option>
                    <option value="stock-asc">Sort: Stock (Low to High)</option>
                    <option value="stock-desc">Sort: Stock (High to Low)</option>
                  </select>
                </div>
                <div className="bg-white border border-gray-400 rounded-none overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                        <th className="p-3 w-24">Barcode</th>
                        <th className="p-3">Item Name</th>
                        <th className="p-3 w-24 text-center">Price (₹)</th>
                        <th className="p-3 w-32 text-center">Store Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {paginatedInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-[#f0f0f0]">
                          <td className="p-3 text-sm font-medium text-[#0078D7]">{item.barcode}</td>
                          <td className="p-3 text-sm text-black">{item.name}</td>
                          <td className="p-3 text-sm text-center text-black">{Number(item.price).toFixed(2)}</td>
                          <td className="p-3 text-sm text-center font-bold text-black">{item.stock_store || '0'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                 <div className="flex justify-between items-center mt-4">
                  <button onClick={() => setInvPage(p => Math.max(0, p - 1))} disabled={invPage === 0} className="px-4 py-1.5 bg-[#e6e6e6] text-black border border-gray-400 text-sm disabled:opacity-50 rounded-none">Previous</button>
                  <button onClick={() => setInvPage(p => p + 1)} disabled={(invPage + 1) * INV_PER_PAGE >= processedInventory.length} className="px-4 py-1.5 bg-[#e6e6e6] text-black border border-gray-400 text-sm disabled:opacity-50 rounded-none">Next</button>
                </div>
              </div>
            )}
            {storeSubTab === 'checkout' && <div className="flex-1 animate-fade-in"><WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Store" defaultTab="checkout" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
          </div>
        )}

        {/* ACTIVITY LEDGER */}
        {activeTab === 'sales' && (
          <div className="animate-fade-in">
             {selectedBill ? (
              <div>
                <button onClick={() => setSelectedBill(null)} className="text-sm text-[#0078D7] hover:underline mb-4 flex items-center">Back to Ledger</button>
                <div className="flex justify-between items-end mb-6">
                  <div>
                    <h2 className="text-2xl font-light text-black">Action ID #{selectedBill.id.split('-')[0]}</h2>
                    <p className="text-sm font-semibold text-black mt-1">Processed By: <span className="capitalize">{selectedBill.cashier_name || 'System'}</span></p>
                  </div>
                  <p className="text-2xl font-light text-[#0078D7]">Value: ₹{Number(selectedBill.total_amount).toFixed(2)}</p>
                </div>
                
                {isLoadingItems ? <p className="text-sm text-gray-500">Loading items...</p> : (
                  <div className="bg-white border border-gray-400 rounded-none overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead>
                        <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                          <th className="p-3 border-r border-gray-300">Item Name</th>
                          <th className="p-3 border-r border-gray-300 w-20 text-center">Qty</th>
                          <th className="p-3 border-r border-gray-300 text-right">Unit Price</th>
                          <th className="p-3 text-right">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {billItems.map(item => (
                          <tr key={item.id} className="hover:bg-[#f0f0f0]">
                            <td className="p-3 border-r border-gray-200 text-sm">{item.name} <span className="text-gray-400 text-xs block">#{item.barcode}</span></td>
                            <td className="p-3 border-r border-gray-200 text-sm text-center">{item.quantity} {item.unit}</td>
                            <td className="p-3 border-r border-gray-200 text-sm text-right">₹{Number(item.price_at_sale).toFixed(2)}</td>
                            <td className="p-3 text-sm text-right font-semibold">₹{(item.price_at_sale * item.quantity).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
             <div>
               <div className="flex justify-between items-center mb-8">
                 <h1 className="text-3xl font-light text-black">Recent Activity</h1>
                 <button onClick={() => fetchBills(salesPage)} className="px-4 py-1.5 bg-[#e6e6e6] border border-gray-400 text-sm rounded-none">Refresh Data</button>
               </div>
               
               {isLoadingBills ? (<p className="text-sm text-gray-500">Loading...</p>) : (
               <>
                 <div className="bg-white border border-gray-400 rounded-none overflow-x-auto mb-4">
                   <table className="w-full text-left border-collapse min-w-[600px]">
                     <thead>
                       <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                         <th className="p-3 w-48">Date & Time</th>
                         <th className="p-3">Action Type</th>
                         <th className="p-3">Value (₹)</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-200">
                       {bills.map((bill) => (
                         <tr key={bill.id} onClick={() => handleBillClick(bill)} className="hover:bg-[#d0e6f5] cursor-pointer">
                           <td className="p-3 text-sm text-gray-600">
                             {new Date(bill.created_at).toLocaleString()}
                             <span className="block text-xs font-semibold text-gray-400 mt-1 capitalize">By: {bill.cashier_name || 'System'}</span>
                           </td>
                           <td className="p-3 text-sm font-semibold text-black">{bill.location === 'Store' ? 'Customer Sale' : 'Inventory Move'}</td>
                           <td className="p-3 text-sm font-semibold text-[#0078D7]">₹{Number(bill.total_amount).toFixed(2)}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
                 <div className="flex justify-between items-center">
                    <button onClick={() => setSalesPage(p => Math.max(0, p - 1))} disabled={salesPage === 0} className="px-4 py-2 bg-[#e6e6e6] border border-gray-400 text-sm rounded-none disabled:opacity-50">← Newer</button>
                    <button onClick={() => setSalesPage(p => p + 1)} disabled={!hasMoreBills} className="px-4 py-2 bg-[#e6e6e6] border border-gray-400 text-sm rounded-none disabled:opacity-50">Older →</button>
                 </div>
               </>
               )}
             </div>
            )}
          </div>
        )}

        {/* STAFF TAB */}
        {activeTab === 'staff' && (
           <div className="animate-fade-in">
             <h1 className="text-3xl font-light text-black mb-8">Staff Management</h1>
             <div className="bg-white p-6 border border-gray-400 rounded-none mb-8 max-w-2xl">
               <h2 className="text-lg font-light text-black mb-4">Register New Cashier</h2>
               <form onSubmit={handleAddWorker} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                 <div>
                   <label className="block text-sm text-gray-600 mb-1">Worker Name</label>
                   <input type="text" value={newWorker.name} onChange={e => setNewWorker({...newWorker, name: e.target.value})} placeholder="e.g. Suresh" className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" />
                 </div>
                 <div>
                   <label className="block text-sm text-gray-600 mb-1">Login PIN</label>
                   <input type="password" value={newWorker.password} onChange={e => setNewWorker({...newWorker, password: e.target.value})} placeholder="Enter 4-digit PIN" className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" />
                 </div>
                 <button type="submit" disabled={isAddingWorker} className="w-full py-1.5 bg-[#0078D7] text-white rounded-none border border-[#005a9e] text-sm h-8.5 disabled:opacity-50">Add Worker</button>
               </form>
             </div>
             <div className="bg-white border border-gray-400 rounded-none overflow-x-auto max-w-2xl">
               <table className="w-full text-left border-collapse min-w-[400px]">
                 <thead>
                   <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                     <th className="p-3">Name</th>
                     <th className="p-3 text-center">Password</th>
                     <th className="p-3 text-center w-32">Actions</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-200">
                   {workers.map((worker) => (
                     <tr key={worker.id} className="hover:bg-[#f0f0f0]">
                       <td className="p-3 text-sm text-black capitalize">{worker.name}</td>
                       <td className="p-3 text-sm text-gray-400 text-center tracking-widest">••••••••</td>
                       <td className="p-2 text-center"><button onClick={() => handleDeleteWorker(worker.id)} className="px-3 py-1 bg-transparent text-[#e81123] border border-[#e81123] hover:bg-[#e81123] hover:text-white transition-colors text-xs rounded-none">Remove</button></td>
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