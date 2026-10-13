import { useState, Fragment } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { formatDateTime } from './utils';
import { Store, CheckCircle, ChevronDown, User, Phone } from 'lucide-react';

const SHOWROOM_PAGE_SIZE = 20;

export default function OwnerShowroom() {
  const { showAlert } = useApp();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(0);
  const [expandedBillId, setExpandedBillId] = useState(null);
  const [billItemsCache, setBillItemsCache] = useState({});
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [paymentMethodModal, setPaymentMethodModal] = useState(null);

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['showroom-sales', page],
    queryFn: async () => {
      const from = page * SHOWROOM_PAGE_SIZE;
      const { data, error } = await supabase
        .from('bills')
        .select('*')
        .eq('location', 'Store')
        .eq('status', 'showroom_pending')
        .order('created_at', { ascending: false })
        .range(from, from + SHOWROOM_PAGE_SIZE - 1);
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60,
  });

  const hasMore = bills.length === SHOWROOM_PAGE_SIZE;

  const toggleRow = async (bill) => {
    if (expandedBillId === bill.id) { setExpandedBillId(null); return; }
    setExpandedBillId(bill.id);
    if (!billItemsCache[bill.id]) {
      setIsLoadingItems(true);
      try {
        const { data } = await supabase.from('bill_items').select('*').eq('bill_id', bill.id);
        if (data) setBillItemsCache(prev => ({ ...prev, [bill.id]: data }));
      } finally {
        setIsLoadingItems(false);
      }
    }
  };

  const handleMarkPaid = (bill) => {
    setPaymentMethodModal(bill);
  };

  const confirmMarkPaid = async (bill, selectedPaymentMethod) => {
    setMarkingPaidId(bill.id);
    setPaymentMethodModal(null);
    try {
      const { error } = await supabase
        .from('bills')
        .update({ status: null, payment_method: selectedPaymentMethod })
        .eq('id', bill.id);
      if (error) throw error;

      showAlert(
        `Bill #${bill.id.split('-')[0]} has been marked as paid (${selectedPaymentMethod}) and added to sales revenue.`,
        'Payment Received'
      );
      queryClient.invalidateQueries({ queryKey: ['showroom-sales'] });
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-trend'] });
      queryClient.invalidateQueries({ queryKey: ['owner-reports'] });
    } catch (e) {
      showAlert(e.message, 'Error');
    } finally {
      setMarkingPaidId(null);
    }
  };

  const totalPending = bills.reduce((sum, b) => sum + Number(b.total_amount || 0), 0);

  return (
    <div className="h-full flex flex-col relative w-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Store size={22} className="text-[var(--color-accent)]" />
            Showroom Pending
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Sales where goods were taken but payment is pending at the showroom.
          </p>
        </div>
        {bills.length > 0 && (
          <div className="shrink-0 px-4 py-2 rounded-lg border" style={{ backgroundColor: 'var(--color-accent-bg)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>Total Pending</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--color-accent)' }}>&#8377;{totalPending.toFixed(2)}</p>
          </div>
        )}
      </div>

      {/* Bills list container */}
      <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] shadow-sm p-4">
        <div className="flex-1 overflow-auto hide-x-scrollbar overflow-x-hidden md:overflow-x-hidden md:overflow-x-auto shadow-sm min-h-[300px] md:rounded-lg border border-[var(--border-light)] mb-4" style={{ backgroundColor: 'transparent' }}>
          {isLoading ? (
            <div className="h-full flex items-center justify-center p-8">
              <PageLoader text="Loading showroom sales..." />
            </div>
          ) : bills.length === 0 ? (
            <EmptyState message="No pending showroom sales. All goods have been paid for!" />
          ) : (
            <>
              {/* Desktop header */}
              <div
                className="hidden md:grid px-4 py-3 border-b border-[var(--border-light)] text-[11px] font-bold uppercase tracking-wider sticky top-0 z-10"
                style={{ gridTemplateColumns: '1fr 1fr 80px 140px 160px', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
              >
              <span>Date &amp; Time</span>
              <span>Customer / Cashier</span>
              <span className="text-center">Items</span>
              <span className="text-right">Amount</span>
              <span className="text-center">Action</span>
            </div>

            <div className="divide-y divide-[var(--border-light)]">
              {bills.map(bill => {
                const isExpanded = expandedBillId === bill.id;
                const items = billItemsCache[bill.id] || [];
                return (
                  <Fragment key={bill.id}>
                    {/* Row */}
                    <div
                      className="px-4 py-3 cursor-pointer transition-colors"
                      style={{ backgroundColor: isExpanded ? 'var(--color-accent-bg)' : undefined }}
                      onClick={() => toggleRow(bill)}
                    >
                      {/* Mobile layout */}
                      <div className="md:hidden">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{formatDateTime(bill.created_at).full}</p>
                            <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                              {bill.customer_name || bill.cashier_name || 'Walk-in'}
                            </p>
                            {bill.customer_phone && (
                              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{bill.customer_phone}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>&#8377;{Number(bill.total_amount).toFixed(2)}</p>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)' }}>SHOWROOM</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMarkPaid(bill); }}
                            disabled={markingPaidId === bill.id}
                            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-md text-white transition-opacity disabled:opacity-50 active:scale-95"
                            style={{ backgroundColor: 'var(--color-success)' }}
                          >
                            {markingPaidId === bill.id
                              ? <Spinner className="w-3 h-3 text-white" />
                              : <CheckCircle size={14} />}
                            Mark as Paid
                          </button>
                          <ChevronDown size={18} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} style={{ color: 'var(--text-tertiary)' }} />
                        </div>
                      </div>

                      {/* Desktop layout */}
                      <div
                        className="hidden md:grid items-center"
                        style={{ gridTemplateColumns: '1fr 1fr 80px 140px 160px' }}
                      >
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{formatDateTime(bill.created_at).full}</span>
                        <div className="flex flex-col">
                          {bill.customer_name && (
                            <span className="text-sm font-medium flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                              <User size={12} className="text-[var(--text-tertiary)] shrink-0" />
                              {bill.customer_name}
                            </span>
                          )}
                          {bill.customer_phone && (
                            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                              <Phone size={11} className="shrink-0" />
                              {bill.customer_phone}
                            </span>
                          )}
                          {!bill.customer_name && !bill.customer_phone && (
                            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{bill.cashier_name || 'Walk-in'}</span>
                          )}
                        </div>
                        <div className="flex justify-center">
                          <ChevronDown size={16} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} style={{ color: 'var(--text-tertiary)' }} />
                        </div>
                        <div className="flex justify-end">
                          <span className="text-sm font-bold" style={{ color: 'var(--color-accent)' }}>&#8377;{Number(bill.total_amount).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-center" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMarkPaid(bill); }}
                            disabled={markingPaidId === bill.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md text-white transition-opacity disabled:opacity-50 active:scale-95"
                            style={{ backgroundColor: 'var(--color-success)' }}
                          >
                            {markingPaidId === bill.id
                              ? <Spinner className="w-3 h-3 text-white" />
                              : <CheckCircle size={13} />}
                            Mark Paid
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded items */}
                    {isExpanded && (
                      <div
                        className="px-6 py-4 border-b border-[var(--border-light)]"
                        style={{ backgroundColor: 'var(--bg-tertiary)' }}
                      >
                        {isLoadingItems && !billItemsCache[bill.id] ? (
                          <div className="flex justify-center py-4"><PageLoader text="" /></div>
                        ) : (
                          <>
                            <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>
                              Bill #{bill.id.split('-')[0]} — Items
                            </p>
                            <div className="rounded-lg overflow-hidden border border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr
                                    className="text-[10px] font-bold uppercase text-left border-b border-[var(--border-light)]"
                                    style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                                  >
                                    <th className="px-4 py-2">Item</th>
                                    <th className="px-4 py-2 text-center">Qty</th>
                                    <th className="px-4 py-2 text-right">Price</th>
                                    <th className="px-4 py-2 text-right">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="text-center py-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>No items found.</td>
                                    </tr>
                                  ) : items.map(item => (
                                    <tr key={item.id} className="border-b border-[var(--border-light)] last:border-0">
                                      <td className="px-4 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{item.name}</td>
                                      <td className="px-4 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>
                                        {Number(item.billable_quantity || item.quantity)} {item.unit}
                                      </td>
                                      <td className="px-4 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                                        &#8377;{Number(item.price_at_sale).toFixed(2)}
                                      </td>
                                      <td className="px-4 py-2 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        &#8377;{(Number(item.price_at_sale) * Number(item.billable_quantity || item.quantity)).toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex justify-end mt-3">
                              <div className="text-right">
                                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Pending Total</span>
                                <p className="text-xl font-bold" style={{ color: 'var(--color-accent)' }}>&#8377;{Number(bill.total_amount).toFixed(2)}</p>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
            </>
          )}
        </div>

        {/* Pagination */}
        {(!isLoading && bills.length > 0) && (
          <div className="flex justify-between items-center p-3 mt-auto shadow-sm rounded-lg shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] btn-press"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              className="h-8 px-6 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] btn-press"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Mark as Paid Modal */}
      {paymentMethodModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in px-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-[380px] rounded-xl overflow-hidden shadow-2xl border border-[var(--border-light)] animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="px-5 py-4 border-b border-[var(--border-light)] flex items-center gap-2">
              <CheckCircle size={18} className="text-[var(--color-success)]" />
              <p className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                Confirm Payment Received
              </p>
            </div>
            <div className="p-5">
              <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                Bill <span className="font-bold" style={{ color: 'var(--text-primary)' }}>#{paymentMethodModal.id.split('-')[0]}</span>
                {paymentMethodModal.customer_name && (
                  <span> &mdash; <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{paymentMethodModal.customer_name}</span></span>
                )}
              </p>
              <p className="text-3xl font-bold mb-5" style={{ color: 'var(--color-success)' }}>
                &#8377;{Number(paymentMethodModal.total_amount).toFixed(2)}
              </p>

              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
                How did they pay?
              </p>
              <div className="flex gap-2">
                {['CASH', 'UPI', 'SPLIT'].map(method => (
                  <button
                    key={method}
                    onClick={() => confirmMarkPaid(paymentMethodModal, method)}
                    className="flex-1 py-3 text-sm font-bold uppercase tracking-wider rounded-lg transition-all hover:opacity-90 active:scale-95 text-white"
                    style={{
                      backgroundColor: method === 'CASH'
                        ? 'var(--color-success)'
                        : method === 'UPI'
                          ? 'var(--color-accent)'
                          : 'var(--color-warning)',
                    }}
                  >
                    {method === 'SPLIT' ? 'UPI+Cash' : method}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-5 pb-4">
              <button
                onClick={() => setPaymentMethodModal(null)}
                className="w-full py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
