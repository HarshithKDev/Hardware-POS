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
      {/* ROW 1: TOP NAVIGATION WITH BACK & RETURN BUTTONS */}
      <div className="flex items-center justify-between pb-3 mb-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Sales History"
          className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-medium)] transition-all cursor-pointer shadow-sm hover:border-[var(--color-accent)] active:scale-95"
          title="Back to Sales History"
        >
          <ArrowLeft className="w-5 h-5 text-[var(--color-accent)]" />
        </button>

        {!isVoided && onProcessReturn && (
          <button
            type="button"
            onClick={() => onProcessReturn(currentBill)}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-bold uppercase tracking-wider text-red-400 hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 transition-all cursor-pointer shadow-sm hover:border-red-500 active:scale-95"
            title="Process Return for this Bill"
          >
            <Undo2 className="w-4 h-4 text-red-400" />
            <span>Return</span>
          </button>
        )}
      </div>

      {/* ROW 2: HERO BANNER HEADER CARD (MATCHING SHOWROOM DESIGN PATTERN) */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-5 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm shrink-0">
        <div>
          {/* Metadata chips row */}
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex-wrap">
            <span>Bill #{currentBill.id.split('-')[0]}</span>
            <span>•</span>
            <span>{datePart} at {timePart}</span>
            <span>•</span>
            <span>Cashier: <strong className="text-[var(--text-primary)] font-semibold capitalize">{currentBill.cashier_name || 'System'}</strong></span>

            {currentBill.payment_method && (
              <span
                className="px-2.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider"
                style={{
                  backgroundColor: currentBill.payment_method === 'CASH'
                    ? 'rgba(34, 197, 94, 0.15)'
                    : currentBill.payment_method === 'UPI'
                      ? 'rgba(59, 130, 246, 0.15)'
                      : 'rgba(234, 179, 8, 0.15)',
                  color: currentBill.payment_method === 'CASH'
                    ? 'var(--color-success)'
                    : currentBill.payment_method === 'UPI'
                      ? 'var(--color-accent)'
                      : 'var(--color-warning)',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                {currentBill.payment_method}
              </span>
            )}

            {isVoided ? (
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                Voided / Returned
              </span>
            ) : (
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Completed
              </span>
            )}
          </div>

          {/* Customer Title */}
          <div className="flex items-center gap-2.5 mt-1 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)]">
              {currentBill.customer_name || (currentBill.customer_phone ? 'Customer' : 'Walk-in Customer')}
            </h1>

            {currentBill.customer_phone && (
              <span className="text-xs font-semibold text-[var(--color-accent)] inline-flex items-center gap-1 bg-[var(--bg-tertiary)] px-2.5 py-0.5 rounded-md border border-[var(--border-medium)]">
                <Phone className="w-3.5 h-3.5" />
                {currentBill.customer_phone}
              </span>
            )}
          </div>
        </div>

        {/* Right Side: Total Billed */}
        <div className="md:text-right shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block mb-0.5">
            Total Billed
          </span>
          <span className={`text-xl sm:text-2xl font-bold tabular-nums ${isVoided ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}`}>
            ₹{Number(currentBill.total_amount || 0).toFixed(2)}
          </span>
          {currentBill.payment_method === 'SPLIT' && (
            <span className="text-xs text-[var(--text-secondary)] block mt-1">
              Cash: ₹{Number(currentBill.cash_amount || 0).toFixed(2)} • UPI: ₹{Number(currentBill.upi_amount || 0).toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* ROW 3: CLEAN KPI SUMMARY CARDS */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4 shrink-0">
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-2.5 sm:p-4 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Total Items
          </span>
          <div className="mt-1 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
            <span className="text-base sm:text-xl font-bold text-[var(--text-primary)] tabular-nums">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
            {totalItemsCount !== items.length && (
              <span className="text-[11px] sm:text-xs text-[var(--text-secondary)]">
                ({totalItemsCount} units)
              </span>
            )}
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-2.5 sm:p-4 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Discount
          </span>
          <div className="mt-1">
            <span className="text-base sm:text-xl font-bold text-[var(--text-primary)] tabular-nums">
              {totalDiscount > 0 ? `₹${totalDiscount.toFixed(2)}` : '₹0.00'}
            </span>
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-2.5 sm:p-4 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Gross Profit
          </span>
          <div className="mt-1">
            <span className={`text-base sm:text-xl font-bold tabular-nums ${isVoided ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--color-success)]'}`}>
              ₹{isVoided ? '0.00' : totalProfit.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* ROW 4: ITEMS LIST */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] shadow-sm min-h-0 flex flex-col">
        {isLoadingItems ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <PageLoader text="Loading items..." />
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[var(--text-tertiary)] font-medium">
            No items recorded for this bill.
          </div>
        ) : (
          <>
            {/* MOBILE CARD VIEW (< 768px): Completely avoids horizontal scrolling */}
            <div className="block md:hidden divide-y divide-[var(--border-medium)] p-2 space-y-2.5 flex-1 overflow-y-auto">
              {items.map((it, idx) => {
                const mrp = Number(it.selling_price || it.system_price || it.price_at_sale || 0);
                const soldPrice = Number(it.price_at_sale || 0);
                const qty = Number(it.billable_quantity || it.quantity || 1);
                const lineTotal = soldPrice * qty;
                const discountPct = Number(it.negotiated_discount || (mrp > 0 && soldPrice < mrp ? ((mrp - soldPrice) / mrp) * 100 : 0));
                const profit = Number(it.profit || 0);

                return (
                  <div
                    key={it.id || idx}
                    className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-light)] shadow-sm space-y-2.5"
                  >
                    {/* Header: Item Name & Index & Total */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
                            #{idx + 1}
                          </span>
                          <span className="font-semibold text-sm text-[var(--text-primary)] leading-tight">
                            {it.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {it.barcode && (
                            <span className="text-[10px] text-[var(--text-secondary)] font-mono">
                              #{it.barcode}
                            </span>
                          )}
                          {it.instance_barcode && (
                            <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 font-mono">
                              Piece: {it.instance_barcode}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs text-[var(--text-tertiary)] block">Total</span>
                        <span className="font-bold text-sm text-[var(--text-primary)] tabular-nums">
                          ₹{lineTotal.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Pricing & Qty Metrics */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border-medium)] text-center text-xs">
                      <div className="bg-[var(--bg-tertiary)]/50 p-1.5 rounded">
                        <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Qty</span>
                        <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                          {qty} <span className="text-[10px] uppercase font-normal">{it.unit || 'PCS'}</span>
                        </span>
                      </div>

                      <div className="bg-[var(--bg-tertiary)]/50 p-1.5 rounded">
                        <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Rate</span>
                        <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                          ₹{soldPrice.toFixed(2)}
                        </span>
                        {mrp > soldPrice && (
                          <span className="text-[9px] line-through text-[var(--text-tertiary)] block">
                            ₹{mrp.toFixed(2)}
                          </span>
                        )}
                      </div>

                      <div className="bg-[var(--bg-tertiary)]/50 p-1.5 rounded">
                        <span className="text-[10px] uppercase block" style={{ color: isVoided ? 'var(--text-tertiary)' : 'var(--color-success)' }}>
                          Profit
                        </span>
                        <span className="font-bold tabular-nums" style={{ color: isVoided ? 'var(--text-tertiary)' : 'var(--color-success)' }}>
                          {isVoided ? '₹0.00' : `₹${profit.toFixed(2)}`}
                        </span>
                      </div>
                    </div>

                    {discountPct > 0 && (
                      <div className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                        <span>Discount Applied</span>
                        <span className="font-bold tabular-nums">{discountPct.toFixed(1)}% OFF</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* DESKTOP TABLE VIEW (>= 768px) */}
            <div className="hidden md:block overflow-x-auto w-full flex-1">
              <table className="w-full text-center border-collapse table-auto md:table-fixed">
                <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                  <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    <th className="py-3 px-2 text-center w-12" style={{ borderRight: '1px solid var(--border-medium)' }}>#</th>
                    <th className="py-3 px-3 text-center md:w-[30%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Item Details</th>
                    <th className="py-3 px-3 text-center md:w-[12%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Quantity</th>
                    <th className="py-3 px-3 text-center md:w-[11%]" style={{ borderRight: '1px solid var(--border-medium)' }}>MRP</th>
                    <th className="py-3 px-3 text-center md:w-[11%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Sold At</th>
                    <th className="py-3 px-3 text-center md:w-[10%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Discount</th>
                    <th className="py-3 px-3 text-center md:w-[13%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Total</th>
                    <th className="py-3 px-3 text-center md:w-[13%]" style={{ color: 'var(--color-success)' }}>Profit</th>
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
                        className="hover:bg-[var(--bg-hover)] transition-colors"
                        style={{ borderBottom: '1px solid var(--border-medium)' }}
                      >
                        <td className="py-3 px-2 text-center text-xs text-[var(--text-tertiary)]" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          {idx + 1}
                        </td>

                        <td className="py-3 px-3 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          <div className="font-semibold text-sm text-[var(--text-primary)]">
                            {it.name}
                          </div>
                          <div className="flex items-center justify-center gap-2 mt-0.5 flex-wrap">
                            {it.barcode && (
                              <span className="text-[11px] text-[var(--text-secondary)] font-mono">
                                #{it.barcode}
                              </span>
                            )}
                            {it.instance_barcode && (
                              <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 font-mono">
                                Piece: {it.instance_barcode}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-center font-medium" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          <span className="font-semibold text-sm text-[var(--text-primary)] tabular-nums">{qty}</span>
                          <span className="text-xs font-normal text-[var(--text-secondary)] uppercase ml-1">{it.unit || 'PCS'}</span>
                        </td>

                        <td className="py-3 px-3 text-center font-medium text-sm text-[var(--text-secondary)] tabular-nums" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          ₹{mrp.toFixed(2)}
                        </td>

                        <td className="py-3 px-3 text-center font-semibold text-sm text-[var(--text-primary)] tabular-nums" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          ₹{soldPrice.toFixed(2)}
                        </td>

                        <td className="py-3 px-3 text-center text-xs tabular-nums" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          {discountPct > 0 ? (
                            <span className="text-amber-400 font-semibold">{discountPct.toFixed(1)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">—</span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-center font-bold text-sm text-[var(--text-primary)] tabular-nums" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          ₹{lineTotal.toFixed(2)}
                        </td>

                        <td className="py-3 px-3 text-center font-bold text-sm tabular-nums" style={{ color: isVoided ? 'var(--text-secondary)' : 'var(--color-success)' }}>
                          {isVoided ? '₹0.00' : `₹${profit.toFixed(2)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
