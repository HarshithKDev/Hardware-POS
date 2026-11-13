import { useState, useRef } from 'react';
import { getPerformedBy } from './utils';
import { supabase } from './supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { generateId } from './utils';
import { BARCODE_START_VALUE, BARCODE_RETRY_ATTEMPTS, UNIT_TYPES, STALE_TIME_5MIN } from './constants';
import { fetchAllShopBarcodes, nextNumericBarcode } from './services/catalog';
import { SCREW_BOX_UNIT } from './constants';

import { Spinner, CreatableDropdown } from './SharedUI';
import { 
  saveInventoryBatch, 
  initDB,
  getLocalCategories,
  setLocalCategories,
  getLocalSubcategories,
  setLocalSubcategories
} from './services/db';
import PageTitleReset from './components/PageTitleReset';
import { buttonClass } from './components/ui';

export default function OwnerCatalog() {
  const { showAlert, isWarehouseDisabled, shopSettings } = useApp();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '', category: '', sub_category: '', description: '', cost_price: '',
    msp: '', price: '', unit: 'PCS', min_quantity_warehouse: '', min_quantity_store: '', item_type: 'standard',
    default_length: '', default_width: '', billing_increment: '0.01', billing_method: 'exact'
  });
  const fileInputRef = useRef(null);

  const handleResetCatalog = () => {
    setForm({
      name: '', category: '', sub_category: '', description: '', cost_price: '',
      msp: '', price: '', unit: 'PCS', min_quantity_warehouse: '', min_quantity_store: '', item_type: 'standard',
      default_length: '', default_width: '', billing_increment: '0.01', billing_method: 'exact'
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const shopId = shopSettings?.id || localStorage.getItem('shop_id');

  // Fetch Categories (Local-First with 0ms initial render)
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', shopId],
    queryFn: async () => {
      let query = supabase.from('categories').select('*').order('name', { ascending: true });
      if (shopId) query = query.eq('shop_id', shopId);
      const { data, error } = await query;
      if (error) throw error;
      const res = data || [];
      if (res.length > 0) setLocalCategories(shopId, res);
      return res;
    },
    initialData: () => getLocalCategories(shopId),
    staleTime: STALE_TIME_5MIN,
  });

  // Fetch Subcategories (Local-First with 0ms initial render)
  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories', shopId],
    queryFn: async () => {
      let query = supabase.from('subcategories').select('*').order('name', { ascending: true });
      if (shopId) query = query.eq('shop_id', shopId);
      const { data, error } = await query;
      if (error) throw error;
      const res = data || [];
      if (res.length > 0) setLocalSubcategories(shopId, res);
      return res;
    },
    initialData: () => getLocalSubcategories(shopId),
    staleTime: STALE_TIME_5MIN,
  });

  // Next barcode calculation (Local-First from IndexedDB for 0ms display)
  const { data: nextBarcode = '' } = useQuery({
    queryKey: ['nextBarcode', shopId],
    queryFn: async () => {
      let barcodes = [];

      // 1. FAST LOCAL-FIRST: Read all barcodes from local IndexedDB (0ms)
      if (typeof indexedDB !== 'undefined') {
        try {
          const db = await initDB();
          const localProducts = await db.getAll('product_master');
          const localShopProducts = localProducts.filter(i => !shopId || !i.shop_id || i.shop_id === shopId);
          localShopProducts.forEach(p => {
            if (p.barcode) barcodes.push(p.barcode);
          });
        } catch (e) {
          console.warn('Could not fetch local product_master barcodes:', e);
        }
      }

      // 2. Only query remote if local DB is completely empty (e.g. initial setup)
      if (barcodes.length === 0 && navigator.onLine) {
        try {
          let query = supabase.from('product_master_public').select('barcode');
          if (shopId) query = query.eq('shop_id', shopId);
          const { data } = await query;
          if (data && data.length > 0) {
            barcodes = data.map(d => d.barcode);
          }
        } catch (err) {}
      }

      const next = barcodes.reduce((max, b) => {
        const num = parseInt(b, 10);
        return !isNaN(num) ? Math.max(max, num) : max;
      }, parseInt(BARCODE_START_VALUE, 10) - 1) || parseInt(BARCODE_START_VALUE, 10) - 1;

      return (next + 1).toString();
    },
    staleTime: 5000,
    refetchOnMount: 'always'
  });



  const addItemMutation = useMutation({
    mutationFn: async (itemData) => {
      let currentBarcode = itemData.barcode;
      // Retry loop to handle TOCTOU collision when multiple users create items at once
      for (let attempt = 0; attempt < BARCODE_RETRY_ATTEMPTS; attempt++) {
        const insertObj = {
          id: generateId(),
          shop_id: shopId,
          barcode: currentBarcode,
          name: itemData.name,
          category: itemData.category || null,
          sub_category: itemData.sub_category || null,
          description: itemData.description?.trim() || null,
          unit: itemData.unit,
          min_quantity_warehouse: isWarehouseDisabled ? 0 : (Number(itemData.min_quantity_warehouse) || 0),
          min_quantity_store: Number(itemData.min_quantity_store) || 0,
          is_loose_item: itemData.item_type === 'loose',
          is_cuttable: itemData.item_type === 'cuttable',
          // Cut-length items are tracked by total length/area only (no piece length / roll size)
          default_length: null,
          default_width: null,
          billing_increment: Number(itemData.billing_increment) || 0.01,
          billing_method: itemData.billing_method || 'exact',
          price: Number(itemData.price) || 0,
          msp: Number(itemData.msp) || 0,
          cost_price: Number(itemData.cost_price) || 0,
          is_active: true
        };

        let { error } = await supabase.from('product_master').insert([insertObj]);

        // Graceful fallback if description column is not yet migrated on remote database
        if (error && (error.message?.includes('description') || error.code === '42703')) {
          console.warn('description column not yet in remote product_master, inserting without description column:', error.message);
          const { description: _d, ...fallbackObj } = insertObj;
          const retryRes = await supabase.from('product_master').insert([fallbackObj]);
          error = retryRes.error;
        }

        if (!error) {
          // Do not insert an initial batch. Batches will be created explicitly from the Inventory tab.
          
          return {
            ...itemData,
            shop_id: localStorage.getItem('shop_id'),
            barcode: currentBarcode,
            is_cuttable: itemData.item_type === 'cuttable',
            is_loose_item: itemData.item_type === 'loose',
            batches: []
          };
        }

        if (error.code === '23505' && error.message.includes('barcode')) {
          console.warn(`Barcode ${currentBarcode} taken, retrying... (Attempt ${attempt + 1}/${BARCODE_RETRY_ATTEMPTS})`);
          // Use the complete barcode list (paged); the old single query stopped at 1000 products
          const allBcs = await fetchAllShopBarcodes(shopId);
          currentBarcode = nextNumericBarcode(allBcs, Number(currentBarcode) + 1);
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

      setForm({ name: '', category: '', sub_category: '', description: '', cost_price: '', unit: 'PCS', min_quantity_warehouse: '', min_quantity_store: '', item_type: 'standard', default_length: '', default_width: '', billing_increment: '0.01', billing_method: 'exact' });
      showAlert(`Added "${savedItem.name}" with Barcode ${savedItem.barcode}.`, "Success");

      // Track in Audit Logs
      try {
        await supabase.from('audit_logs').insert([{
          action_type: 'CREATE',
          barcode: savedItem.barcode,
          item_name: savedItem.name,
          performed_by: getPerformedBy(),
          changes: `Item: ${savedItem.name}${savedItem.description ? ` | Description: ${savedItem.description}` : ''} | Category: ${savedItem.category || 'N/A'} | Sub-Category: ${savedItem.sub_category || 'N/A'} | Type: ${savedItem.unit === SCREW_BOX_UNIT ? 'Screw Box' : savedItem.is_cuttable ? 'Cuttable' : (savedItem.is_loose_item ? 'Loose' : 'Standard')}`
        }]);
      } catch (err) {
        console.error("Failed to log item creation", err);
      }
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
    if (addItemMutation.isPending) return; // prevent double-submit
    if (!form.name.trim()) return showAlert("Item name is required.", "Validation Error");
    if (!form.category.trim()) return showAlert("Category is required.", "Validation Error");
    if (!form.sub_category.trim()) return showAlert("Sub-category is required.", "Validation Error");
    if (Number(form.msp) < Number(form.cost_price)) return showAlert("MSP cannot be lower than Cost Price.", "Validation Error");
    if (Number(form.price) < Number(form.msp)) return showAlert("Selling Price cannot be lower than MSP.", "Validation Error");
    if (!nextBarcode) return showAlert("System is generating the next barcode, please wait.", "Notice");

    addItemMutation.mutate({ ...form, barcode: nextBarcode });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto gap-6 animate-fade-in pr-1">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <PageTitleReset
            title="Register New Item"
            onReset={handleResetCatalog}
            className="mb-2"
            tooltip="Click title to clear registration form"
          />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Assigned Barcode: <span className=" font-bold text-lg" style={{ color: 'var(--color-accent)' }}>{nextBarcode || '...'}</span>
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-0 md:p-6 rounded-xl md:shadow-sm flex flex-col flex-1 gap-4 md:bg-[var(--bg-secondary)] md:border md:border-[var(--border-medium)]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="md:col-span-2 lg:col-span-4">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-name">Item Name</label>
            <input id="item-name" type="text" autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 10mm Steel Rebar" className="w-full h-10 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          </div>

          <div className="md:col-span-2 lg:col-span-4">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-description">
              Product Description (Optional)
            </label>
            <textarea
              id="item-description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. High-tensile corrosion-resistant steel rebar suitable for heavy construction..."
              className="w-full p-3 text-sm focus:outline-none rounded-md resize-none max-md:min-h-[104px]"
              style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-cat">Category</label>
            <CreatableDropdown
              value={form.category}
              onChange={(val) => setForm({ ...form, category: val, sub_category: '' })}
              options={(categories || []).map(c => typeof c === 'string' ? c : (c?.name || '')).filter(Boolean)}
              placeholder="Select or type to create..."
              onCreate={handleCreateCategory}
              required={true}
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-subcat">Sub-category</label>
            <CreatableDropdown
              value={form.sub_category}
              onChange={(val) => setForm({ ...form, sub_category: val })}
              options={(subcategories || [])
                .filter(sub => {
                  if (!form.category) return true;
                  const catName = typeof sub === 'string' ? '' : (sub?.category_name || '');
                  return catName.toLowerCase() === form.category.toLowerCase();
                })
                .map(s => typeof s === 'string' ? s : (s?.name || ''))
                .filter(Boolean)}
              placeholder="Select or type to create..."
              onCreate={handleCreateSubcategory}
              disabled={!form.category}
              required={true}
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-type">Item Type</label>
            <div className="relative">
              <select id="item-type" required value={form.item_type} onChange={(e) => {
                const newType = e.target.value;
                setForm(prev => ({ 
                  ...prev, 
                  item_type: newType,
                  // Screw boxes are always counted in boxes; leaving that type resets to pieces
                  unit: newType === 'screw_box'
                    ? SCREW_BOX_UNIT
                    : (prev.unit === SCREW_BOX_UNIT ? 'PCS' : (newType === 'cuttable' && prev.unit === 'PCS' ? 'FT' : prev.unit))
                }));
              }} className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none rounded-md appearance-none cursor-pointer" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                <option value="standard">Standard Item</option>
                <option value="loose">Loose / Bulk Box (Prompt Qty)</option>
                <option value="cuttable">Cuttable Stock (Pipes/Mesh)</option>
                <option value="screw_box">Screw Box (sold by the box, can be opened for loose sale)</option>
              </select>
            </div>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-unit">Unit Type</label>
            <div className="relative">
              <select id="item-unit" required disabled={form.item_type === 'screw_box'} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none rounded-md appearance-none cursor-pointer" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                {form.item_type === 'screw_box'
                  ? <option value={SCREW_BOX_UNIT}>Boxes</option>
                  : UNIT_TYPES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>

          {form.item_type === 'cuttable' && (
            <div className="lg:col-span-4 p-3 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-medium)] text-xs text-[var(--text-secondary)]">
              Cut-length items are stocked and sold by the <strong>total {form.unit === 'SQFT' ? 'sqft' : (form.unit || 'FT').toLowerCase()}</strong>.
              When receiving, enter the total (e.g. <strong>200 {form.unit === 'SQFT' ? 'sqft' : (form.unit || 'FT').toLowerCase()}</strong>); when selling, enter the amount sold. No piece lengths or roll sizes needed.
            </div>
          )}

          {/* Pricing fields removed. Pricing is now exclusively handled at the batch level in the Inventory tab. */}

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 lg:col-span-2">
            {!isWarehouseDisabled && (
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-min-qty-whse">Min Qty (Warehouse)</label>
                <div className="relative">
                  <input id="item-min-qty-whse" type="number" inputMode="decimal" required step="any" min="0" value={form.min_quantity_warehouse} onChange={(e) => setForm({ ...form, min_quantity_warehouse: e.target.value })} placeholder={form.item_type === 'cuttable' ? (form.unit === 'SQFT' ? 'e.g. 500' : 'e.g. 50') : 'e.g. 10'} className="w-full h-10 pl-3 pr-16 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{form.unit === 'METER' ? 'M' : (form.unit || 'PCS')}</span>
                </div>
              </div>
            )}
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-min-qty-store">{isWarehouseDisabled ? 'Min Stock Alert' : 'Min Qty (Store)'}</label>
              <div className="relative">
                <input id="item-min-qty-store" type="number" inputMode="decimal" required step="any" min="0" value={form.min_quantity_store} onChange={(e) => setForm({ ...form, min_quantity_store: e.target.value })} placeholder={form.item_type === 'cuttable' ? (form.unit === 'SQFT' ? 'e.g. 100' : 'e.g. 24') : 'e.g. 5'} className="w-full h-10 pl-3 pr-16 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{form.unit === 'METER' ? 'M' : (form.unit || 'PCS')}</span>
              </div>
            </div>
          </div>
          
          <div className="lg:col-span-2">
             <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }} htmlFor="item-bill-method">Billing Method</label>
             <div className="relative">
               <select
                 id="item-bill-method"
                 required
                 value={form.billing_method}
                 onChange={(e) => setForm({ ...form, billing_method: e.target.value })}
                 className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none rounded-md appearance-none cursor-pointer"
                 style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
               >
                 <option value="exact">Exact (No rounding)</option>
                 <option value="round_up">Round Up to 0.5 (e.g. 4.2 → 4.5, 4.6 → 5.0)</option>
               </select>
             </div>
          </div>
        </div>
        
        {/* Spacer to push the footer down if the screen is tall */}
        <div className="flex-1" />

        {/* Phones: Save stays visible at the bottom while scrolling the form */}
        <div className="flex justify-end items-center mt-auto pt-3 pb-3 md:pt-6 md:pb-0 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:bg-[var(--bg-secondary)]" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button
            type="submit"
            disabled={addItemMutation.isPending || !nextBarcode}
            className={buttonClass({ variant: 'primary', size: 'md', className: 'w-full md:w-auto min-w-[200px]' })}
          >
            {addItemMutation.isPending ? <Spinner className="w-5 h-5 text-white" /> : 'Save Item'}
          </button>
        </div>
      </form>

    </div>
  );
}