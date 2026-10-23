import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { formatDateTime } from './utils';
import { PageLoader } from './SharedUI';
import {
  ArrowLeft,
  Phone
} from 'lucide-react';

export default function ShowroomDetailsView({
  bill,
  onBack,
  cachedItems
}) {
  const [currentBill, setCurrentBill] = useState(bill);

  useEffect(() => {
    setCurrentBill(bill);
  }, [bill]);

  // Fetch bill items
  const shopId = currentBill.shop_id || localStorage.getItem('shop_id');
  const { data: items = cachedItems || [], isLoading: isLoadingItems } = useQuery({
    queryKey: ['showroom_bill_items', shopId, currentBill.id],
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

  const { datePart, timePart } = formatDateTime(currentBill.created_at);

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 animate-fade-in text-[var(--text-primary)]">
      {/* TOP NAVIGATION */}
      <div className="flex items-center justify-between pb-3 mb-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Showroom Dispatches"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-medium)] transition-all cursor-pointer shadow-sm hover:border-[var(--color-accent)] active:scale-95"
          title="Back to Showroom Dispatches"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--color-accent)]" />
          <span>Back to Showroom</span>
        </button>
      </div>

      {/* ESSENTIAL BILL & CUSTOMER INFO HEADER */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-4 sm:p-5 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm shrink-0">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            <span>Showroom Dispatch #{currentBill.id.split('-')[0]}</span>
            <span>•</span>
            <span>{datePart} at {timePart}</span>
          </div>

          <div className="flex items-center gap-2.5 mt-1 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)]">
              {currentBill.customer_name || 'Showroom Recipient'}
            </h1>
            {currentBill.customer_phone && (
              <span className="text-xs font-semibold text-[var(--color-accent)] inline-flex items-center gap-1 bg-[var(--bg-tertiary)] px-2.5 py-0.5 rounded-md border border-[var(--border-medium)]">
                <Phone className="w-3.5 h-3.5" />
                {currentBill.customer_phone}
              </span>
            )}
          </div>
        </div>

        {/* Showroom Dispatched Value */}
        <div className="md:text-right shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block mb-0.5">
            Total Dispatched Value
          </span>
          <span className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tabular-nums">
            ₹{Number(currentBill.total_amount || 0).toFixed(2)}
          </span>
        </div>
      </div>

      {/* ITEMS LIST */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] shadow-sm min-h-0 flex flex-col">
        {isLoadingItems ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <PageLoader text="Loading showroom items..." />
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[var(--text-tertiary)] font-medium">
            No items recorded for this showroom dispatch.
          </div>
        ) : (
          <>
            {/* MOBILE CARD VIEW (< 768px): Completely avoids horizontal scrolling */}
            <div className="block md:hidden divide-y divide-[var(--border-medium)] p-2 space-y-2.5 flex-1 overflow-y-auto">
              {items.map((it, idx) => {
                const unitPrice = Number(it.price_at_sale || 0);
                const qty = Number(it.billable_quantity || it.quantity || 1);
                const lineTotal = unitPrice * qty;

                return (
                  <div
                    key={it.id || idx}
                    className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-light)] shadow-sm space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-sm text-[var(--text-primary)] leading-tight block">
                          {it.name}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs text-[var(--text-tertiary)] block">Total</span>
                        <span className="font-bold text-sm text-[var(--text-primary)] tabular-nums">
                          ₹{lineTotal.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border-medium)] text-center text-xs">
                      <div className="bg-[var(--bg-tertiary)]/50 p-1.5 rounded">
                        <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Qty Deducted</span>
                        <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                          {qty} <span className="text-[10px] uppercase font-normal">{it.unit || 'PCS'}</span>
                        </span>
                      </div>

                      <div className="bg-[var(--bg-tertiary)]/50 p-1.5 rounded">
                        <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Unit Value</span>
                        <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                          ₹{unitPrice.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* DESKTOP TABLE VIEW (>= 768px) */}
            <div className="hidden md:block overflow-x-auto w-full flex-1">
              <table className="w-full text-center border-collapse table-auto md:table-fixed">
                <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                  <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    <th className="py-3 px-4 text-center md:w-[40%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Deducted Product</th>
                    <th className="py-3 px-4 text-center md:w-[20%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Qty Deducted</th>
                    <th className="py-3 px-4 text-center md:w-[20%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Unit Value</th>
                    <th className="py-3 px-4 text-center md:w-[20%]">Total Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-medium)]">
                  {items.map((it, idx) => {
                    const unitPrice = Number(it.price_at_sale || 0);
                    const qty = Number(it.billable_quantity || it.quantity || 1);
                    const lineTotal = unitPrice * qty;

                    return (
                      <tr
                        key={it.id || idx}
                        className="hover:bg-[var(--bg-hover)] transition-colors"
                        style={{ borderBottom: '1px solid var(--border-medium)' }}
                      >
                        <td className="py-3 px-4 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          <div className="font-semibold text-sm text-[var(--text-primary)]">
                            {it.name}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          <span className="font-semibold text-sm text-[var(--text-primary)] tabular-nums">{qty}</span>
                          <span className="text-xs font-normal text-[var(--text-secondary)] uppercase ml-1">{it.unit || 'PCS'}</span>
                        </td>

                        <td className="py-3 px-4 text-center font-medium text-sm text-[var(--text-secondary)] tabular-nums" style={{ borderRight: '1px solid var(--border-medium)' }}>
                          ₹{unitPrice.toFixed(2)}
                        </td>

                        <td className="py-3 px-4 text-center font-bold text-sm text-[var(--text-primary)] tabular-nums">
                          ₹{lineTotal.toFixed(2)}
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
