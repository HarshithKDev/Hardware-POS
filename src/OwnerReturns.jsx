import React, { useState, useEffect, Fragment } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { Search, Undo2, ChevronDown, ChevronRight, X, Phone, User, AlertCircle } from 'lucide-react';
import { PageLoader, Spinner } from './SharedUI';
import { DialogOverlay } from './Dialog';
import { useQueryClient } from '@tanstack/react-query';

export default function OwnerReturns() {
  const { userRole, shopId, showAlert } = useApp();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customers, setCustomers] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const [bills, setBills] = useState([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [expandedBillId, setExpandedBillId] = useState(null);
  
  const [returnModalState, setReturnModalState] = useState(null); // { bill, items }
  const [isReturning, setIsReturning] = useState(false);

  // Fetch unique customers
  useEffect(() => {
    async function fetchCustomers() {
      try {
        const { data, error } = await supabase.from('bills').select('customer_name, customer_phone').neq('customer_name', null);
        if (data && !error) {
          const unique = [];
          const map = new Map();
          for (const row of data) {
            const compositeKey = `${row.customer_name}-${row.customer_phone || ''}`.toLowerCase();
            if (row.customer_name && !map.has(compositeKey)) {
              map.set(compositeKey, true);
              unique.push({ name: row.customer_name, phone: row.customer_phone || '' });
            }
          }
          setCustomers(unique);
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchCustomers();
  }, []);

  const handleSelectCustomer = (cust) => {
    setCustomerName(cust.name);
    setCustomerPhone(cust.phone);
    setShowDropdown(false);
    searchPurchases(cust.name, cust.phone);
  };

  const searchPurchases = async (name = customerName, phone = customerPhone) => {
    if (!name && !phone) {
      showAlert("Please enter a customer name or phone.", "Warning");
      return;
    }
    setLoadingBills(true);
    setBills([]);
    setExpandedBillId(null);
    try {
      let query = supabase.from('bills').select('*, items:bill_items(*)').order('created_at', { ascending: false });
      if (name) query = query.ilike('customer_name', `%${name}%`);
      if (phone) query = query.ilike('customer_phone', `%${phone}%`);
      
      const { data, error } = await query;
      if (error) {
        if (error.code === 'PGRST200' || error.message.includes('customer_name')) {
           showAlert("You need to add customer_name and customer_phone columns to the 'bills' table in Supabase first!", "Error");
        } else {
           throw error;
        }
      } else {
        setBills(data || []);
      }
    } catch (err) {
      console.error(err);
      if (err.message?.includes('customer_name')) {
         showAlert("Database schema missing 'customer_name'. Please add it via Supabase.", "Error");
      } else {
         showAlert(err.message, "Error");
      }
    } finally {
      setLoadingBills(false);
    }
  };
  
  const handleOpenReturnModal = (bill) => {
    setReturnModalState({ bill, items: bill.items || [] });
  };

  const executeReturnItems = async (itemsToReturn, isAll, bill) => {
    try {
      if (itemsToReturn.length === 0) return;
      setIsReturning(true);

      const sid = localStorage.getItem('shop_id');

      if (isAll) {
        const { error: billError } = await supabase.from('bills').update({ status: 'voided' }).eq('id', bill.id);
        if (billError) throw billError;
      } else {
        const refundAmount = itemsToReturn.reduce((sum, item) => sum + (Number(item.price_at_sale) * item.returnQuantity), 0);
        const newTotal = Math.max(0, Number(bill.total_amount) - refundAmount);
        const { error: billError } = await supabase.from('bills').update({ total_amount: newTotal }).eq('id', bill.id);
        if (billError) throw billError;
      }
      
      for (const item of itemsToReturn) {
        const qtyToRestore = item.returnQuantity;
        if (item.instance_barcode) {
          const { data: inst } = await supabase.from('stock_instances').select('original_length').eq('instance_barcode', item.instance_barcode).single();
          if (inst) {
            await supabase.from('stock_instances').update({ status: 'available', current_length: inst.original_length }).eq('instance_barcode', item.instance_barcode);
          }
        } else {
          // If we have batch_id, restore to it. If not, try to find any batch for this barcode.
          let targetBatchId = item.batch_id;
          if (!targetBatchId) {
             const { data: batches } = await supabase.from('inventory_batches').select('batch_id').eq('barcode', item.barcode).limit(1);
             if (batches && batches.length > 0) targetBatchId = batches[0].batch_id;
          }
          
          if (targetBatchId) {
            const { data: batch } = await supabase.from('inventory_batches').select('stock_store').eq('batch_id', targetBatchId).single();
            if (batch) {
              const newStock = Number(batch.stock_store || 0) + qtyToRestore;
              await supabase.from('inventory_batches').update({ stock_store: newStock }).eq('batch_id', targetBatchId);
            }
          }
        }

        await supabase.from('audit_logs').insert([{
          shop_id: sid,
          item_name: item.name,
          barcode: item.barcode,
          action_type: isAll ? 'VOID' : 'RETURN',
          changes: isAll 
            ? `Restored ${qtyToRestore} ${item.unit} (Bill #${bill.id.split('-')[0]})` 
            : `Returned ${qtyToRestore} ${item.unit} of ${item.name} from Bill #${bill.id.split('-')[0]}`,
          performed_by: localStorage.getItem('owner_name') || 'Owner'
        }]);

        if (!isAll) {
          const currentQty = Number(item.billable_quantity || item.quantity);
          if (qtyToRestore >= currentQty) {
            await supabase.from('bill_items').delete().eq('id', item.id);
          } else {
            const newQty = currentQty - qtyToRestore;
            const actQty = Number(item.actual_quantity || item.quantity) - qtyToRestore;
            await supabase.from('bill_items').update({ quantity: newQty, billable_quantity: newQty, actual_quantity: actQty }).eq('id', item.id);
          }
        }
      }
      
      showAlert(`Successfully returned ${isAll ? 'full bill' : 'selected items'}.`, "Success");
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      searchPurchases(); // Re-fetch
      
      if (isAll) {
         setExpandedBillId(null);
      }
      setReturnModalState(null);
    } catch (e) {
      console.error(e);
      showAlert(e.message, "Return Failed");
    } finally {
      setIsReturning(false);
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(customerName.toLowerCase()) || 
    c.phone.includes(customerName)
  );

  return (
    <div className="h-full flex flex-col relative w-full">
      <div className="flex justify-between items-end mb-6">
        <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>Process Returns</h1>
      </div>
      
      <div className="mb-6 p-6 rounded-lg shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Search Customer</h2>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Customer Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              <input 
                type="text" 
                value={customerName} 
                onChange={(e) => { setCustomerName(e.target.value); setShowDropdown(true); }} 
                onFocus={() => setShowDropdown(true)}
                placeholder="e.g. John Doe" 
                className="w-full h-10 pr-4 text-sm focus:outline-none rounded-md" 
                style={{ paddingLeft: '40px', border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
              />
              {showDropdown && customerName && filteredCustomers.length > 0 && (
                <div className="absolute z-10 w-full mt-1 rounded-md shadow-lg" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', maxHeight: '200px', overflowY: 'auto' }}>
                  {filteredCustomers.map((cust, i) => (
                    <button key={i} onClick={() => handleSelectCustomer(cust)} className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-hover)] transition-colors flex justify-between">
                      <span style={{ color: 'var(--text-primary)' }}>{cust.name}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{cust.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex-1 relative">
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Customer Phone</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              <input 
                type="text" 
                value={customerPhone} 
                onChange={(e) => setCustomerPhone(e.target.value)} 
                placeholder="e.g. 9876543210" 
                className="w-full h-10 pr-4 text-sm focus:outline-none rounded-md" 
                style={{ paddingLeft: '40px', border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
              />
            </div>
          </div>
          
          <div className="flex items-end">
            <button 
              onClick={() => searchPurchases()} 
              disabled={loadingBills}
              className="h-10 px-6 text-sm font-semibold rounded-md flex items-center gap-2 transition-colors text-white disabled:opacity-50" 
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {loadingBills ? 'Searching...' : <><Search className="w-4 h-4" /> Search</>}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[var(--bg-secondary)] rounded-lg shadow-sm border border-[var(--border-light)]">
        {loadingBills ? (
          <div className="flex flex-col items-center justify-center h-48 gap-4">
             <PageLoader text="Loading purchases..." />
          </div>
        ) : bills.length === 0 && (customerName || customerPhone) ? (
          <div className="flex flex-col items-center justify-center h-48" style={{ color: 'var(--text-secondary)' }}>
             <p>No purchases found for this customer.</p>
          </div>
        ) : bills.length > 0 ? (
          <div className="w-full">
            <table className="block md:table w-full text-left border-collapse min-w-full">
            <thead className="hidden md:table-header-group" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
              <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                <th className="p-4 border-none w-10"></th>
                <th className="p-4 border-none">Bill ID</th>
                <th className="p-4 border-none">Date</th>
                <th className="p-4 border-none text-right">Items</th>
                <th className="p-4 border-none text-right">Total</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {bills.map(bill => {
                const isExpanded = expandedBillId === bill.id;
                const items = bill.items || [];
                return (
                  <Fragment key={bill.id}>
                    <tr onClick={() => setExpandedBillId(isExpanded ? null : bill.id)} className="block md:table-row border-b border-[var(--border-light)] cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
                      <td className="hidden md:table-cell p-4 w-10 text-center border-none">
                        {isExpanded ? <ChevronDown className="w-4 h-4 mx-auto" /> : <ChevronRight className="w-4 h-4 mx-auto" />}
                      </td>
                      <td className="block md:table-cell p-4 border-none font-medium" style={{ color: 'var(--text-primary)' }}>
                         #{bill.id.split('-')[0]}
                         {bill.status === 'voided' && <span className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>Returned</span>}
                      </td>
                      <td className="block md:table-cell p-4 border-none text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {new Date(bill.created_at).toLocaleString()}
                      </td>
                      <td className="block md:table-cell p-4 border-none text-sm text-right font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {items.length} items
                      </td>
                      <td className="block md:table-cell p-4 border-none text-right font-bold text-lg" style={{ color: bill.status === 'voided' ? 'var(--text-secondary)' : 'var(--color-success)' }}>
                        <span className={bill.status === 'voided' ? 'line-through opacity-50 mr-2' : ''}>
                          ₹{Number(bill.total_amount).toFixed(2)}
                        </span>
                        {bill.status === 'voided' && '₹0.00'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="block md:table-row bg-[var(--bg-tertiary)]">
                        <td colSpan="5" className="block md:table-cell p-0" style={{ borderBottom: '2px solid var(--color-accent)' }}>
                          <div className="p-6 px-8">
                            <div className="flex justify-between items-center mb-3 pb-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
                              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Bill #{bill.id.split('-')[0]} Items</p>
                              {bill.status !== 'voided' && items.length > 0 && (
                                <button onClick={(e) => { e.stopPropagation(); handleOpenReturnModal(bill); }} className="px-4 py-1.5 text-xs font-bold uppercase rounded transition-colors" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                                  Return Items
                                </button>
                              )}
                            </div>
                            <div className="overflow-x-hidden md:overflow-x-auto w-full rounded-lg shadow-sm border border-[var(--border-light)]">
                              <table className="block md:table w-full text-left border-collapse min-w-full" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                                <thead className="hidden md:table-header-group" style={{ backgroundColor: 'var(--bg-hover)', borderBottom: '1px solid var(--border-light)' }}>
                                  <tr className="text-xs font-semibold uppercase" style={{ color: 'var(--text-secondary)' }}>
                                    <th className="py-3 px-4">Item Name</th>
                                    <th className="py-3 px-4 text-center">Qty</th>
                                    <th className="py-3 px-4 text-center">MRP</th>
                                    <th className="py-3 px-4 text-center">Sold At</th>
                                    <th className="py-3 px-4 text-right">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map(item => (
                                    <tr key={item.id} className="border-b border-[var(--border-light)]">
                                      <td className="py-3 px-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.name}</td>
                                      <td className="py-3 px-4 text-sm text-center">{item.billable_quantity || item.quantity} {item.unit}</td>
                                      <td className="py-3 px-4 text-sm text-center">₹{Number(item.selling_price || item.system_price || item.price_at_sale).toFixed(2)}</td>
                                      <td className="py-3 px-4 text-sm text-center">₹{Number(item.price_at_sale).toFixed(2)}</td>
                                      <td className="py-3 px-4 text-sm text-right font-bold" style={{ color: 'var(--text-primary)' }}>₹{(item.price_at_sale * (item.billable_quantity || item.quantity)).toFixed(2)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {returnModalState && (
        <ReturnModal 
          isOpen={true} 
          onClose={() => setReturnModalState(null)} 
          bill={returnModalState.bill} 
          items={returnModalState.items} 
          onExecuteReturn={executeReturnItems}
          isReturning={isReturning}
        />
      )}
    </div>
  );
}

function ReturnModal({ isOpen, onClose, bill, items, onExecuteReturn, isReturning }) {
  const [returnQuantities, setReturnQuantities] = useState({});

  if (!isOpen || !bill) return null;

  const handleQtyChange = (item, delta) => {
    setReturnQuantities(prev => {
      const current = prev[item.id] || 0;
      const maxQty = Number(item.billable_quantity || item.actual_quantity || item.quantity);
      let newQty = current + delta;
      if (newQty < 0) newQty = 0;
      if (newQty > maxQty) newQty = maxQty;
      
      const updated = { ...prev };
      if (newQty === 0) {
        delete updated[item.id];
      } else {
        updated[item.id] = newQty;
      }
      return updated;
    });
  };

  const handleSelectAll = () => {
    setReturnQuantities(prev => {
      if (Object.keys(prev).length === items.length) {
        return {};
      }
      const all = {};
      items.forEach(item => {
        all[item.id] = Number(item.billable_quantity || item.actual_quantity || item.quantity);
      });
      return all;
    });
  };

  const itemsToReturn = Object.keys(returnQuantities).map(id => {
    const item = items.find(i => i.id === id);
    return { ...item, returnQuantity: returnQuantities[id] };
  }).filter(Boolean);

  const refundAmount = itemsToReturn.reduce((sum, item) => sum + (Number(item.price_at_sale) * item.returnQuantity), 0);
  const isAll = items.length > 0 && items.length === itemsToReturn.length && items.every(item => returnQuantities[item.id] === Number(item.billable_quantity || item.quantity));

  return (
    <DialogOverlay isOpen={isOpen} onClose={onClose} labelId="return-items-title" maxWidth="500px">
      <div className="flex flex-col h-full max-h-[85vh] p-6">
        <div className="flex justify-between items-center mb-6">
          <span id="return-items-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Return Items
          </span>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-[var(--bg-hover)] transition-colors">
            <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto mb-6 pr-2">
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Select the quantity you want to return from Bill #{bill.id.split('-')[0]}:</p>
          
          <div className="flex flex-col gap-3">
            {items.map(item => {
              const maxQty = Number(item.billable_quantity || item.actual_quantity || item.quantity);
              const returnQty = returnQuantities[item.id] || 0;
              const isSelected = returnQty > 0;
              const isCuttable = item.instance_barcode || item.cut_length !== null || ['SQFT', 'FT', 'METER', 'M'].includes((item.unit || '').toUpperCase());
              
              return (
                <div key={item.id} className="flex justify-between items-center p-3 rounded-lg border transition-colors" style={{ backgroundColor: isSelected ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-secondary)', borderColor: isSelected ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-light)' }}>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                    <span className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Sold: {maxQty} {item.unit} @ ₹{Number(item.price_at_sale).toFixed(2)}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {isCuttable ? (
                      <span className="text-xs font-semibold px-3 py-1.5 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>
                        Non-returnable (Cut Item)
                      </span>
                    ) : (
                      <>
                        <button onClick={() => handleQtyChange(item, -1)} disabled={returnQty <= 0} className="w-8 h-8 rounded-full border flex items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50 hover:bg-[var(--bg-hover)]">-</button>
                        <span className="w-6 text-center font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                          {returnQty}
                        </span>
                        <button onClick={() => handleQtyChange(item, 1)} disabled={returnQty >= maxQty} className="w-8 h-8 rounded-full border flex items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50 hover:bg-[var(--bg-hover)]">+</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-4 pt-4 shrink-0" style={{ borderTop: '1px solid var(--border-light)' }}>
          <div className="flex justify-between items-center">
            <button onClick={handleSelectAll} className="text-sm font-semibold underline" style={{ color: 'var(--text-secondary)' }}>
              {Object.keys(returnQuantities).length === items.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="font-bold text-lg" style={{ color: 'var(--color-error)' }}>Refund: ₹{refundAmount.toFixed(2)}</span>
          </div>
          
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              Cancel
            </button>
            <button 
              onClick={() => onExecuteReturn(itemsToReturn, isAll, bill)} 
              disabled={itemsToReturn.length === 0 || isReturning} 
              className="px-6 py-2.5 rounded-lg text-white text-sm font-semibold flex items-center justify-center min-w-[120px] transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#ef4444' }}
            >
              {isReturning ? <Spinner /> : (isAll ? 'Void Entire Bill' : 'Return Selected')}
            </button>
          </div>
        </div>
      </div>
    </DialogOverlay>
  );
}
