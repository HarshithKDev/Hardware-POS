import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function OwnerDashboard({ inventory, refreshInventory }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [newItem, setNewItem] = useState({ barcode: '', name: '', price: '', stock: '', unit: 'PCS' });
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

  // --- NEW: CUSTOM MODAL STATES ---
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'Notification' });
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, message: '', title: 'Confirm Action', onConfirm: null });

  const showAlert = (message, title = 'Notification') => {
    setAlertConfig({ isOpen: true, message, title });
  };

  const showConfirm = (message, onConfirmCallback, title = 'Confirm') => {
    setConfirmConfig({ isOpen: true, message, title, onConfirm: onConfirmCallback });
  };

  useEffect(() => {
    if (activeTab === 'sales' || activeTab === 'dashboard') fetchBills(salesPage);
    if (activeTab === 'staff') fetchWorkers();
    if (activeTab !== 'sales') setSelectedBill(null);
  }, [activeTab, salesPage]);

  const fetchBills = async (page) => {
    try {
      setIsLoadingBills(true);
      const from = page * SALES_PER_PAGE;
      const to = from + SALES_PER_PAGE - 1;

      const { data, error } = await supabase.from('bills').select('*').order('created_at', { ascending: false }).range(from, to);
      if (error) throw error;
      if (data) {
        setBills(data);
        setHasMoreBills(data.length === SALES_PER_PAGE);
      }
    } catch (error) {
      console.error("Error fetching bills:", error.message);
    } finally {
      setIsLoadingBills(false);
    }
  };

  const handleBillClick = async (bill) => {
    setSelectedBill(bill);
    setIsLoadingItems(true);
    try {
      const { data, error } = await supabase.from('bill_items').select('*').eq('bill_id', bill.id);
      if (error) throw error;
      if (data) setBillItems(data);
    } catch (error) {
      console.error("Error fetching items:", error.message);
    } finally {
      setIsLoadingItems(false);
    }
  };

  const fetchWorkers = async () => {
    try {
      const { data, error } = await supabase.from('workers').select('*').order('name', { ascending: true });
      if (error) throw error;
      if (data) setWorkers(data);
    } catch (error) {
      console.error("Error fetching workers:", error.message);
    }
  };

  const handleAddWorker = async (e) => {
    e.preventDefault();
    if (!newWorker.name || !newWorker.password) return showAlert("Please provide both a name and a password.", "Missing Info");
    try {
      setIsAddingWorker(true);
      const { error } = await supabase.from('workers').insert([{ name: newWorker.name, password: newWorker.password }]);
      if (error) throw error;
      setNewWorker({ name: '', password: '' });
      fetchWorkers();
      showAlert("Worker added successfully!", "Success");
    } catch (error) {
      console.error("Error:", error.message);
      showAlert("Failed to add worker. The name might already exist.", "Error");
    } finally {
      setIsAddingWorker(false);
    }
  };

  const handleDeleteWorker = (id) => {
    // Replaced window.confirm with our custom UI!
    showConfirm("Are you sure you want to remove this worker's access?", async () => {
      try {
        const { error } = await supabase.from('workers').delete().eq('id', id);
        if (error) throw error;
        fetchWorkers();
        showAlert("Worker removed.", "Success");
      } catch (error) {
        console.error("Delete Error:", error.message);
        showAlert("Failed to delete worker.", "Error");
      }
    }, "Remove Staff");
  };

  const handleAddItem = async (e) => {
    e.preventDefault(); 
    if (!newItem.barcode || !newItem.name || !newItem.price) return showAlert("Please fill in the barcode, name, and price.", "Validation Error");
    if (inventory.some(item => item.barcode === newItem.barcode)) return showAlert(`Error: Barcode ${newItem.barcode} is already in use!`, "Duplicate Barcode");
    try {
      setIsSubmitting(true);
      const { error } = await supabase.from('inventory').insert([{ barcode: newItem.barcode, name: newItem.name, price: Number(newItem.price), stock: Number(newItem.stock || 0), unit: newItem.unit }]);
      if (error) throw error;
      setNewItem({ barcode: '', name: '', price: '', stock: '', unit: 'PCS' });
      refreshInventory(); 
      showAlert("New product securely added to the cloud database!", "Success");
    } catch (error) {
      console.error("Error:", error.message);
      showAlert("Failed to save item to the cloud. Please try again.", "Error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (item) => {
    setEditingBarcode(item.barcode);
    setEditFormData({ ...item });
  };

  const handleSaveEdit = async () => {
    try {
      const { error } = await supabase.from('inventory').update({ name: editFormData.name, price: Number(editFormData.price), stock: Number(editFormData.stock), unit: editFormData.unit }).eq('barcode', editingBarcode);
      if (error) throw error;
      setEditingBarcode(null);
      refreshInventory(); 
      showAlert("Item updated successfully!", "Success");
    } catch (error) {
      console.error("Update Error:", error.message);
      showAlert("Failed to update item.", "Error");
    }
  };

  const handleDeleteClick = (barcode) => {
    showConfirm("Are you sure you want to delete this item? This cannot be undone.", async () => {
      try {
        const { error } = await supabase.from('inventory').delete().eq('barcode', barcode);
        if (error) throw error;
        refreshInventory();
        showAlert("Item deleted successfully!", "Success");
      } catch (error) {
        console.error("Delete Error:", error.message);
        showAlert("Failed to delete item.", "Error");
      }
    }, "Delete Product");
  };

  const todaysRevenue = bills.reduce((total, bill) => {
    const billDate = new Date(bill.created_at).toDateString();
    const today = new Date().toDateString();
    if (billDate === today) return total + Number(bill.total_amount);
    return total;
  }, 0);

  const lowStockCount = inventory.filter(item => item.stock < 10).length;

  const totalInventoryValue = inventory.reduce((total, item) => {
    return total + (Number(item.price) * Number(item.stock));
  }, 0);

  return (
    <div className="min-h-screen bg-[#f3f3f3] flex text-black relative">
      
      {/* --- CUSTOM ALERT MODAL --- */}
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white border border-gray-400 w-96 shadow-[4px_4px_0px_rgba(0,0,0,0.15)] rounded-none">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between items-center">
              <span className="text-sm font-semibold text-black px-1">{alertConfig.title}</span>
              <button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="text-gray-500 hover:text-[#e81123] text-lg leading-none px-2 transition-colors">×</button>
            </div>
            <div className="p-6">
              <p className="text-sm text-black">{alertConfig.message}</p>
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end">
              <button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm transition-colors rounded-none border border-[#005a9e]">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* --- CUSTOM CONFIRM MODAL --- */}
      {confirmConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-white border border-gray-400 w-96 shadow-[4px_4px_0px_rgba(0,0,0,0.15)] rounded-none">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between items-center">
              <span className="text-sm font-semibold text-black px-1">{confirmConfig.title}</span>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="text-gray-500 hover:text-[#e81123] text-lg leading-none px-2 transition-colors">×</button>
            </div>
            <div className="p-6">
              <p className="text-sm text-black">{confirmConfig.message}</p>
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end gap-3">
              <button onClick={() => {
                if (confirmConfig.onConfirm) confirmConfig.onConfirm();
                setConfirmConfig({ ...confirmConfig, isOpen: false });
              }} className="px-6 py-1.5 bg-[#e81123] hover:bg-[#b00d1a] text-white text-sm transition-colors rounded-none border border-[#b00d1a]">Yes</button>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm transition-colors rounded-none">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <aside className="w-64 bg-[#e6e6e6] p-6 border-r border-gray-400">
        <h2 className="text-2xl font-light mb-8 text-black">Admin Panel</h2>
        <nav className="space-y-1">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'dashboard' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Dashboard Overview</button>
          <button onClick={() => setActiveTab('inventory')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Manage Inventory</button>
          <button onClick={() => setActiveTab('sales')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'sales' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Recent Sales</button>
          <button onClick={() => setActiveTab('staff')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'staff' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Manage Staff</button>
        </nav>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">
        
        {activeTab === 'dashboard' && (
           <div className="animate-fade-in">
             <h1 className="text-3xl font-light text-black mb-8">Business Overview</h1>
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#107c10] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Today's Revenue</p>
                 <p className="text-3xl font-light text-[#107c10] mt-2">₹{todaysRevenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#0078D7] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Total Unique Items</p>
                 <p className="text-3xl font-light text-black mt-2">{inventory.length}</p>
               </div>
               <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#605e5c] rounded-none shadow-sm flex flex-col justify-between">
                 <p className="text-xs text-gray-500 uppercase font-semibold">Total Stock Value</p>
                 <p className="text-3xl font-light text-black mt-2">₹{totalInventoryValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
               </div>
               <div className={`bg-white p-6 border border-gray-400 border-l-4 rounded-none shadow-sm flex flex-col justify-between ${lowStockCount > 0 ? 'border-l-[#e81123]' : 'border-l-[#107c10]'}`}>
                 <p className="text-xs text-gray-500 uppercase font-semibold">Low Stock Alerts</p>
                 <p className={`text-3xl font-light mt-2 ${lowStockCount > 0 ? 'text-[#e81123]' : 'text-[#107c10]'}`}>
                   {lowStockCount > 0 ? `${lowStockCount} Items` : 'All Good'}
                 </p>
               </div>
             </div>
             <div className="bg-white border border-gray-400 p-6 rounded-none shadow-sm">
                <h2 className="text-lg font-light text-black mb-4">Quick Actions</h2>
                <div className="flex gap-4">
                  <button onClick={() => setActiveTab('inventory')} className="px-4 py-2 bg-[#e6e6e6] hover:bg-[#cccccc] text-black text-sm border border-gray-400 transition-colors">Add New Product</button>
                  <button onClick={() => setActiveTab('sales')} className="px-4 py-2 bg-[#e6e6e6] hover:bg-[#cccccc] text-black text-sm border border-gray-400 transition-colors">View Sales Ledger</button>
                  <button onClick={() => setActiveTab('staff')} className="px-4 py-2 bg-[#e6e6e6] hover:bg-[#cccccc] text-black text-sm border border-gray-400 transition-colors">Manage Staff</button>
                </div>
             </div>
           </div>
        )}

        {activeTab === 'inventory' && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-light text-black mb-8">Inventory Management</h1>
            <div className="bg-white p-6 border border-gray-400 rounded-none mb-8">
              <h2 className="text-lg font-light text-black mb-4">Register New Product</h2>
              <form onSubmit={handleAddItem} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                <div><label className="block text-sm text-gray-600 mb-1">Barcode</label><input type="text" value={newItem.barcode} onChange={e => setNewItem({...newItem, barcode: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                <div className="md:col-span-2"><label className="block text-sm text-gray-600 mb-1">Item Name</label><input type="text" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                <div><label className="block text-sm text-gray-600 mb-1">Unit</label><select value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm bg-white"><option value="PCS">PCS</option><option value="GRAMS">GRAMS</option><option value="SQFT">SQFT</option></select></div>
                <div><label className="block text-sm text-gray-600 mb-1">Price (₹)</label><input type="number" step="0.01" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" /></div>
                <button type="submit" disabled={isSubmitting} className="w-full py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white transition-colors rounded-none border border-[#005a9e] text-sm h-[34px] disabled:opacity-50">Add Item</button>
              </form>
            </div>
            
            <div className="bg-white border border-gray-400 rounded-none overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                    <th className="p-3 font-medium border-r border-gray-300 w-24">Barcode</th>
                    <th className="p-3 font-medium border-r border-gray-300">Item Name</th>
                    <th className="p-3 font-medium border-r border-gray-300 w-24">Unit</th>
                    <th className="p-3 font-medium border-r border-gray-300 w-28">Price (₹)</th>
                    <th className="p-3 font-medium border-r border-gray-300 w-24">In Stock</th>
                    <th className="p-3 font-medium w-32 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {inventory.map((item) => (
                    <tr key={item.id} className={item.stock < 10 && editingBarcode !== item.barcode ? 'bg-[#ffebee] hover:bg-[#ffcdd2]' : 'hover:bg-[#f0f0f0]'}>
                      <td className="p-3 border-r border-gray-200 text-sm font-medium text-[#0078D7]">{item.barcode}</td>
                      {editingBarcode === item.barcode ? (
                        <>
                          <td className="p-2 border-r border-gray-200"><input type="text" value={editFormData.name} onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none" /></td>
                          <td className="p-2 border-r border-gray-200"><select value={editFormData.unit} onChange={(e) => setEditFormData({...editFormData, unit: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none bg-white"><option value="PCS">PCS</option><option value="GRAMS">GRAMS</option><option value="SQFT">SQFT</option></select></td>
                          <td className="p-2 border-r border-gray-200"><input type="number" step="0.01" value={editFormData.price} onChange={(e) => setEditFormData({...editFormData, price: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none" /></td>
                          <td className="p-2 border-r border-gray-200"><input type="number" value={editFormData.stock} onChange={(e) => setEditFormData({...editFormData, stock: e.target.value})} className="w-full px-2 py-1 border border-gray-400 text-sm rounded-none" /></td>
                          <td className="p-2 text-center flex gap-2 justify-center">
                            <button onClick={handleSaveEdit} className="px-3 py-1 bg-[#107c10] text-white text-xs rounded-none hover:bg-[#0b580b]">Save</button>
                            <button onClick={() => setEditingBarcode(null)} className="px-3 py-1 bg-[#e6e6e6] text-black border border-gray-400 text-xs rounded-none hover:bg-[#cccccc]">Cancel</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name}</td>
                          <td className="p-3 border-r border-gray-200 text-sm text-black">{item.unit}</td>
                          <td className="p-3 border-r border-gray-200 text-sm text-black">{Number(item.price).toFixed(2)}</td>
                          <td className="p-3 border-r border-gray-200 text-sm text-black font-semibold">{item.stock || '0'}</td>
                          <td className="p-2 text-center flex gap-2 justify-center">
                            <button onClick={() => handleEditClick(item)} className="px-3 py-1 bg-[#e6e6e6] text-black border border-gray-400 text-xs rounded-none hover:bg-[#cccccc]">Edit</button>
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

        {activeTab === 'sales' && (
          <div className="animate-fade-in">
            {selectedBill ? (
              <div>
                <button onClick={() => setSelectedBill(null)} className="text-sm text-[#0078D7] hover:underline mb-4 flex items-center">← Back to Ledger</button>
                <div className="flex justify-between items-end mb-6">
                  <div>
                    <h2 className="text-2xl font-light text-black">Receipt #{selectedBill.id.split('-')[0]}</h2>
                    <p className="text-sm text-gray-500">{new Date(selectedBill.created_at).toLocaleString()} • {selectedBill.location}</p>
                  </div>
                  <p className="text-2xl font-light text-[#0078D7]">Total: ₹{Number(selectedBill.total_amount).toFixed(2)}</p>
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
                  <h1 className="text-3xl font-light text-black">Recent Sales (Ledger)</h1>
                  <button onClick={() => fetchBills(salesPage)} className="px-4 py-1.5 bg-[#e6e6e6] text-black border border-gray-400 text-sm rounded-none hover:bg-[#cccccc]">Refresh Data</button>
                </div>
                {isLoadingBills ? (<p className="text-sm text-gray-500">Loading recent transactions from cloud...</p>) : (
                  <>
                    <div className="bg-white border border-gray-400 rounded-none overflow-hidden mb-4">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                            <th className="p-3 font-medium border-r border-gray-300 w-48">Date & Time</th>
                            <th className="p-3 font-medium border-r border-gray-300 w-64">Receipt ID</th>
                            <th className="p-3 font-medium border-r border-gray-300">Location</th>
                            <th className="p-3 font-medium text-right">Total Amount (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {bills.length === 0 ? (<tr><td colSpan="4" className="p-8 text-center text-gray-500 text-sm">No sales recorded yet.</td></tr>) : (
                            bills.map((bill) => {
                              const dateObj = new Date(bill.created_at);
                              return (
                                <tr key={bill.id} onClick={() => handleBillClick(bill)} className="hover:bg-[#d0e6f5] cursor-pointer transition-colors">
                                  <td className="p-3 border-r border-gray-200 text-sm text-gray-600">{dateObj.toLocaleDateString()} {dateObj.toLocaleTimeString()}</td>
                                  <td className="p-3 border-r border-gray-200 text-xs text-gray-400 font-mono">{bill.id.split('-')[0]}...</td>
                                  <td className="p-3 border-r border-gray-200 text-sm text-black">{bill.location}</td>
                                  <td className="p-3 text-sm text-black font-semibold text-right text-[#0078D7]">₹{Number(bill.total_amount).toFixed(2)}</td>
                                </tr>
                              );
                            })
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