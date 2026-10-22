import { useState, useEffect, useRef, useMemo, Fragment, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { formatDateTime, escapeIlike, formatDayHeader } from './utils';
import { SALES_PER_PAGE } from './constants';
import { DialogOverlay } from './Dialog';
import { Search, Undo2, X, Phone, User, ChevronRight, Calendar } from 'lucide-react';
import BillDetailsView from './BillDetailsView';
import { getInventoryItemByBarcode } from './services/db';

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
  const { showAlert } = useApp();
  const queryClient = useQueryClient();

  const [salesPage, setSalesPage] = useState(0);
  const [datePageIndex, setDatePageIndex] = useState(0);
  const [customDate, setCustomDate] = useState('');

  // Customer search & suggestions
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const searchContainerRef = useRef(null);

  const [selectedBill, setSelectedBill] = useState(null);
  const [billItemsCache, setBillItemsCache] = useState({});
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [returnModalState, setReturnModalState] = useState(null); // { bill, items }

  // Query distinct dates with store sales for day-by-day pagination
  const shopId = localStorage.getItem('shop_id');
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
        query = query.or(`customer_phone.ilike.%${cleanQ}%,customer_name.ilike.%${cleanQ}%,id.ilike.%${cleanQ}%`);
      }
      const from = salesPage * SALES_PER_PAGE;
      query = query
        .order('created_at', { ascending: false })
        .range(from, from + SALES_PER_PAGE - 1);
    } else {
      // DAY-BY-DAY MODE: Load records strictly of currentDay
      const start = `${currentDay}T00:00:00`;
      const end = `${currentDay}T23:59:59.999`;
      query = query
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;
    
    // Auto-clean any non-sale (inbound stock receiving) records that mistakenly had location set to Store with 0 total & no payment
    const rawBills = data || [];
    const inboundOrphans = rawBills.filter(b => !b.payment_method && Number(b.total_amount) === 0);
    if (inboundOrphans.length > 0) {
      inboundOrphans.forEach(b => {
        supabase.from('bills').update({ location: 'Warehouse-Inbound' }).eq('id', b.id).then(() => {});
      });
    }

    return rawBills.filter(b => b.payment_method || Number(b.total_amount) > 0 || b.status === 'voided');
  }, [shopId, isSearching, salesPage, searchQuery, currentDay]);

  const { data: bills = [], isLoading: isLoadingBills } = useQuery({
    queryKey: ['bills', shopId, isSearching, salesPage, searchQuery, currentDay, isActive],
    queryFn: fetchBills,
    enabled: isActive,
    staleTime: 1000 * 60 * 2,
  });

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
          query = query.or(`customer_phone.ilike.%${cleanQ}%,customer_name.ilike.%${cleanQ}%,id.ilike.%${cleanQ}%`);
        }
      } else {
        const start = `${currentDay}T00:00:00`;
        const end = `${currentDay}T23:59:59.999`;
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
         'Total Profit': b.total_profit || 0
      }));
      
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sales_Ledger");
      
      worksheet['!cols'] = [
        { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 18 }, { wch: 20 },
        { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
      ];

      XLSX.writeFile(workbook, `Sales_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
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
        items = await enrichBillItems(data || []);
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
    try {
      if (itemsToReturn.length === 0) return;

      const shopId = localStorage.getItem('shop_id');
      const performedBy = localStorage.getItem('owner_name') || localStorage.getItem('cashier_name') || 'Staff';

      let updatedBillTotal = Number(bill.total_amount);

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
        let billUpdateQuery = supabase.from('bills').update({ total_amount: updatedBillTotal, status: newStatus }).eq('id', bill.id);
        if (shopId) {
          billUpdateQuery = billUpdateQuery.eq('shop_id', shopId);
        }
        const { error: billError } = await billUpdateQuery;
        if (billError) throw billError;
      }

      // Restore stock for selected items
      for (const item of itemsToReturn) {
        const qtyToRestore = item.returnQuantity;
        if (item.instance_barcode) {
          let instQuery = supabase.from('stock_instances').select('original_length, current_length').eq('instance_barcode', item.instance_barcode);
          if (shopId) {
            instQuery = instQuery.eq('shop_id', shopId);
          }
          const { data: inst } = await instQuery.maybeSingle();
          if (inst) {
            const currentLen = Number(inst.current_length || 0);
            const maxLen = Number(inst.original_length || currentLen + Number(qtyToRestore));
            const restoredLen = Math.min(maxLen, currentLen + Number(qtyToRestore));
            let updateInst = supabase
              .from('stock_instances')
              .update({ 
                status: 'available', 
                current_length: restoredLen 
              })
              .eq('instance_barcode', item.instance_barcode);
            if (shopId) {
              updateInst = updateInst.eq('shop_id', shopId);
            }
            await updateInst;
          }
        } else {
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
            let bStockQuery = supabase.from('inventory_batches').select('stock_store').eq('batch_id', targetBatchId);
            if (shopId) {
              bStockQuery = bStockQuery.eq('shop_id', shopId);
            }
            const { data: batch } = await bStockQuery.maybeSingle();
            if (batch) {
              const newStock = Number(batch.stock_store || 0) + qtyToRestore;
              let updateBatch = supabase.from('inventory_batches').update({ stock_store: newStock }).eq('batch_id', targetBatchId);
              if (shopId) {
                updateBatch = updateBatch.eq('shop_id', shopId);
              }
              await updateBatch;
            }
          }
        }

        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          item_name: item.name,
          barcode: item.barcode,
          action_type: isAll ? 'VOID' : 'RETURN',
          changes: isAll 
            ? `Restored ${qtyToRestore} ${item.unit} (Bill #${bill.id.split('-')[0]})` 
            : `Returned ${qtyToRestore} ${item.unit} of ${item.name} from Bill #${bill.id.split('-')[0]}`,
          performed_by: performedBy
        }]);

        if (!isAll) {
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
      
      showAlert(`Successfully returned ${isAll ? 'full bill' : 'selected items'}.`, "Success");
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['piece_counts'] });
      queryClient.invalidateQueries({ queryKey: ['stock_instances'] });
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
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>Sales History</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">Search past sales by customer phone or name, view receipts, and process returns.</p>
        </div>
      </div>

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
                <div className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-light)]">
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
                    <span className="text-[10px] text-[var(--color-accent)] font-semibold uppercase">Filter</span>
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
                <input
                  type="date"
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
                  className="h-10 md:h-9 px-2 text-xs font-semibold focus:outline-none rounded-md shadow-sm cursor-pointer"
                  style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
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
                    className="h-10 md:h-9 px-2.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--color-accent)' }}
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
            <table className={`block md:table w-full md:table-fixed text-left border-collapse ${(isLoadingBills && bills.length === 0 || bills.length === 0) ? 'h-full' : ''}`}>
            <colgroup className="hidden md:table-column-group">
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead className="hidden md:table-header-group sticky top-0 z-20 glass-header" style={{ borderBottom: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}>
              <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                <th className="py-4 px-3 w-[18%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Date &amp; Time</th>
                <th className="py-4 px-3 w-[20%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Customer</th>
                <th className="py-4 px-3 w-[14%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Cashier</th>
                <th className="py-4 px-3 w-[12%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Payment</th>
                <th className="py-4 px-3 w-[14%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Total (₹)</th>
                <th className="py-4 px-3 w-[12%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Action</th>
                <th className="py-4 px-3 w-[10%] text-center">Details</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group p-2 md:p-0">
              {isLoadingBills && bills.length === 0 ? (
                <tr className="block md:table-row border-none" style={{ borderBottom: 'none' }}><td colSpan="7" className="block md:table-cell h-[300px] text-center p-4 border-none" style={{ borderBottom: 'none' }}><PageLoader text="Loading sales..." /></td></tr>
              ) : bills.length === 0 ? (
                <tr className="block md:table-row border-none" style={{ borderBottom: 'none' }}><td colSpan="7" className="block md:table-cell h-[300px] p-0 border-none" style={{ borderBottom: 'none' }}><EmptyState message="No sales found for this period." /></td></tr>
              ) : bills.map(bill => (
                <tr
                  key={bill.id}
                  onClick={() => setSelectedBill(bill)}
                  className="cursor-pointer premium-hover block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none border md:border-b md:border-t-0 md:border-l-0 md:border-r-0 border-[var(--border-medium)] md:border-[var(--border-medium)] mb-3 md:mb-0 relative transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-medium)',
                  }}
                >
                  {/* Mobile Row Card */}
                  <td className="md:hidden block p-4 border-none">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="text-[11px] font-bold text-[var(--text-secondary)]">{formatDateTime(bill.created_at).full}</div>
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
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-light)]">
                              Walk-in Customer
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className={`text-base font-bold ${bill.status === 'voided' ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--color-accent)]'}`}>₹{Number(bill.total_amount).toFixed(2)}</div>
                        {bill.payment_method && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded inline-block mt-0.5" style={{ backgroundColor: bill.payment_method === 'CASH' ? 'rgba(16, 185, 129, 0.15)' : bill.payment_method === 'UPI' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(234, 179, 8, 0.15)', color: bill.payment_method === 'CASH' ? 'var(--color-success)' : bill.payment_method === 'UPI' ? 'var(--color-accent)' : 'var(--color-warning)' }}>{bill.payment_method}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-[var(--border-light)] mt-2">
                      <div className="text-xs font-medium capitalize" style={{ color: 'var(--text-secondary)' }}>Cashier: {bill.cashier_name}</div>
                      <div className="flex items-center gap-2">
                        {bill.status === 'voided' ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-red-500/15 text-red-500">RETURNED</span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenReturnModal(bill);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 shadow-sm text-red-600 bg-red-50 border border-red-200 dark:bg-red-950/40 dark:border-red-900/50 dark:text-red-400 active:scale-95 transition-all"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                            <span>Return</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBill(bill);
                          }}
                          className="px-2.5 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <span>View</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </td>

                  {/* Desktop Table Cells - Center Aligned */}
                  <td className="hidden md:table-cell py-4 px-3 w-[18%] text-sm text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                    <div className="font-semibold text-xs text-[var(--text-primary)]">{formatDateTime(bill.created_at).datePart}</div>
                    <div className="text-[11px] text-[var(--text-secondary)]">{formatDateTime(bill.created_at).timePart}</div>
                  </td>

                  <td className="hidden md:table-cell py-4 px-3 w-[20%] text-sm text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
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

                  <td className="hidden md:table-cell py-4 px-3 w-[14%] text-sm text-center capitalize" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                    <span className="font-medium">{bill.cashier_name}</span>
                  </td>

                  <td className="hidden md:table-cell py-4 px-3 w-[12%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    {bill.status === 'voided' ? (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-red-500/15 text-red-500 inline-block">VOIDED</span>
                    ) : bill.payment_method ? (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded inline-block" style={{ backgroundColor: bill.payment_method === 'CASH' ? 'rgba(16, 185, 129, 0.15)' : bill.payment_method === 'UPI' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(234, 179, 8, 0.15)', color: bill.payment_method === 'CASH' ? 'var(--color-success)' : bill.payment_method === 'UPI' ? 'var(--color-accent)' : 'var(--color-warning)' }}>{bill.payment_method}</span>
                    ) : (
                      <span className="text-xs text-[var(--text-tertiary)]">--</span>
                    )}
                  </td>

                  <td className="hidden md:table-cell py-4 px-3 w-[14%] text-center text-sm font-bold" style={{ borderRight: '1px solid var(--border-medium)', color: bill.status === 'voided' ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: bill.status === 'voided' ? 'line-through' : 'none' }}>
                    ₹{Number(bill.total_amount).toFixed(2)}
                  </td>

                  {/* Dedicated Return Button on ALL Rows */}
                  <td className="hidden md:table-cell py-4 px-3 w-[12%] text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    {bill.status === 'voided' ? (
                      <span className="px-2.5 py-1 text-[10px] font-bold uppercase rounded bg-red-500/15 text-red-500 inline-block">
                        RETURNED
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenReturnModal(bill);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md inline-flex items-center justify-center gap-1.5 transition-all shadow-sm text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 dark:bg-red-950/40 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/60 active:scale-95"
                        title="Process Return for this Bill"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Return</span>
                      </button>
                    )}
                  </td>

                  {/* View Details Button to open Full-Screen View */}
                  <td className="hidden md:table-cell py-4 px-3 w-[10%] text-center h-full">
                    <div className="flex justify-center items-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBill(bill);
                        }}
                        className="px-2.5 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center gap-1 cursor-pointer"
                        title="View Full Bill Details"
                      >
                        <span>View</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
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
                className="h-8 px-2.5 sm:px-4 text-xs font-semibold disabled:opacity-40 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] flex items-center gap-1 shrink-0"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                title="Previous Day"
              >
                <span>&larr; <span className="hidden sm:inline">Previous</span><span className="sm:hidden">Prev</span></span>
              </button>

              <div className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium text-[var(--text-secondary)] text-center min-w-0">
                <span className="font-bold text-[var(--text-primary)] px-2 sm:px-2.5 py-1 rounded-md inline-flex items-center gap-1 sm:gap-1.5 truncate" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                  <Calendar className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                  <span className="truncate">{formatDayHeader(currentDay)}</span>
                </span>
                <span>•</span>
                <span className="shrink-0">{bills.length} {bills.length === 1 ? 'sale' : 'sales'}</span>
                {availableDates.length > 0 && (
                  <>
                    <span className="hidden sm:inline">•</span>
                    <span className="hidden sm:inline text-[11px] text-[var(--text-tertiary)]">
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
                className="h-8 px-2.5 sm:px-4 text-xs font-semibold disabled:opacity-40 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] flex items-center gap-1 shrink-0"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                title="Next Day"
              >
                <span><span className="hidden sm:inline">Next</span><span className="sm:hidden">Next</span> &rarr;</span>
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => setSalesPage(p => Math.max(0, p - 1))} 
                disabled={salesPage === 0} 
                className="h-8 px-3 sm:px-5 text-xs font-semibold disabled:opacity-40 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] shrink-0"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
              >
                &larr; Prev
              </button>

              <div className="text-xs text-[var(--text-secondary)] text-center truncate px-1">
                <span className="font-semibold text-[var(--color-accent)] hidden sm:inline">Global Search: </span>Page {salesPage + 1} • {bills.length} items
              </div>

              <button 
                onClick={() => setSalesPage(p => p + 1)} 
                disabled={bills.length < SALES_PER_PAGE} 
                className="h-8 px-3 sm:px-5 text-xs font-semibold disabled:opacity-40 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] shrink-0"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
              >
                Next &rarr;
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
          <span id="return-items-title" className="text-lg font-semibold text-[var(--text-primary)]">
            Process Return &amp; Refund
          </span>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            Bill #{bill.id.split('-')[0]} • {formatDateTime(bill.created_at).datePart}
            {bill.customer_phone && ` • Phone: ${bill.customer_phone}`}
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-[var(--bg-hover)] rounded-full transition-colors text-[var(--text-secondary)]">
          <X className="w-5 h-5" />
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
                      <div className="text-xs text-[var(--text-secondary)]">Sold at: ₹{Number(item.price_at_sale).toFixed(2)}/{item.unit || 'pc'}</div>
                    </div>
                  </label>

                  {isCuttable ? (
                    <div className="flex items-center">
                      <span className="text-[11px] font-semibold px-2.5 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border-light)] text-[var(--text-secondary)]">
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
                    <span className="font-bold text-[var(--text-primary)]">Item Refund: ₹{(Number(item.price_at_sale) * returnQty).toFixed(2)}</span>
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
          <span className="text-2xl font-bold" style={{ color: 'var(--color-error)' }}>₹{refundAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isReturning}
            className="h-10 px-5 text-sm font-medium rounded-md border border-[var(--border-light)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 text-[var(--text-primary)]"
            style={{ backgroundColor: 'transparent' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={itemsToReturn.length === 0 || isReturning}
            className="h-10 px-6 text-sm font-semibold rounded-md transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[130px] shadow-sm"
            style={{ backgroundColor: 'var(--color-error)', color: '#fff' }}
          >
            {isReturning ? <Spinner className="w-5 h-5 text-white" /> : (isAll ? 'Void Full Bill' : 'Confirm Return')}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}