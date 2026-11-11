import { useState, useEffect, useRef, useMemo, Fragment, useCallback } from 'react';
import { localToUtcIso, formatINR, billLabel } from './utils';
import { getPerformedBy } from './utils';
import { supabase } from './supabaseClient';
import { casUpdateRow } from './services/atomicStock';
import { beginCriticalWork } from './services/busyGuard';
import { returnItemsAtomic } from './services/posRpc';
import { PageLoader, EmptyState } from './SharedUI';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { formatDateTime, escapeIlike, formatDayHeader, useSessionState } from './utils';
import { SALES_PER_PAGE } from './constants';
import { DialogOverlay } from './Dialog';
import { Search, Undo2, X, Phone, User, Calendar } from 'lucide-react';
import BillDetailsView from './BillDetailsView';
import { getInventoryItemByBarcode } from './services/db';
import PageTitleReset from './components/PageTitleReset';
import DayClosingModal from './components/reports/DayClosingModal';
import { Badge, Button, buttonClass, DateField, useSort, SortTh, TableSkeleton } from './components/ui';

// Click-to-sort columns for the sales list (sorting happens on the loaded day/page only)
const LEDGER_SORT = {
  date: (b) => new Date(b.created_at).getTime() || 0,
  customer: { get: (b) => b.customer_name || b.customer_phone || '', textual: true },
  cashier: { get: (b) => b.cashier_name || '', textual: true },
  payment: { get: (b) => (b.status === 'voided' ? 'VOIDED' : (b.payment_method || '')), textual: true },
  total: (b) => Number(b.total_amount) || 0,
};

const paymentTone = (method) => (method === 'CASH' ? 'success' : method === 'UPI' ? 'accent' : 'warning');

// Searching by bill number is switched on once bills loaded from the database include
// the bill_no column (after the bill-number SQL update); before that the query would fail.
let billNoSearchEnabled = false;
const noteBillNoColumn = (rows) => {
  if (!billNoSearchEnabled && (rows || []).some(r => r && Object.prototype.hasOwnProperty.call(r, 'bill_no'))) {
    billNoSearchEnabled = true;
  }
};

const isItemCuttable = (item) => {
  return Boolean(
    item?.is_cuttable === true ||
    item?.instance_barcode ||
    (item?.cut_length !== null && item?.cut_length !== undefined && Number(item?.cut_length) > 0)
  );
};

const enrichBillItems = async (rawItems) => {
  if (!rawItems || rawItems.length === 0) return [];
  const barcodes = [...new Set(rawItems.map(i => i.barcode).filter(Boolean))];
  const productMap = {};
  if (barcodes.length > 0) {
    try {
      const { data: prodData } = await supabase
        .from('product_master')
        .select('barcode, is_cuttable')
        .in('barcode', barcodes);
      if (prodData) {
        prodData.forEach(p => {
          productMap[p.barcode] = p.is_cuttable;
        });
      }
    } catch (pErr) {
      console.warn("Could not fetch product_master for returns:", pErr);
    }
  }

  return Promise.all(rawItems.map(async (it) => {
    let isCut = Boolean(
      it.is_cuttable ||
      productMap[it.barcode] ||
      it.instance_barcode ||
      (it.cut_length !== null && it.cut_length !== undefined && Number(it.cut_length) > 0)
    );

    if (!isCut && it.barcode && productMap[it.barcode] === undefined) {
      try {
        const localProd = await getInventoryItemByBarcode(it.barcode);
        if (localProd?.is_cuttable) isCut = true;
      } catch (e) {
        // Ignore local lookup failure
      }
    }

    return {
      ...it,
      is_cuttable: isCut
    };
  }));
};

export default function OwnerLedger({ isActive }) {
  const { showAlert, userRole, shopSettings } = useApp();
  const [isClosingOpen, setIsClosingOpen] = useState(false);
  const isOwner = userRole === 'owner';
  const queryClient = useQueryClient();
  const shopId = localStorage.getItem('shop_id');

  const [salesPage, setSalesPage] = useSessionState(`pos_ledger_sales_page_${shopId}`, 0);
  const [datePageIndex, setDatePageIndex] = useSessionState(`pos_ledger_date_idx_${shopId}`, 0);
  const [customDate, setCustomDate] = useSessionState(`pos_ledger_custom_date_${shopId}`, '');

  // Customer search & suggestions
  const [searchQuery, setSearchQuery] = useSessionState(`pos_ledger_search_${shopId}`, '');
  const [customers, setCustomers] = useState([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const searchContainerRef = useRef(null);

  const [selectedBill, setSelectedBill] = useSessionState(`pos_ledger_selected_${shopId}`, null);
  const [billItemsCache, setBillItemsCache] = useState({});
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [returnModalState, setReturnModalState] = useSessionState(`pos_ledger_return_modal_${shopId}`, null);

  const handleResetLedger = () => {
    setSearchQuery('');
    setSalesPage(0);
    setDatePageIndex(0);
    setCustomDate('');
    setSelectedBill(null);
    setReturnModalState(null);
    setShowCustomerDropdown(false);
    try {
      window.sessionStorage.removeItem(`pos_ledger_sales_page_${shopId}`);
      window.sessionStorage.removeItem(`pos_ledger_date_idx_${shopId}`);
      window.sessionStorage.removeItem(`pos_ledger_custom_date_${shopId}`);
      window.sessionStorage.removeItem(`pos_ledger_search_${shopId}`);
      window.sessionStorage.removeItem(`pos_ledger_selected_${shopId}`);
      window.sessionStorage.removeItem(`pos_ledger_return_modal_${shopId}`);
    } catch (e) {}
  };

  // Query distinct dates with store sales for day-by-day pagination
  const { data: availableDates = [] } = useQuery({
    queryKey: ['billAvailableDates', shopId, isActive],
    queryFn: async () => {
      let query = supabase
        .from('bills')
        .select('created_at')
        .eq('location', 'Store')
        .neq('status', 'showroom_pending')
        .neq('status', 'showroom')
        .neq('payment_method', 'SHOWROOM')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const dates = [];
      const seen = new Set();
      for (const row of (data || [])) {
        if (!row.created_at) continue;
        const d = new Date(row.created_at).toLocaleDateString('en-CA');
        if (!seen.has(d)) {
          seen.add(d);
          dates.push(d);
        }
      }
      return dates;
    },
    enabled: isActive,
    staleTime: 1000 * 60 * 2,
  });

  const isSearching = Boolean(searchQuery.trim());

  // Active day: custom selected date, or date at current page index, or latest available date
  const currentDay = useMemo(() => {
    if (customDate) return customDate;
    if (availableDates && availableDates.length > 0) {
      return availableDates[datePageIndex] || availableDates[0];
    }
    return new Date().toLocaleDateString('en-CA');
  }, [customDate, availableDates, datePageIndex]);

  // Fetch recent customer records for quick search suggestions (phone prioritized)
  useEffect(() => {
    async function fetchRecentCustomers() {
      try {
        const shopId = localStorage.getItem('shop_id');
        let query = supabase
          .from('bills')
          .select('customer_name, customer_phone')
          .eq('location', 'Store');
        if (shopId) {
          query = query.eq('shop_id', shopId);
        }
        const { data, error } = await query
          .order('created_at', { ascending: false })
          .limit(300);

        if (data && !error) {
          const map = new Map();
          const list = [];
          for (const row of data) {
            const phone = (row.customer_phone || '').trim();
            const name = (row.customer_name || '').trim();
            if (!phone && !name) continue;
            const key = `${phone}:::${name.toLowerCase()}`;
            if (!map.has(key)) {
              map.set(key, true);
              list.push({ phone, name });
            }
          }
          setCustomers(list);
        }
      } catch (err) {
        console.error('Error fetching recent customers:', err);
      }
    }
    fetchRecentCustomers();
  }, []);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowCustomerDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter suggestions prioritizing phone numbers, then customer names
  const filteredSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers.filter(c => 
      (c.phone && c.phone.includes(q)) || 
      (c.name && c.name.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [customers, searchQuery]);

  const fetchBills = useCallback(async () => {
    let query = supabase
      .from('bills')
      .select('*')
      .eq('location', 'Store') // Only Sales
      .neq('status', 'showroom_pending')
      .neq('status', 'showroom')
      .neq('payment_method', 'SHOWROOM'); // Showroom records are in their own section
    if (shopId) {
      query = query.eq('shop_id', shopId);
    }

    if (isSearching) {
      // GLOBAL SEARCH: Search all available data across all time
      const raw = searchQuery.trim().replace(/^#/, '').replace(/[,()]/g, '');
      if (raw) {
        const cleanQ = escapeIlike(raw);
        query = query.or(`customer_phone.ilike.%${cleanQ}%,customer_name.ilike.%${cleanQ}%,id.ilike.%${cleanQ}%${billNoSearchEnabled && /^\d{1,12}$/.test(raw) ? `,bill_no.eq.${raw}` : ''}`);
      }
      const from = salesPage * SALES_PER_PAGE;
      query = query
        .order('created_at', { ascending: false })
        .range(from, from + SALES_PER_PAGE - 1);
    } else {
      // DAY-BY-DAY MODE: Load records strictly of currentDay
      const start = localToUtcIso(`${currentDay}T00:00:00`);
      const end = localToUtcIso(`${currentDay}T23:59:59.999`);
      query = query
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;
    noteBillNoColumn(data);
    
    // Stock receipts are now tagged 'Warehouse-Inbound' when saved (and old ones are fixed by the
    // SQL migration), so the ledger no longer writes to the database while loading.
    const rawBills = data || [];

    return rawBills.filter(b => b.payment_method || Number(b.total_amount) > 0 || b.status === 'voided');
  }, [shopId, isSearching, salesPage, searchQuery, currentDay]);

  const { data: bills = [], isLoading: isLoadingBills } = useQuery({
    queryKey: ['bills', shopId, isSearching, salesPage, searchQuery, currentDay, isActive],
    queryFn: fetchBills,
    enabled: isActive,
    staleTime: 1000 * 60 * 2,
  });
  const { sorted: sortedBills, sort: billSort, toggleSort: toggleBillSort } = useSort(bills, LEDGER_SORT);

  const hasMoreBills = isSearching ? bills.length === SALES_PER_PAGE : (datePageIndex < availableDates.length - 1);

  const handleExportCSV = async () => {
    try {
      showAlert('Preparing CSV export...', 'Info');
      const shopId = localStorage.getItem('shop_id');
      let query = supabase.from('bills').select('*')
        .eq('location', 'Store')
        .neq('status', 'showroom_pending')
        .neq('status', 'showroom')
        .neq('payment_method', 'SHOWROOM');
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }

      if (isSearching) {
        const raw = searchQuery.trim().replace(/^#/, '').replace(/[,()]/g, '');
        if (raw) {
          const cleanQ = escapeIlike(raw);
          query = query.or(`customer_phone.ilike.%${cleanQ}%,customer_name.ilike.%${cleanQ}%,id.ilike.%${cleanQ}%${billNoSearchEnabled && /^\d{1,12}$/.test(raw) ? `,bill_no.eq.${raw}` : ''}`);
        }
      } else {
        const start = localToUtcIso(`${currentDay}T00:00:00`);
        const end = localToUtcIso(`${currentDay}T23:59:59.999`);
        query = query.gte('created_at', start).lte('created_at', end);
      }

      query = query.order('created_at', { ascending: false }).limit(5000);

      const { data, error } = await query;
      if (error) throw error;
      
      const rawData = data || [];
      const cleanData = rawData.filter(b => b.payment_method || Number(b.total_amount) > 0 || b.status === 'voided');
      if (cleanData.length === 0) {
         return showAlert('No data to export for this filter.', 'Warning');
      }
      const exportData = cleanData.map(b => ({
         'Bill ID': b.id,
         'Date': formatDateTime(b.created_at).datePart,
         'Time': formatDateTime(b.created_at).timePart,
         'Customer Phone': b.customer_phone || '',
         'Customer Name': b.customer_name || 'Walk-in',
         'Cashier': b.cashier_name || 'System',
         'Activity Type': b.status === 'voided' ? 'Voided / Returned' : 'Sale',
         'Status': b.status || 'completed',
         'Payment Method': b.payment_method || '',
         'Total Amount': b.total_amount || 0,
         ...(isOwner ? { 'Total Profit': b.total_profit || 0 } : {})
      }));
      
      const { default: ExcelJS } = await import('exceljs');
      const { saveAs } = await import('file-saver');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Sales_Ledger');

      const columns = [
        { header: 'Bill ID', key: 'Bill ID', width: 15 },
        { header: 'Date', key: 'Date', width: 15 },
        { header: 'Time', key: 'Time', width: 10 },
        { header: 'Customer Phone', key: 'Customer Phone', width: 18 },
        { header: 'Customer Name', key: 'Customer Name', width: 20 },
        { header: 'Cashier', key: 'Cashier', width: 15 },
        { header: 'Activity Type', key: 'Activity Type', width: 18 },
        { header: 'Status', key: 'Status', width: 15 },
        { header: 'Payment Method', key: 'Payment Method', width: 15 },
        { header: 'Total Amount', key: 'Total Amount', width: 15 },
      ];
      if (isOwner) {
        columns.push({ header: 'Total Profit', key: 'Total Profit', width: 15 });
      }
      worksheet.columns = columns;
      worksheet.getRow(1).font = { bold: true };

      exportData.forEach(row => {
        worksheet.addRow(row);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Sales_Export_${new Date().toLocaleDateString('en-CA')}.xlsx`);
    } catch (e) {
      showAlert(`Export failed: ${e.message}`, 'Error');
    }
  };

  const handleOpenReturnModal = async (bill) => {
    if (bill.status === 'voided') {
      showAlert('This bill has already been fully returned.', 'Info');
      return;
    }

    let items = billItemsCache[bill.id];
    if (!items) {
      try {
        setIsLoadingItems(true);
        const shopId = bill.shop_id || localStorage.getItem('shop_id');
        let biQuery = supabase.from('bill_items').select('*').eq('bill_id', bill.id);
        if (shopId) {
          biQuery = biQuery.eq('shop_id', shopId);
        }
        const { data, error } = await biQuery;
        if (error) throw error;
        let rawItems = data || [];
        const hasScrew = rawItems.some(it => it.barcode === 'SCREWS' || it.is_screw);
        const billTotal = Number(bill.total_amount || 0);
        if (!hasScrew && billTotal > 0) {
          const itemsSum = rawItems.reduce((acc, it) => acc + (Number(it.price_at_sale || 0) * Number(it.billable_quantity || it.quantity || 1)), 0);
          const diff = Math.round((billTotal - itemsSum) * 100) / 100;
          if (diff > 0) {
            rawItems = [
              ...rawItems,
              {
                id: 'screw-legacy-' + bill.id,
                bill_id: bill.id,
                barcode: 'SCREWS',
                name: 'Screws',
                quantity: 1,
                billable_quantity: 1,
                actual_quantity: 1,
                price_at_sale: diff,
                system_price: diff,
                profit: diff,
                unit: 'SET',
                is_screw: true
              }
            ];
          }
        }
        items = await enrichBillItems(rawItems);
        setBillItemsCache(prev => ({ ...prev, [bill.id]: items }));
      } catch (err) {
        showAlert(`Failed to load items: ${err.message}`, 'Error');
        return;
      } finally {
        setIsLoadingItems(false);
      }
    }

    if (items.length === 0) {
      showAlert('No items found for this bill.', 'Warning');
      return;
    }

    setReturnModalState({ bill, items });
  };

  const executeReturnItems = async (itemsToReturn, isAll, bill) => {
    const endCriticalWork = beginCriticalWork(); // holds back app auto-update reloads
    try {
      if (itemsToReturn.length === 0) return;

      const shopId = localStorage.getItem('shop_id');
      const performedBy = getPerformedBy();

      let updatedBillTotal = Number(bill.total_amount);

      const stockRestoreFailures = [];

      // One database call does the whole return (stock back, bill lines, total, Cash/UPI,
      // return record, audit log) all-or-nothing. Before the database update it isn't
      // available and the step-by-step path below is used instead.
      let atomicDone = false;
      const allRealLines = itemsToReturn.every(i => /^[0-9a-f-]{36}$/i.test(String(i.id)));
      if (allRealLines) {
        const res = await returnItemsAtomic({
          billId: bill.id,
          items: itemsToReturn.map(i => ({ bill_item_id: i.id, quantity: Number(i.returnQuantity) })),
          voidAll: isAll,
          performedBy
        });
        if (!res.unavailable) {
          if (res.error) throw res.error;
          atomicDone = true;
          if (isAll) updatedBillTotal = 0;
          else if (res.data?.new_total !== undefined && res.data?.new_total !== null) updatedBillTotal = Number(res.data.new_total);
        }
      }

      if (!atomicDone) {
        if (isAll) {
          // Mark entire bill as voided
          updatedBillTotal = 0;
          let billUpdateQuery = supabase
            .from('bills')
            .update({ status: 'voided' })
            .eq('id', bill.id);
          if (shopId) {
            billUpdateQuery = billUpdateQuery.eq('shop_id', shopId);
          }
          const { error: billError } = await billUpdateQuery;
          if (billError) throw billError;
        } else {
          // Calculate partial refund
          const refundAmount = itemsToReturn.reduce((sum, item) => sum + (Number(item.price_at_sale) * item.returnQuantity), 0);
          updatedBillTotal = Math.max(0, Number(bill.total_amount) - refundAmount);
          const newStatus = updatedBillTotal <= 0.001 ? 'voided' : bill.status;
          const billUpdatePayload = { total_amount: updatedBillTotal, status: newStatus };
          // Keep the payment split consistent with the reduced total (refund comes out of cash first)
          const round2 = (n) => Math.round(n * 100) / 100;
          if (bill.payment_method === 'CASH') {
            billUpdatePayload.cash_amount = round2(updatedBillTotal);
          } else if (bill.payment_method === 'UPI') {
            billUpdatePayload.upi_amount = round2(updatedBillTotal);
          } else if (bill.payment_method === 'SPLIT') {
            const prevCash = Number(bill.cash_amount || 0);
            const prevUpi = Number(bill.upi_amount || 0);
            const cashRefund = Math.min(prevCash, refundAmount);
            billUpdatePayload.cash_amount = round2(prevCash - cashRefund);
            billUpdatePayload.upi_amount = round2(Math.max(0, prevUpi - (refundAmount - cashRefund)));
          }
          let billUpdateQuery = supabase.from('bills').update(billUpdatePayload).eq('id', bill.id);
          if (shopId) {
            billUpdateQuery = billUpdateQuery.eq('shop_id', shopId);
          }
          const { error: billError } = await billUpdateQuery;
          if (billError) throw billError;
        }

        // Restore stock for selected items directly to inventory_batches
        for (const item of itemsToReturn) {
          const qtyToRestore = item.returnQuantity;
          let targetBatchId = item.batch_id;
          if (!targetBatchId) {
             let bQuery = supabase.from('inventory_batches').select('batch_id').eq('barcode', item.barcode);
             if (shopId) {
               bQuery = bQuery.eq('shop_id', shopId);
             }
             const { data: batches } = await bQuery.limit(1);
             if (batches && batches.length > 0) targetBatchId = batches[0].batch_id;
          }
        
          if (targetBatchId) {
            // Atomic increment (compare-and-swap) so a sale on a counter at the same moment isn't lost
            try {
              await casUpdateRow({
                table: 'inventory_batches',
                match: { batch_id: targetBatchId, shop_id: shopId },
                columns: ['stock_store'],
                compute: (cur) => ({
                  update: { stock_store: Number(cur.stock_store || 0) + Number(qtyToRestore) }
                })
              });
            } catch (stockErr) {
              // Keep processing the remaining items (same as before), but report it instead of failing silently
              console.error(`Stock restore failed for ${item.name}:`, stockErr);
              stockRestoreFailures.push(`${item.name} (${qtyToRestore} ${item.unit || ''})`.trim());
            }
          }

          await supabase.from('audit_logs').insert([{
            shop_id: shopId,
            item_name: item.name,
            barcode: item.barcode,
            action_type: isAll ? 'VOID' : 'RETURN',
            changes: isAll 
              ? `Restored ${qtyToRestore} ${item.unit} (Bill #${billLabel(bill)})` 
              : `Returned ${qtyToRestore} ${item.unit} of ${item.name} from Bill #${billLabel(bill)}`,
            performed_by: performedBy
          }]);

          if (!isAll && !String(item.id).startsWith('screw-legacy-')) {
            const currentQty = Number(item.billable_quantity || item.quantity);
            if (qtyToRestore >= currentQty) {
              // Delete individual returned item from bill_items
              let delItem = supabase.from('bill_items').delete().eq('id', item.id);
              if (shopId) {
                delItem = delItem.eq('shop_id', shopId);
              }
              await delItem;
            } else {
              // Update quantity for partial return
              const newQty = currentQty - qtyToRestore;
              const actQty = Number(item.actual_quantity || item.quantity) - qtyToRestore;
              let updateItem = supabase.from('bill_items').update({
                  quantity: newQty,
                  billable_quantity: newQty,
                  actual_quantity: actQty
              }).eq('id', item.id);
              if (shopId) {
                updateItem = updateItem.eq('shop_id', shopId);
              }
              await updateItem;
            }
          }
        }
      
      }

      if (stockRestoreFailures.length > 0) {
        showAlert(`Return recorded, but stock could not be added back for: ${stockRestoreFailures.join(', ')}. Please adjust these items' stock manually.`, "Partial Stock Restore");
      } else {
        showAlert(`Successfully returned ${isAll ? 'full bill' : 'selected items'}.`, "Success");
      }
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      
      if (!isAll) {
         // re-fetch bill items to update cache correctly for partial qtys
         let refetchItems = supabase.from('bill_items').select('*').eq('bill_id', bill.id);
         if (shopId) {
           refetchItems = refetchItems.eq('shop_id', shopId);
         }
         const { data: updatedItems } = await refetchItems;
         const enrichedUpdated = await enrichBillItems(updatedItems || []);
         setBillItemsCache(prev => ({
           ...prev,
           [bill.id]: enrichedUpdated
         }));
         if (selectedBill && selectedBill.id === bill.id) {
           setSelectedBill(prev => prev ? { ...prev, total_amount: updatedBillTotal } : null);
         }
      } else {
         setBillItemsCache(prev => {
           const next = { ...prev };
           delete next[bill.id];
           return next;
         });
         if (selectedBill && selectedBill.id === bill.id) {
           setSelectedBill(prev => prev ? { ...prev, status: 'voided', total_amount: 0 } : null);
         }
      }
      setReturnModalState(null);
    } catch (e) {
      console.error(e);
      showAlert(e.message, "Return Failed");
    } finally {
      endCriticalWork();
    }
  };

  if (selectedBill) {
    return (
      <div className="h-full flex flex-col relative w-full">
        <BillDetailsView
          bill={selectedBill}
          onBack={() => setSelectedBill(null)}
          onProcessReturn={(bill) => handleOpenReturnModal(bill)}
          cachedItems={billItemsCache[selectedBill.id]}
          showProfit={isOwner}
        />
        {returnModalState && (
          <ReturnItemsModal 
            isOpen={true}
            onClose={() => setReturnModalState(null)}
            bill={returnModalState.bill}
            items={returnModalState.items}
            onReturnItems={executeReturnItems}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative w-full">
      <div className="flex flex-wrap justify-between items-end gap-3 mb-4">
        <PageTitleReset
          title="Sales History"
          subtitle="Search past sales by customer phone or name, view receipts, and process returns."
          onReset={handleResetLedger}
          tooltip="Click title to reset customer search and date filters to default"
        />
        {isOwner && (
          <Button
            variant="primary"
            onClick={() => setIsClosingOpen(true)}
            title={`End-of-day summary for ${formatDayHeader(currentDay)}`}
          >
            <Calendar className="w-4 h-4" />
            <span>Day closing</span>
          </Button>
        )}
      </div>
      {isOwner && (
        <DayClosingModal
          isOpen={isClosingOpen}
          onClose={() => setIsClosingOpen(false)}
          day={currentDay}
          shopId={shopId}
          shopName={shopSettings?.shop_name}
        />
      )}

      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3 mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          {/* Customer Search Bar with Phone prioritized */}
          <div className="relative w-full lg:w-96" ref={searchContainerRef}>
            <div className="relative flex items-center">
              <Search className="w-4 h-4 absolute left-3.5 text-[var(--text-secondary)] pointer-events-none shrink-0 z-10" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSalesPage(0);
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                placeholder="Search Phone, Name, or Bill #..."
                className="w-full h-10 text-sm rounded-lg focus:outline-none shadow-sm transition-all"
                style={{
                  paddingLeft: '2.5rem',
                  paddingRight: '2.5rem',
                  border: '1px solid var(--border-medium)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-input)'
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSalesPage(0);
                  }}
                  className="absolute right-2.5 p-1 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] z-10"
                  title="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Customer suggestion dropdown (Phone number shown first in bold) */}
            {showCustomerDropdown && filteredSuggestions.length > 0 && (
              <div
                className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-xl z-50 overflow-hidden border border-[var(--border-medium)] bg-[var(--bg-secondary)] py-1 max-h-64 overflow-y-auto"
              >
                <div className="px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-light)]">
                  Customer Suggestions (Phone / Name)
                </div>
                {filteredSuggestions.map((cust, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSearchQuery(cust.phone || cust.name);
                      setShowCustomerDropdown(false);
                      setSalesPage(0);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-light)] last:border-none"
                  >
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                      <span className="font-bold text-[var(--text-primary)]">
                        {cust.phone || 'No Phone'}
                      </span>
                      {cust.name && (
                        <span className="text-xs text-[var(--text-secondary)]">
                          • {cust.name}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-[var(--color-accent)] font-semibold uppercase">Filter</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Day Navigation / Jump & Export */}
          <div className="flex flex-wrap items-center gap-2">
            {!isSearching ? (
              <>
                <span className="text-xs font-semibold uppercase whitespace-nowrap text-[var(--text-secondary)]">Date:</span>
                <DateField
                  value={currentDay}
                  max={new Date().toLocaleDateString('en-CA')}
                  onChange={(e) => {
                    const selected = e.target.value;
                    if (!selected) return;
                    const idx = availableDates.indexOf(selected);
                    if (idx >= 0) {
                      setDatePageIndex(idx);
                      setCustomDate('');
                    } else {
                      setCustomDate(selected);
                    }
                  }}
                  aria-label="Date filter"
                  title="Jump to date"
                />
                {(datePageIndex > 0 || customDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDate('');
                      setDatePageIndex(0);
                    }}
                    className={buttonClass({ variant: 'secondary', size: 'md', className: 'md:h-9' })}
                    title="Return to latest active day"
                  >
                    Latest Day
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-accent)' }}>
                <span>Searching all dates across all history</span>
              </div>
            )}
          </div>
        </div>

        {/* Ledger Table */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto shadow-sm min-h-[400px] md:rounded-lg border border-[var(--border-light)] mb-4" style={{ backgroundColor: 'transparent', overscrollBehavior: 'none' }}>
          <div className="w-full max-w-full h-full">
            <table className={`block md:table w-full md:table-fixed text-left md:text-center border-collapse ${(isLoadingBills && bills.length === 0 || bills.length === 0) ? 'h-full' : ''}`}>
            <colgroup className="hidden md:table-column-group">
              <col style={{ width: '20%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead className="hidden md:table-header-group sticky top-0 z-20 glass-header" style={{ borderBottom: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}>
              <tr className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                <SortTh label="Date & Time" sortKey="date" sort={billSort} onSort={toggleBillSort} className="h-10 px-3 w-[20%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }} />
                <SortTh label="Customer" sortKey="customer" sort={billSort} onSort={toggleBillSort} className="h-10 px-3 w-[24%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }} />
                <SortTh label="Cashier" sortKey="cashier" sort={billSort} onSort={toggleBillSort} className="h-10 px-3 w-[16%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }} />
                <SortTh label="Payment" sortKey="payment" sort={billSort} onSort={toggleBillSort} className="h-10 px-3 w-[12%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }} />
                <SortTh label="Total (₹)" sortKey="total" sort={billSort} onSort={toggleBillSort} className="h-10 px-3 w-[14%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }} />
                <th className="h-10 px-3 w-[14%] text-center">Action</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group p-2 md:p-0">
              {isLoadingBills && bills.length === 0 ? (
                <tr className="block md:table-row border-none" style={{ borderBottom: 'none' }}><td colSpan="6" className="block md:table-cell p-0 border-none" style={{ borderBottom: 'none' }}><TableSkeleton rows={8} cols={6} label="Loading sales…" /></td></tr>
              ) : bills.length === 0 ? (
                <tr className="block md:table-row border-none" style={{ borderBottom: 'none' }}><td colSpan="6" className="block md:table-cell h-[300px] p-0 border-none" style={{ borderBottom: 'none' }}><EmptyState message="No sales found for this period." /></td></tr>
              ) : sortedBills.map(bill => (
                <tr
                  key={bill.id}
                  onClick={() => setSelectedBill(bill)}
                  className="cursor-pointer premium-hover block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none border md:border-b md:border-t-0 md:border-l-0 md:border-r-0 border-[var(--border-medium)] md:border-[var(--border-medium)] mb-3 md:mb-0 relative md:static transition-colors"
                  style={{
                    borderBottom: '1px solid var(--border-medium)',
                  }}
                >
                  {/* Mobile Row Card */}
                  <td className="md:hidden block p-4 border-none">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="text-xs font-bold text-[var(--text-secondary)]">{formatDateTime(bill.created_at).full}</div>
                        {(bill.customer_phone || bill.customer_name) ? (
                           <div className="text-xs font-semibold text-[var(--text-primary)] mt-1 flex items-center gap-1.5 flex-wrap">
                            {bill.customer_phone && (
                              <span className="font-bold flex items-center gap-1">
                                <Phone className="w-3 h-3 text-[var(--color-accent)]" />
                                {bill.customer_phone}
                              </span>
                            )}
                            {bill.customer_name && (
                              <span className="text-[var(--text-secondary)]">({bill.customer_name})</span>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-light)]">
                              Walk-in Customer
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className={`text-base font-bold tabular-nums ${bill.status === 'voided' ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--color-accent)]'}`}>₹{formatINR(Number(bill.total_amount), 2)}</div>
                        {bill.payment_method && (
                          <Badge tone={paymentTone(bill.payment_method)} className="mt-0.5">{bill.payment_method}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-[var(--border-light)] mt-2">
                      <div className="text-xs font-medium capitalize" style={{ color: 'var(--text-secondary)' }}>Cashier: {bill.cashier_name}</div>
                      <div className="flex items-center gap-2">
                        {bill.status === 'voided' ? (
                          <Badge tone="error">RETURNED</Badge>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenReturnModal(bill);
                            }}
                            className={buttonClass({ variant: 'danger-outline', size: 'sm', className: 'gap-1' })}
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                            <span>Return</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Desktop Table Cells - Center Aligned */}
                  <td className="hidden md:table-cell py-4 px-3 w-[20%] text-sm text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                    <div className="font-semibold text-xs text-[var(--text-primary)]">{formatDateTime(bill.created_at).datePart}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{formatDateTime(bill.created_at).timePart}</div>
                  </td>

                  <td className="hidden md:table-cell py-4 px-3 w-[24%] text-sm text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    {bill.customer_phone || bill.customer_name ? (
                      <div className="flex flex-col items-center justify-center">
                        {bill.customer_phone && (
                          <span className="font-bold text-xs flex items-center justify-center gap-1 text-[var(--text-primary)]">
                            <Phone className="w-3 h-3 text-[var(--color-accent)] shrink-0" />
                            {bill.customer_phone}
                          </span>
                        )}
                        {bill.customer_name && (
                          <span className="text-xs text-[var(--text-secondary)]">
                            {bill.customer_name}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-light)]">
                        Walk-in Customer
                      </span>
                    )}
                  </td>

                  <td className="hidden md:table-cell py-4 px-3 w-[16%] text-sm text-center capitalize" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                    <span className="font-medium">{bill.cashier_name}</span>
                  </td>

                  <td className="hidden md:table-cell py-4 px-3 w-[12%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    {bill.status === 'voided' ? (
                      <Badge tone="error">VOIDED</Badge>
                    ) : bill.payment_method ? (
                      <Badge tone={paymentTone(bill.payment_method)}>{bill.payment_method}</Badge>
                    ) : (
                      <span className="text-xs text-[var(--text-tertiary)]">--</span>
                    )}
                  </td>

                  <td className="hidden md:table-cell py-4 px-3 w-[14%] text-center text-sm font-bold tabular-nums" style={{ borderRight: '1px solid var(--border-medium)', color: bill.status === 'voided' ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: bill.status === 'voided' ? 'line-through' : 'none' }}>
                    ₹{formatINR(Number(bill.total_amount), 2)}
                  </td>

                  {/* Dedicated Return Button on ALL Rows */}
                  <td className="hidden md:table-cell py-4 px-3 w-[14%] text-center">
                    {bill.status === 'voided' ? (
                      <Badge tone="error">RETURNED</Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenReturnModal(bill);
                        }}
                        className={buttonClass({ variant: 'danger-outline', size: 'sm' })}
                        title="Process Return for this Bill"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Return</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>

        <div className="flex flex-row justify-between items-center gap-2 p-2.5 sm:p-3 mt-auto shadow-sm rounded-lg shrink-0 w-full" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
          {!isSearching ? (
            <>
              <button 
                onClick={() => {
                  setCustomDate('');
                  setDatePageIndex(p => Math.max(0, p - 1));
                }} 
                disabled={datePageIndex === 0 && (!customDate || customDate === availableDates[0])} 
                className={buttonClass({ variant: 'secondary', size: 'sm', className: 'sm:px-4' })}
                title="Previous Day"
              >
                <span>&larr;<span className="hidden sm:inline"> Previous</span></span>
              </button>

              <div className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium text-[var(--text-secondary)] text-center min-w-0">
                <span className="font-bold text-[var(--text-primary)] px-2 sm:px-2.5 py-1 rounded-md inline-flex items-center gap-1 sm:gap-1.5 truncate" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                  <Calendar className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                  <span className="truncate">{formatDayHeader(currentDay)}</span>
                </span>
                <span>•</span>
                <span className="shrink-0">{bills.length} {bills.length === 1 ? 'sale' : 'sales'}</span>
                {bills.length > 0 && (
                  <>
                    <span>•</span>
                    <span className="shrink-0 font-bold tabular-nums text-[var(--text-primary)]" title="Total of this day's sales (returned bills excluded)">
                      ₹{formatINR(bills.reduce((sum, b) => sum + (b.status === 'voided' ? 0 : (Number(b.total_amount) || 0)), 0), 2)}
                    </span>
                  </>
                )}
                {availableDates.length > 0 && (
                  <>
                    <span className="hidden sm:inline">•</span>
                    <span className="hidden sm:inline text-xs text-[var(--text-tertiary)]">
                      Day {availableDates.indexOf(currentDay) >= 0 ? availableDates.indexOf(currentDay) + 1 : datePageIndex + 1} of {availableDates.length}
                    </span>
                  </>
                )}
              </div>

              <button 
                onClick={() => {
                  setCustomDate('');
                  setDatePageIndex(p => Math.min(Math.max(0, availableDates.length - 1), p + 1));
                }} 
                disabled={availableDates.length === 0 || (datePageIndex >= availableDates.length - 1 && (!customDate || customDate === availableDates[availableDates.length - 1]))} 
                className={buttonClass({ variant: 'secondary', size: 'sm', className: 'sm:px-4' })}
                title="Next Day"
              >
                <span><span className="hidden sm:inline">Next </span>&rarr;</span>
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => setSalesPage(p => Math.max(0, p - 1))} 
                disabled={salesPage === 0} 
                className={buttonClass({ variant: 'secondary', size: 'sm', className: 'sm:px-5' })}
                title="Previous Page"
              >
                <span>&larr;<span className="hidden sm:inline"> Prev</span></span>
              </button>

              <div className="text-xs text-[var(--text-secondary)] text-center truncate px-1">
                <span className="font-semibold text-[var(--color-accent)] hidden sm:inline">Global Search: </span>Page {salesPage + 1} • {bills.length} items
              </div>

              <button 
                onClick={() => setSalesPage(p => p + 1)} 
                disabled={bills.length < SALES_PER_PAGE} 
                className={buttonClass({ variant: 'secondary', size: 'sm', className: 'sm:px-5' })}
                title="Next Page"
              >
                <span><span className="hidden sm:inline">Next </span>&rarr;</span>
              </button>
            </>
          )}
        </div>
      </div>

      {returnModalState && (
        <ReturnItemsModal 
          isOpen={true}
          onClose={() => setReturnModalState(null)}
          bill={returnModalState.bill}
          items={returnModalState.items}
          onReturnItems={executeReturnItems}
        />
      )}
    </div>
  );
}

function ReturnItemsModal({ isOpen, onClose, bill, items, onReturnItems }) {
  const [returnQuantities, setReturnQuantities] = useState({});
  const [isReturning, setIsReturning] = useState(false);

  if (!isOpen || !bill) return null;

  const returnableItems = items.filter(item => !isItemCuttable(item));

  const handleQtyChange = (item, delta) => {
    setReturnQuantities(prev => {
      const current = prev[item.id] || 0;
      const maxQty = Number(item.billable_quantity || item.actual_quantity || item.quantity);
      let newQty = current + delta;
      if (newQty < 0) newQty = 0;
      if (newQty > maxQty) newQty = maxQty;
      
      const updated = { ...prev, [item.id]: newQty };
      if (newQty === 0) delete updated[item.id];
      return updated;
    });
  };

  const handleCheckbox = (item) => {
    setReturnQuantities(prev => {
      if (prev[item.id]) {
        const updated = { ...prev };
        delete updated[item.id];
        return updated;
      } else {
        return { ...prev, [item.id]: Number(item.billable_quantity || item.actual_quantity || item.quantity) };
      }
    });
  };

  const handleSelectAll = () => {
    setReturnQuantities(prev => {
      const allSelected = returnableItems.length > 0 && returnableItems.every(i => prev[i.id] === Number(i.billable_quantity || i.actual_quantity || i.quantity));
      if (allSelected) {
        return {};
      }
      const updated = {};
      returnableItems.forEach(i => {
        updated[i.id] = Number(i.billable_quantity || i.actual_quantity || i.quantity);
      });
      return updated;
    });
  };

  const itemsToReturn = Object.keys(returnQuantities).map(id => {
    const item = items.find(i => i.id === id);
    return { ...item, returnQuantity: returnQuantities[id] };
  }).filter(Boolean);

  const refundAmount = itemsToReturn.reduce((sum, item) => sum + (Number(item.price_at_sale) * item.returnQuantity), 0);
  const isAll = items.length > 0 && items.length === itemsToReturn.length && items.every(item => returnQuantities[item.id] === Number(item.billable_quantity || item.actual_quantity || item.quantity));

  const handleConfirm = async () => {
    setIsReturning(true);
    try {
      await onReturnItems(itemsToReturn, isAll, bill);
    } finally {
      setIsReturning(false);
    }
  };

  return (
    <DialogOverlay isOpen={isOpen} onClose={onClose} labelId="return-items-title" maxWidth="520px">
      <div className="flex justify-between items-center px-6 pt-6 pb-4 border-b border-[var(--border-light)]">
        <div>
          <span id="return-items-title" className="text-base font-semibold text-[var(--text-primary)]">
            Process Return &amp; Refund
          </span>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            Bill #{billLabel(bill)} • {formatDateTime(bill.created_at).datePart}
            {bill.customer_phone && ` • Phone: ${bill.customer_phone}`}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="p-1.5 hover:bg-[var(--bg-hover)] rounded-md transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-6 max-h-[60vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm text-[var(--text-secondary)]">Select items and quantities to return:</p>
          {returnableItems.length > 1 && (
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs font-bold text-[var(--color-accent)] hover:underline"
            >
              {returnableItems.every(i => returnQuantities[i.id] === Number(i.billable_quantity || i.actual_quantity || i.quantity)) ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
        
        <div className="flex flex-col gap-3">
          {items.map(item => {
            const maxQty = Number(item.billable_quantity || item.actual_quantity || item.quantity);
            const returnQty = returnQuantities[item.id] || 0;
            const isSelected = returnQty > 0;
            const isCuttable = isItemCuttable(item);

            return (
              <div key={item.id} className="flex flex-col gap-2 p-3 rounded-lg border transition-colors" style={{ backgroundColor: isSelected ? 'var(--color-accent-bg)' : 'var(--bg-secondary)', borderColor: isSelected ? 'var(--color-accent)' : 'var(--border-light)' }}>
                <div className="flex items-center justify-between">
                  <label className={`flex items-center gap-3 flex-1 ${isCuttable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`} onClick={(e) => { e.preventDefault(); if (!isCuttable) handleCheckbox(item); }}>
                    <input 
                      type="checkbox" 
                      checked={isSelected} 
                      readOnly
                      disabled={isCuttable}
                      className="w-4 h-4 rounded cursor-pointer pointer-events-none"
                      style={{ accentColor: 'var(--color-accent)' }}
                    />
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{item.name}</div>
                      <div className="text-xs text-[var(--text-secondary)]">Sold at: ₹{formatINR(Number(item.price_at_sale), 2)}/{item.unit || 'pc'}</div>
                    </div>
                  </label>

                  {isCuttable ? (
                    <div className="flex items-center">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border-light)] text-[var(--text-secondary)]">
                        Non-returnable (Cut Item)
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button 
                        type="button"
                        onClick={() => handleQtyChange(item, -1)} 
                        disabled={returnQty <= 0} 
                        className="w-7 h-7 rounded border border-[var(--border-medium)] flex items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-40 hover:bg-[var(--bg-hover)] transition-colors text-sm font-bold"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        max={maxQty}
                        value={returnQty}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val >= 0 && val <= maxQty) {
                            setReturnQuantities(prev => {
                              const updated = { ...prev, [item.id]: val };
                              if (val === 0) delete updated[item.id];
                              return updated;
                            });
                          }
                        }}
                        className="w-12 h-7 text-center font-bold text-sm rounded border border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none"
                      />
                      <button 
                        type="button"
                        onClick={() => handleQtyChange(item, 1)} 
                        disabled={returnQty >= maxQty} 
                        className="w-7 h-7 rounded border border-[var(--border-medium)] flex items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-40 hover:bg-[var(--bg-hover)] transition-colors text-sm font-bold"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="flex justify-between items-center text-xs pt-2 border-t border-[var(--border-light)]">
                  <span className="text-[var(--text-secondary)]">Purchased: {maxQty} {item.unit}</span>
                  {!isCuttable && (
                    <span className="font-bold text-[var(--text-primary)]">Item Refund: ₹{formatINR((Number(item.price_at_sale) * returnQty), 2)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-6 py-4 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Total Refund Amount:</span>
          <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-error)' }}>₹{formatINR(refundAmount, 2)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isReturning}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={itemsToReturn.length === 0} loading={isReturning} className="min-w-[140px]">
            {isAll ? 'Void Full Bill' : 'Confirm Return'}
          </Button>
        </div>
      </div>
    </DialogOverlay>
  );
}