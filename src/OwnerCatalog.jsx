import { useState, useRef } from 'react';
import { getPerformedBy } from './utils';
import { supabase } from './supabaseClient';
import { syncInventoryToLocal } from './services/sync';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { generateId } from './utils';
import { BARCODE_START_VALUE, BARCODE_RETRY_ATTEMPTS, UNIT_TYPES, STALE_TIME_5MIN } from './constants';
import { fetchAllShopBarcodes, nextNumericBarcode } from './services/catalog';
import { SCREW_BOX_UNIT } from './constants';

// Empty cell → 0; text like "abc" → NaN (reported by validation instead of silently becoming 0)
const toImportNumber = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return 0;
  return Number(String(v).replace(/[₹,\s]/g, ''));
};
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
        const currentUser = (await supabase.auth.getUser()).data.user?.email || 'Unknown';
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

  const handleDownloadTemplate = async () => {
    const { default: ExcelJS } = await import('exceljs');
    const { saveAs } = await import('file-saver');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Template');
    const dataSheet = workbook.addWorksheet('Data', { state: 'hidden' });

    // Populate Data Sheet with dynamic categories
    const catNames = categories.map(c => c.name);
    const subCatNames = subcategories.map(s => s.name);
    
    dataSheet.getColumn(1).values = ['Categories', ...(catNames.length ? catNames : ['Hardware', 'Plumbing'])];
    dataSheet.getColumn(2).values = ['Subcategories', ...(subCatNames.length ? subCatNames : ['Nails', 'Screws', 'Pipes'])];

    // Setup Template Columns
    sheet.columns = [
      { header: 'barcode', key: 'barcode', width: 15 },
      { header: 'name', key: 'name', width: 35 },
      { header: 'description', key: 'description', width: 30 },
      { header: 'category', key: 'category', width: 20 },
      { header: 'sub_category', key: 'sub_category', width: 20 },
      { header: 'cost_price', key: 'cost_price', width: 15 },
      { header: 'msp', key: 'msp', width: 15 },
      { header: 'price', key: 'price', width: 15 },
      { header: 'unit', key: 'unit', width: 15 },
      { header: 'type', key: 'type', width: 15 },
      { header: 'min_quantity_warehouse', key: 'min_quantity_warehouse', width: 25 },
      { header: 'min_quantity_store', key: 'min_quantity_store', width: 25 }
    ];

    // Add sample rows
    sheet.addRow({
      barcode: '001001', name: 'Standard Item Example', description: 'Grade A steel fastener', category: catNames[0] || 'Hardware', sub_category: subCatNames[0] || 'Nails',
      cost_price: 50, msp: 60, price: 75, unit: 'PCS', type: 'Standard',
      min_quantity_warehouse: 10, min_quantity_store: 5
    });
    sheet.addRow({
      barcode: '', name: 'Loose Item Example (Screws)', description: 'Galvanized wood screw', category: catNames[0] || 'Hardware', sub_category: subCatNames[0] || 'Screws',
      cost_price: 5, msp: 8, price: 10, unit: 'PCS', type: 'Loose',
      min_quantity_warehouse: 100, min_quantity_store: 50
    });
    sheet.addRow({
      barcode: '', name: 'Cuttable Item Example (Pipe)', description: 'Schedule 40 PVC pipe', category: catNames[0] || 'Plumbing', sub_category: subCatNames[0] || 'Pipes',
      cost_price: 120, msp: 150, price: 180, unit: 'FT', type: 'Cuttable',
      min_quantity_warehouse: 50, min_quantity_store: 10
    });
    sheet.addRow({
      barcode: '', name: 'Screw Box Example (8x1 inch, 100 pcs)', description: 'Sold by the box; can be opened for loose sale', category: catNames[0] || 'Hardware', sub_category: subCatNames[0] || 'Screws',
      cost_price: 90, msp: 110, price: 130, unit: 'BOX', type: 'Screw Box',
      min_quantity_warehouse: 5, min_quantity_store: 2
    });

    // Style headers
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // Add Data Validation for 1000 rows
    for (let i = 2; i <= 1000; i++) {
      sheet.getCell(`C${i}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['Data!$A$2:$A$500']
      };
      sheet.getCell(`D${i}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['Data!$B$2:$B$500']
      };
      sheet.getCell(`H${i}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"PCS,FT,SQFT,M,KG"']
      };
      sheet.getCell(`I${i}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"Standard,Loose,Cuttable"']
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), 'Inventory_Import_Template.xlsx');
  };

  const handleImportExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      showAlert('Reading Excel file... Please wait.', 'Info');
      const { default: ExcelJS } = await import('exceljs');
      const data = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(data);
      const worksheet = workbook.worksheets[0];

      if (!worksheet || worksheet.rowCount <= 1) {
        throw new Error('The Excel file appears to be empty.');
      }

      const headerRow = worksheet.getRow(1);
      const headers = [];
      headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        let val = cell.value;
        if (val != null && typeof val === 'object') {
          val = val.text || val.result || '';
        }
        headers[colNumber] = String(val || '').trim();
      });

      const jsonData = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const rowObj = {};
        let hasData = false;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const header = headers[colNumber];
          if (header) {
            let val = cell.value;
            if (val != null && typeof val === 'object') {
              if (val.result !== undefined) val = val.result;
              else if (val.text !== undefined) val = val.text;
            }
            rowObj[header] = val != null ? val : '';
            if (val != null && val !== '') hasData = true;
          }
        });
        if (hasData) {
          rowObj.__row = rowNumber;
          jsonData.push(rowObj);
        }
      });

      if (jsonData.length === 0) {
        throw new Error('The Excel file appears to be empty.');
      }

      showAlert('Importing items... This may take a minute.', 'Info');

      const formattedData = jsonData.map(row => {
        const rowType = String(row.type || row.Type || 'Standard').trim().toLowerCase();
        const isLoose = rowType === 'loose';
        const isCuttable = rowType === 'cuttable';
        const isScrewBoxRow = ['screw box', 'screwbox', 'screw_box', 'box'].includes(rowType);
        let unit = isScrewBoxRow ? SCREW_BOX_UNIT : String(row.unit || row.Unit || 'PCS').trim().toUpperCase();
        if (unit === 'GRAMS' || unit === 'GRAM' || unit === 'G') unit = 'KG';
        
        return {
          __row: row.__row,
          barcode: String(row.barcode || row.Barcode || '').trim(),
          name: String(row.name || row.Name || '').trim(),
          category: String(row.category || row.Category || 'Uncategorized').trim(),
          sub_category: String(row.sub_category || row.Subcategory || '').trim(),
          description: String(row.description || row.Description || '').trim() || null,
          cost_price: toImportNumber(row.cost_price ?? row.Cost),
          msp: toImportNumber(row.msp ?? row.MSP),
          price: toImportNumber(row.price ?? row.Price ?? row.MRP),
          stock_warehouse: 0,
          stock_store: 0,
          unit: unit,
          is_loose_item: isLoose,
          is_cuttable: isCuttable,
          default_length: null,
          default_width: null,
          min_quantity_warehouse: Number(row.min_quantity_warehouse || row.Min_Quantity_Warehouse || row['Min Quantity (Warehouse)'] || row.min_quantity || 0),
          min_quantity_store: Number(row.min_quantity_store || row.Min_Quantity_Store || row['Min Quantity (Store)'] || row.min_quantity || 0),
          is_active: true
        };
      }).filter(r => r.name);

      if (formattedData.length === 0) {
        throw new Error('No valid rows found. Ensure the "name" column exists and is filled.');
      }

      // Validate every row first (row numbers match the Excel sheet) so nothing is half-imported
      const validUnits = new Set([...UNIT_TYPES.map(u => u.value), SCREW_BOX_UNIT]);
      const rowErrors = [];
      const seenInFile = new Map();
      formattedData.forEach((r, idx) => {
        const rowNo = r.__row || idx + 2;
        const problems = [];
        for (const [field, label] of [['price', 'MRP'], ['msp', 'MSP'], ['cost_price', 'Cost']]) {
          if (!Number.isFinite(r[field])) problems.push(`${label} is not a number`);
          else if (r[field] < 0) problems.push(`${label} is negative`);
        }
        if (Number.isFinite(r.msp) && Number.isFinite(r.price) && r.price > 0 && r.msp > r.price) problems.push('MSP is higher than MRP');
        if (!validUnits.has(r.unit)) problems.push(`unit "${r.unit}" must be one of ${[...validUnits].join(', ')}`);
        if (r.barcode) {
          if (seenInFile.has(r.barcode)) problems.push(`barcode ${r.barcode} is repeated (also row ${seenInFile.get(r.barcode)})`);
          else seenInFile.set(r.barcode, rowNo);
        }
        if (problems.length) rowErrors.push(`Row ${rowNo} (${r.name}): ${problems.join('; ')}`);
      });
      if (rowErrors.length > 0) {
        const shown = rowErrors.slice(0, 15).join('\n');
        throw new Error(`Nothing was imported. Please fix these rows and try again:\n${shown}${rowErrors.length > 15 ? `\n...and ${rowErrors.length - 15} more` : ''}`);
      }
      
      const missingCatSubcat = formattedData.some(r => !r.category || !r.sub_category);
      if (missingCatSubcat) {
        throw new Error('All products must have a Category and a Sub-category specified.');
      }

      // Auto-create missing categories and sub-categories
      const uniqueCategories = [...new Set(formattedData.map(r => r.category).filter(Boolean))];
      const existingCatNames = categories.map(c => c.name);
      const newCatsToInsert = uniqueCategories.filter(c => !existingCatNames.includes(c)).map(name => ({ name }));

      if (newCatsToInsert.length > 0) {
        const { error: catError } = await supabase.from('categories').insert(newCatsToInsert);
        if (catError && catError.code !== '23505') {
          throw new Error(`Could not create the new categories (${newCatsToInsert.map(c => c.name).join(', ')}): ${catError.message}. Nothing was imported.`);
        }
        queryClient.invalidateQueries({ queryKey: ['categories'] });
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
        if (subError && subError.code !== '23505') {
          throw new Error(`Could not create the new sub-categories: ${subError.message}. Nothing was imported.`);
        }
        queryClient.invalidateQueries({ queryKey: ['subcategories'] });
      }

      // Complete list of barcodes already used by this shop (paged; includes deleted products)
      const existingList = await fetchAllShopBarcodes(shopId);
      const existingBarcodes = new Set(existingList);
      let maxBarcodeNum = Number(nextNumericBarcode([...existingList, ...formattedData.map(r => r.barcode).filter(Boolean)])) - 1;

      // A row whose barcode already exists is SKIPPED and reported. Previously it silently got a
      // new barcode, creating a duplicate product while shelf labels still pointed to the old one.
      const skippedExisting = [];
      let generatedCount = 0;
      const productMasterData = [];
      formattedData.forEach((row, idx) => {
        if (row.barcode && existingBarcodes.has(row.barcode)) {
          skippedExisting.push(`Row ${row.__row || idx + 2}: ${row.name} (barcode ${row.barcode})`);
          return;
        }
        if (!row.barcode) {
          maxBarcodeNum++;
          generatedCount++;
          row.barcode = maxBarcodeNum.toString();
        }
        existingBarcodes.add(row.barcode);
        row.id = generateId();
        
        productMasterData.push({
          id: row.id,
          shop_id: shopId,
          barcode: row.barcode,
          name: row.name,
          category: row.category,
          sub_category: row.sub_category,
          unit: row.unit,
          is_loose_item: row.is_loose_item,
          is_cuttable: row.is_cuttable,
          default_length: row.default_length,
          default_width: row.default_width,
          min_quantity_warehouse: row.min_quantity_warehouse,
          min_quantity_store: row.min_quantity_store,
          is_active: row.is_active,
          billing_increment: 0.01,
          billing_method: 'exact',
          description: row.description || null,
          price: Number(row.price || row.Selling_Price || 0),
          msp: Number(row.msp || row.MSP || 0),
          cost_price: Number(row.cost_price || row.Cost_Price || 0)
        });
      });
        
      if (productMasterData.length === 0) {
        throw new Error(`Nothing to import: all ${skippedExisting.length} rows use barcodes that already exist.\n${skippedExisting.slice(0, 15).join('\n')}`);
      }

      // Insert in chunks so a very large file doesn't time out
      const CHUNK = 200;
      let insertedCount = 0;
      for (let i = 0; i < productMasterData.length; i += CHUNK) {
        const chunk = productMasterData.slice(i, i + CHUNK);
        let { error } = await supabase.from('product_master').insert(chunk);
        if (error && (error.message?.includes('description') || error.code === '42703')) {
          const fallbackData = chunk.map(({ description: _d, ...rest }) => rest);
          const retryRes = await supabase.from('product_master').insert(fallbackData);
          error = retryRes.error;
        }
        if (error) {
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          throw new Error(`Imported ${insertedCount} of ${productMasterData.length} items, then the database rejected items ${i + 1}–${i + chunk.length} ("${chunk[0].name}" onwards): ${error.message}. Fix the file and import again — already-imported barcodes will be skipped.`);
        }
        insertedCount += chunk.length;
      }

      try {
        const auditLogs = productMasterData.map(item => ({
          action_type: 'CREATE',
          barcode: item.barcode,
          item_name: item.name,
          changes: `Bulk Imported CSV Item: ${item.name} | Category: ${item.category || 'N/A'} | Type: ${item.unit === SCREW_BOX_UNIT ? 'Screw Box' : item.is_cuttable ? 'Cuttable' : (item.is_loose_item ? 'Loose' : 'Standard')}`,
          performed_by: getPerformedBy()
        }));
        await supabase.from('audit_logs').insert(auditLogs);
      } catch (err) {
        console.error("Failed to log bulk import", err);
      }

      let msg = `Imported ${insertedCount} items.`;
      if (generatedCount > 0) msg += ` Auto-generated ${generatedCount} barcodes.`;
      if (skippedExisting.length > 0) {
        msg += `\n\nSkipped ${skippedExisting.length} rows because their barcode already exists (edit those products in Inventory instead):\n${skippedExisting.slice(0, 15).join('\n')}${skippedExisting.length > 15 ? `\n...and ${skippedExisting.length - 15} more` : ''}`;
      }
      showAlert(msg, skippedExisting.length > 0 ? 'Imported with Skipped Rows' : 'Success');

      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['nextBarcode'] });

      await syncInventoryToLocal('owner');

    } catch (err) {
      showAlert(`Import failed: ${err.message}`, 'Error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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