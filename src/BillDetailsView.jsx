import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { formatDateTime } from './utils';
import { PageLoader } from './SharedUI';
import {
  ArrowLeft,
  Phone,
  Undo2
} from 'lucide-react';

export default function BillDetailsView({
  bill,
  onBack,
  onProcessReturn,
  cachedItems
}) {
  const [currentBill, setCurrentBill] = useState(bill);

  useEffect(() => {
    setCurrentBill(bill);
  }, [bill]);

  // Fetch bill items
  const shopId = currentBill.shop_id || localStorage.getItem('shop_id');
  const { data: items = cachedItems || [], isLoading: isLoadingItems } = useQuery({
    queryKey: ['bill_items', shopId, currentBill.id],
    queryFn: async () => {
      let query = supabase
        .from('bill_items')
        .select('*')
        .eq('bill_id', currentBill.id);
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    initialData: cachedItems,
    staleTime: 1000 * 30
  });

  const totalItemsCount = items.reduce((acc, it) => acc + Number(it.billable_quantity || it.quantity || 1), 0);
  const totalProfit = items.reduce((acc, it) => acc + Number(it.profit || 0), 0);
  const totalOriginalAmount = items.reduce((acc, it) => {
    const origPrice = Number(it.selling_price || it.system_price || it.price_at_sale || 0);
    const qty = Number(it.billable_quantity || it.quantity || 1);
    return acc + (origPrice * qty);
  }, 0);
  const totalDiscount = Math.max(0, totalOriginalAmount - Number(currentBill.total_amount || 0));

  const isVoided = currentBill.status === 'voided';
  const { datePart, timePart } = formatDateTime(currentBill.created_at);

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 animate-fade-in text-[var(--text-primary)]">
      {/* ROW 1: TOP NAVIGATION WITH BACK BUTTON */}
      <div className="flex items-center justify-between pb-3 mb-2 shrink-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Sales History"
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-medium)] transition-all cursor-pointer shadow-sm hover:border-[var(--color-accent)] active:scale-95"
          title="Back to Sales History"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--color-accent)]" />
          <span>Back</span>
        </button>

        {!isVoided && onProcessReturn && (
          <button
            type="button"
            onClick={() => onProcessReturn(currentBill)}
            className="h-8 px-3 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
            title="Process Return for this Bill"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Process Return</span>
          </button>
        )}
      </div>

      {/* ROW 2: TRANSACTION TITLE, STATUS & METADATA */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 mb-4 border-b border-[var(--border-light)] shrink-0">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] truncate">
              Bill #{currentBill.id.split('-')[0]}
            </h1>

            {currentBill.payment_method && (
              <span
                className="px-2.5 py-0.5 text-xs font-bold rounded tracking-wider shrink-0"
                style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', border: '1px solid rgba(59, 130, 246, 0.3)' }}
              >
                {currentBill.payment_method}
              </span>
            )}

            {isVoided ? (
              <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-red-500/10 text-red-400 border border-red-500/25">
                Voided / Returned
              </span>
            ) : (
              <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                Completed
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-secondary)] mt-0.5">
            <span>{datePart} at {timePart}</span>
            <span className="text-[var(--text-tertiary)] opacity-30">•</span>
            <span>Cashier: <strong className="text-[var(--text-primary)] font-medium capitalize">{currentBill.cashier_name || 'System'}</strong></span>
            <span className="text-[var(--text-tertiary)] opacity-30">•</span>
            <span className="flex items-center gap-1.5">
              <span>Customer:</span>
              {currentBill.customer_phone || currentBill.customer_name ? (
                <span className="font-semibold text-[var(--text-primary)] inline-flex items-center gap-1">
                  {currentBill.customer_phone && <Phone className="w-3 h-3 text-[var(--color-accent)] inline shrink-0" />}
                  {currentBill.customer_phone}
                  {currentBill.customer_name && <span className="text-[var(--text-secondary)] font-normal">({currentBill.customer_name})</span>}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-light)]">
                  Walk-in Customer
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* ROW 3: STANDARD METRICS GRID (MATCHING BATCH DETAILS VIEW) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 shrink-0">
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
            Total Billed
          </span>
          <span className={`text-sm sm:text-base font-bold ${isVoided ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}`}>
            ₹{Number(currentBill.total_amount || 0).toFixed(2)}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">Final amount paid</span>
        </div>

        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
            Items Count
          </span>
          <span className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">{totalItemsCount} total units</span>
        </div>

        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
            Discount Given
          </span>
          <span className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
            {totalDiscount > 0 ? `₹${totalDiscount.toFixed(2)}` : '₹0.00'}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">Savings provided</span>
        </div>

        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
            Gross Profit
          </span>
          <span className={`text-sm sm:text-base font-bold ${isVoided ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--color-success)]'}`}>
            ₹{isVoided ? '0.00' : totalProfit.toFixed(2)}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] block mt-0.5">Total sale margin</span>
        </div>
      </div>

      {/* ROW 4: ITEMS LIST TABLE */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto rounded-lg border border-[var(--border-light)] bg-[var(--bg-secondary)] shadow-sm min-h-0 flex flex-col">
        {isLoadingItems ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <PageLoader text="Loading items..." />
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-[var(--text-tertiary)] font-medium">
            No items recorded for this bill.
          </div>
        ) : (
          <div className="overflow-x-auto w-full flex-1">
            <table className="w-full text-left border-collapse table-auto md:table-fixed">
              <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  <th className="py-3 px-3 text-center w-12" style={{ borderRight: '1px solid var(--border-medium)' }}>#</th>
                  <th className="py-3 px-4 text-left md:w-[32%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Item Details</th>
                  <th className="py-3 px-3 text-center md:w-[12%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Quantity</th>
                  <th className="py-3 px-3 text-center md:w-[12%]" style={{ borderRight: '1px solid var(--border-medium)' }}>MRP</th>
                  <th className="py-3 px-3 text-center md:w-[12%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Sold At</th>
                  <th className="py-3 px-3 text-center md:w-[10%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Discount</th>
                  <th className="py-3 px-4 text-center md:w-[12%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Total</th>
                  <th className="py-3 px-4 text-right md:w-[10%]" style={{ color: 'var(--color-success)' }}>Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-medium)]">
                {items.map((it, idx) => {
                  const mrp = Number(it.selling_price || it.system_price || it.price_at_sale || 0);
                  const soldPrice = Number(it.price_at_sale || 0);
                  const qty = Number(it.billable_quantity || it.quantity || 1);
                  const lineTotal = soldPrice * qty;
                  const discountPct = Number(it.negotiated_discount || (mrp > 0 && soldPrice < mrp ? ((mrp - soldPrice) / mrp) * 100 : 0));
                  const profit = Number(it.profit || 0);

                  return (
                    <tr
                      key={it.id || idx}
                      className="hover:bg-[var(--bg-hover)] transition-colors text-sm"
                      style={{ borderBottom: '1px solid var(--border-medium)' }}
                    >
                      <td className="py-3 px-3 text-center text-xs text-[var(--text-tertiary)]" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        {idx + 1}
                      </td>

                      <td className="py-3 px-4" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        <div className="font-semibold text-sm text-[var(--text-primary)]">
                          {it.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {it.barcode && (
                            <span className="text-[11px] text-[var(--text-tertiary)]">
                              #{it.barcode}
                            </span>
                          )}
                          {it.instance_barcode && (
                            <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                              Piece: {it.instance_barcode}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center font-medium" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        <div>
                          {qty} <span className="text-xs text-[var(--text-secondary)]">{it.unit || 'PCS'}</span>
                        </div>
                        {it.actual_quantity && Number(it.actual_quantity) !== qty && (
                          <div className="text-[10px] text-[var(--text-tertiary)]">
                            Act: {it.actual_quantity} {it.unit}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-center text-[var(--text-secondary)]" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        ₹{mrp.toFixed(2)}
                      </td>

                      <td className="py-3 px-3 text-center font-medium text-[var(--text-primary)]" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        ₹{soldPrice.toFixed(2)}
                      </td>

                      <td className="py-3 px-3 text-center text-xs text-[var(--text-secondary)]" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        {discountPct > 0 ? `${discountPct.toFixed(1)}%` : '—'}
                      </td>

                      <td className="py-3 px-4 text-center font-bold text-[var(--text-primary)]" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        ₹{lineTotal.toFixed(2)}
                      </td>

                      <td className="py-3 px-4 text-right font-semibold" style={{ color: isVoided ? 'var(--text-secondary)' : 'var(--color-success)' }}>
                        {isVoided ? '₹0.00' : `₹${profit.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
