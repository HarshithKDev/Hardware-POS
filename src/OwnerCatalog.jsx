import { useState, useEffect } from 'react';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient';

export default function OwnerCatalog({ showAlert }) {
  const [newItem, setNewItem] = useState({ name: '', category: '', sub_category: '', price: '', cost_price: '', msp: '', stock_warehouse: '', unit: 'PCS' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nextBarcode, setNextBarcode] = useState('Loading...');
  
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  
  const [printModal, setPrintModal] = useState({ isOpen: false, item: null, qty: 1 });

  const fetchInitialData = async () => {
    try {
      const { data: latestItem } = await supabase.from('inventory').select('barcode').order('barcode', { ascending: false }).limit(1);
      setNextBarcode(latestItem && latestItem.length > 0 ? (parseInt(latestItem[0].barcode, 10) + 1).toString() : '1001');
      
      const { data: catData } = await supabase.from('categories').select('*');
      const { data: subData } = await supabase.from('subcategories').select('*');
      if (catData) setCategories(catData);
      if (subData) setSubcategories(subData);
    } catch(e) { setNextBarcode('Error'); }
  };

  useEffect(() => { fetchInitialData(); }, []);

  const handleAddItem = async (e) => {
    e.preventDefault(); 
    if (!newItem.name || !newItem.price || !newItem.cost_price || !newItem.msp) return showAlert("Please fill all the boxes.", "Error");
    if (!newItem.category || !newItem.sub_category) return showAlert("Please select a Category and Sub-category.", "Error");
    if (Number(newItem.cost_price) < 0 || Number(newItem.price) < 0 || Number(newItem.msp) < 0) return showAlert("Prices cannot be negative numbers.", "Error");
    if (Number(newItem.msp) < Number(newItem.cost_price)) return showAlert("MSP cannot be lower than the Cost Price.", "Error");
    if (Number(newItem.msp) > Number(newItem.price)) return showAlert("MSP cannot be higher than MRP.", "Error");

    try {
      setIsSubmitting(true);
      let success = false; let attempts = 0; let safeBarcode = nextBarcode;
      while (!success && attempts < 3) {
        try {
          // Payload (the data being sent to the database)
          const { error } = await supabase.from('inventory').insert([{ 
            barcode: safeBarcode, 
            name: newItem.name, 
            category: newItem.category,
            sub_category: newItem.sub_category,
            cost_price: Number(newItem.cost_price || 0), 
            msp: Number(newItem.msp || 0), 
            price: Number(newItem.price || 0), 
            stock_warehouse: 0, 
            stock_store: 0, 
            unit: newItem.unit, 
            is_active: true 
          }]);
          if (error) throw error; success = true; 
        } catch (insertError) {
          if (insertError.message?.includes('duplicate key') || insertError.code === '23505') { attempts++; safeBarcode = (parseInt(safeBarcode, 10) + 1).toString(); } else throw insertError; 
        }
      }
      if (!success) throw new Error("The system is busy. Please try again.");
      
      const savedItemData = { barcode: safeBarcode, name: newItem.name, price: Number(newItem.price || 0) };
      
      setNewItem({ name: '', category: '', sub_category: '', cost_price: '', msp: '', price: '', unit: 'PCS' }); 
      fetchInitialData(); 
      setPrintModal({ isOpen: true, item: savedItemData, qty: 1 });

    } catch (e) { showAlert(e.message || "Error saving item.", "System Error"); } finally { setIsSubmitting(false); }
  };

  const handleClosePrintModal = () => { setPrintModal({ isOpen: false, item: null, qty: 1 }); };
  const safePrintQty = printModal.qty === '' || printModal.qty < 1 ? 1 : parseInt(printModal.qty);

  const availableSubcategories = subcategories.filter(sub => sub.category_name === newItem.category);

  return (
    <div className="w-full animate-fade-in relative">
      
      {printModal.isOpen && (
        <style>{`
          @media print { 
            body * { visibility: hidden !important; } 
            #new-barcode-print, #new-barcode-print * { visibility: visible !important; } 
            #new-barcode-print { position: absolute; left: 0; top: 0; width: 100%; display: flex !important; flex-wrap: wrap; align-content: flex-start; } 
          }
        `}</style>
      )}

      {printModal.isOpen && printModal.item && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] print:hidden px-4">
          <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-[#f3f3f3] flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-300">
              <span className="text-xs font-semibold uppercase tracking-wider text-black">Print Barcode Labels</span>
              <button onClick={handleClosePrintModal} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 focus:outline-none rounded-none">✕</button>
            </div>
            
            <div className="p-6 bg-white flex flex-col items-center">
              <p className="text-sm text-[#107c10] font-bold mb-4">✓ Item Registered Successfully</p>
              
              <div className="border border-gray-300 p-4 mb-5 bg-[#f9f9f9] text-center w-[50mm] shadow-sm">
                <p className="text-xs font-bold text-black mb-1 truncate">{printModal.item.name}</p>
                <div className="flex justify-center bg-white p-1 border border-gray-200">
                  <Barcode value={printModal.item.barcode} width={1.2} height={40} fontSize={12} margin={0} />
                </div>
                <p className="text-sm font-bold text-black mt-1">₹{printModal.item.price.toFixed(2)}</p>
              </div>
              
              <div className="w-full">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2 text-center">Number of Labels to Print</label>
                <input 
                  type="number" 
                  min="1" 
                  value={printModal.qty} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setPrintModal({...printModal, qty: val === '' ? '' : parseInt(val)});
                  }} 
                  onBlur={() => {
                    if (printModal.qty === '' || printModal.qty < 1) setPrintModal({...printModal, qty: 1});
                  }}
                  className="w-full h-10 px-3 border-2 border-gray-300 bg-white text-lg rounded-none focus:outline-none focus:border-[#0078D7] text-center font-bold" 
                />
              </div>
            </div>
            
            <div className="p-3 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => { window.print(); handleClosePrintModal(); }} className="h-9 px-8 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold rounded-none focus:outline-none focus:ring-2 focus:ring-[#0078D7] focus:ring-offset-1">Print Now</button>
              <button onClick={handleClosePrintModal} className="h-9 px-6 bg-[#e6e6e6] hover:bg-[#cccccc] text-black text-sm font-semibold border border-gray-400 rounded-none focus:outline-none">Skip</button>
            </div>
          </div>
        </div>
      )}

      {printModal.isOpen && printModal.item && (
        <div id="new-barcode-print" className="hidden print:flex flex-wrap content-start justify-start bg-white w-full h-full">
          {/* Array.from (a method to create a new array from an iterable object) */}
          {Array.from({ length: safePrintQty }).map((_, index) => (
            <div key={`${printModal.item.barcode}-${index}`} className="flex flex-col items-center justify-center p-1 border-gray-200 w-[50mm] h-[25mm] overflow-hidden break-inside-avoid mb-2 mr-2">
               <p className="text-[9px] font-bold text-black truncate w-full text-center leading-none mb-1">{printModal.item.name}</p>
               <Barcode value={printModal.item.barcode} width={1} height={25} fontSize={10} margin={0} displayValue={true} />
               <p className="text-[10px] font-bold text-black leading-none mt-1">₹{printModal.item.price.toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}

      <h1 className="text-2xl font-light text-black mb-6">Add New Item</h1>
      <div className="bg-[#f3f3f3] border border-gray-400 p-6 w-full rounded-none">
        <h2 className="text-sm font-semibold uppercase text-gray-600 mb-6 border-b border-gray-300 pb-2 tracking-wider">Item Details</h2>
        <form onSubmit={handleAddItem} className="flex flex-wrap gap-4 items-end w-full">
          <div className="flex flex-col w-32 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Barcode</label><input type="text" value={nextBarcode} disabled className="h-10 border-2 border-gray-300 bg-[#e6e6e6] text-[#0078D7] px-3 text-sm text-center font-bold focus:outline-none" /></div>
          <div className="flex flex-col flex-1 min-w-[200px]"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Product Name</label><input type="text" value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          
          <div className="flex flex-col w-40 shrink-0">
            <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Category</label>
            <select value={newItem.category} onChange={e=>setNewItem({...newItem, category: e.target.value, sub_category: ''})} className="h-10 border-2 border-gray-300 bg-white px-2 text-sm rounded-none focus:outline-none focus:border-[#0078D7] cursor-pointer">
              <option value="">Select</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          
          <div className="flex flex-col w-40 shrink-0">
            <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Sub-Category</label>
            <select value={newItem.sub_category} onChange={e=>setNewItem({...newItem, sub_category: e.target.value})} disabled={!newItem.category} className="h-10 border-2 border-gray-300 bg-white px-2 text-sm rounded-none focus:outline-none focus:border-[#0078D7] disabled:bg-gray-100 disabled:cursor-not-allowed cursor-pointer">
              <option value="">Select</option>
              {availableSubcategories.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>

          <div className="flex flex-col w-24 shrink-0">
            <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Unit Type</label>
            <select value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-2 text-sm rounded-none focus:outline-none focus:border-[#0078D7] cursor-pointer font-medium text-gray-700">
              <option value="PCS">Pieces</option><option value="GRAMS">Grams</option><option value="SQFT">Sq Ft</option>
            </select>
          </div>
          
          <div className="flex flex-col w-24 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Cost (₹)</label><input type="number" step="1" min="0" value={newItem.cost_price} onChange={e=>setNewItem({...newItem,cost_price:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col w-24 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">MSP (₹)</label><input type="number" step="1" min="0" value={newItem.msp} onChange={e=>setNewItem({...newItem,msp:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col w-24 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">MRP (₹)</label><input type="number" step="1" min="0" value={newItem.price} onChange={e=>setNewItem({...newItem,price:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="w-full xl:w-32 shrink-0"><button type="submit" disabled={isSubmitting} className="h-10 bg-[#0078D7] hover:bg-[#005a9e] text-white px-4 text-sm font-semibold rounded-none focus:outline-none w-full flex items-center justify-center">{isSubmitting ? 'Wait...' : 'Save Item'}</button></div>
        </form>
      </div>
    </div>
  );
}