import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function OwnerDashboard({ inventory, refreshInventory }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [newItem, setNewItem] = useState({ barcode: '', name: '', price: '', stock: '', unit: 'PCS' });
  const [isSubmitting, setIsSubmitting] = useState(false); 

  // --- NEW STATE FOR RECENT SALES ---
  const [bills, setBills] = useState([]);
  const [isLoadingBills, setIsLoadingBills] = useState(false);

  // Fetch the bills whenever the owner clicks the 'sales' tab
  useEffect(() => {
    if (activeTab === 'sales') {
      fetchBills();
    }
  }, [activeTab]);

  const fetchBills = async () => {
    try {
      setIsLoadingBills(true);
      // We grab the latest 50 receipts from the database, sorted by newest first
      const { data, error } = await supabase
        .from('bills')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      if (data) setBills(data);
    } catch (error) {
      console.error("Error fetching bills:", error.message);
    } finally {
      setIsLoadingBills(false);
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault(); 
    
    if (!newItem.barcode || !newItem.name || !newItem.price) {
      alert("Please fill in the barcode, name, and price.");
      return;
    }

    const barcodeExists = inventory.some(item => item.barcode === newItem.barcode);
    if (barcodeExists) {
      alert(`Error: Barcode ${newItem.barcode} is already in use!`);
      return;
    }

    try {
      setIsSubmitting(true);
      
      const { error } = await supabase
        .from('inventory')
        .insert([{ 
            barcode: newItem.barcode, 
            name: newItem.name, 
            price: Number(newItem.price), 
            stock: Number(newItem.stock || 0),
            unit: newItem.unit
        }]);

      if (error) throw error;

      setNewItem({ barcode: '', name: '', price: '', stock: '', unit: 'PCS' });
      alert("New product securely added to the cloud database!");
      refreshInventory(); 

    } catch (error) {
      console.error("Error adding item:", error.message);
      alert("Failed to save item to the cloud. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f3f3] flex text-black">
      
      <aside className="w-64 bg-[#e6e6e6] p-6 border-r border-gray-400">
        <h2 className="text-2xl font-light mb-8 text-black">Admin Panel</h2>
        <nav className="space-y-1">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'dashboard' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Dashboard Overview</button>
          <button onClick={() => setActiveTab('inventory')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Manage Inventory</button>
          {/* New Sales Tab Button */}
          <button onClick={() => setActiveTab('sales')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'sales' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Recent Sales</button>
        </nav>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">
        
        {activeTab === 'dashboard' && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-light text-black mb-8">Today's Overview</h1>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#0078D7] rounded-none">
                <p className="text-sm text-gray-600 uppercase">Total Items in System</p>
                <p className="text-3xl font-light text-black mt-2">{inventory.length}</p>
              </div>
              <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#107c10] rounded-none">
                 <p className="text-sm text-gray-600 uppercase">Quick Actions</p>
                 <p className="text-sm font-medium text-black mt-2">Go to Recent Sales to view today's revenue.</p>
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
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Barcode</label>
                  <input type="text" value={newItem.barcode} onChange={e => setNewItem({...newItem, barcode: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" placeholder="e.g. 1005" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-600 mb-1">Item Name</label>
                  <input type="text" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" placeholder="Product Description" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Unit</label>
                  <select value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm bg-white">
                    <option value="PCS">PCS</option>
                    <option value="GRAMS">GRAMS</option>
                    <option value="SQFT">SQFT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Price (₹)</label>
                  <input type="number" step="0.01" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" placeholder="0.00" />
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white transition-colors rounded-none border border-[#005a9e] text-sm h-[34px] disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Add Item'}
                </button>
              </form>
            </div>

            <div className="bg-white border border-gray-400 rounded-none overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                    <th className="p-3 font-medium border-r border-gray-300">Barcode</th>
                    <th className="p-3 font-medium border-r border-gray-300">Item Name</th>
                    <th className="p-3 font-medium border-r border-gray-300">Unit</th>
                    <th className="p-3 font-medium border-r border-gray-300">Price (₹)</th>
                    <th className="p-3 font-medium">In Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {inventory.map((item) => (
                    <tr key={item.id} className="hover:bg-[#f0f0f0]">
                      <td className="p-3 border-r border-gray-200 text-sm font-medium text-[#0078D7]">{item.barcode}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-black">{item.unit}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-black">{Number(item.price).toFixed(2)}</td>
                      <td className="p-3 text-sm text-black">{item.stock || '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- THE NEW SALES TAB CONTENT --- */}
        {activeTab === 'sales' && (
          <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-3xl font-light text-black">Recent Sales (Ledger)</h1>
              <button onClick={fetchBills} className="px-4 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm rounded-none transition-colors">
                Refresh Data
              </button>
            </div>

            {isLoadingBills ? (
               <p className="text-sm text-gray-500">Loading recent transactions from cloud...</p>
            ) : (
              <div className="bg-white border border-gray-400 rounded-none overflow-hidden">
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
                    {bills.length === 0 ? (
                      <tr><td colSpan="4" className="p-8 text-center text-gray-500 text-sm">No sales recorded yet.</td></tr>
                    ) : (
                      bills.map((bill) => {
                        // Formatting the ISO date (ISO date - an international standard format for representing dates and times) into a readable format
                        const dateObj = new Date(bill.created_at);
                        const formattedDate = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();

                        return (
                          <tr key={bill.id} className="hover:bg-[#f0f0f0]">
                            <td className="p-3 border-r border-gray-200 text-sm text-gray-600">{formattedDate}</td>
                            <td className="p-3 border-r border-gray-200 text-xs text-gray-400 font-mono">{bill.id}</td>
                            <td className="p-3 border-r border-gray-200 text-sm text-black">{bill.location}</td>
                            <td className="p-3 text-sm text-black font-semibold text-right text-[#0078D7]">₹{Number(bill.total_amount).toFixed(2)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}