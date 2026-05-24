import { useState } from 'react';
import { supabase } from './supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { generateId } from './utils';
import { BARCODE_START_VALUE, BARCODE_RETRY_ATTEMPTS, UNIT_TYPES, STALE_TIME_5MIN } from './constants';
import { Spinner } from './SharedUI';

export default function OwnerCatalog() {
  const { showAlert } = useApp();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '', category: '', sub_category: '', cost_price: '',
    msp: '', price: '', unit: 'PCS'
  });
  const [nextBarcode, setNextBarcode] = useState('');
  const [printLabelCount, setPrintLabelCount] = useState(0);

  // Fetch Categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME_5MIN,
  });

  // Fetch Subcategories
  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcategories').select('*').order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME_5MIN,
  });

  // Fetch next barcode
  useQuery({
    queryKey: ['nextBarcode'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory').select('barcode').order('barcode', { ascending: false }).limit(1);
      if (error) throw error;
      const next = data && data.length > 0 ? (parseInt(data[0].barcode, 10) + 1).toString() : BARCODE_START_VALUE;
      setNextBarcode(next);
      return next;
    },
  });

  const generateBarcodeLabelsHtml = (itemData) => {
    let html = `<html><head><style>
      @page { margin: 0; size: 50mm 25mm; }
      body { margin: 0; padding: 0; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #fff; color: #000; }
      .label { width: 48mm; height: 23mm; text-align: center; border: 1px solid #ddd; padding: 2mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; justify-content: space-between; }
      .label:last-child { page-break-after: auto; }
      .name { font-size: 10px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; }
      .price { font-size: 12px; font-weight: bold; margin-bottom: 2px; }
      .barcode-text { font-size: 14px; letter-spacing: 2px; font-family: monospace; }
    </style></head><body>`;
    for (let i = 0; i < printLabelCount; i++) {
      html += `
        <div class="label">
          <div class="name">${itemData.name}</div>
          <div class="price">MRP: ₹${itemData.price}</div>
          <svg id="barcode-${i}"></svg>
          <div class="barcode-text">${itemData.barcode}</div>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
        <script>
          JsBarcode("#barcode-${i}", "${itemData.barcode}", { format: "CODE128", width: 1.5, height: 30, displayValue: false, margin: 0 });
        </script>
      `;
    }
    html += `</body><script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); }</script></html>`;
    return html;
  };

  const addItemMutation = useMutation({
    mutationFn: async (itemData) => {
      let currentBarcode = itemData.barcode;
      // Retry loop to handle TOCTOU collision when multiple users create items at once
      for (let attempt = 0; attempt < BARCODE_RETRY_ATTEMPTS; attempt++) {
        const { error } = await supabase.from('inventory').insert([{
          id: generateId(),
          barcode: currentBarcode,
          name: itemData.name,
          category: itemData.category || null,
          sub_category: itemData.sub_category || null,
          cost_price: Number(itemData.cost_price),
          msp: Number(itemData.msp),
          price: Number(itemData.price),
          stock_warehouse: 0,
          stock_store: 0,
          unit: itemData.unit,
          is_active: true
        }]);

        if (!error) return { ...itemData, barcode: currentBarcode };

        if (error.code === '23505' && error.message.includes('barcode')) {
          console.warn(`Barcode ${currentBarcode} taken, retrying... (Attempt ${attempt + 1}/${BARCODE_RETRY_ATTEMPTS})`);
          const { data: latest } = await supabase.from('inventory').select('barcode').order('barcode', { ascending: false }).limit(1);
          currentBarcode = latest && latest.length > 0 ? (parseInt(latest[0].barcode, 10) + 1).toString() : (parseInt(currentBarcode, 10) + 1).toString();
        } else {
          throw error;
        }
      }
      throw new Error(`Failed to generate a unique barcode after ${BARCODE_RETRY_ATTEMPTS} attempts. Please try again.`);
    },
    onSuccess: (savedItem) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['nextBarcode'] });
      
      if (printLabelCount > 0) {
        const printWin = window.open('', '_blank');
        if (printWin) {
          printWin.document.write(generateBarcodeLabelsHtml(savedItem));
          printWin.document.close();
        } else {
          showAlert("Popup blocked! Could not print labels.", "Notice");
        }
      }
      
      setForm({ name: '', category: '', sub_category: '', cost_price: '', msp: '', price: '', unit: 'PCS' });
      setPrintLabelCount(0);
      showAlert(`Added "${savedItem.name}" with Barcode ${savedItem.barcode}.`, "Success");
    },
    onError: (e) => {
      showAlert(e.message, "Failed to Add Item");
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return showAlert("Item name is required.", "Validation Error");
    if (Number(form.msp) < Number(form.cost_price)) return showAlert("MSP cannot be lower than Cost Price.", "Validation Error");
    if (Number(form.price) < Number(form.msp)) return showAlert("Selling Price cannot be lower than MSP.", "Validation Error");
    if (!nextBarcode) return showAlert("System is generating the next barcode, please wait.", "Notice");

    addItemMutation.mutate({ ...form, barcode: nextBarcode });
  };

  return (
    <div className="flex flex-col h-full gap-6 animate-fade-in max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-light mb-2" style={{ color: 'var(--text-primary)' }}>Register New Item</h1>
        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Assigned Barcode: <span className="font-mono font-bold text-lg" style={{ color: 'var(--color-accent)' }}>{nextBarcode || '...'}</span>
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          Note: This barcode is provisional. If someone else registers an item at the exact same time, the system will automatically assign the next available number.
        </p>
      </div>
      
      <form onSubmit={handleSubmit} className="p-4 md:p-8 shadow-sm flex flex-col gap-6" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-name">Nomenclature</label>
            <input id="item-name" type="text" autoFocus required value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="e.g. 10mm Steel Rebar" className="w-full h-10 px-3 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-cat">Category</label>
            <div className="relative">
              <select id="item-cat" value={form.category} onChange={(e) => setForm({...form, category: e.target.value, sub_category: ''})} className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                <option value="">-- None --</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg></div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-subcat">Sub-category</label>
            <div className="relative">
              <select id="item-subcat" value={form.sub_category} onChange={(e) => setForm({...form, sub_category: e.target.value})} disabled={!form.category} className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer disabled:cursor-not-allowed" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                <option value="">-- None --</option>
                {subcategories.filter(sub => sub.category_name === form.category).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg></div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-cost">Cost Price (₹)</label>
            <input id="item-cost" type="number" step="any" min="0" required value={form.cost_price} onChange={(e) => setForm({...form, cost_price: e.target.value})} placeholder="0.00" className="w-full h-10 px-3 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-msp">Minimum Selling Price (₹)</label>
            <input id="item-msp" type="number" step="any" min="0" required value={form.msp} onChange={(e) => setForm({...form, msp: e.target.value})} placeholder="0.00" className="w-full h-10 px-3 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-mrp">Maximum Retail Price (₹)</label>
            <input id="item-mrp" type="number" step="any" min="0" required value={form.price} onChange={(e) => setForm({...form, price: e.target.value})} placeholder="0.00" className="w-full h-10 px-3 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-unit">Unit Type</label>
            <div className="relative">
              <select id="item-unit" value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                {UNIT_TYPES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg></div>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-6 flex flex-col md:flex-row justify-between items-center gap-4" style={{ borderTop: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <label htmlFor="print-qty" className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Print Labels:</label>
            <input 
              id="print-qty"
              type="number" 
              min="0" 
              max="50" 
              value={printLabelCount} 
              onChange={(e) => setPrintLabelCount(Math.max(0, parseInt(e.target.value) || 0))} 
              className="w-20 h-10 px-2 text-center text-sm font-bold focus:outline-none" 
              style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
            />
          </div>
          <button 
            type="submit" 
            disabled={addItemMutation.isPending || !nextBarcode} 
            className="w-full md:w-auto h-10 px-10 text-white text-sm font-semibold uppercase tracking-wider disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 flex justify-center items-center min-w-[200px]" 
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {addItemMutation.isPending ? <Spinner className="w-5 h-5 text-white" /> : 'Save Item'}
          </button>
        </div>
      </form>
    </div>
  );
}