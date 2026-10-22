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
  const productMap = new Map((products || []).map(p => [p.barcode, p]));

  onProgress?.('Fetching sales transactions...');
  let billsQuery = supabase.from('bills').select('*').order('created_at', { ascending: false });
  if (shopId) billsQuery = billsQuery.eq('shop_id', shopId);
  const { data: bills = [] } = await billsQuery;
  const billMap = new Map((bills || []).map(b => [b.id, b]));

  onProgress?.('Fetching bill item details...');
  let billItems = [];
  try {
    let billItemsQuery = supabase.from('bill_items').select('*');
    if (shopId) billItemsQuery = billItemsQuery.eq('shop_id', shopId);
    const { data: biData, error: biErr } = await billItemsQuery;
    if (biErr) {
      console.warn('bill_items query note:', biErr.message);
      // Fallback: If shop_id filter failed (e.g. column not present on bill_items), fetch all and filter in memory by bills
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

  // Sort bill items in-memory by transaction date descending
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
    let batchQuery = supabase.from('inventory_batches').select('*');
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

  // Title Row (Starts from Column A: no blank column A)
  overviewSheet.mergeCells('A2:D2');
  const titleCell = overviewSheet.getCell('A2');
  titleCell.value = `${(shopSettings?.shop_name || 'HARDWARE POS').toUpperCase()} - COMPLETE BUSINESS EXPORT`;
  titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_HEADER } };
  overviewSheet.getRow(2).height = 34;

  // Shop Info Card Header
  overviewSheet.mergeCells('A4:D4');
  const profileHeaderCell = overviewSheet.getCell('A4');
  profileHeaderCell.value = 'STORE PROFILE & SYSTEM REGISTRATION';
  profileHeaderCell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  profileHeaderCell.alignment = { vertical: 'middle', horizontal: 'left' };
  profileHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SLATE_HEADER } };
  overviewSheet.getRow(4).height = 24;

  const infoRows = [
    ['Store / Shop Name', shopSettings?.shop_name || 'N/A', 'Physical Counter / Store Entity', 'Verified Active'],
    ['Owner / Administrator', shopSettings?.owner_name || 'Administrator', 'Primary Account Holder', 'Full Owner Access'],
    ['Registered Admin Email', shopSettings?.registered_admin_email || shopSettings?.email || 'N/A', 'Login & Backup Email', 'System ID'],
    ['Contact Phone', shopSettings?.phone || 'N/A', 'Official Business Phone', 'Verified'],
    ['Shop Address', (shopSettings?.shop_address || '').replace(/^HIDDEN::/, '') || 'N/A', 'Store Location / Premises', 'On Invoices'],
    ['UPI ID / Digital VPA', (shopSettings?.upi_id || '').replace(/^HIDDEN::/, '') || 'N/A', 'Digital Payment Receiver', 'On Invoices'],
    ['Report Export Timestamp', formatDateTime(new Date().toISOString()).full, 'Automated Snapshot Generation', 'Live Database']
  ];

  overviewSheet.getRow(5).values = ['Property', 'Store Detail Value', 'Field Description', 'Status / Role'];
  applyHeaderStyle(overviewSheet.getRow(5), 'FF334155');

  infoRows.forEach(([prop, val, desc, status], idx) => {
    const rNum = 6 + idx;
    const row = overviewSheet.getRow(rNum);
    row.getCell(1).value = prop;
    row.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF334155' } };
    row.getCell(2).value = val;
    row.getCell(2).font = { size: 10, color: { argb: 'FF0F172A' }, bold: idx === 0 || idx === 1 };
    row.getCell(3).value = desc;
    row.getCell(3).font = { size: 10, color: { argb: 'FF64748B' } };
    row.getCell(4).value = status;
    row.getCell(4).font = { size: 10, color: { argb: 'FF059669' }, bold: true };
    applyRowStyle(row, idx % 2 === 0);
  });

  // KPI Section Header
  const kpiHeaderRowNum = 6 + infoRows.length + 1;
  overviewSheet.mergeCells(`A${kpiHeaderRowNum}:D${kpiHeaderRowNum}`);
  const kpiHeaderCell = overviewSheet.getCell(`A${kpiHeaderRowNum}`);
  kpiHeaderCell.value = 'KEY PERFORMANCE INDICATORS (LIFETIME SNAPSHOT)';
  kpiHeaderCell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  kpiHeaderCell.alignment = { vertical: 'middle', horizontal: 'left' };
  kpiHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_HEADER } };
  overviewSheet.getRow(kpiHeaderRowNum).height = 24;

  const kpis = [
    ['Total Catalog Items', (products || []).length, 'SKU Items', 'Active Product Catalog'],
    ['Total Store Inventory', totalStoreUnits, 'Units', 'Ready on Store Counter'],
    ['Total Warehouse Inventory', totalWhseUnits, 'Units', 'Backroom / Storage Units'],
    ['Total Combined Stock Units', totalStoreUnits + totalWhseUnits, 'Units', 'All Locations Combined'],
    ['Inventory Valuation (At Cost)', totalCostValuation, 'Currency', 'Actual Capital Invested'],
    ['Inventory Valuation (At Retail)', totalRetailValuation, 'Currency', 'Potential Retail Turnover'],
    ['Potential Gross Inventory Profit', totalRetailValuation - totalCostValuation, 'Currency', 'Expected Markup on Inventory'],
    ['Total Invoices Processed', (bills || []).length, 'Invoices', 'Recorded Invoices to Date'],
    ['Total Gross Sales Revenue', totalSalesRevenue, 'Currency', 'Excluding Showroom Transfers'],
    ['Total Customer Discounts Given', totalDiscountsGiven, 'Currency', 'Negotiated & Direct Deductions'],
    ['Total Operating Expenses Recorded', totalExpensesAmount, 'Currency', 'Staff Advances, Utilities, etc.'],
    ['Net Operating Surplus (Sales - Expenses)', netEarnings, 'Currency', netEarnings >= 0 ? 'Profitable Balance' : 'Negative Margin']
  ];

  const kpiTableHeaderRow = kpiHeaderRowNum + 1;
  overviewSheet.getRow(kpiTableHeaderRow).values = ['Business Metric', 'Value', 'Unit / Format', 'Context & Notes'];
  applyHeaderStyle(overviewSheet.getRow(kpiTableHeaderRow), NAVY_HEADER);

  kpis.forEach(([name, val, type, context], idx) => {
    const rowNum = kpiTableHeaderRow + 1 + idx;
    const row = overviewSheet.getRow(rowNum);
    row.getCell(1).value = name;
    row.getCell(2).value = typeof val === 'number' ? val : (isNaN(Number(val)) ? val : Number(val));
    row.getCell(3).value = type;
    row.getCell(4).value = context;

    if (type === 'Currency') {
      row.getCell(2).numFmt = '₹#,##0.00';
    } else if (type === 'Units' || type === 'Invoices' || type === 'SKU Items') {
      row.getCell(2).numFmt = '#,##0.00';
    }

    applyRowStyle(row, idx % 2 === 0);
  });

  overviewSheet.getColumn(1).width = 38;
  overviewSheet.getColumn(2).width = 28;
  overviewSheet.getColumn(3).width = 18;
  overviewSheet.getColumn(4).width = 32;

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
    { header: 'Cost Price (₹)', key: 'cost_price', width: 14 },
    { header: 'Min Price (MSP) (₹)', key: 'msp', width: 16 },
    { header: 'Selling Price (₹)', key: 'price', width: 14 },
    { header: 'Unit Margin (₹)', key: 'margin', width: 14 },
    { header: 'Store Stock', key: 'stock_store', width: 14 },
    { header: 'Warehouse Stock', key: 'stock_warehouse', width: 16 },
    { header: 'Total Stock', key: 'total_stock', width: 14 },
    { header: 'Stock Value at Cost (₹)', key: 'val_cost', width: 20 },
    { header: 'Stock Value at Retail (₹)', key: 'val_retail', width: 20 },
    { header: 'Item Type', key: 'type', width: 16 },
    { header: 'Min Store Limit', key: 'min_store', width: 16 },
    { header: 'Min Warehouse Limit', key: 'min_whse', width: 18 },
    { header: 'Stock Health', key: 'health', width: 16 },
    { header: 'Catalog Status', key: 'status', width: 14 }
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

    const itemType = p.is_cuttable ? 'Cuttable Piece' : (p.is_loose_item ? 'Loose Item' : 'Standard Product');

    const row = productSheet.addRow({
      barcode: p.barcode || '--',
      name: p.name || 'Unnamed Product',
      category: p.category || 'General',
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
      status: p.is_active === false ? 'Inactive' : 'Active'
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

  // Inventory Totals Summary Row (Fully filled, zero empty cells)
  const prodTotalRow = productSheet.addRow({
    barcode: 'TOTALS',
    name: `TOTAL SUMMARY (${(products || []).length} Products)`,
    category: 'All Categories',
    sub_category: 'All Sub-Categories',
    unit: 'Total Units',
    cost_price: products.length > 0 ? (totalCostValuation / (totalStoreUnits + totalWhseUnits || 1)) : 0,
    msp: 0,
    price: products.length > 0 ? (totalRetailValuation / (totalStoreUnits + totalWhseUnits || 1)) : 0,
    margin: (totalRetailValuation - totalCostValuation),
    stock_store: totalStoreUnits,
    stock_warehouse: totalWhseUnits,
    total_stock: totalStoreUnits + totalWhseUnits,
    val_cost: totalCostValuation,
    val_retail: totalRetailValuation,
    type: 'Full Inventory',
    min_store: 0,
    min_whse: 0,
    health: 'Stock Summary',
    status: 'ACTIVE'
  });

  ['cost_price', 'msp', 'price', 'margin', 'val_cost', 'val_retail'].forEach(k => {
    prodTotalRow.getCell(k).numFmt = '₹#,##0.00';
  });
  ['stock_store', 'stock_warehouse', 'total_stock', 'min_store', 'min_whse'].forEach(k => {
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
    { header: 'Cashier / Operator', key: 'cashier', width: 18 },
    { header: 'Payment Method', key: 'method', width: 16 },
    { header: 'Subtotal (₹)', key: 'subtotal', width: 15 },
    { header: 'Discount (₹)', key: 'discount', width: 14 },
    { header: 'Final Paid (₹)', key: 'total', width: 16 },
    { header: 'Transaction Status', key: 'status', width: 18 },
    { header: 'Notes / Type', key: 'notes', width: 25 }
  ];

  applyHeaderStyle(salesSheet.getRow(1), BLUE_HEADER);

  if ((bills || []).length === 0) {
    const emptyRow = salesSheet.addRow({
      id: 'NO-SALES',
      date: '--',
      customer_name: 'No Sales Recorded',
      customer_phone: '--',
      cashier: '--',
      method: '--',
      subtotal: 0,
      discount: 0,
      total: 0,
      status: 'NO DATA',
      notes: 'No sales transactions processed yet'
    });
    applyRowStyle(emptyRow, false);
  } else {
    bills.forEach((b, idx) => {
      const formattedDate = formatDateTime(b.created_at).full;
      const subtotal = Number(b.subtotal != null ? b.subtotal : b.total_amount) || 0;
      const discount = Number(b.discount) || 0;
      const total = Number(b.total_amount) || 0;
      const isShowroomBill = isShowroom(b);
      const status = isShowroomBill ? 'SHOWROOM DEDUCTION' : (b.status || 'completed').toUpperCase();

      const row = salesSheet.addRow({
        id: b.id,
        date: formattedDate,
        customer_name: b.customer_name || (isShowroomBill ? 'Showroom Internal' : 'Walk-in Customer'),
        customer_phone: b.customer_phone || '--',
        cashier: b.cashier_name || 'Cashier',
        method: (b.payment_method || 'CASH').toUpperCase(),
        subtotal: subtotal,
        discount: discount,
        total: total,
        status: status,
        notes: b.notes || (isShowroomBill ? 'Showroom Stock Deduction' : 'Store POS Sale')
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
  }

  // Summary Row (Zero empty cells)
  const salesTotalRow = salesSheet.addRow({
    id: 'TOTAL REVENUE',
    date: 'All Transaction Dates',
    customer_name: `${(bills || []).length} Total Invoices`,
    customer_phone: '--',
    cashier: 'All Staff Cashiers',
    method: 'All Payment Modes',
    subtotal: (bills || []).reduce((acc, b) => (b.status !== 'voided' && !isShowroom(b)) ? acc + (Number(b.subtotal != null ? b.subtotal : b.total_amount) || 0) : acc, 0),
    discount: totalDiscountsGiven,
    total: totalSalesRevenue,
    status: 'COMPLETED SALES',
    notes: 'Excluding Showroom Deductions'
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
    { header: 'Quantity Sold', key: 'quantity', width: 14 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Unit Cost (₹)', key: 'cost_price', width: 14 },
    { header: 'Unit Price (₹)', key: 'price', width: 14 },
    { header: 'Total Price (₹)', key: 'total_price', width: 18 },
    { header: 'Est. Gross Profit (₹)', key: 'profit', width: 18 },
    { header: 'Piece / Roll Barcode', key: 'instance_barcode', width: 20 },
    { header: 'Dimensions / Specs', key: 'dimensions', width: 18 }
  ];

  applyHeaderStyle(itemsSheet.getRow(1), INDIGO_HEADER);

  let totalItemQty = 0;
  let totalItemsValue = 0;
  let totalItemsProfit = 0;

  if ((billItems || []).length === 0) {
    const emptyRow = itemsSheet.addRow({
      bill_id: 'NO-ITEMS',
      date: '--',
      barcode: '--',
      item_name: 'No Line Items Recorded',
      quantity: 0,
      unit: '--',
      cost_price: 0,
      price: 0,
      total_price: 0,
      profit: 0,
      instance_barcode: '--',
      dimensions: '--'
    });
    applyRowStyle(emptyRow, false);
  } else {
    billItems.forEach((it, idx) => {
      const pLookup = productMap.get(it.barcode);
      const qty = Number(it.billable_quantity || it.quantity || 0);
      const cost = Number(it.cost_price != null ? it.cost_price : (it.cost_at_sale != null ? it.cost_at_sale : (pLookup?.cost_price || 0))) || 0;
      const price = Number(it.price != null ? it.price : (it.price_at_sale != null ? it.price_at_sale : (pLookup?.price || 0))) || 0;
      const totalP = Number(it.total_price != null ? it.total_price : qty * price) || 0;
      const profit = it.profit != null ? Number(it.profit) : (totalP - (qty * cost));

      totalItemQty += qty;
      totalItemsValue += totalP;
      totalItemsProfit += profit;

      const parentBill = billMap.get(it.bill_id);
      const rowDate = it.created_at ? formatDateTime(it.created_at).full : (parentBill?.created_at ? formatDateTime(parentBill.created_at).full : '--');

      const dimensionsStr = it.dimensions
        ? (typeof it.dimensions === 'object' ? JSON.stringify(it.dimensions) : it.dimensions)
        : (it.cut_length ? `${it.cut_length} x ${it.cut_width || 0}` : '--');

      const row = itemsSheet.addRow({
        bill_id: it.bill_id || it.billId || '--',
        date: rowDate,
        barcode: it.barcode || '--',
        item_name: it.item_name || it.name || pLookup?.name || 'Item Sold',
        quantity: qty,
        unit: (it.unit || pLookup?.unit || 'PCS').toUpperCase(),
        cost_price: cost,
        price: price,
        total_price: totalP,
        profit: profit,
        instance_barcode: it.instance_barcode || it.instanceBarcode || '--',
        dimensions: dimensionsStr
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
  }

  // Summary Row (Zero empty cells)
  const itemsTotalRow = itemsSheet.addRow({
    bill_id: 'SUMMARY TOTALS',
    date: 'All Sales Transactions',
    barcode: '--',
    item_name: `${(billItems || []).length} Total Sold Line Items`,
    quantity: totalItemQty,
    unit: 'Total Units',
    cost_price: 0,
    price: 0,
    total_price: totalItemsValue,
    profit: totalItemsProfit,
    instance_barcode: '--',
    dimensions: '--'
  });

  itemsTotalRow.getCell('quantity').numFmt = '#,##0.00';
  ['cost_price', 'price', 'total_price', 'profit'].forEach(k => {
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

  if ((expenses || []).length === 0) {
    const emptyRow = expSheet.addRow({
      id: 'EXP-NONE',
      date: '--',
      worker: 'No Expenses Logged',
      amount: 0,
      reason: 'No operating expenses recorded yet',
      recorded_by: '--'
    });
    applyRowStyle(emptyRow, false);
  } else {
    expenses.forEach((e, idx) => {
      const row = expSheet.addRow({
        id: e.id || '--',
        date: e.created_at ? formatDateTime(e.created_at).full : (e.date || '--'),
        worker: e.worker_name || 'General Shop',
        amount: Number(e.amount) || 0,
        reason: e.reason || e.description || 'General Business Expense',
        recorded_by: e.recorded_by || 'Owner'
      });

      row.getCell('amount').numFmt = '₹#,##0.00';
      applyRowStyle(row, idx % 2 === 0);
    });
  }

  // Summary Row (Zero empty cells)
  const expTotalRow = expSheet.addRow({
    id: 'TOTAL EXPENSES',
    date: 'All Expense Dates',
    worker: `${(expenses || []).length} Total Entries`,
    amount: totalExpensesAmount,
    reason: 'Total Store Operating Outflow',
    recorded_by: shopSettings?.owner_name || 'Store Administration'
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
    { header: 'Product Name', key: 'product_name', width: 34 },
    { header: 'Batch #', key: 'batch_number', width: 14 },
    { header: 'Purchase Cost (₹)', key: 'cost_price', width: 16 },
    { header: 'Min Price (MSP) (₹)', key: 'msp', width: 18 },
    { header: 'Selling Price (MRP) (₹)', key: 'price', width: 20 },
    { header: 'Store Stock', key: 'quantity_store', width: 14 },
    { header: 'Warehouse Stock', key: 'quantity_warehouse', width: 16 },
    { header: 'Total Batch Units', key: 'total_qty', width: 16 },
    { header: 'Batch Status', key: 'status', width: 14 },
    { header: 'Created Date', key: 'created_at', width: 20 }
  ];

  applyHeaderStyle(batchSheet.getRow(1), SKY_HEADER);

  let totalBatchStore = 0;
  let totalBatchWhse = 0;

  if ((batches || []).length === 0) {
    const emptyRow = batchSheet.addRow({
      barcode: '--',
      product_name: 'No Multi-Batches Recorded',
      batch_number: 'Initial',
      cost_price: 0,
      msp: 0,
      price: 0,
      quantity_store: 0,
      quantity_warehouse: 0,
      total_qty: 0,
      status: 'Standard Stock',
      created_at: '--'
    });
    applyRowStyle(emptyRow, false);
  } else {
    batches.forEach((b, idx) => {
      const pLookup = productMap.get(b.barcode);
      // Correct database columns in Supabase: stock_store, stock_warehouse, purchase_cost, selling_price
      const sStock = Number(b.stock_store != null ? b.stock_store : (b.quantity_store || 0)) || 0;
      const wStock = Number(b.stock_warehouse != null ? b.stock_warehouse : (b.quantity_warehouse || 0)) || 0;
      const cost = Number(b.purchase_cost != null ? b.purchase_cost : (b.cost_price != null ? b.cost_price : (pLookup?.cost_price || 0))) || 0;
      const price = Number(b.selling_price != null ? b.selling_price : (b.price != null ? b.price : (pLookup?.price || 0))) || 0;
      const msp = Number(b.msp != null ? b.msp : (pLookup?.msp || 0)) || 0;

      totalBatchStore += sStock;
      totalBatchWhse += wStock;

      const row = batchSheet.addRow({
        barcode: b.barcode || '--',
        product_name: pLookup?.name || 'Catalog Item',
        batch_number: b.batch_number ? `Batch ${String(b.batch_number).padStart(2, '0')}` : 'Initial Batch',
        cost_price: cost,
        msp: msp,
        price: price,
        quantity_store: sStock,
        quantity_warehouse: wStock,
        total_qty: sStock + wStock,
        status: b.is_active === false ? 'Archived' : (sStock + wStock > 0 ? 'Active Stock' : 'Depleted'),
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
  }

  // Summary Row (Zero empty cells)
  const batchTotalRow = batchSheet.addRow({
    barcode: 'BATCH TOTALS',
    product_name: `${(batches || []).length} Recorded Inventory Batches`,
    batch_number: 'All Batches',
    cost_price: 0,
    msp: 0,
    price: 0,
    quantity_store: totalBatchStore,
    quantity_warehouse: totalBatchWhse,
    total_qty: totalBatchStore + totalBatchWhse,
    status: 'ACTIVE BATCHES',
    created_at: 'All Batch Periods'
  });

  ['cost_price', 'msp', 'price'].forEach(k => {
    batchTotalRow.getCell(k).numFmt = '₹#,##0.00';
  });
  ['quantity_store', 'quantity_warehouse', 'total_qty'].forEach(k => {
    batchTotalRow.getCell(k).numFmt = '#,##0.00';
  });

  applyTotalRowStyle(batchTotalRow, 'FFE0F2FE');
  autoFitColumns(batchSheet, 12, 35);

  // -------------------------------------------------------------
  // SHEET 7: Categories & Subcategories
  // -------------------------------------------------------------
  onProgress?.('Exporting Categories Sheet...');
  const catSheet = workbook.addWorksheet('Categories & Subcategories', { views: [{ showGridLines: true }] });

  catSheet.columns = [
    { header: 'Category Name', key: 'cat_name', width: 26 },
    { header: 'Sub-Category Name', key: 'sub_name', width: 26 },
    { header: 'Product Count (SKUs)', key: 'prod_count', width: 22 },
    { header: 'Total In-Stock Units', key: 'stock_units', width: 22 }
  ];

  applyHeaderStyle(catSheet.getRow(1), PURPLE_HEADER);

  let totalCatProducts = 0;
  let totalCatUnits = 0;

  // Build a complete matrix of categories and subcategories
  const seenCatSub = new Set();
  const categoryRows = [];

  // 1. Process all declared subcategories
  (subcategories || []).forEach(sub => {
    const catName = sub.category_name || 'General';
    const subName = sub.name || 'General';
    seenCatSub.add(`${catName}::${subName}`);

    const matchedProds = (products || []).filter(p => (p.category || 'General') === catName && (p.sub_category || 'General') === subName);
    const prodCount = matchedProds.length;
    const stockUnits = matchedProds.reduce((sum, p) => sum + (Number(p.stock_store) || 0) + (Number(p.stock_warehouse) || 0), 0);

    categoryRows.push({
      cat_name: catName,
      sub_name: subName,
      prod_count: prodCount,
      stock_units: stockUnits
    });
  });

  // 2. Process categories without subcategories
  (categories || []).forEach(cat => {
    const hasSubs = (subcategories || []).some(s => s.category_name === cat.name);
    if (!hasSubs) {
      const key = `${cat.name}::Main / General`;
      if (!seenCatSub.has(key)) {
        seenCatSub.add(key);
        const matchedProds = (products || []).filter(p => (p.category || 'General') === cat.name);
        const prodCount = matchedProds.length;
        const stockUnits = matchedProds.reduce((sum, p) => sum + (Number(p.stock_store) || 0) + (Number(p.stock_warehouse) || 0), 0);

        categoryRows.push({
          cat_name: cat.name,
          sub_name: 'Main / General',
          prod_count: prodCount,
          stock_units: stockUnits
        });
      }
    }
  });

  // 3. Process any orphaned products with custom category/subcategory not in tables
  (products || []).forEach(p => {
    const catName = p.category || 'General';
    const subName = p.sub_category || 'General';
    const key = `${catName}::${subName}`;
    if (!seenCatSub.has(key)) {
      seenCatSub.add(key);
      const matchedProds = (products || []).filter(pr => (pr.category || 'General') === catName && (pr.sub_category || 'General') === subName);
      categoryRows.push({
        cat_name: catName,
        sub_name: subName,
        prod_count: matchedProds.length,
        stock_units: matchedProds.reduce((sum, pr) => sum + (Number(pr.stock_store) || 0) + (Number(pr.stock_warehouse) || 0), 0)
      });
    }
  });

  if (categoryRows.length === 0) {
    const emptyRow = catSheet.addRow({
      cat_name: 'General',
      sub_name: 'General Items',
      prod_count: (products || []).length,
      stock_units: totalStoreUnits + totalWhseUnits
    });
    applyRowStyle(emptyRow, false);
    totalCatProducts = (products || []).length;
    totalCatUnits = totalStoreUnits + totalWhseUnits;
  } else {
    categoryRows.forEach((r, idx) => {
      totalCatProducts += r.prod_count;
      totalCatUnits += r.stock_units;

      const row = catSheet.addRow({
        cat_name: r.cat_name,
        sub_name: r.sub_name,
        prod_count: r.prod_count,
        stock_units: r.stock_units
      });

      row.getCell('prod_count').numFmt = '#,##0';
      row.getCell('stock_units').numFmt = '#,##0.00';
      applyRowStyle(row, idx % 2 === 0);
    });
  }

  // Summary Row (Zero empty cells)
  const catTotalRow = catSheet.addRow({
    cat_name: 'TOTALS',
    sub_name: `${(categories || []).length} Categories Registered`,
    prod_count: totalCatProducts,
    stock_units: totalCatUnits
  });

  catTotalRow.getCell('prod_count').numFmt = '#,##0';
  catTotalRow.getCell('stock_units').numFmt = '#,##0.00';
  applyTotalRowStyle(catTotalRow, 'FFF3E8FF');
  autoFitColumns(catSheet, 16, 35);

  // -------------------------------------------------------------
  // SHEET 8: Staff Members
  // -------------------------------------------------------------
  onProgress?.('Exporting Staff Members Sheet...');
  const staffSheet = workbook.addWorksheet('Staff Members', { views: [{ showGridLines: true }] });

  staffSheet.columns = [
    { header: 'Staff Name', key: 'name', width: 26 },
    { header: 'Account Role', key: 'role', width: 28 },
    { header: 'Account Status', key: 'status', width: 16 },
    { header: 'Created Date', key: 'created_at', width: 22 }
  ];

  applyHeaderStyle(staffSheet.getRow(1), EMERALD_HEADER);

  // 1. Primary Store Owner / Administrator at top
  const ownerRow = staffSheet.addRow({
    name: shopSettings?.owner_name || 'Store Owner',
    role: 'Store Owner / Administrator',
    status: 'Active (Owner)',
    created_at: shopSettings?.created_at ? formatDateTime(shopSettings.created_at).full : formatDateTime(new Date().toISOString()).full
  });
  applyRowStyle(ownerRow, false);
  const ownerRoleCell = ownerRow.getCell('role');
  ownerRoleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
  ownerRoleCell.font = { color: { argb: 'FF166534' }, bold: true };

  // 2. All Floor Staff & Cashiers
  (workers || []).forEach((w, idx) => {
    const isNonBillable = w.password?.includes('NON_BILLABLE');
    const roleLabel = isNonBillable ? 'Floor Staff (Non-Billable Stock Only)' : 'Cashier (Billable Counter Terminal)';
    const row = staffSheet.addRow({
      name: w.name || 'Staff Member',
      role: roleLabel,
      status: w.is_active === false ? 'Inactive' : 'Active',
      created_at: w.created_at ? formatDateTime(w.created_at).full : '--'
    });

    applyRowStyle(row, (idx + 1) % 2 === 0);

    const roleCell = row.getCell('role');
    if (isNonBillable) {
      roleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      roleCell.font = { color: { argb: 'FF92400E' }, bold: true };
    } else {
      roleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      roleCell.font = { color: { argb: 'FF1E40AF' }, bold: true };
    }
  });

  // Summary Row (Zero empty cells)
  const staffTotalRow = staffSheet.addRow({
    name: 'TOTAL ACCOUNTS',
    role: `${(workers || []).length + 1} Staff & Admin Accounts Registered`,
    status: 'ACTIVE ACCOUNTS',
    created_at: 'All Shifts & Locations'
  });

  applyTotalRowStyle(staffTotalRow, 'FFDCFCE7');
  autoFitColumns(staffSheet, 16, 35);

  // -------------------------------------------------------------
  // SHEET 9: Audit Logs & Activity Trail
  // -------------------------------------------------------------
  onProgress?.('Exporting Audit Trail Logs Sheet...');
  const auditSheet = workbook.addWorksheet('Audit Trail Logs', { views: [{ showGridLines: true }] });

  auditSheet.columns = [
    { header: 'Date & Time', key: 'date', width: 22 },
    { header: 'Action Type', key: 'action_type', width: 16 },
    { header: 'Barcode / Entity', key: 'barcode', width: 16 },
    { header: 'Item Name / Target', key: 'item_name', width: 30 },
    { header: 'Changes & Action Details', key: 'changes', width: 45 },
    { header: 'Performed By', key: 'performed_by', width: 18 }
  ];

  applyHeaderStyle(auditSheet.getRow(1), SLATE_HEADER);

  if ((auditLogs || []).length === 0) {
    const emptyRow = auditSheet.addRow({
      date: '--',
      action_type: 'SYSTEM',
      barcode: '--',
      item_name: 'No Audit Records',
      changes: 'No audit trail logs recorded yet',
      performed_by: '--'
    });
    applyRowStyle(emptyRow, false);
  } else {
    auditLogs.forEach((log, idx) => {
      const action = (log.action_type || 'ACTIVITY').toUpperCase();
      const row = auditSheet.addRow({
        date: log.created_at ? formatDateTime(log.created_at).full : (log.date || '--'),
        action_type: action,
        barcode: log.barcode || '--',
        item_name: log.item_name || log.barcode || 'General Entity',
        changes: log.changes || log.description || 'System Event',
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
  }

  // Summary Row (Zero empty cells)
  const auditTotalRow = auditSheet.addRow({
    date: 'Complete Audit Trail',
    action_type: 'AUDIT SUMMARY',
    barcode: '--',
    item_name: `${(auditLogs || []).length} Logged Events`,
    changes: 'Detailed Security & Inventory Action History',
    performed_by: 'All Users'
  });

  applyTotalRowStyle(auditTotalRow, 'FFF1F5F9');
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
