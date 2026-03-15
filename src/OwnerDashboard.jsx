import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import WorkerBilling from './WorkerBilling'; 

export default function OwnerDashboard({ inventory, refreshInventory, shopSettings }) {
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('posOwnerActiveTab') || 'dashboard');
  
  const [warehouseSubTab, setWarehouseSubTab] = useState(() => sessionStorage.getItem('posOwnerWarehouseSubTab') || 'inventory'); 
  const [storeSubTab, setStoreSubTab] = useState(() => sessionStorage.getItem('posOwnerStoreSubTab') || 'inventory'); 

  useEffect(() => { sessionStorage.setItem('posOwnerActiveTab', activeTab); }, [activeTab]);
  useEffect(() => { sessionStorage.setItem('posOwnerWarehouseSubTab', warehouseSubTab); }, [warehouseSubTab]);
  useEffect(() => { sessionStorage.setItem('posOwnerStoreSubTab', storeSubTab); }, [storeSubTab]);

  const [newItem, setNewItem] = useState({ name: '', price: '', stock_warehouse: '', unit: 'PCS' });
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
  const [todaysTransactionCount, setTodaysTransactionCount] = useState(0); 
  const [inventorySearch, setInventorySearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc');

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
      const { data, error } = await supabase.from('bills').select('total_amount').gte('created_at', today.toISOString()).eq('location', 'Store'); 
      if (!error && data) {
        const total = data.reduce((sum, bill) => sum + Number(bill.total_amount), 0);
        setTodaysTrueRevenue(total);
        setTodaysTransactionCount(data.length); 
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
      if (error) throw error;
      if (data) setWorkers(data);
    } catch (error) { console.error("Error:", error.message); }
  };

  const handleAddWorker = async (e) => {
    e.preventDefault();
    if (!newWorker.name || !newWorker.password) return showAlert("Provide name and password.", "Missing Info");
    try {
      setIsAddingWorker(true);
      const { error } = await supabase.from('workers').insert([{ name: newWorker.name, password: newWorker.password }]);
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
    const codes = inventory
      .map(item => parseInt(item.barcode, 10))
      .filter(code => !isNaN(code))
      .sort((a, b) => a - b);
    
    let nextCode = 1001; 
    for (let i = 0; i < codes.length; i++) {
      if (codes[i] === nextCode) {
        nextCode++;
      } else if (codes[i] > nextCode) {
        break; 
      }
    }
    return nextCode.toString();
  };

  const handleAddItem = async (e) => {
    e.preventDefault(); 
    const autoBarcode = getNextBarcode(); 
    
    if (!newItem.name || !newItem.price) return showAlert("Fill in name and price.", "Validation Error");
    if (inventory.some(item => item.barcode === autoBarcode)) return showAlert(`System Error: Barcode ${autoBarcode} is already in use.`, "Duplicate Barcode");
    
    try {
      setIsSubmitting(true);
      const { error } = await supabase.from('inventory').insert([{ 
        barcode: autoBarcode, 
        name: newItem.name, 
        price: Number(newItem.price), 
        stock_warehouse: Number(newItem.stock_warehouse || 0), 
        stock_store: 0, 
        unit: newItem.unit 
      }]);
      if (error) throw error;
      setNewItem({ name: '', price: '', stock_warehouse: '', unit: 'PCS' }); 
      refreshInventory(); 
      showAlert(`Product successfully added to the warehouse. Assigned Barcode: ${autoBarcode}`, "Success");
    } catch (error) { showAlert("Failed to save.", "Error"); } finally { setIsSubmitting(false); }
  };

  const handleEditClick = (item) => {
    setEditingBarcode(item.barcode);
    setEditFormData({ ...item });
  };

  const handleSaveEdit = async () => {
    try {
      const { error } = await supabase.from('inventory').update({ 
        name: editFormData.name, 
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
    showConfirm("WARNING: Deleting this item will permanently remove it from the system. This may cause past receipts containing this item to display blank spaces. Are you absolutely sure you want to delete this instead of just setting the stock to 0?", async () => {
      try {
        const { error } = await supabase.from('inventory').delete().eq('barcode', barcode);
        if (error) throw error;
        refreshInventory();
        showAlert("Item deleted.", "Success");
      } catch (error) { showAlert("Failed to delete.", "Error"); }
    }, "Critical Warning");
  };

  const lowStoreCount = inventory.filter(item => item.stock_store < 10).length;
  const lowWarehouseCount = inventory.filter(item => item.stock_warehouse < 20).length;

  const totalInventoryValue = inventory.reduce((total, item) => {
    return total + (Number(item.price) * (Number(item.stock_warehouse) + Number(item.stock_store)));
  }, 0);

  const warehouseCapital = inventory.reduce((total, item) => total + (Number(item.price) * Number(item.stock_warehouse)), 0);
  const storeCapital = inventory.reduce((total, item) => total + (Number(item.price) * Number(item.stock_store)), 0);

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
        case 'barcode-asc': 
        default: return a.barcode.localeCompare(b.barcode);
      }
    });

  return (
    <div className="min-h-screen bg-[#f3f3f3] flex text-black relative">
      
      {/* CUSTOM MODALS */}
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white border border-gray-400 w-96 shadow-[4px_4px_0px_rgba(0,0,0,0.15)] rounded-none">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between items-center"><span className="text-sm font-semibold text-black px-1">{alertConfig.title}</span><button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="text-gray-500 hover:text-[#e81123] text-lg leading-none px-2 transition-colors">×</button></div>
            <div className="p-6"><p className="text-sm text-black">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end"><button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] transition-colors text-white text-sm rounded-none">OK</button></div>
          </div>
        </div>
      )}

      {confirmConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white border border-gray-400 w-96 shadow-[4px_4px_0px_rgba(0,0,0,0.15)] rounded-none">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between items-center"><span className="text-sm font-semibold text-black px-1">{confirmConfig.title}</span><button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="text-gray-500 hover:text-[#e81123] text-lg leading-none px-2 transition-colors">×</button></div>
            <div className="p-6"><p className="text-sm text-black">{confirmConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end gap-3">
              <button onClick={() => { if (confirmConfig.onConfirm) confirmConfig.onConfirm(); setConfirmConfig({ ...confirmConfig, isOpen: false }); }} className="px-6 py-1.5 bg-[#e81123] hover:bg-[#b00d1a] transition-colors text-white text-sm rounded-none">Yes</button>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] transition-colors text-black border border-gray-400 text-sm rounded-none">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <aside className="w-64 bg-[#e6e6e6] p-6 border-r border-gray-400 flex flex-col h-screen sticky top-0 overflow-y-auto">
        <h2 className="text-2xl font-light mb-8 text-black">Admin Panel</h2>
        <nav className="space-y-1">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'dashboard' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Dashboard Overview</button>
          <button onClick={() => setActiveTab('register')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'register' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Register New Product</button>
          <button onClick={() => setActiveTab('warehouse')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'warehouse' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Warehouse Management</button>
          <button onClick={() => setActiveTab('store')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'store' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Store Management</button>
          <button onClick={() => setActiveTab('sales')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'sales' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Recent Activity</button>
          <button onClick={() => setActiveTab('staff')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'staff' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Manage Staff</button>
        </nav>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto h-screen">
        
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
           <div className="animate-fade-in">
             <h1 className="text-3xl font-light text-black mb-8">Business Overview</h1>
             
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#107c10] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Today's Store Revenue</p>
                 <p className="text-3xl font-light text-[#107c10] mt-2">₹{todaysTrueRevenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#0078D7] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Today's Sales Count</p>
                 <p className="text-3xl font-light text-[#0078D7] mt-2">{todaysTransactionCount} Bills</p>
               </div>
               <div className={`bg-white p-6 border border-gray-400 border-l-4 rounded-none shadow-sm flex flex-col justify-between ${lowStoreCount > 0 ? 'border-l-[#e81123]' : 'border-l-[#107c10]'}`}>
                 <p className="text-xs text-gray-500 uppercase font-semibold">Low Store Stock</p>
                 <p className={`text-3xl font-light mt-2 ${lowStoreCount > 0 ? 'text-[#e81123]' : 'text-[#107c10]'}`}>
                   {lowStoreCount > 0 ? `${lowStoreCount} Items` : 'Shelves Full'}
                 </p>
               </div>
               <div className={`bg-white p-6 border border-gray-400 border-l-4 rounded-none shadow-sm flex flex-col justify-between ${lowWarehouseCount > 0 ? 'border-l-[#e81123]' : 'border-l-[#107c10]'}`}>
                 <p className="text-xs text-gray-500 uppercase font-semibold">Wholesaler Reorder Alert</p>
                 <p className={`text-3xl font-light mt-2 ${lowWarehouseCount > 0 ? 'text-[#e81123]' : 'text-[#107c10]'}`}>
                   {lowWarehouseCount > 0 ? `${lowWarehouseCount} Items` : 'Stocked Up'}
                 </p>
               </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#605e5c] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Total Assets Value</p>
                 <p className="text-2xl font-light text-black mt-2">₹{totalInventoryValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                 <p className="text-xs text-gray-500 mt-2">Across {inventory.length} unique products</p>
               </div>
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#0078D7] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Capital in Warehouse</p>
                 <p className="text-2xl font-light text-black mt-2">₹{warehouseCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                 <p className="text-xs text-gray-500 mt-2">Unsold backroom inventory</p>
               </div>
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#107c10] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Capital on Store Shelves</p>
                 <p className="text-2xl font-light text-black mt-2">₹{storeCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                 <p className="text-xs text-gray-500 mt-2">Active retail floor inventory</p>
               </div>
             </div>
           </div>
        )}

        {/* REGISTER NEW PRODUCT TAB */}
        {activeTab === 'register' && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-light text-black mb-8">Catalog Registration</h1>
            <p className="text-sm text-gray-600 mb-8 border-l-4 border-[#0078D7] pl-3">Add completely new items to the master database. The system will automatically assign the next available sequential barcode.</p>
            
            <div className="bg-white p-6 border border-gray-400 rounded-none mb-8 max-w-5xl">
              <h2 className="text-lg font-light text-black mb-4">Product Details</h2>
              <form onSubmit={handleAddItem} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Barcode (Auto)</label>
                  <input 
                    type="text" 
                    value={getNextBarcode()} 
                    disabled 
                    className="w-full px-3 py-1.5 border border-gray-400 bg-gray-200 text-gray-500 focus:outline-none rounded-none text-sm cursor-not-allowed" 
                    title="Automatically determined by sequence"
                  />
                </div>
                
                <div className="md:col-span-2"><label className="block text-sm text-gray-600 mb-1">Item Name</label><input type="text" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                <div><label className="block text-sm text-gray-600 mb-1">Unit</label><select value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm bg-white"><option value="PCS">PCS</option><option value="GRAMS">GRAMS</option><option value="SQFT">SQFT</option></select></div>
                <div><label className="block text-sm text-gray-600 mb-1">Price (₹)</label><input type="number" step="0.01" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                <div><label className="block text-sm text-gray-600 mb-1">Initial Whse Qty</label><input type="number" value={newItem.stock_warehouse} onChange={e => setNewItem({...newItem, stock_warehouse: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                
                <button type="submit" disabled={isSubmitting} className="w-full py-2 bg-[#0078D7] hover:bg-[#005a9e] transition-colors text-white rounded-none border border-[#005a9e] text-sm md:col-span-6 mt-4 font-medium">Add Product to Master Database</button>
              </form>
            </div>
          </div>
        )}

        {/* WAREHOUSE TAB */}
        {activeTab === 'warehouse' && (
          <div className="animate-fade-in flex flex-col h-full">
            <h1 className="text-3xl font-light text-black mb-6">Warehouse Management</h1>
            
            <div className="flex gap-2 mb-6 border-b border-gray-400 pb-4">
              <button onClick={() => setWarehouseSubTab('inventory')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${warehouseSubTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Inventory List</button>
              <button onClick={() => setWarehouseSubTab('receive')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${warehouseSubTab === 'receive' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Receive Inbound</button>
              <button onClick={() => setWarehouseSubTab('transfer')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${warehouseSubTab === 'transfer' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Move to Store</button>
            </div>

            {warehouseSubTab === 'inventory' && (
              <div className="animate-fade-in">
                
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
                  <input type="text" placeholder="Search by Name or Barcode..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="w-full md:w-1/2 px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none" />
                  <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="w-full md:w-auto px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none bg-white">
                    <option value="barcode-asc">Sort: Barcode (Ascending)</option>
                    <option value="name-asc">Sort: Name (A-Z)</option>
                    <option value="stock-asc">Sort: Whse Stock (Low to High)</option>
                    <option value="stock-desc">Sort: Whse Stock (High to Low)</option>
                  </select>
                </div>

                <div className="bg-white border border-gray-400 rounded-none overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                        <th className="p-3 font-medium border-r border-gray-300 w-24">Barcode</th>
                        <th className="p-3 font-medium border-r border-gray-300">Item Name</th>
                        <th className="p-3 font-medium border-r border-gray-300 w-24 text-center">Unit</th>
                        <th className="p-3 font-medium border-r border-gray-300 w-24">Price (₹)</th>
                        <th className="p-3 font-medium border-r border-gray-300 w-32 text-center">Whse Stock</th>
                        <th className="p-3 font-medium w-32 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {processedInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-[#f0f0f0]">
                          <td className="p-3 border-r border-gray-200 text-sm font-medium text-[#0078D7]">{item.barcode}</td>
                          {editingBarcode === item.barcode ? (
                            <>
                              <td className="p-2 border-r border-gray-200"><input type="text" value={editFormData.name} onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none" /></td>
                              <td className="p-2 border-r border-gray-200">
                                <select value={editFormData.unit} onChange={(e) => setEditFormData({...editFormData, unit: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none bg-white">
                                  <option value="PCS">PCS</option><option value="GRAMS">GRAMS</option><option value="SQFT">SQFT</option>
                                </select>
                              </td>
                              <td className="p-2 border-r border-gray-200"><input type="number" step="0.01" value={editFormData.price} onChange={(e) => setEditFormData({...editFormData, price: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none" /></td>
                              <td className="p-2 border-r border-gray-200"><input type="number" value={editFormData.stock_warehouse} onChange={(e) => setEditFormData({...editFormData, stock_warehouse: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm text-center rounded-none" /></td>
                              <td className="p-2 text-center flex gap-2 justify-center">
                                <button onClick={handleSaveEdit} className="px-3 py-1 bg-[#107c10] text-white text-xs rounded-none hover:bg-[#0b580b] transition-colors">Save</button>
                                <button onClick={() => setEditingBarcode(null)} className="px-3 py-1 bg-[#e6e6e6] text-black border border-gray-400 text-xs rounded-none hover:bg-[#cccccc] transition-colors">Cancel</button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-gray-600 text-center">{item.unit}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-black">{Number(item.price).toFixed(2)}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-black font-semibold text-center">{item.stock_warehouse || '0'}</td>
                              <td className="p-2 text-center flex gap-2 justify-center">
                                <button onClick={() => handleEditClick(item)} className="px-3 py-1 bg-[#e6e6e6] text-black border border-gray-400 text-xs rounded-none hover:bg-[#cccccc] transition-colors">Edit</button>
                                <button onClick={() => handleDeleteClick(item.barcode)} className="px-3 py-1 bg-transparent text-[#e81123] border border-[#e81123] text-xs rounded-none hover:bg-[#e81123] hover:text-white transition-colors">Delete</button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {warehouseSubTab === 'receive' && (
              <div className="flex-1 animate-fade-in">
                <WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Warehouse" defaultTab="receive" hideNav={true} shopSettings={shopSettings} />
              </div>
            )}

            {warehouseSubTab === 'transfer' && (
              <div className="flex-1 animate-fade-in">
                <WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Warehouse" defaultTab="transfer" hideNav={true} shopSettings={shopSettings} />
              </div>
            )}
          </div>
        )}

        {/* STORE TAB */}
        {activeTab === 'store' && (
          <div className="animate-fade-in flex flex-col h-full">
            <h1 className="text-3xl font-light text-black mb-6">Store Management</h1>
            
            <div className="flex gap-2 mb-6 border-b border-gray-400 pb-4">
              <button onClick={() => setStoreSubTab('inventory')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${storeSubTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Inventory List</button>
              <button onClick={() => setStoreSubTab('checkout')} className={`px-6 py-2 text-sm border border-gray-400 rounded-none transition-colors ${storeSubTab === 'checkout' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Customer Checkout</button>
            </div>

            {storeSubTab === 'inventory' && (
              <div className="animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
                  <input type="text" placeholder="Search Store Shelves..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="w-full md:w-1/2 px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none" />
                  <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="w-full md:w-auto px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-sm rounded-none bg-white">
                    <option value="barcode-asc">Sort: Barcode (Ascending)</option>
                    <option value="name-asc">Sort: Name (A-Z)</option>
                    <option value="stock-asc">Sort: Store Stock (Low to High)</option>
                    <option value="stock-desc">Sort: Store Stock (High to Low)</option>
                  </select>
                </div>

                <div className="bg-white border border-gray-400 rounded-none overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                        <th className="p-3 font-medium border-r border-gray-300 w-24">Barcode</th>
                        <th className="p-3 font-medium border-r border-gray-300">Item Name</th>
                        <th className="p-3 font-medium border-r border-gray-300 w-24 text-center">Unit</th>
                        <th className="p-3 font-medium border-r border-gray-300 w-24">Price (₹)</th>
                        <th className="p-3 font-medium border-r border-gray-300 w-32 text-center">Store Stock</th>
                        <th className="p-3 font-medium w-32 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {processedInventory.map((item) => (
                        <tr key={item.id} className={item.stock_store < 10 && editingBarcode !== item.barcode ? 'bg-[#ffebee]' : 'hover:bg-[#f0f0f0]'}>
                          <td className="p-3 border-r border-gray-200 text-sm font-medium text-[#0078D7]">{item.barcode}</td>
                          {editingBarcode === item.barcode ? (
                            <>
                              <td className="p-2 border-r border-gray-200"><input type="text" value={editFormData.name} onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none" /></td>
                              <td className="p-2 border-r border-gray-200">
                                <select value={editFormData.unit} onChange={(e) => setEditFormData({...editFormData, unit: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none bg-white">
                                  <option value="PCS">PCS</option><option value="GRAMS">GRAMS</option><option value="SQFT">SQFT</option>
                                </select>
                              </td>
                              <td className="p-2 border-r border-gray-200"><input type="number" step="0.01" value={editFormData.price} onChange={(e) => setEditFormData({...editFormData, price: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none" /></td>
                              <td className="p-2 border-r border-gray-200"><input type="number" value={editFormData.stock_store} onChange={(e) => setEditFormData({...editFormData, stock_store: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm text-center rounded-none" /></td>
                              <td className="p-2 text-center flex gap-2 justify-center">
                                <button onClick={handleSaveEdit} className="px-3 py-1 bg-[#107c10] text-white text-xs rounded-none hover:bg-[#0b580b] transition-colors">Save</button>
                                <button onClick={() => setEditingBarcode(null)} className="px-3 py-1 bg-[#e6e6e6] text-black border border-gray-400 text-xs rounded-none hover:bg-[#cccccc] transition-colors">Cancel</button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-gray-600 text-center">{item.unit}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-black">{Number(item.price).toFixed(2)}</td>
                              <td className="p-3 border-r border-gray-200 text-sm text-black font-semibold text-center">{item.stock_store || '0'}</td>
                              <td className="p-2 text-center flex gap-2 justify-center">
                                <button onClick={() => handleEditClick(item)} className="px-3 py-1 bg-[#e6e6e6] text-black border border-gray-400 text-xs rounded-none hover:bg-[#cccccc] transition-colors">Edit</button>
                                <button onClick={() => handleDeleteClick(item.barcode)} className="px-3 py-1 bg-transparent text-[#e81123] border border-[#e81123] text-xs rounded-none hover:bg-[#e81123] hover:text-white transition-colors">Delete</button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {storeSubTab === 'checkout' && (
              <div className="flex-1 animate-fade-in">
                <WorkerBilling inventory={inventory} refreshInventory={refreshInventory} sessionLocation="Store" defaultTab="checkout" hideNav={true} shopSettings={shopSettings} />
              </div>
            )}
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
                    <p className="text-sm text-gray-500">{new Date(selectedBill.created_at).toLocaleString()} • {selectedBill.location}</p>
                  </div>
                  <p className="text-2xl font-light text-[#0078D7]">Value: ₹{Number(selectedBill.total_amount).toFixed(2)}</p>
                </div>
                
                {isLoadingItems ? <p className="text-sm text-gray-500">Loading items...</p> : (
                  <div className="bg-white border border-gray-400 rounded-none overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                          <th className="p-3 border-r border-gray-300">Item Name</th>
                          <th className="p-3 border-r border-gray-300 w-20 text-center">Qty</th>
                          <th className="p-3 border-r border-gray-300 text-right">Unit Price</th>
                          <th className="p-3 border-r border-gray-300 w-24 text-center">Discount</th>
                          <th className="p-3 text-right">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {billItems.map(item => (
                          <tr key={item.id} className="hover:bg-[#f0f0f0]">
                            <td className="p-3 border-r border-gray-200 text-sm">{item.name} <span className="text-gray-400 text-xs block">#{item.barcode}</span></td>
                            <td className="p-3 border-r border-gray-200 text-sm text-center">{item.quantity} {item.unit}</td>
                            <td className="p-3 border-r border-gray-200 text-sm text-right">₹{Number(item.price_at_sale / (1 - item.discount_pct / 100)).toFixed(2)}</td>
                            <td className="p-3 border-r border-gray-200 text-sm text-center">{item.discount_pct}%</td>
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
                 <h1 className="text-3xl font-light text-black">Recent Activity Ledger</h1>
                 <button onClick={() => fetchBills(salesPage)} className="px-4 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm rounded-none transition-colors">Refresh Data</button>
               </div>
               
               {isLoadingBills ? (<p className="text-sm text-gray-500">Loading recent transactions from cloud...</p>) : (
               <>
                 <div className="bg-white border border-gray-400 rounded-none overflow-hidden mb-4">
                   <table className="w-full text-left border-collapse">
                     <thead>
                       <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                         <th className="p-3 font-medium border-r border-gray-300 w-48">Date & Time</th>
                         <th className="p-3 font-medium border-r border-gray-300">Action Type</th>
                         <th className="p-3 font-medium border-r border-gray-300">Value (₹)</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-200">
                       {bills.length === 0 ? (<tr><td colSpan="3" className="p-8 text-center text-gray-500 text-sm">No activity recorded yet.</td></tr>) : (
                         bills.map((bill) => (
                           <tr key={bill.id} onClick={() => handleBillClick(bill)} className="hover:bg-[#d0e6f5] cursor-pointer transition-colors">
                             <td className="p-3 border-r border-gray-200 text-sm text-gray-600">{new Date(bill.created_at).toLocaleString()}</td>
                             <td className="p-3 border-r border-gray-200 text-sm font-semibold text-black">
                               {bill.location === 'Warehouse-Inbound' ? 'Stock Received' : 
                                bill.location === 'Warehouse-Transfer' ? 'Transfer to Store' : 
                                'Customer Sale'}
                             </td>
                             <td className="p-3 text-sm text-black font-semibold text-[#0078D7]">₹{Number(bill.total_amount).toFixed(2)}</td>
                           </tr>
                         ))
                       )}
                     </tbody>
                   </table>
                 </div>
                 <div className="flex justify-between items-center">
                    <button onClick={() => setSalesPage(p => Math.max(0, p - 1))} disabled={salesPage === 0} className="px-4 py-2 bg-[#e6e6e6] text-black border border-gray-400 text-sm rounded-none disabled:opacity-50 hover:bg-[#cccccc]">← Newer</button>
                    <span className="text-sm text-gray-500">Page {salesPage + 1}</span>
                    <button onClick={() => setSalesPage(p => p + 1)} disabled={!hasMoreBills} className="px-4 py-2 bg-[#e6e6e6] text-black border border-gray-400 text-sm rounded-none disabled:opacity-50 hover:bg-[#cccccc]">Older →</button>
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
                 <div><label className="block text-sm text-gray-600 mb-1">Worker Name</label><input type="text" value={newWorker.name} onChange={e => setNewWorker({...newWorker, name: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" placeholder="e.g. Suresh" /></div>
                 <div><label className="block text-sm text-gray-600 mb-1">Login Password</label><input type="text" value={newWorker.password} onChange={e => setNewWorker({...newWorker, password: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" placeholder="Set a password" /></div>
                 <button type="submit" disabled={isAddingWorker} className="w-full py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white transition-colors rounded-none border border-[#005a9e] text-sm h-[34px] disabled:opacity-50">Add Worker</button>
               </form>
             </div>
             <div className="bg-white border border-gray-400 rounded-none overflow-hidden max-w-2xl">
               <table className="w-full text-left border-collapse">
                 <thead>
                   <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                     <th className="p-3 border-r border-gray-300">Name</th>
                     <th className="p-3 border-r border-gray-300">Password</th>
                     <th className="p-3 text-center w-32">Actions</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-200">
                   {workers.map((worker) => (
                     <tr key={worker.id} className="hover:bg-[#f0f0f0]">
                       <td className="p-3 border-r border-gray-200 text-sm text-black capitalize">{worker.name}</td>
                       <td className="p-3 border-r border-gray-200 text-sm text-gray-600 font-mono">{worker.password}</td>
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