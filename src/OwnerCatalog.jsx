import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function OwnerCatalog({ showAlert }) {
  const [newItem, setNewItem] = useState({ name: '', price: '', cost_price: '', msp: '', stock_warehouse: '', unit: 'PCS' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nextBarcode, setNextBarcode] = useState('Loading...');

  const fetchNextBarcode = async () => {
    try {
      const { data: latestItem } = await supabase.from('inventory').select('barcode').order('barcode', { ascending: false }).limit(1);
      setNextBarcode(latestItem && latestItem.length > 0 ? (parseInt(latestItem[0].barcode, 10) + 1).toString() : '1001');
    } catch(e) { setNextBarcode('Error'); }
  };

  useEffect(() => { fetchNextBarcode(); }, []);

  const handleAddItem = async (e) => {
    e.preventDefault(); 
    if (!newItem.name || !newItem.price || !newItem.cost_price || !newItem.msp) return showAlert("Fill all mandatory fields.", "Validation Error");
    if (Number(newItem.cost_price) < 0 || Number(newItem.price) < 0 || Number(newItem.msp) < 0) return showAlert("Values cannot be negative.", "Validation Error");
    if (Number(newItem.msp) < Number(newItem.cost_price)) return showAlert("MSP cannot be lower than Cost Price.", "Validation Error");
    if (Number(newItem.msp) > Number(newItem.price)) return showAlert("MSP cannot be greater than MRP.", "Validation Error");

    try {
      setIsSubmitting(true);
      let success = false; let attempts = 0; let safeBarcode = nextBarcode;
      while (!success && attempts < 3) {
        try {
          const { error } = await supabase.from('inventory').insert([{ barcode: safeBarcode, name: newItem.name, cost_price: Number(newItem.cost_price || 0), msp: Number(newItem.msp || 0), price: Number(newItem.price || 0), stock_warehouse: 0, stock_store: 0, unit: newItem.unit, is_active: true }]);
          if (error) throw error; success = true; 
        } catch (insertError) {
          if (insertError.message?.includes('duplicate key') || insertError.code === '23505') { attempts++; safeBarcode = (parseInt(safeBarcode, 10) + 1).toString(); } else throw insertError; 
        }
      }
      if (!success) throw new Error("System traffic is extremely high. Try again.");
      setNewItem({ name: '', cost_price: '', msp: '', price: '', unit: 'PCS' }); fetchNextBarcode(); showAlert(`Record committed. Assigned SKU: ${safeBarcode}`, "Success");
    } catch (e) { showAlert(e.message || "Error creating record.", "System Error"); } finally { setIsSubmitting(false); }
  };

  return (
    <div className="w-full animate-fade-in">
      <h1 className="text-2xl font-light text-black mb-6">Catalog Management</h1>
      <div className="bg-[#f9f9f9] border border-gray-400 p-6 w-full rounded-none">
        <h2 className="text-sm font-semibold uppercase text-gray-600 mb-6 border-b border-gray-300 pb-2 tracking-wider">Registration Profile</h2>
        <form onSubmit={handleAddItem} className="flex flex-col xl:flex-row gap-4 items-end w-full">
          <div className="flex flex-col w-full xl:w-32 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">SKU Code</label><input type="text" value={nextBarcode} disabled className="border-2 border-gray-300 bg-[#e6e6e6] text-[#0078D7] px-3 py-1.5 text-sm rounded-none focus:outline-none text-center font-bold" /></div>
          <div className="flex flex-col w-full xl:w-auto flex-1"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Nomenclature</label><input type="text" value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col w-full xl:w-24 shrink-0">
            <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">UOM</label>
            <div className="relative w-full">
              <select value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} className="w-full border-2 border-gray-300 bg-white pl-3 pr-8 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer font-medium text-gray-700">
                <option value="PCS">PCS</option><option value="GRAMS">GRAMS</option><option value="SQFT">SQFT</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600"><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg></div>
            </div>
          </div>
          <div className="flex flex-col w-full xl:w-28 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Cost (₹)</label><input type="number" step="1" min="0" value={newItem.cost_price} onChange={e=>setNewItem({...newItem,cost_price:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col w-full xl:w-28 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">MSP (₹)</label><input type="number" step="1" min="0" value={newItem.msp} onChange={e=>setNewItem({...newItem,msp:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col w-full xl:w-28 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">MRP (₹)</label><input type="number" step="1" min="0" value={newItem.price} onChange={e=>setNewItem({...newItem,price:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-1.5 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="w-full xl:w-32 shrink-0 mt-4 xl:mt-0"><button type="submit" disabled={isSubmitting} className="bg-[#0078D7] hover:bg-[#005a9e] text-white px-4 h-[35px] text-sm font-semibold rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black w-full flex items-center justify-center">{isSubmitting ? 'Wait...' : 'Commit'}</button></div>
        </form>
      </div>
    </div>
  );
}