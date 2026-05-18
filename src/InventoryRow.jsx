import { useState } from 'react';

export default function InventoryRow({ item, viewType, categories, onSave, onRemove }) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(item);

  const handleSave = () => {
    onSave(formData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setFormData(item); // Reset local changes back to original
    setIsEditing(false);
  };

  if (isEditing && viewType === 'warehouse') {
    return (
      <tr className="bg-[#f3f3f3] transition-none">
        <td className="p-3 border-r border-gray-200 text-sm font-semibold tracking-wider text-[#0078D7]">{item.barcode}</td>
        <td className="p-1 border-r border-gray-200"><input type="text" value={formData.name || ''} onChange={e=>setFormData({...formData, name: e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
        <td className="p-1 border-r border-gray-200">
          <select value={formData.category || ''} onChange={e=>setFormData({...formData, category: e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm rounded-none focus:outline-none focus:border-[#0078D7]">
            <option value="">None</option>
            {categories?.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </td>
        <td className="p-1 border-r border-gray-200"><input type="number" step="1" min="0" value={formData.cost_price ?? ''} onChange={e=>setFormData({...formData, cost_price: e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
        <td className="p-1 border-r border-gray-200"><input type="number" step="1" min="0" value={formData.msp ?? ''} onChange={e=>setFormData({...formData, msp: e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
        <td className="p-1 border-r border-gray-200"><input type="number" step="1" min="0" value={formData.price ?? ''} onChange={e=>setFormData({...formData, price: e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
        <td className="p-1 border-r border-gray-200"><input type="number" step="any" min="0" value={formData.stock_warehouse ?? ''} onChange={e=>setFormData({...formData, stock_warehouse: e.target.value})} className="h-8 border border-gray-400 px-2 w-full text-sm text-center rounded-none focus:outline-none focus:border-[#0078D7]" /></td>
        <td className="p-2 flex gap-1 justify-center">
          <button onClick={handleSave} className="h-8 bg-[#107c10] hover:bg-[#0e6d0e] text-white px-3 text-xs font-semibold rounded-none border border-transparent focus:outline-none">Save</button>
          <button onClick={handleCancel} className="h-8 bg-[#e6e6e6] hover:bg-[#cccccc] text-black px-3 text-xs font-semibold border border-gray-400 rounded-none focus:outline-none">Cancel</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-[#f3f3f3] transition-none">
      <td className="p-3 border-r border-gray-200 text-sm font-semibold tracking-wider text-[#0078D7]">{item.barcode}</td>
      <td className="p-3 border-r border-gray-200 text-sm text-black font-medium">{item.name}</td>
      <td className="p-3 border-r border-gray-200 text-sm text-gray-700">{item.category || '-'}</td>
      {viewType === 'warehouse' && (
        <>
          <td className="p-3 border-r border-gray-200 text-sm text-center">{Number(item.cost_price||0).toFixed(2)}</td>
          <td className="p-3 border-r border-gray-200 text-sm text-center">{Number(item.msp||0).toFixed(2)}</td>
        </>
      )}
      <td className="p-3 border-r border-gray-200 text-sm text-center">{viewType === 'store' && '₹'}{Number(item.price||0).toFixed(2)}</td>
      <td className="p-3 border-r border-gray-200 text-sm text-center text-black font-bold">{viewType === 'warehouse' ? item.stock_warehouse : item.stock_store}</td>
      {viewType === 'warehouse' && (
        <td className="p-2 flex gap-2 justify-center items-center h-full">
          <button onClick={() => { setIsEditing(true); setFormData(item); }} className="h-8 bg-[#e6e6e6] hover:bg-[#cccccc] border border-gray-400 text-black px-4 text-xs font-semibold rounded-none focus:outline-none">Edit</button>
          <button onClick={() => onRemove(item.barcode)} className="h-8 bg-white border border-[#e81123] text-[#e81123] hover:bg-[#e81123] hover:text-white px-3 text-xs font-semibold rounded-none focus:outline-none">Remove</button>
        </td>
      )}
    </tr>
  );
}