import { useState, useRef } from 'react';
import { supabase } from './supabaseClient';
import { syncInventoryToLocal } from './services/sync';
import * as XLSX from 'xlsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { generateId } from './utils';
import { BARCODE_START_VALUE, BARCODE_RETRY_ATTEMPTS, UNIT_TYPES, STALE_TIME_5MIN } from './constants';
import { Spinner, CreatableDropdown } from './SharedUI';
import { PrintPreviewModal } from './AppModals';
import { saveInventoryBatch } from './services/db';

export default function OwnerCatalog() {
  const { showAlert } = useApp();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '', category: '', sub_category: '', cost_price: '',
    msp: '', price: '', unit: 'PCS', min_quantity: '', item_type: 'standard',
    default_length: '', default_width: ''
  });
  const [nextBarcode, setNextBarcode] = useState('');
  const [printLabelCount, setPrintLabelCount] = useState(0);
  const [barcodePreview, setBarcodePreview] = useState({ isOpen: false, previewHtml: '', printHtml: '' });
  const fileInputRef = useRef(null);

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

  useQuery({
    queryKey: ['nextBarcode'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory').select('barcode');
      if (error) throw error;
      const next = data?.reduce((max, item) => {
        const num = parseInt(item.barcode, 10);
        return !isNaN(num) ? Math.max(max, num) : max;
      }, parseInt(BARCODE_START_VALUE, 10) - 1) || parseInt(BARCODE_START_VALUE, 10) - 1;
      const nextString = (next + 1).toString();
      setNextBarcode(nextString);
      return nextString;
    },
  });

  // Single barcode preview for the modal
  const generateSinglePreviewHtml = (itemData) => {
    return `<html><head>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
      <style>
        body { margin: 0; padding: 20px; font-family: sans-serif; background: #fff; color: #000; display: flex; justify-content: center; align-items: center; min-height: 100vh; box-sizing: border-box; }
        .label { width: 50mm; text-align: center; border: 1px solid #ccc; padding: 3mm; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 2px; }
        .name { font-size: 10px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }
        .price { font-size: 11px; font-weight: bold; }
        .barcode-text { font-size: 12px; letter-spacing: 2px; font-family: monospace; }
      </style></head><body>
      <div class="label">
        <div class="name">${itemData.name}</div>
        <div class="price">MRP: ₹${itemData.price}</div>
        <svg id="barcode-0"></svg>
        <div class="barcode-text">${itemData.barcode}</div>
      </div>
      <script>
        JsBarcode("#barcode-0", "${itemData.barcode}", { format: "CODE128", width: 1.5, height: 30, displayValue: false, margin: 0 });
      </script>
    </body></html>`;
  };

  // Full grid for actual printing (5 per row, A4)
  const generatePrintHtml = (itemData, count) => {
    let html = `<html><head>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
      <style>
        @page { margin: 5mm; size: A4; }
        body { margin: 0; padding: 0; font-family: sans-serif; background: #fff; color: #000; }
        .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2mm; width: 100%; }
        .label { height: 24mm; text-align: center; border: 1px solid #ccc; padding: 1.5mm; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: space-between; overflow: hidden; }
        .name { font-size: 8px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }
        .price { font-size: 9px; font-weight: bold; }
        .barcode-text { font-size: 10px; letter-spacing: 1.5px; font-family: monospace; }
        svg { max-width: 100%; }
      </style></head><body>
      <div class="grid">`;
    for (let i = 0; i < count; i++) {
      html += `
        <div class="label">
          <div class="name">${itemData.name}</div>
          <div class="price">MRP: ₹${itemData.price}</div>
          <svg id="barcode-${i}"></svg>
          <div class="barcode-text">${itemData.barcode}</div>
        </div>`;
    }
    html += `</div>
      <script>
        for (let i = 0; i < ${count}; i++) {
          JsBarcode("#barcode-" + i, "${itemData.barcode}", { format: "CODE128", width: 1.5, height: 25, displayValue: false, margin: 0 });
        }
      </script>
    </body></html>`;
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
          min_quantity: Number(itemData.min_quantity) || 0,
          is_loose_item: itemData.item_type === 'loose',
          is_cuttable: itemData.item_type === 'cuttable',
          default_length: itemData.item_type === 'cuttable' ? (Number(itemData.default_length) || null) : null,
          default_width: (itemData.item_type === 'cuttable' && itemData.unit === 'SQFT') ? (Number(itemData.default_width) || null) : null,
          is_active: true
        }]);

        if (!error) return { 
          ...itemData, 
          barcode: currentBarcode,
          is_cuttable: itemData.item_type === 'cuttable',
          is_loose_item: itemData.item_type === 'loose'
        };

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
    onSuccess: async (savedItem) => {
      try {
        await saveInventoryBatch([savedItem]);
      } catch (err) {
        console.error("Local save failed", err);
      }
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['nextBarcode'] });

      if (printLabelCount > 0) {
        const previewHtml = generateSinglePreviewHtml(savedItem);
        const printHtml = generatePrintHtml(savedItem, printLabelCount);
        setBarcodePreview({ isOpen: true, previewHtml, printHtml });
      }

      setForm({ name: '', category: '', sub_category: '', cost_price: '', msp: '', price: '', unit: 'PCS', min_quantity: '', item_type: 'standard', default_length: '', default_width: '' });
      setPrintLabelCount(0);
      showAlert(`Added "${savedItem.name}" with Barcode ${savedItem.barcode}.`, "Success");
    },
    onError: (e) => {
      showAlert(e.message, "Failed to Add Item");
    }
  });

  // Hybrid Category Creation
  const handleCreateCategory = async (newCategoryName) => {
    try {
      const { error } = await supabase.from('categories').insert([{ name: newCategoryName }]);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setForm(f => ({ ...f, category: newCategoryName, sub_category: '' }));
    } catch (err) {
      showAlert(err.message, "Error");
    }
  };

  const handleCreateSubcategory = async (newSubcategoryName) => {
    if (!form.category) return;
    try {
      const { error } = await supabase.from('subcategories').insert([{ name: newSubcategoryName, category_name: form.category }]);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['subcategories'] });
      setForm(f => ({ ...f, sub_category: newSubcategoryName }));
    } catch (err) {
      showAlert(err.message, "Error");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return showAlert("Item name is required.", "Validation Error");
    if (Number(form.msp) < Number(form.cost_price)) return showAlert("MSP cannot be lower than Cost Price.", "Validation Error");
    if (Number(form.price) < Number(form.msp)) return showAlert("Selling Price cannot be lower than MSP.", "Validation Error");
    if (!nextBarcode) return showAlert("System is generating the next barcode, please wait.", "Notice");

    addItemMutation.mutate({ ...form, barcode: nextBarcode });
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        barcode: '001001', // Example of leading zero preserved by Excel
        name: 'Example Item (Delete This Row)',
        category: 'Hardware',
        sub_category: 'Nails',
        cost_price: '50',
        msp: '60',
        price: '75',
        unit: 'PCS',
        min_quantity: '10'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

    // Auto-size columns
    worksheet['!cols'] = [
      { wch: 15 }, { wch: 35 }, { wch: 15 }, { wch: 15 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }
    ];

    XLSX.writeFile(workbook, 'Inventory_Import_Template.xlsx');
  };

  const handleImportExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      showAlert('Reading Excel file... Please wait.', 'Info');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!jsonData || jsonData.length === 0) {
        throw new Error('The Excel file appears to be empty.');
      }

      showAlert('Importing items... This may take a minute.', 'Info');

      const formattedData = jsonData.map(row => ({
        barcode: String(row.barcode || row.Barcode || '').trim(),
        name: String(row.name || row.Name || '').trim(),
        category: String(row.category || row.Category || 'Uncategorized').trim(),
        sub_category: String(row.sub_category || row.Subcategory || '').trim(),
        cost_price: Number(row.cost_price || row.Cost || 0),
        msp: Number(row.msp || row.MSP || 0),
        price: Number(row.price || row.Price || row.MRP || 0),
        stock_warehouse: 0,
        stock_store: 0,
        unit: String(row.unit || row.Unit || 'PCS').trim(),
        min_quantity: Number(row.min_quantity || row.Min_Quantity || row['Min Quantity'] || 0),
        is_active: true
      })).filter(r => r.barcode && r.name);

      if (formattedData.length === 0) {
        throw new Error('No valid rows found. Ensure "barcode" and "name" columns exist.');
      }

      // Auto-create missing categories and sub-categories
      const uniqueCategories = [...new Set(formattedData.map(r => r.category).filter(Boolean))];
      const existingCatNames = categories.map(c => c.name);
      const newCatsToInsert = uniqueCategories.filter(c => !existingCatNames.includes(c)).map(name => ({ name }));

      if (newCatsToInsert.length > 0) {
        const { error: catError } = await supabase.from('categories').insert(newCatsToInsert);
        if (catError) console.error("Error auto-creating categories:", catError);
        else queryClient.invalidateQueries({ queryKey: ['categories'] });
      }

      const uniqueSubcategories = [];
      formattedData.forEach(r => {
        if (r.category && r.sub_category) {
          if (!uniqueSubcategories.some(sub => sub.category === r.category && sub.sub_category === r.sub_category)) {
            uniqueSubcategories.push({ category: r.category, sub_category: r.sub_category });
          }
        }
      });

      const newSubsToInsert = uniqueSubcategories.filter(sub => {
        return !subcategories.some(e => e.name === sub.sub_category && e.category_name === sub.category);
      }).map(sub => ({ name: sub.sub_category, category_name: sub.category }));

      if (newSubsToInsert.length > 0) {
        const { error: subError } = await supabase.from('subcategories').insert(newSubsToInsert);
        if (subError) console.error("Error auto-creating sub-categories:", subError);
        else queryClient.invalidateQueries({ queryKey: ['subcategories'] });
      }

      // Resolve barcode conflicts to avoid overwriting existing items
      const { data: existingInventory } = await supabase.from('inventory').select('barcode');
      const existingBarcodes = new Set(existingInventory?.map(i => i.barcode) || []);
      let maxBarcodeNum = existingInventory?.reduce((max, item) => {
        const num = parseInt(item.barcode, 10);
        return !isNaN(num) ? Math.max(max, num) : max;
      }, parseInt(BARCODE_START_VALUE, 10) - 1) || parseInt(BARCODE_START_VALUE, 10) - 1;

      let conflictCount = 0;
      formattedData.forEach(row => {
        if (existingBarcodes.has(row.barcode)) {
          maxBarcodeNum++;
          row.barcode = maxBarcodeNum.toString();
          conflictCount++;
        }
        existingBarcodes.add(row.barcode);
        row.id = generateId();
      });

      const { error } = await supabase.from('inventory').insert(formattedData);
      if (error) throw error;

      if (conflictCount > 0) {
        showAlert(`Imported ${formattedData.length} items. Auto-assigned new barcodes to ${conflictCount} conflicting items!`, 'Success');
      } else {
        showAlert(`Successfully imported ${formattedData.length} items! Syncing...`, 'Success');
      }

      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['nextBarcode'] });

      await syncInventoryToLocal();

    } catch (err) {
      showAlert(`Import failed: ${err.message}`, 'Error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full gap-6 animate-fade-in max-w-4xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-light mb-2" style={{ color: 'var(--text-primary)' }}>Register New Item</h1>
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Assigned Barcode: <span className="font-mono font-bold text-lg" style={{ color: 'var(--color-accent)' }}>{nextBarcode || '...'}</span>
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Note: This barcode is provisional. It resolves automatically during concurrent saves.
          </p>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="h-9 px-4 text-xs font-semibold uppercase tracking-wider flex items-center gap-1 transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
          >
            Template
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 px-4 text-xs font-semibold uppercase tracking-wider flex items-center gap-1 transition-colors"
            style={{ backgroundColor: 'var(--color-accent)', color: '#ffffff', border: '1px solid var(--color-accent)' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Import Excel
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportExcel}
            accept=".xlsx, .xls"
            className="hidden"
          />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 md:p-8 shadow-sm flex flex-col gap-6" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-name">Nomenclature</label>
            <input id="item-name" type="text" autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 10mm Steel Rebar" className="w-full h-10 px-3 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-cat">Category</label>
            <CreatableDropdown
              value={form.category}
              onChange={(val) => setForm({ ...form, category: val, sub_category: '' })}
              options={categories.map(c => c.name)}
              placeholder="Select or type to create..."
              onCreate={handleCreateCategory}
              required={true}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-subcat">Sub-category</label>
            <CreatableDropdown
              value={form.sub_category}
              onChange={(val) => setForm({ ...form, sub_category: val })}
              options={subcategories.filter(sub => sub.category_name === form.category).map(s => s.name)}
              placeholder="Select or type to create..."
              onCreate={handleCreateSubcategory}
              disabled={!form.category}
              required={true}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-cost">Cost Price (₹)</label>
            <input id="item-cost" type="number" step="any" min="0" required value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} placeholder="0.00" className="w-full h-10 px-3 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-msp">Minimum Selling Price (₹)</label>
            <input id="item-msp" type="number" step="any" min="0" required value={form.msp} onChange={(e) => setForm({ ...form, msp: e.target.value })} placeholder="0.00" className="w-full h-10 px-3 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-mrp">Maximum Retail Price (₹)</label>
            <input id="item-mrp" type="number" step="any" min="0" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" className="w-full h-10 px-3 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-unit">Unit Type</label>
            <div className="relative">
              <select id="item-unit" required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                {UNIT_TYPES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg></div>
            </div>
          </div>
          
          {form.item_type === 'cuttable' && form.unit === 'SQFT' && (
            <>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-def-length">Default Piece Length (Optional)</label>
                <div className="relative">
                  <input id="item-def-length" type="number" step="any" min="0" value={form.default_length} onChange={(e) => setForm({ ...form, default_length: e.target.value })} placeholder="e.g. 10" className="w-full h-10 pl-3 pr-16 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-def-width">Default Roll Height (ft)</label>
                <div className="relative">
                  <input id="item-def-width" type="number" step="any" min="0" required value={form.default_width} onChange={(e) => setForm({ ...form, default_width: e.target.value })} placeholder="e.g. 3" className="w-full h-10 pl-3 pr-16 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>ft</span>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-min-qty">Min Quantity</label>
            <div className="relative">
              <input id="item-min-qty" type="number" required step="1" min="0" value={form.min_quantity} onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} placeholder="e.g. 10" className="w-full h-10 pl-3 pr-16 text-sm focus:outline-none" style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{UNIT_TYPES.find(u => u.value === form.unit)?.label || form.unit}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-type">Item Type</label>
            <div className="relative">
              <select 
                id="item-type" 
                required
                value={form.item_type} 
                onChange={(e) => setForm({...form, item_type: e.target.value})} 
                className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer" 
                style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
              >
                <option value="standard">Standard Item</option>
                <option value="loose">Loose / Bulk Box (Prompt Qty)</option>
                <option value="cuttable">Cuttable Stock (Pipes/Mesh)</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg></div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center mt-2 pt-6" style={{ borderTop: '1px solid var(--border-light)' }}>
          {form.item_type !== 'cuttable' ? (
            <div className="flex items-center gap-4">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Print Labels:</label>
              <input
                id="print-qty"
                type="number"
                min="0"
                max="50"
                value={printLabelCount}
                onChange={(e) => setPrintLabelCount(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value)))}
                className="w-20 h-10 px-2 text-center text-sm font-bold focus:outline-none"
                style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
              />
            </div>
          ) : (
            <div className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
              * Print labels for individual pieces from the Inventory tab.
            </div>
          )}
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

      <PrintPreviewModal
        isOpen={barcodePreview.isOpen}
        onClose={() => setBarcodePreview({ isOpen: false, previewHtml: '', printHtml: '' })}
        type="barcode"
        title="Barcode Label Preview"
        iframeHtml={barcodePreview.previewHtml}
        printHtml={barcodePreview.printHtml}
      />
    </div>
  );
}