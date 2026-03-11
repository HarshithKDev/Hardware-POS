import React, { useState } from 'react';

// Starting inventory data for the owner to manage
const INITIAL_INVENTORY = [
  { barcode: '1001', name: 'Brass Door Handle', price: 450, stock: 45 },
  { barcode: '1002', name: 'Steel Soap Stand', price: 120, stock: 12 },
  { barcode: '1003', name: 'Ceramic Mug', price: 150, stock: 30 },
  { barcode: '1004', name: 'Screws (Pack of 50)', price: 50, stock: 200 },
];

export default function OwnerDashboard() {
  // useState (useState - a React Hook that lets you add a state variable to your component)
  const [activeTab, setActiveTab] = useState('dashboard');
  const [inventory, setInventory] = useState(INITIAL_INVENTORY);
  
  // State for the "Add New Product" form
  const [newItem, setNewItem] = useState({ barcode: '', name: '', price: '', stock: '' });

  const handleAddItem = (e) => {
    e.preventDefault(); // (preventDefault - a method that stops the default action of an element from happening, like refreshing the page on form submission)
    
    // Quick validation to ensure fields aren't empty
    if (!newItem.barcode || !newItem.name || !newItem.price) {
      alert("Please fill in the barcode, name, and price.");
      return;
    }

    // Add the new item to our inventory array (Array - a data structure consisting of a collection of elements identified by an index)
    setInventory([...inventory, { ...newItem, price: Number(newItem.price), stock: Number(newItem.stock) }]);
    
    // Reset the form
    setNewItem({ barcode: '', name: '', price: '', stock: '' });
    alert("New product added successfully!");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 text-white p-6 shadow-xl">
        <h2 className="text-2xl font-bold mb-8 text-blue-400">Admin Panel</h2>
        <nav className="space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}
          >
            Dashboard Overview
          </button>
          <button 
            onClick={() => setActiveTab('inventory')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${activeTab === 'inventory' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}
          >
            Manage Inventory
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto">
        
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-bold text-gray-800 mb-8">Today's Overview</h1>
            
            {/* KPI Cards (KPI - Key Performance Indicator, a measurable value that demonstrates how effectively a company is achieving key business objectives) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm border-l-4 border-l-blue-500">
                <p className="text-sm text-gray-500 font-medium">Total Sales Today</p>
                <p className="text-3xl font-bold text-gray-800 mt-2">₹14,520</p>
              </div>
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm border-l-4 border-l-emerald-500">
                <p className="text-sm text-gray-500 font-medium">Items Sold</p>
                <p className="text-3xl font-bold text-gray-800 mt-2">84</p>
              </div>
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm border-l-4 border-l-purple-500">
                <p className="text-sm text-gray-500 font-medium">Low Stock Alerts</p>
                <p className="text-3xl font-bold text-gray-800 mt-2">3</p>
              </div>
            </div>
          </div>
        )}

        {/* INVENTORY TAB */}
        {activeTab === 'inventory' && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-bold text-gray-800 mb-8">Inventory Management</h1>
            
            {/* Add New Item Form */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-8">
              <h2 className="text-lg font-semibold text-gray-700 mb-4">Register New Product</h2>
              <form onSubmit={handleAddItem} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Barcode</label>
                  <input 
                    type="text" 
                    value={newItem.barcode} 
                    onChange={e => setNewItem({...newItem, barcode: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500" 
                    placeholder="e.g. 1005"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-600 mb-1">Item Name</label>
                  <input 
                    type="text" 
                    value={newItem.name} 
                    onChange={e => setNewItem({...newItem, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500" 
                    placeholder="Product Description"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Price (₹)</label>
                  <input 
                    type="number" 
                    value={newItem.price} 
                    onChange={e => setNewItem({...newItem, price: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500" 
                    placeholder="0.00"
                  />
                </div>
                <button type="submit" className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded font-medium transition-colors h-[42px]">
                  Add Item
                </button>
              </form>
            </div>

            {/* Current Inventory Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 text-sm uppercase tracking-wider border-b border-gray-200">
                    <th className="p-4 font-semibold">Barcode</th>
                    <th className="p-4 font-semibold">Item Name</th>
                    <th className="p-4 font-semibold">Price (₹)</th>
                    <th className="p-4 font-semibold">In Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {/* map (map - a method that creates a new array populated with the results of calling a provided function on every element in the calling array) */}
                  {inventory.map((item, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 font-medium text-blue-600">{item.barcode}</td>
                      <td className="p-4 text-gray-800">{item.name}</td>
                      <td className="p-4 text-gray-600">{item.price.toFixed(2)}</td>
                      <td className="p-4 text-gray-600">{item.stock || 'N/A'}</td>
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