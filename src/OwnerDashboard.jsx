import React, { useState } from 'react';

export default function OwnerDashboard({ inventory, setInventory }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [newItem, setNewItem] = useState({ barcode: '', name: '', price: '', stock: '' });

  const handleAddItem = (e) => {
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

    setInventory([...inventory, { ...newItem, price: Number(newItem.price), stock: Number(newItem.stock) }]);
    setNewItem({ barcode: '', name: '', price: '', stock: '' });
    alert("New product added successfully!");
  };

  return (
    // Flat light gray background
    <div className="min-h-screen bg-[#f3f3f3] flex text-black">
      
      {/* Windows-style light sidebar with sharp border */}
      <aside className="w-64 bg-[#e6e6e6] p-6 border-r border-gray-400">
        <h2 className="text-2xl font-light mb-8 text-black">Admin Panel</h2>
        <nav className="space-y-1">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'dashboard' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Dashboard Overview</button>
          <button onClick={() => setActiveTab('inventory')} className={`w-full text-left px-4 py-2 transition-colors rounded-none text-sm ${activeTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'hover:bg-[#cccccc] text-black'}`}>Manage Inventory</button>
        </nav>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">
        
        {activeTab === 'dashboard' && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-light text-black mb-8">Today's Overview</h1>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Sharp, flat KPI cards */}
              <div className="bg-white p-6 border border-gray-400 border-l-4 border-l-[#0078D7] rounded-none">
                <p className="text-sm text-gray-600 uppercase">Total Items in System</p>
                <p className="text-3xl font-light text-black mt-2">{inventory.length}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-light text-black mb-8">Inventory Management</h1>
            
            {/* Flat form container */}
            <div className="bg-white p-6 border border-gray-400 rounded-none mb-8">
              <h2 className="text-lg font-light text-black mb-4">Register New Product</h2>
              <form onSubmit={handleAddItem} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Barcode</label>
                  <input type="text" value={newItem.barcode} onChange={e => setNewItem({...newItem, barcode: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" placeholder="e.g. 1005" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-600 mb-1">Item Name</label>
                  <input type="text" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" placeholder="Product Description" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Price (₹)</label>
                  <input type="number" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} className="w-full px-3 py-1.5 border border-gray-400 focus:outline-none focus:border-[#0078D7] rounded-none text-sm" placeholder="0.00" />
                </div>
                <button type="submit" className="w-full py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white transition-colors rounded-none border border-[#005a9e] text-sm h-[34px]">Add Item</button>
              </form>
            </div>

            {/* Sharp Datagrid for the inventory table */}
            <div className="bg-white border border-gray-400 rounded-none overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                    <th className="p-3 font-medium border-r border-gray-300">Barcode</th>
                    <th className="p-3 font-medium border-r border-gray-300">Item Name</th>
                    <th className="p-3 font-medium border-r border-gray-300">Price (₹)</th>
                    <th className="p-3 font-medium">In Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {inventory.map((item, index) => (
                    <tr key={index} className="hover:bg-[#f0f0f0]">
                      <td className="p-3 border-r border-gray-200 text-sm font-medium text-[#0078D7]">{item.barcode}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name}</td>
                      <td className="p-3 border-r border-gray-200 text-sm text-black">{item.price.toFixed(2)}</td>
                      <td className="p-3 text-sm text-black">{item.stock || '0'}</td>
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