import { useState, useEffect } from 'react';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient';

export default function OwnerCatalog({ showAlert }) {
  const [newItem, setNewItem] = useState({ name: '', price: '', cost_price: '', msp: '', stock_warehouse: '', unit: 'PCS' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nextBarcode, setNextBarcode] = useState('Loading...');
  
  const [printModal, setPrintModal] = useState({ isOpen: false, item: null, qty: 1 });

  const fetchNextBarcode = async () => {
    try {
      const { data: latestItem } = await supabase.from('inventory').select('barcode').order('barcode', { ascending: false }).limit(1);
      setNextBarcode(latestItem && latestItem.length > 0 ? (parseInt(latestItem[0].barcode, 10) + 1).toString() : '1001');
    } catch(e) { setNextBarcode('Error'); }
  };

  useEffect(() => { fetchNextBarcode(); }, []);

  const handleAddItem = async (e) => {
    e.preventDefault(); 
    if (!newItem.name || !newItem.price || !newItem.cost_price || !newItem.msp) return showAlert("Please fill all the boxes.", "Error");
    if (Number(newItem.cost_price) < 0 || Number(newItem.price) < 0 || Number(newItem.msp) < 0) return showAlert("Prices cannot be negative numbers.", "Error");
    if (Number(newItem.msp) < Number(newItem.cost_price)) return showAlert("MSP cannot be lower than the Cost Price.", "Error");
    if (Number(newItem.msp) > Number(newItem.price)) return showAlert("MSP cannot be higher than MRP.", "Error");

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
      if (!success) throw new Error("The system is busy. Please try again.");
      
      const savedItemData = { barcode: safeBarcode, name: newItem.name, price: Number(newItem.price || 0) };
      
      setNewItem({ name: '', cost_price: '', msp: '', price: '', unit: 'PCS' }); 
      fetchNextBarcode(); 
      
      setPrintModal({ isOpen: true, item: savedItemData, qty: 1 });

    } catch (e) { showAlert(e.message || "Error saving item.", "System Error"); } finally { setIsSubmitting(false); }
  };

  const handleClosePrintModal = () => {
    setPrintModal({ isOpen: false, item: null, qty: 1 });
  };

  // Safe quantity helper for printing and looping
  const safePrintQty = printModal.qty === '' || printModal.qty < 1 ? 1 : parseInt(printModal.qty);

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
                    // Allow the box to be completely empty while they are deleting the '1' to type a new number
                    setPrintModal({...printModal, qty: val === '' ? '' : parseInt(val)});
                  }} 
                  onBlur={() => {
                    // If they click away and the box is still empty, gently put a '1' back in
                    if (printModal.qty === '' || printModal.qty < 1) {
                      setPrintModal({...printModal, qty: 1});
                    }
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
        <form onSubmit={handleAddItem} className="flex flex-col xl:flex-row gap-4 items-end w-full">
          <div className="flex flex-col w-full xl:w-32 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Barcode</label><input type="text" value={nextBarcode} disabled className="h-10 border-2 border-gray-300 bg-[#e6e6e6] text-[#0078D7] px-3 text-sm rounded-none focus:outline-none text-center font-bold" /></div>
          <div className="flex flex-col w-full xl:w-auto flex-1"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Product Name</label><input type="text" value={newItem.name} onChange={e=>setNewItem({...newItem,name:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col w-full xl:w-24 shrink-0">
            <label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Unit Type</label>
            <div className="relative w-full">
              <select value={newItem.unit} onChange={e=>setNewItem({...newItem,unit:e.target.value})} className="h-10 w-full border-2 border-gray-300 bg-white pl-3 pr-8 text-sm rounded-none focus:outline-none focus:border-[#0078D7] appearance-none cursor-pointer font-medium text-gray-700">
                <option value="PCS">Pieces</option><option value="GRAMS">Grams</option><option value="SQFT">Sq Ft</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600"><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg></div>
            </div>
          </div>
          <div className="flex flex-col w-full xl:w-28 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Cost (₹)</label><input type="number" step="1" min="0" value={newItem.cost_price} onChange={e=>setNewItem({...newItem,cost_price:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col w-full xl:w-28 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">MSP (₹)</label><input type="number" step="1" min="0" value={newItem.msp} onChange={e=>setNewItem({...newItem,msp:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col w-full xl:w-28 shrink-0"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">MRP (₹)</label><input type="number" step="1" min="0" value={newItem.price} onChange={e=>setNewItem({...newItem,price:e.target.value})} className="h-10 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="w-full xl:w-32 shrink-0 mt-4 xl:mt-0"><button type="submit" disabled={isSubmitting} className="h-10 bg-[#0078D7] hover:bg-[#005a9e] text-white px-4 text-sm font-semibold rounded-none border border-transparent focus:outline-none focus:ring-2 focus:ring-[#0078D7] focus:ring-offset-1 w-full flex items-center justify-center">{isSubmitting ? 'Wait...' : 'Save Item'}</button></div>
        </form>
      </div>
    </div>
  );
}