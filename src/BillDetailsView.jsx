import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatINR, billLabel } from './utils';
import { readRows } from './services/secureRead';
import { buttonClass, TableSkeleton } from './components/ui';
import { useApp } from './AppContext';
import {
  ArrowLeft,
  Phone,
  Undo2
} from 'lucide-react';

export default function BillDetailsView({
  bill,
  onBack,
  onProcessReturn,
  cachedItems,
  showProfit: showProfitProp
}) {
  const { userRole } = useApp();
  const showProfit = showProfitProp !== undefined ? showProfitProp : (userRole === 'owner');
  const [currentBill, setCurrentBill] = useState(bill);

  useEffect(() => {
    setCurrentBill(bill);
  }, [bill]);

  // Fetch bill items
  const shopId = currentBill.shop_id || localStorage.getItem('shop_id');
  const { data: rawItems = cachedItems || [], isLoading: isLoadingItems } = useQuery({
    queryKey: ['bill_items', shopId, currentBill.id],
    queryFn: async () => {
      const build = (q) => {
        let query = q.select('*').eq('bill_id', currentBill.id);
        if (shopId) query = query.eq('shop_id', shopId);
        return query;
      };
      const { data, error } = await readRows('bill_items', build);
      if (error) throw error;
      return data || [];
    },
    initialData: cachedItems,
    staleTime: 1000 * 30
  });

  // Reconcile legacy bills that had screws but were not saved to bill_items due to schema/filtering
  const items = React.useMemo(() => {
    const list = rawItems || [];
    const hasScrew = list.some(it => it.barcode === 'SCREWS' || it.is_screw);
    const billTotal = Number(currentBill?.total_amount || 0);
    if (!hasScrew && billTotal > 0) {
      const itemsSum = list.reduce((acc, it) => acc + (Number(it.price_at_sale || 0) * Number(it.billable_quantity || it.quantity || 1)), 0);
      const diff = Math.round((billTotal - itemsSum) * 100) / 100;
      if (diff > 0) {
        return [
          ...list,
          {
            id: 'screw-legacy-' + currentBill.id,
            bill_id: currentBill.id,
            barcode: 'SCREWS',
            name: 'Screws',
            quantity: 1,
            billable_quantity: 1,
            actual_quantity: 1,
            price_at_sale: diff,
            system_price: diff,
            selling_price: diff,
            profit: diff,
            unit: 'SET',
            is_screw: true
          }
        ];
      }
    }
    return list;
  }, [rawItems, currentBill?.total_amount, currentBill?.id]);

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
          className={buttonClass({ variant: 'secondary', size: 'sm', className: 'gap-1.5' })}
          title="Back to Sales History"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        {!isVoided && onProcessReturn && (
          <button
            type="button"
            onClick={() => onProcessReturn(currentBill)}
            className={buttonClass({ variant: 'danger-outline', size: 'sm' })}
            title="Process Return for this Bill"
          >
            <Undo2 className="w-4 h-4" />
            <span>Return</span>
          </button>
        )}
      </div>

      {/* ROW 2: HERO BANNER HEADER CARD (MATCHING SHOWROOM DESIGN PATTERN) */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-5 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm shrink-0">
        <div>
          {/* Metadata chips row */}
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex-wrap">
            <span>Bill #{billLabel(currentBill)}</span>
            <span>•</span>
            <span>{datePart} at {timePart}</span>
            <span>•</span>
            <span>Cashier: <strong className="text-[var(--text-primary)] font-semibold capitalize">{currentBill.cashier_name || 'System'}</strong></span>

            {currentBill.payment_method && (
              <span
                className="px-2.5 py-0.5 text-[11px] font-bold rounded uppercase tracking-wider"
                style={{
                  backgroundColor: currentBill.payment_method === 'CASH'
                    ? 'var(--color-success-bg)'
                    : currentBill.payment_method === 'UPI'
                      ? 'var(--color-accent-bg)'
                      : 'var(--color-warning-bg)',
                  color: currentBill.payment_method === 'CASH'
                    ? 'var(--color-success)'
                    : currentBill.payment_method === 'UPI'
                      ? 'var(--color-accent)'
                      : 'var(--color-warning)',
                  border: '1px solid var(--border-light)'
                }}
              >
                {currentBill.payment_method}
              </span>
            )}

            {isVoided ? (
              <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase rounded-full bg-[var(--color-error-bg)] text-[var(--color-error)] border border-[var(--color-error-border)]">
                Voided / Returned
              </span>
            ) : (
              <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase rounded-full bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[var(--color-success-border)]">
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
            ₹{formatINR(Number(currentBill.total_amount || 0), 2)}
          </span>
          {currentBill.payment_method === 'SPLIT' && (
            <span className="text-xs text-[var(--text-secondary)] block mt-1">
              Cash: ₹{formatINR(Number(currentBill.cash_amount || 0), 2)} • UPI: ₹{formatINR(Number(currentBill.upi_amount || 0), 2)}
            </span>
          )}
        </div>
      </div>

      {/* ROW 3: CLEAN KPI SUMMARY CARDS */}
      <div className={`grid ${showProfit ? 'grid-cols-3' : 'grid-cols-2'} gap-2 sm:gap-3 mb-4 shrink-0`}>
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-2.5 sm:p-4 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Total Items
          </span>
          <div className="mt-1 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
            <span className="text-base sm:text-xl font-bold text-[var(--text-primary)] tabular-nums">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
            {totalItemsCount !== items.length && (
              <span className="text-xs sm:text-xs text-[var(--text-secondary)]">
                ({totalItemsCount} units)
              </span>
            )}
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-2.5 sm:p-4 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Discount
          </span>
          <div className="mt-1">
            <span className="text-base sm:text-xl font-bold text-[var(--text-primary)] tabular-nums">
              {totalDiscount > 0 ? `₹${formatINR(totalDiscount, 2)}` : '₹0.00'}
            </span>
          </div>
        </div>

        {showProfit && (
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-2.5 sm:p-4 shadow-sm flex flex-col justify-between">
            <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Gross Profit
            </span>
            <div className="mt-1">
              <span className={`text-base sm:text-xl font-bold tabular-nums ${isVoided ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--color-success)]'}`}>
                ₹{formatINR(isVoided ? '0.00' : totalProfit, 2)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ROW 4: ITEMS LIST */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] shadow-sm min-h-0 flex flex-col">
        {isLoadingItems ? (
          <TableSkeleton rows={6} cols={6} label="Loading items…" />
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
                          <span className="text-xs font-bold text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
                            #{idx + 1}
                          </span>
                          <span className="font-semibold text-sm text-[var(--text-primary)] leading-tight">
                            {it.name || it.item_name || (it.barcode === 'SCREWS' ? 'Screws' : 'Item')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {it.barcode && (
                            <span className="text-xs text-[var(--text-secondary)] font-mono">
                              #{it.barcode}
                            </span>
                          )}
                          {it.instance_barcode && (
                            <span className="text-xs text-[var(--color-purple)] bg-[var(--color-purple-bg)] px-1.5 py-0.5 rounded border border-[var(--color-purple-border)] font-mono">
                              Piece: {it.instance_barcode}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs text-[var(--text-tertiary)] block">Total</span>
                        <span className="font-bold text-sm text-[var(--text-primary)] tabular-nums">
                          ₹{formatINR(lineTotal, 2)}
                        </span>
                      </div>
                    </div>

                    {/* Pricing & Qty Metrics */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border-medium)] text-center text-xs">
                      <div className="bg-[var(--bg-tertiary)]/50 p-1.5 rounded">
                        <span className="text-[11px] text-[var(--text-secondary)] uppercase block">Qty</span>
                        <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                          {qty} <span className="text-[11px] uppercase font-normal">{it.unit || 'PCS'}</span>
                        </span>
                      </div>

                      <div className="bg-[var(--bg-tertiary)]/50 p-1.5 rounded">
                        <span className="text-[11px] text-[var(--text-secondary)] uppercase block">Rate</span>
                        <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                          {it.barcode === 'SCREWS' || it.is_screw ? '—' : `₹${formatINR(soldPrice, 2)}`}
                        </span>
                        {mrp > soldPrice && it.barcode !== 'SCREWS' && !it.is_screw && (
                          <span className="text-xs line-through text-[var(--text-tertiary)] block">
                            ₹{formatINR(mrp, 2)}
                          </span>
                        )}
                      </div>

                      {showProfit && (
                        <div className="bg-[var(--bg-tertiary)]/50 p-1.5 rounded">
                          <span className="text-[11px] uppercase block" style={{ color: isVoided ? 'var(--text-tertiary)' : 'var(--color-success)' }}>
                            Profit
                          </span>
                          <span className="font-bold tabular-nums" style={{ color: isVoided ? 'var(--text-tertiary)' : 'var(--color-success)' }}>
                            {isVoided ? '₹0.00' : `₹${formatINR(profit, 2)}`}
                          </span>
                        </div>
                      )}
                    </div>

                    {discountPct > 0 && (
                      <div className="flex items-center justify-between text-xs px-2 py-1 rounded bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] text-[var(--color-warning)]">
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
                  <tr className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    <th className="h-10 px-2 text-center w-12" style={{ borderRight: '1px solid var(--border-medium)' }}>#</th>
                    <th className={`h-10 px-3 text-center ${showProfit ? 'md:w-[28%]' : 'md:w-[35%]'}`} style={{ borderRight: '1px solid var(--border-medium)' }}>Item Details</th>
                    <th className="h-10 px-3 text-center md:w-[12%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Quantity</th>
                    <th className="h-10 px-3 text-center md:w-[11%]" style={{ borderRight: '1px solid var(--border-medium)' }}>MRP</th>
                    <th className="h-10 px-3 text-center md:w-[11%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Sold At</th>
                    <th className="h-10 px-3 text-center md:w-[10%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Discount</th>
                    <th className={`h-10 px-3 text-center ${showProfit ? 'md:w-[13%]' : 'md:w-[16%]'}`} style={showProfit ? { borderRight: '1px solid var(--border-medium)' } : {}}>Total</th>
                    {showProfit && (
                      <th className="h-10 px-3 text-center md:w-[13%]" style={{ color: 'var(--color-success)' }}>Profit</th>
                    )}
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
                            {it.name || it.item_name || (it.barcode === 'SCREWS' ? 'Screws' : 'Item')}
                          </div>
                          <div className="flex items-center justify-center gap-2 mt-0.5 flex-wrap">
                            {it.barcode && (
                              <span className="text-xs text-[var(--text-secondary)] font-mono">
                                #{it.barcode}
                              </span>
                            )}
                            {it.instance_barcode && (
                              <span className="text-xs text-[var(--color-purple)] bg-[var(--color-purple-bg)] px-1.5 py-0.5 rounded border border-[var(--color-purple-border)] font-mono">
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
                          {it.barcode === 'SCREWS' || it.is_screw ? '—' : `₹${formatINR(mrp, 2)}`}
                        </td>

                        <td className="py-3 px-3 text-center font-semibold text-sm text-[var(--text-primary)] tabular-nums" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          {it.barcode === 'SCREWS' || it.is_screw ? '—' : `₹${formatINR(soldPrice, 2)}`}
                        </td>

                        <td className="py-3 px-3 text-center text-xs tabular-nums" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          {discountPct > 0 && it.barcode !== 'SCREWS' && !it.is_screw ? (
                            <span className="text-[var(--color-warning)] font-semibold">{discountPct.toFixed(1)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">—</span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-center font-bold text-sm text-[var(--text-primary)] tabular-nums" style={showProfit ? { borderRight: '1px solid var(--border-medium)' } : {}}>
                          ₹{formatINR(lineTotal, 2)}
                        </td>

                        {showProfit && (
                          <td className="py-3 px-3 text-center font-bold text-sm tabular-nums" style={{ color: isVoided ? 'var(--text-secondary)' : 'var(--color-success)' }}>
                            {isVoided ? '₹0.00' : `₹${formatINR(profit, 2)}`}
                          </td>
                        )}
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
