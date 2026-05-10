import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function OwnerInventory({ viewType, showAlert, showConfirm }) {
  const [inventorySearch, setInventorySearch] = useState('');
  const [sortOption, setSortOption] = useState('barcode-asc'); 
  const [invPage, setInvPage] = useState(0);
  const [paginatedInventory, setPaginatedInventory] = useState([]);
  const [totalInvItems, setTotalInvItems] = useState(0);
  const [editingBarcode, setEditingBarcode] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const INV_PER_PAGE = 50;

  const loadInventory = async () => {
    const from = invPage * INV_PER_PAGE;
    let query = supabase.from('inventory').select('*', { count: 'exact' }).eq('is_active', true);
    if (inventorySearch.trim() !== '') query = query.or(`name.ilike.%${inventorySearch}%,barcode.ilike.%${inventorySearch}%`);
    if (sortOption === 'barcode-asc') query = query.order('barcode', { ascending: true });
    else if (sortOption === 'barcode-desc') query = query.order('barcode', { ascending: false });
    else if (sortOption === 'name-asc') query = query.order('name', { ascending: true });
    else if (sortOption === 'name-desc') query = query.order('name', { ascending: false });
    else if (sortOption === 'stock-asc') query = query.order(viewType === 'warehouse' ? 'stock_warehouse' : 'stock_store', { ascending: true });
    else if (sortOption === 'stock-desc') query = query.order(viewType === 'warehouse' ? 'stock_warehouse' : 'stock_store', { ascending: false });

    const { data, count } = await query.range(from, from + INV_PER_PAGE - 1);
    if (data) { setPaginatedInventory(data); setTotalInvItems(count || 0); }
  };

  useEffect(() => { loadInventory(); }, [invPage, inventorySearch, sortOption, viewType]);

  const handleSaveEdit = async () => {
    if (Number(editFormData.cost_price) < 0 || Number(editFormData.price) < 0 || Number(editFormData.msp) < 0) return showAlert("Prices cannot be negative numbers.", "Error");
    if (Number(editFormData.msp) < Number(editFormData.cost_price)) return showAlert("MSP cannot be lower than the Cost Price.", "Error");
    if (Number(editFormData.msp) > Number(editFormData.price)) return showAlert("MSP cannot be higher than MRP.", "Error");
    try {
      const { error } = await supabase.from('inventory').update({ name: editFormData.name, cost_price: Number(editFormData.cost_price || 0), msp: Number(editFormData.msp || 0), price: Number(editFormData.price || 0), stock_warehouse: Number(editFormData.stock_warehouse || 0), stock_store: Number(editFormData.stock_store || 0), unit: editFormData.unit }).eq('barcode', editingBarcode);
      if (error) throw error;
      setEditingBarcode(null); loadInventory(); 
    } catch (e) { showAlert(e.message || "Error updating item.", "System Error"); }
  };

  const handleDeleteClick = (barcode) => showConfirm("Remove this item from the active list?", async () => { await supabase.from('inventory').update({ is_active: false }).eq('barcode', barcode); loadInventory(); });
  const maxPages = Math.max(1, Math.ceil(totalInvItems / INV_PER_PAGE));
  const safeInvPage = Math.min(invPage, maxPages - 1);

  return (
    <div className="flex flex-col flex-1 pb-4 animate-fade-in">
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <input type="text" placeholder="Search Barcode or Name..." value={inventorySearch} onChange={e=>{setInventorySearch(e.target.value); setInvPage(0);}} className={`h-9 border-2 border-gray-300 bg-white px-3 text-sm w-full md:flex-1 rounded-none focus:outline-none focus:border-[#0078D7] ${viewType === 'store' && 'mb-4 md:mb-0'}`} />
        <div className="relative w-full md:w-[260px] flex-shrink-0">
          <select value={sortOption} onChange={(e) => {setSortOption(e.target.value); setInvPage(0);}} className="h-9 w-full border-2 border-gray-300 bg-white pl-3 pr-8 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer font-medium text-gray-700">
            <option value="barcode-asc">Barcode (Low to High)</option><option value="barcode-desc">Barcode (High to Low)</option><option value="name-asc">Name (A-Z)</option><option value="name-desc">Name (Z-A)</option>
            {viewType === 'warehouse' && (<><option value="stock-asc">Quantity (Low-High)</option><option value="stock-desc">Quantity (High-Low)</option></>)}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500"><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg></div>
        </div>
      </div>
      <div className={`border border-gray-400 overflow-x-auto bg-white flex-1 min-h-[300px] rounded-none shadow-sm`}>
        <table className={`w-full text-left border-collapse min-w-[${viewType === 'warehouse' ? '900px' : '600px'}]`}>
          <thead className="bg-[#f9f9f9] sticky top-0 border-b border-gray-400">
            <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              <th className={`p-3 border-r border-gray-200 ${viewType === 'store' ? 'w-32' : 'w-24'}`}>Barcode</th><th className="p-3 border-r border-gray-200">Item Name</th>
              {viewType === 'warehouse' ? (<><th className="p-3 border-r border-gray-200 text-center w-28">Cost</th><th className="p-3 border-r border-gray-200 text-center w-28">MSP</th></>) : null}
              <th className={`p-3 border-r border-gray-200 text-center ${viewType === 'warehouse' ? 'w-28' : 'w-32'}`}>MRP</th>
              <th className={`p-3 text-center ${viewType === 'warehouse' ? 'border-r border-gray-200 w-28' : 'w-32'}`}>{viewType === 'warehouse' ? 'Whse Qty' : 'Store Qty'}</th>
              {viewType === 'warehouse' && <th className="p-3 text-center w-40">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 border-b border-gray-400">
            {paginatedInventory.length === 0 ? (
              <tr><td colSpan={viewType === 'warehouse' ? "7" : "4"} className="p-8 text-center text-gray-500 text-sm font-semibold">No items found matching the search.</td></tr>
            ) : paginatedInventory.map(item => (
              <tr key={item.id} className="hover:bg-[#f3f3f3] transition-none">
                <td className="p-3 border-r border-gray-200 text-sm font-semibold tracking-wider text-[#0078D7]">{item.barcode}</td>
                {editingBarcode === item.barcode && viewType === 'warehouse' ? (
                  <>
                    <td className="p-1 border-r border-gray-200"><input type="text" value={editFormData.name ?? ''} onChange={e=>setEditFormData({...editFormData,name:e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                    <td className="p-1 border-r border-gray-200"><input type="number" step="1" min="0" value={editFormData.cost_price ?? ''} onChange={e=>setEditFormData({...editFormData,cost_price:e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                    <td className="p-1 border-r border-gray-200"><input type="number" step="1" min="0" value={editFormData.msp ?? ''} onChange={e=>setEditFormData({...editFormData,msp:e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                    <td className="p-1 border-r border-gray-200"><input type="number" step="1" min="0" value={editFormData.price ?? ''} onChange={e=>setEditFormData({...editFormData,price:e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                    <td className="p-1 border-r border-gray-200"><input type="number" step="any" min="0" value={editFormData.stock_warehouse ?? ''} onChange={e=>setEditFormData({...editFormData,stock_warehouse:e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
                    <td className="p-2 flex gap-1 justify-center">
                      <button onClick={handleSaveEdit} className="h-8 bg-[#107c10] hover:bg-[#0e6d0e] text-white px-3 text-xs font-semibold rounded-none border border-transparent focus:outline-none">Save</button>
                      <button onClick={()=>setEditingBarcode(null)} className="h-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black px-3 text-xs font-semibold border border-gray-400 rounded-none focus:outline-none">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-3 border-r border-gray-200 text-sm text-black font-medium">{item.name}</td>
                    {viewType === 'warehouse' ? (<><td className="p-3 border-r border-gray-200 text-sm text-center">{Number(item.cost_price||0).toFixed(2)}</td><td className="p-3 border-r border-gray-200 text-sm text-center">{Number(item.msp||0).toFixed(2)}</td></>) : null}
                    <td className="p-3 border-r border-gray-200 text-sm text-center">{viewType === 'store' && '₹'}{Number(item.price||0).toFixed(2)}</td>
                    <td className="p-3 border-r border-gray-200 text-sm text-center text-black font-bold">{viewType === 'warehouse' ? item.stock_warehouse : item.stock_store}</td>
                    {viewType === 'warehouse' && (
                      <td className="p-2 flex gap-2 justify-center items-center h-full">
                        <button onClick={()=> {setEditingBarcode(item.barcode); setEditFormData({ ...item });}} className="h-8 bg-[#e6e6e6] hover:bg-[#cccccc] border border-gray-400 text-black px-4 text-xs font-semibold rounded-none focus:outline-none">Edit</button>
                        <button onClick={()=>handleDeleteClick(item.barcode)} className="h-8 bg-white border border-[#e81123] text-[#e81123] hover:bg-[#e81123] hover:text-white px-3 text-xs font-semibold rounded-none focus:outline-none">Remove</button>
                      </td>
                    )}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between items-center mt-4 bg-[#f3f3f3] p-3 border border-gray-400 rounded-none shadow-sm">
        <button onClick={()=>setInvPage(p=>Math.max(0,p-1))} disabled={invPage===0} className="h-8 px-6 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none">Previous</button>
        <span className="text-sm font-semibold text-gray-700">Page {safeInvPage + 1} of {maxPages}</span>
        <button onClick={()=>setInvPage(p=>p+1)} disabled={(safeInvPage+1)*INV_PER_PAGE>=totalInvItems} className="h-8 px-6 bg-white border border-gray-400 text-sm font-semibold disabled:opacity-50 rounded-none focus:outline-none">Next</button>
      </div>
    </div>
  );
}