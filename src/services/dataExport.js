import { supabase } from '../supabaseClient';
import { formatDateTime } from '../utils';

/**
 * Applies header styling with custom background color, bold text, and borders.
 */
function applyHeaderStyle(row, bgColorHex) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgColorHex }
    };
    cell.font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: false
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF64748B' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });
}

/**
 * Applies standard cell styling with zebra striping and thin borders.
 */
function applyRowStyle(row, isEven) {
  row.height = 22;
  const bg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (!cell.fill) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bg }
      };
    }
    if (!cell.font) {
      cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF1E293B' } };
    }
    cell.alignment = cell.alignment || { vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };
  });
}

/**
 * Applies summary/total row styling with bold text and double bottom border.
 */
function applyTotalRowStyle(row, bgColorHex = 'FFF1F5F9') {
  row.height = 26;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgColorHex }
    };
    cell.font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      color: { argb: 'FF0F172A' }
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF64748B' } },
      bottom: { style: 'double', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };
  });
}

/**
 * Automatically adjusts column widths based on content length with min/max bounds.
 */
function autoFitColumns(worksheet, minWidth = 12, maxWidth = 50) {
  worksheet.columns.forEach((column) => {
    let maxLen = 0;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const val = cell.value != null ? String(cell.value) : '';
      if (val.length > maxLen) {
        maxLen = val.length;
      }
    });
    column.width = Math.max(minWidth, Math.min(maxWidth, maxLen + 4));
  });
}

/**
 * Exports complete application database into a beautifully formatted, multi-sheet Excel file.
 *
 * @param {Object} shopSettings - Current shop settings object
 * @param {Function} onProgress - Callback for real-time progress text
 */
export async function exportCompleteShopData(shopSettings, onProgress) {
  const shopId = shopSettings?.id || localStorage.getItem('shop_id');

  // -------------------------------------------------------------
  // Step 1: Query All Tables from Remote Supabase
  // -------------------------------------------------------------
  onProgress?.('Fetching inventory items...');
  let prodQuery = supabase.from('product_master').select('*').order('name');
  if (shopId) prodQuery = prodQuery.eq('shop_id', shopId);
  const { data: products = [] } = await prodQuery;

  onProgress?.('Fetching sales transactions...');
  let billsQuery = supabase.from('bills').select('*').order('created_at', { ascending: false });
  if (shopId) billsQuery = billsQuery.eq('shop_id', shopId);
  const { data: bills = [] } = await billsQuery;

  onProgress?.('Fetching bill item details...');
  let billItems = [];
  try {
    let billItemsQuery = supabase.from('bill_items').select('*');
    if (shopId) billItemsQuery = billItemsQuery.eq('shop_id', shopId);
    const { data: biData, error: biErr } = await billItemsQuery;
    if (biErr) {
      console.warn('bill_items fetch warning (retrying without filter):', biErr.message);
      // Fallback: If shop_id filter failed (e.g. column missing on bill_items), fetch all and filter by current bills
      const { data: allBi } = await supabase.from('bill_items').select('*');
      if (allBi) {
        if (bills && bills.length > 0) {
          const billIdSet = new Set(bills.map(b => b.id));
          billItems = allBi.filter(it => billIdSet.has(it.bill_id));
        } else {
          billItems = allBi;
        }
      }
    } else if (biData) {
      billItems = biData;
    }
  } catch (err) {
    console.warn('Bill items fetch error:', err);
  }

  // Sort bill items in-memory by transaction date
  if (billItems.length > 0 && bills && bills.length > 0) {
    const billDateMap = new Map(bills.map(b => [b.id, b.created_at]));
    billItems.sort((a, b) => {
      const dateA = billDateMap.get(a.bill_id) || '';
      const dateB = billDateMap.get(b.bill_id) || '';
      return dateB.localeCompare(dateA);
    });
  }

  onProgress?.('Fetching expenses...');
  let expenses = [];
  try {
    let expQuery = supabase.from('expenses').select('*').order('created_at', { ascending: false });
    const { data: remoteExp } = await expQuery;
    if (remoteExp) {
      expenses = shopId ? remoteExp.filter(e => e.notes === `shop:${shopId}` || !e.notes) : remoteExp;
    }
  } catch (e) {
    console.warn('Remote expense fetch failed, checking local:', e);
  }

  // Local storage expenses fallback / merge
  try {
    const localRaw = localStorage.getItem(`hardware_pos_expenses_${shopId || 'default'}`);
    if (localRaw) {
      const localExp = JSON.parse(localRaw);
      if (Array.isArray(localExp)) {
        const idSet = new Set(expenses.map(e => e.id));
        localExp.forEach(le => {
          if (!idSet.has(le.id)) {
            expenses.push(le);
            idSet.add(le.id);
          }
        });
      }
    }
  } catch (err) {
    console.warn('Local expense parse error:', err);
  }

  onProgress?.('Fetching categories & sub-categories...');
  let catQuery = supabase.from('categories').select('*').order('name');
  if (shopId) catQuery = catQuery.eq('shop_id', shopId);
  const { data: categories = [] } = await catQuery;

  let subCatQuery = supabase.from('subcategories').select('*').order('name');
  if (shopId) subCatQuery = subCatQuery.eq('shop_id', shopId);
  const { data: subcategories = [] } = await subCatQuery;

  onProgress?.('Fetching staff members...');
  let workerQuery = supabase.from('workers').select('*').order('name');
  if (shopId) workerQuery = workerQuery.eq('shop_id', shopId);
  const { data: workers = [] } = await workerQuery;

  onProgress?.('Fetching inventory batches...');
  let batches = [];
  try {
    let batchQuery = supabase.from('inventory_batches').select('*').order('created_at', { ascending: false });
    if (shopId) batchQuery = batchQuery.eq('shop_id', shopId);
    const { data: bData } = await batchQuery;
    if (bData) batches = bData;
  } catch (e) {
    console.warn('Batch fetch error:', e);
  }

  onProgress?.('Fetching audit logs...');
  let auditLogs = [];
  try {
    let auditQuery = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(2000);
    if (shopId) auditQuery = auditQuery.eq('shop_id', shopId);
    const { data: aData } = await auditQuery;
    if (aData) auditLogs = aData;
  } catch (e) {
    console.warn('Audit logs fetch error:', e);
  }

  // -------------------------------------------------------------
  // Step 2: Initialize ExcelJS Workbook
  // -------------------------------------------------------------
  onProgress?.('Initializing Excel workbook...');
  const { default: ExcelJS } = await import('exceljs');
  const { saveAs } = await import('file-saver');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = shopSettings?.owner_name || 'Hardware POS System';
  workbook.lastModifiedBy = shopSettings?.owner_name || 'Hardware POS System';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Color Palette Constants (ARGB)
  const NAVY_HEADER = 'FF1E3A8A';
  const TEAL_HEADER = 'FF0F766E';
  const BLUE_HEADER = 'FF1E40AF';
  const INDIGO_HEADER = 'FF4338CA';
  const CRIMSON_HEADER = 'FF991B1B';
  const SKY_HEADER = 'FF0284C7';
  const PURPLE_HEADER = 'FF7E22CE';
  const EMERALD_HEADER = 'FF059669';
  const SLATE_HEADER = 'FF475569';

  // -------------------------------------------------------------
  // SHEET 1: Business Overview & Key Metrics
  // -------------------------------------------------------------
  onProgress?.('Creating Summary & Profile Sheet...');
  const overviewSheet = workbook.addWorksheet('Business Overview', { views: [{ showGridLines: true }] });

  // Compute key totals
  let totalStoreUnits = 0;
  let totalWhseUnits = 0;
  let totalCostValuation = 0;
  let totalRetailValuation = 0;

  (products || []).forEach(p => {
    const sStock = Number(p.stock_store) || 0;
    const wStock = Number(p.stock_warehouse) || 0;
    const cPrice = Number(p.cost_price) || 0;
    const sPrice = Number(p.price) || 0;

    totalStoreUnits += sStock;
    totalWhseUnits += wStock;
    totalCostValuation += (sStock + wStock) * cPrice;
    totalRetailValuation += (sStock + wStock) * sPrice;
  });

  const isShowroom = (b) => b?.payment_method === 'SHOWROOM' || b?.status === 'showroom_pending' || b?.status === 'showroom';
  const totalSalesRevenue = (bills || []).reduce((acc, b) => (b.status !== 'voided' && !isShowroom(b)) ? acc + (Number(b.total_amount) || 0) : acc, 0);
  const totalDiscountsGiven = (bills || []).reduce((acc, b) => (b.status !== 'voided' && !isShowroom(b)) ? acc + (Number(b.discount) || 0) : acc, 0);
  const totalExpensesAmount = (expenses || []).reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  const netEarnings = totalSalesRevenue - totalExpensesAmount;

  // Title Row
  overviewSheet.mergeCells('B2:E2');
  const titleCell = overviewSheet.getCell('B2');
  titleCell.value = `${(shopSettings?.shop_name || 'HARDWARE POS').toUpperCase()} - COMPLETE BUSINESS EXPORT`;
  titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_HEADER } };
  overviewSheet.getRow(2).height = 34;

  // Shop Info Card
  overviewSheet.getCell('B4').value = 'SHOP PROFILE';
  overviewSheet.getCell('B4').font = { bold: true, size: 11, color: { argb: NAVY_HEADER } };

  const infoRows = [
    ['Store / Shop Name:', shopSettings?.shop_name || 'N/A'],
    ['Owner / Administrator:', shopSettings?.owner_name || 'N/A'],
    ['Contact Phone:', shopSettings?.phone || 'N/A'],
    ['Shop Address:', (shopSettings?.shop_address || '').replace(/^HIDDEN::/, '') || 'N/A'],
    ['UPI ID / Billing VPA:', (shopSettings?.upi_id || '').replace(/^HIDDEN::/, '') || 'N/A'],
    ['Export Date & Time:', formatDateTime(new Date().toISOString()).full]
  ];

  infoRows.forEach(([lbl, val], idx) => {
    const rNum = 5 + idx;
    overviewSheet.getCell(`B${rNum}`).value = lbl;
    overviewSheet.getCell(`B${rNum}`).font = { bold: true, size: 10, color: { argb: 'FF475569' } };
    overviewSheet.getCell(`C${rNum}`).value = val;
    overviewSheet.getCell(`C${rNum}`).font = { size: 10, color: { argb: 'FF0F172A' } };
    overviewSheet.getRow(rNum).height = 20;
  });

  // KPI Table
  overviewSheet.getCell('B12').value = 'KEY PERFORMANCE INDICATORS (LIFETIME SNAPSHOT)';
  overviewSheet.getCell('B12').font = { bold: true, size: 11, color: { argb: NAVY_HEADER } };

  const kpis = [
    ['Total Catalog Items', (products || []).length, 'Products', 'FF3B82F6'],
    ['Total Store Inventory', totalStoreUnits.toFixed(2), 'Units', 'FF10B981'],
    ['Total Warehouse Inventory', totalWhseUnits.toFixed(2), 'Units', 'FF06B6D4'],
    ['Total Combined Stock', (totalStoreUnits + totalWhseUnits).toFixed(2), 'Units', 'FF8B5CF6'],
    ['Inventory Valuation (At Cost)', totalCostValuation, 'Currency', 'FF6366F1'],
    ['Inventory Valuation (At Retail)', totalRetailValuation, 'Currency', 'FF10B981'],
    ['Potential Gross Margin in Stock', totalRetailValuation - totalCostValuation, 'Currency', 'FF059669'],
    ['Total Sales Invoices Recorded', (bills || []).length, 'Bills', 'FF3B82F6'],
    ['Total Gross Revenue Collected', totalSalesRevenue, 'Currency', 'FF10B981'],
    ['Total Customer Discounts Given', totalDiscountsGiven, 'Currency', 'FFF59E0B'],
    ['Total Business Expenses Recorded', totalExpensesAmount, 'Currency', 'FFEF4444'],
    ['Net Sales Margin (Revenue - Expenses)', netEarnings, 'Currency', netEarnings >= 0 ? 'FF10B981' : 'FFEF4444']
  ];

  overviewSheet.getRow(13).values = ['', 'Metric', 'Value', 'Unit / Type'];
  applyHeaderStyle(overviewSheet.getRow(13), NAVY_HEADER);

  kpis.forEach(([name, val, type], idx) => {
    const rowNum = 14 + idx;
    const row = overviewSheet.getRow(rowNum);
    row.getCell(2).value = name;
    row.getCell(3).value = typeof val === 'number' ? val : (isNaN(Number(val)) ? val : Number(val));
    row.getCell(4).value = type;

    if (type === 'Currency') {
      row.getCell(3).numFmt = '₹#,##0.00';
    }

    applyRowStyle(row, idx % 2 === 0);
  });

  overviewSheet.getColumn(2).width = 38;
  overviewSheet.getColumn(3).width = 24;
  overviewSheet.getColumn(4).width = 16;
  overviewSheet.getColumn(5).width = 10;

  // -------------------------------------------------------------
  // SHEET 2: Products & Inventory
  // -------------------------------------------------------------
  onProgress?.('Exporting Products & Inventory Sheet...');
  const productSheet = workbook.addWorksheet('Products & Inventory', { views: [{ showGridLines: true }] });

  productSheet.columns = [
    { header: 'Barcode', key: 'barcode', width: 14 },
    { header: 'Product Name', key: 'name', width: 36 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Sub-Category', key: 'sub_category', width: 18 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Cost Price', key: 'cost_price', width: 14 },
    { header: 'Min Price (MSP)', key: 'msp', width: 16 },
    { header: 'Selling Price', key: 'price', width: 14 },
    { header: 'Unit Margin', key: 'margin', width: 14 },
    { header: 'Store Stock', key: 'stock_store', width: 14 },
    { header: 'Warehouse Stock', key: 'stock_warehouse', width: 16 },
    { header: 'Total Stock', key: 'total_stock', width: 14 },
    { header: 'Stock Value (Cost)', key: 'val_cost', width: 18 },
    { header: 'Stock Value (Retail)', key: 'val_retail', width: 18 },
    { header: 'Item Type', key: 'type', width: 14 },
    { header: 'Min Store Limit', key: 'min_store', width: 16 },
    { header: 'Min Warehouse Limit', key: 'min_whse', width: 18 },
    { header: 'Stock Health', key: 'health', width: 16 },
    { header: 'Status', key: 'status', width: 12 }
  ];

  applyHeaderStyle(productSheet.getRow(1), TEAL_HEADER);

  (products || []).forEach((p, idx) => {
    const sStock = Number(p.stock_store) || 0;
    const wStock = Number(p.stock_warehouse) || 0;
    const totStock = sStock + wStock;
    const cPrice = Number(p.cost_price) || 0;
    const sPrice = Number(p.price) || 0;
    const msp = Number(p.msp) || 0;
    const margin = sPrice - cPrice;
    const valCost = totStock * cPrice;
    const valRetail = totStock * sPrice;

    const minStore = Number(p.min_quantity_store) || 0;
    const minWhse = Number(p.min_quantity_warehouse) || 0;

    let health = 'In Stock';
    if (totStock <= 0) health = 'Out of Stock';
    else if (sStock <= minStore && sStock > 0) health = 'Low Store Stock';
    else if (wStock <= minWhse && wStock > 0) health = 'Low Warehouse';

    const itemType = p.is_cuttable ? 'Cuttable Piece' : (p.is_loose_item ? 'Loose Item' : 'Standard');

    const row = productSheet.addRow({
      barcode: p.barcode,
      name: p.name,
      category: p.category || 'Uncategorized',
      sub_category: p.sub_category || 'General',
      unit: (p.unit || 'PCS').toUpperCase(),
      cost_price: cPrice,
      msp: msp,
      price: sPrice,
      margin: margin,
      stock_store: sStock,
      stock_warehouse: wStock,
      total_stock: totStock,
      val_cost: valCost,
      val_retail: valRetail,
      type: itemType,
      min_store: minStore,
      min_whse: minWhse,
      health: health,
      status: p.is_active ? 'Active' : 'Inactive'
    });

    // Formatting numbers
    ['cost_price', 'msp', 'price', 'margin', 'val_cost', 'val_retail'].forEach(k => {
      row.getCell(k).numFmt = '₹#,##0.00';
    });
    ['stock_store', 'stock_warehouse', 'total_stock', 'min_store', 'min_whse'].forEach(k => {
      row.getCell(k).numFmt = '#,##0.00';
    });

    applyRowStyle(row, idx % 2 === 0);

    // Color code Stock Health
    const healthCell = row.getCell('health');
    if (health === 'Out of Stock') {
      healthCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      healthCell.font = { color: { argb: 'FF991B1B' }, bold: true };
    } else if (health.startsWith('Low')) {
      healthCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      healthCell.font = { color: { argb: 'FF92400E' }, bold: true };
    } else {
      healthCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      healthCell.font = { color: { argb: 'FF166534' } };
    }
  });

  // Inventory Totals Summary Row
  const prodTotalRow = productSheet.addRow({
    barcode: '',
    name: 'TOTAL SUMMARY',
    category: '',
    sub_category: '',
    unit: '',
    cost_price: null,
    msp: null,
    price: null,
    margin: null,
    stock_store: totalStoreUnits,
    stock_warehouse: totalWhseUnits,
    total_stock: totalStoreUnits + totalWhseUnits,
    val_cost: totalCostValuation,
    val_retail: totalRetailValuation,
    type: '',
    min_store: null,
    min_whse: null,
    health: '',
    status: ''
  });

  ['val_cost', 'val_retail'].forEach(k => {
    prodTotalRow.getCell(k).numFmt = '₹#,##0.00';
  });
  ['stock_store', 'stock_warehouse', 'total_stock'].forEach(k => {
    prodTotalRow.getCell(k).numFmt = '#,##0.00';
  });

  applyTotalRowStyle(prodTotalRow, 'FFE2E8F0');
  autoFitColumns(productSheet, 12, 45);

  // -------------------------------------------------------------
  // SHEET 3: Sales Transactions (Bills)
  // -------------------------------------------------------------
  onProgress?.('Exporting Sales Transactions Sheet...');
  const salesSheet = workbook.addWorksheet('Sales Transactions', { views: [{ showGridLines: true }] });

  salesSheet.columns = [
    { header: 'Receipt # / Bill ID', key: 'id', width: 20 },
    { header: 'Date & Time', key: 'date', width: 20 },
    { header: 'Customer Name', key: 'customer_name', width: 22 },
    { header: 'Customer Phone', key: 'customer_phone', width: 16 },
    { header: 'Cashier', key: 'cashier', width: 16 },
    { header: 'Payment Method', key: 'method', width: 16 },
    { header: 'Subtotal (₹)', key: 'subtotal', width: 15 },
    { header: 'Discount (₹)', key: 'discount', width: 14 },
    { header: 'Final Paid (₹)', key: 'total', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Notes / Reference', key: 'notes', width: 25 }
  ];

  applyHeaderStyle(salesSheet.getRow(1), BLUE_HEADER);

  (bills || []).forEach((b, idx) => {
    const formattedDate = formatDateTime(b.created_at).full;
    const subtotal = Number(b.subtotal != null ? b.subtotal : b.total_amount) || 0;
    const discount = Number(b.discount) || 0;
    const total = Number(b.total_amount) || 0;
    const isShowroomBill = isShowroom(b);
    const status = isShowroomBill ? 'SHOWROOM DEDUCTION' : (b.status || 'completed').toUpperCase();

    const row = salesSheet.addRow({
      id: b.id,
      date: formattedDate,
      customer_name: b.customer_name || (isShowroomBill ? 'Showroom' : 'Walk-in Customer'),
      customer_phone: b.customer_phone || '--',
      cashier: b.cashier_name || 'Cashier',
      method: (b.payment_method || 'CASH').toUpperCase(),
      subtotal: subtotal,
      discount: discount,
      total: total,
      status: status,
      notes: b.notes || (isShowroomBill ? 'Showroom Stock Deduction' : '')
    });

    ['subtotal', 'discount', 'total'].forEach(k => {
      row.getCell(k).numFmt = '₹#,##0.00';
    });

    applyRowStyle(row, idx % 2 === 0);

    const statusCell = row.getCell('status');
    if (status === 'VOIDED' || status === 'RETURNED') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      statusCell.font = { color: { argb: 'FF991B1B' }, bold: true };
    } else if (isShowroomBill) {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      statusCell.font = { color: { argb: 'FF92400E' }, bold: true };
    } else {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      statusCell.font = { color: { argb: 'FF166534' } };
    }
  });

  const salesTotalRow = salesSheet.addRow({
    id: 'TOTAL REVENUE',
    date: '',
    customer_name: `${(bills || []).length} Total Bills`,
    customer_phone: '',
    cashier: '',
    method: '',
    subtotal: (bills || []).reduce((acc, b) => (b.status !== 'voided' && !isShowroom(b)) ? acc + (Number(b.subtotal != null ? b.subtotal : b.total_amount) || 0) : acc, 0),
    discount: totalDiscountsGiven,
    total: totalSalesRevenue,
    status: '',
    notes: ''
  });

  ['subtotal', 'discount', 'total'].forEach(k => {
    salesTotalRow.getCell(k).numFmt = '₹#,##0.00';
  });

  applyTotalRowStyle(salesTotalRow, 'FFE0E7FF');
  autoFitColumns(salesSheet, 12, 40);

  // -------------------------------------------------------------
  // SHEET 4: Bill Items Breakdown
  // -------------------------------------------------------------
  onProgress?.('Exporting Bill Items Breakdown Sheet...');
  const itemsSheet = workbook.addWorksheet('Bill Items Breakdown', { views: [{ showGridLines: true }] });

  itemsSheet.columns = [
    { header: 'Bill ID', key: 'bill_id', width: 18 },
    { header: 'Date & Time', key: 'date', width: 20 },
    { header: 'Barcode', key: 'barcode', width: 14 },
    { header: 'Item Name', key: 'item_name', width: 34 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Unit Cost (₹)', key: 'cost_price', width: 14 },
    { header: 'Unit Price (₹)', key: 'price', width: 14 },
    { header: 'Total Item Price (₹)', key: 'total_price', width: 18 },
    { header: 'Est. Gross Profit (₹)', key: 'profit', width: 18 },
    { header: 'Piece / Roll Barcode', key: 'instance_barcode', width: 20 },
    { header: 'Dimensions', key: 'dimensions', width: 16 }
  ];

  applyHeaderStyle(itemsSheet.getRow(1), INDIGO_HEADER);

  let totalItemQty = 0;
  let totalItemsValue = 0;
  let totalItemsProfit = 0;

  const billDateMap = new Map((bills || []).map(b => [b.id, b.created_at]));

  (billItems || []).forEach((it, idx) => {
    const qty = Number(it.billable_quantity || it.quantity || 0);
    const cost = Number(it.cost_price != null ? it.cost_price : (it.cost_at_sale != null ? it.cost_at_sale : 0)) || 0;
    const price = Number(it.price != null ? it.price : (it.price_at_sale != null ? it.price_at_sale : 0)) || 0;
    const totalP = Number(it.total_price != null ? it.total_price : qty * price) || 0;
    const profit = it.profit != null ? Number(it.profit) : (totalP - (qty * cost));

    totalItemQty += qty;
    totalItemsValue += totalP;
    totalItemsProfit += profit;

    const rowDate = it.created_at ? formatDateTime(it.created_at).full : (billDateMap.get(it.bill_id) ? formatDateTime(billDateMap.get(it.bill_id)).full : '--');

    const row = itemsSheet.addRow({
      bill_id: it.bill_id || it.billId || '',
      date: rowDate,
      barcode: it.barcode || '',
      item_name: it.item_name || it.name || '',
      quantity: qty,
      unit: (it.unit || 'PCS').toUpperCase(),
      cost_price: cost,
      price: price,
      total_price: totalP,
      profit: profit,
      instance_barcode: it.instance_barcode || it.instanceBarcode || '--',
      dimensions: it.dimensions ? (typeof it.dimensions === 'object' ? JSON.stringify(it.dimensions) : it.dimensions) : '--'
    });

    ['cost_price', 'price', 'total_price', 'profit'].forEach(k => {
      row.getCell(k).numFmt = '₹#,##0.00';
    });
    row.getCell('quantity').numFmt = '#,##0.00';

    applyRowStyle(row, idx % 2 === 0);

    const profitCell = row.getCell('profit');
    if (profit > 0) {
      profitCell.font = { color: { argb: 'FF15803D' }, bold: true };
    } else if (profit < 0) {
      profitCell.font = { color: { argb: 'FFB91C1C' }, bold: true };
    }
  });

  const itemsTotalRow = itemsSheet.addRow({
    bill_id: 'TOTAL ITEMS SOLD',
    date: '',
    barcode: '',
    item_name: `${(billItems || []).length} Line Items`,
    quantity: totalItemQty,
    unit: '',
    cost_price: null,
    price: null,
    total_price: totalItemsValue,
    profit: totalItemsProfit,
    instance_barcode: '',
    dimensions: ''
  });

  itemsTotalRow.getCell('quantity').numFmt = '#,##0.00';
  ['total_price', 'profit'].forEach(k => {
    itemsTotalRow.getCell(k).numFmt = '₹#,##0.00';
  });

  applyTotalRowStyle(itemsTotalRow, 'FFE0E7FF');
  autoFitColumns(itemsSheet, 12, 40);

  // -------------------------------------------------------------
  // SHEET 5: Business Expenses
  // -------------------------------------------------------------
  onProgress?.('Exporting Expenses Sheet...');
  const expSheet = workbook.addWorksheet('Business Expenses', { views: [{ showGridLines: true }] });

  expSheet.columns = [
    { header: 'Expense ID', key: 'id', width: 18 },
    { header: 'Date & Time', key: 'date', width: 20 },
    { header: 'Staff / Beneficiary', key: 'worker', width: 22 },
    { header: 'Amount (₹)', key: 'amount', width: 16 },
    { header: 'Description / Purpose', key: 'reason', width: 34 },
    { header: 'Recorded By', key: 'recorded_by', width: 18 }
  ];

  applyHeaderStyle(expSheet.getRow(1), CRIMSON_HEADER);

  (expenses || []).forEach((e, idx) => {
    const row = expSheet.addRow({
      id: e.id,
      date: e.created_at ? formatDateTime(e.created_at).full : (e.date || '--'),
      worker: e.worker_name || 'General Shop',
      amount: Number(e.amount) || 0,
      reason: e.reason || e.description || '',
      recorded_by: e.recorded_by || 'Admin'
    });

    row.getCell('amount').numFmt = '₹#,##0.00';
    applyRowStyle(row, idx % 2 === 0);
  });

  const expTotalRow = expSheet.addRow({
    id: 'TOTAL EXPENSES',
    date: '',
    worker: `${(expenses || []).length} Entries`,
    amount: totalExpensesAmount,
    reason: '',
    recorded_by: ''
  });

  expTotalRow.getCell('amount').numFmt = '₹#,##0.00';
  applyTotalRowStyle(expTotalRow, 'FFFEE2E2');
  autoFitColumns(expSheet, 14, 40);

  // -------------------------------------------------------------
  // SHEET 6: Inventory Batches
  // -------------------------------------------------------------
  onProgress?.('Exporting Inventory Batches Sheet...');
  const batchSheet = workbook.addWorksheet('Inventory Batches', { views: [{ showGridLines: true }] });

  batchSheet.columns = [
    { header: 'Barcode', key: 'barcode', width: 14 },
    { header: 'Batch #', key: 'batch_number', width: 12 },
    { header: 'Cost Price (₹)', key: 'cost_price', width: 14 },
    { header: 'Min Price (MSP) (₹)', key: 'msp', width: 16 },
    { header: 'Selling Price (₹)', key: 'price', width: 14 },
    { header: 'Store Stock', key: 'quantity_store', width: 14 },
    { header: 'Warehouse Stock', key: 'quantity_warehouse', width: 16 },
    { header: 'Total Batch Units', key: 'total_qty', width: 16 },
    { header: 'Created Date', key: 'created_at', width: 20 }
  ];

  applyHeaderStyle(batchSheet.getRow(1), SKY_HEADER);

  (batches || []).forEach((b, idx) => {
    const sStock = Number(b.quantity_store) || 0;
    const wStock = Number(b.quantity_warehouse) || 0;
    const row = batchSheet.addRow({
      barcode: b.barcode,
      batch_number: b.batch_number ? `Batch ${String(b.batch_number).padStart(2, '0')}` : 'Initial',
      cost_price: Number(b.cost_price) || 0,
      msp: Number(b.msp) || 0,
      price: Number(b.price) || 0,
      quantity_store: sStock,
      quantity_warehouse: wStock,
      total_qty: sStock + wStock,
      created_at: b.created_at ? formatDateTime(b.created_at).full : '--'
    });

    ['cost_price', 'msp', 'price'].forEach(k => {
      row.getCell(k).numFmt = '₹#,##0.00';
    });
    ['quantity_store', 'quantity_warehouse', 'total_qty'].forEach(k => {
      row.getCell(k).numFmt = '#,##0.00';
    });

    applyRowStyle(row, idx % 2 === 0);
  });

  autoFitColumns(batchSheet, 12, 35);

  // -------------------------------------------------------------
  // SHEET 7: Categories & Subcategories
  // -------------------------------------------------------------
  onProgress?.('Exporting Categories Sheet...');
  const catSheet = workbook.addWorksheet('Categories & Subcategories', { views: [{ showGridLines: true }] });

  catSheet.columns = [
    { header: 'Category Name', key: 'cat_name', width: 24 },
    { header: 'Sub-Category Name', key: 'sub_name', width: 24 },
    { header: 'Associated Products', key: 'prod_count', width: 20 }
  ];

  applyHeaderStyle(catSheet.getRow(1), PURPLE_HEADER);

  const subCatList = subcategories.length > 0 ? subcategories : [];
  if (subCatList.length > 0) {
    subCatList.forEach((s, idx) => {
      const pCount = (products || []).filter(p => p.category === s.category_name && p.sub_category === s.name).length;
      const row = catSheet.addRow({
        cat_name: s.category_name || 'General',
        sub_name: s.name,
        prod_count: pCount
      });
      applyRowStyle(row, idx % 2 === 0);
    });
  } else {
    categories.forEach((c, idx) => {
      const pCount = (products || []).filter(p => p.category === c.name).length;
      const row = catSheet.addRow({
        cat_name: c.name,
        sub_name: '--',
        prod_count: pCount
      });
      applyRowStyle(row, idx % 2 === 0);
    });
  }

  autoFitColumns(catSheet, 16, 35);

  // -------------------------------------------------------------
  // SHEET 8: Staff Members
  // -------------------------------------------------------------
  onProgress?.('Exporting Staff Members Sheet...');
  const staffSheet = workbook.addWorksheet('Staff Members', { views: [{ showGridLines: true }] });

  staffSheet.columns = [
    { header: 'Staff Name', key: 'name', width: 24 },
    { header: 'Account Role', key: 'role', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Created Date', key: 'created_at', width: 20 }
  ];

  applyHeaderStyle(staffSheet.getRow(1), EMERALD_HEADER);

  (workers || []).forEach((w, idx) => {
    const isNonBillable = w.password?.includes('NON_BILLABLE');
    const roleLabel = isNonBillable ? 'Floor Staff (Non-Billable)' : 'Cashier (Billable)';
    const row = staffSheet.addRow({
      name: w.name,
      role: roleLabel,
      status: 'Active',
      created_at: w.created_at ? formatDateTime(w.created_at).full : '--'
    });

    applyRowStyle(row, idx % 2 === 0);

    const roleCell = row.getCell('role');
    if (isNonBillable) {
      roleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      roleCell.font = { color: { argb: 'FF92400E' }, bold: true };
    } else {
      roleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      roleCell.font = { color: { argb: 'FF166534' }, bold: true };
    }
  });

  autoFitColumns(staffSheet, 14, 30);

  // -------------------------------------------------------------
  // SHEET 9: Audit Logs & Activity Trail
  // -------------------------------------------------------------
  onProgress?.('Exporting Audit Trail Logs Sheet...');
  const auditSheet = workbook.addWorksheet('Audit Trail Logs', { views: [{ showGridLines: true }] });

  auditSheet.columns = [
    { header: 'Date & Time', key: 'date', width: 22 },
    { header: 'Action Type', key: 'action_type', width: 16 },
    { header: 'Barcode', key: 'barcode', width: 14 },
    { header: 'Entity / Item Name', key: 'item_name', width: 28 },
    { header: 'Changes & Details', key: 'changes', width: 45 },
    { header: 'Performed By', key: 'performed_by', width: 18 }
  ];

  applyHeaderStyle(auditSheet.getRow(1), SLATE_HEADER);

  (auditLogs || []).forEach((log, idx) => {
    const action = (log.action_type || 'ACTIVITY').toUpperCase();
    const row = auditSheet.addRow({
      date: log.created_at ? formatDateTime(log.created_at).full : (log.date || '--'),
      action_type: action,
      barcode: log.barcode || '--',
      item_name: log.item_name || '',
      changes: log.changes || '--',
      performed_by: log.performed_by || 'Owner'
    });

    applyRowStyle(row, idx % 2 === 0);

    const actionCell = row.getCell('action_type');
    if (action.includes('DELETE') || action.includes('VOID')) {
      actionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      actionCell.font = { color: { argb: 'FF991B1B' }, bold: true };
    } else if (action.includes('CREATE') || action.includes('INSERT') || action.includes('STOCK_IN')) {
      actionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      actionCell.font = { color: { argb: 'FF166534' }, bold: true };
    } else if (action.includes('RETURN')) {
      actionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
      actionCell.font = { color: { argb: 'FF9A3412' }, bold: true };
    } else {
      actionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      actionCell.font = { color: { argb: 'FF1E40AF' }, bold: true };
    }
  });

  autoFitColumns(auditSheet, 12, 55);

  // -------------------------------------------------------------
  // Step 3: Write to Excel File Buffer & Trigger Download
  // -------------------------------------------------------------
  onProgress?.('Generating Excel file & preparing download...');
  const buffer = await workbook.xlsx.writeBuffer();
  const safeName = (shopSettings?.shop_name || 'Hardware_POS').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${safeName}_Full_Business_Backup_${dateStr}.xlsx`;

  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName
  );

  return fileName;
}
