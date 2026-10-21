import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { formatDateTime } from './utils';
import { PageLoader, Spinner } from './SharedUI';
import {
  ArrowLeft,
  Phone,
  CheckCircle
} from 'lucide-react';

export default function ShowroomDetailsView({
  bill,
  onBack,
  onMarkPaid,
  isMarkingPaid = false,
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
      {/* TOP NAVIGATION & PRIMARY ACTION */}
      <div className="flex items-center justify-between pb-3 mb-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Showroom Pending"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-medium)] transition-all cursor-pointer shadow-sm hover:border-[var(--color-accent)] active:scale-95"
          title="Back to Showroom Pending"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--color-accent)]" />
          <span>Back</span>
        </button>

        {onMarkPaid && (
          <button
            type="button"
            onClick={() => onMarkPaid(currentBill)}
            disabled={isMarkingPaid}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold uppercase tracking-wider rounded-lg text-white transition-opacity active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-success)' }}
            title="Mark as Paid"
          >
            {isMarkingPaid ? <Spinner className="w-4 h-4 text-white" /> : <CheckCircle className="w-4 h-4" />}
            <span>Mark as Paid</span>
          </button>
        )}
      </div>

      {/* ESSENTIAL BILL & CUSTOMER INFO HEADER */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] p-5 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm shrink-0">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            <span>Bill #{currentBill.id.split('-')[0]}</span>
            <span>•</span>
            <span>{datePart} at {timePart}</span>
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
              {currentBill.customer_name || 'Walk-in Customer'}
            </h1>
            {currentBill.customer_phone && (
              <span className="text-base sm:text-lg font-semibold text-[var(--color-accent)] inline-flex items-center gap-1.5 bg-[var(--bg-tertiary)] px-3 py-1 rounded-lg border border-[var(--border-medium)]">
                <Phone className="w-4 h-4" />
                {currentBill.customer_phone}
              </span>
            )}
          </div>
        </div>

        {/* Big Pending Amount */}
        <div className="md:text-right">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-0.5">
            Pending Total
          </span>
          <span className="text-3xl sm:text-4xl font-extrabold text-[var(--color-accent)]">
            ₹{Number(currentBill.total_amount || 0).toFixed(2)}
          </span>
        </div>
      </div>

      {/* ITEMS LIST TABLE */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] shadow-sm min-h-0 flex flex-col">
        {isLoadingItems ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <PageLoader text="Loading showroom items..." />
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[var(--text-tertiary)] font-medium">
            No items recorded for this bill.
          </div>
        ) : (
          <div className="overflow-x-auto w-full flex-1">
            <table className="w-full text-left border-collapse table-auto md:table-fixed">
              <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                <tr className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  <th className="py-3.5 px-5 text-left md:w-[48%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Item</th>
                  <th className="py-3.5 px-4 text-center md:w-[18%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Qty</th>
                  <th className="py-3.5 px-4 text-right md:w-[17%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Price</th>
                  <th className="py-3.5 px-5 text-right md:w-[17%]">Total</th>
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
                      <td className="py-4 px-5" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        <div className="font-bold text-base sm:text-lg text-[var(--text-primary)]">
                          {it.name}
                        </div>
                      </td>

                      <td className="py-4 px-4 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        <div className="font-bold text-base sm:text-lg text-[var(--text-primary)]">
                          {qty} <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase">{it.unit || 'PCS'}</span>
                        </div>
                      </td>

                      <td className="py-4 px-4 text-right font-semibold text-base sm:text-lg text-[var(--text-secondary)]" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        ₹{unitPrice.toFixed(2)}
                      </td>

                      <td className="py-4 px-5 text-right font-bold text-base sm:text-lg text-[var(--text-primary)]">
                        ₹{lineTotal.toFixed(2)}
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
