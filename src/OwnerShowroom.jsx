import { useState, Fragment } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader, EmptyState } from './SharedUI';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { formatDateTime } from './utils';
import { CheckCircle, ChevronRight, Phone } from 'lucide-react';
import ShowroomDetailsView from './ShowroomDetailsView';

const SHOWROOM_PAGE_SIZE = 20;

export default function OwnerShowroom() {
  const { showAlert } = useApp();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(0);
  const [selectedBill, setSelectedBill] = useState(null);
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [paymentMethodModal, setPaymentMethodModal] = useState(null);

  const shopId = localStorage.getItem('shop_id');

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['showroom-sales', shopId, page],
    queryFn: async () => {
      const from = page * SHOWROOM_PAGE_SIZE;
      let query = supabase
        .from('bills')
        .select('*')
        .eq('location', 'Store')
        .eq('status', 'showroom_pending');
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(from, from + SHOWROOM_PAGE_SIZE - 1);
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60,
  });

  const hasMore = bills.length === SHOWROOM_PAGE_SIZE;

  const handleMarkPaid = (bill) => {
    setPaymentMethodModal(bill);
  };

  const confirmMarkPaid = async (bill, selectedPaymentMethod, cashAmount = 0, upiAmount = 0) => {
    setMarkingPaidId(bill.id);
    setPaymentMethodModal(null);
    try {
      const shopId = localStorage.getItem('shop_id');
      const totalAmt = Number(bill.total_amount || 0);
      const finalCash = selectedPaymentMethod === 'CASH' ? totalAmt : (selectedPaymentMethod === 'UPI' ? 0 : Number(cashAmount || 0));
      const finalUpi = selectedPaymentMethod === 'UPI' ? totalAmt : (selectedPaymentMethod === 'CASH' ? 0 : Number(upiAmount || 0));

      const updateData = {
        status: null,
        payment_method: selectedPaymentMethod,
        cash_amount: finalCash,
        upi_amount: finalUpi
      };

      let query = supabase
        .from('bills')
        .update(updateData)
        .eq('id', bill.id);
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { error } = await query;
      if (error) throw error;

      showAlert(
        `Bill #${bill.id.split('-')[0]} has been marked as paid (${selectedPaymentMethod}) and added to sales revenue.`,
        'Payment Received'
      );
      if (selectedBill && selectedBill.id === bill.id) {
        setSelectedBill(null);
      }
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

  if (selectedBill) {
    return (
      <div className="h-full flex flex-col relative w-full animate-fade-in">
        <ShowroomDetailsView
          bill={selectedBill}
          onBack={() => setSelectedBill(null)}
          onMarkPaid={(bill) => handleMarkPaid(bill)}
          isMarkingPaid={markingPaidId === selectedBill.id}
        />
        {/* Mark as Paid Modal */}
        {paymentMethodModal && (
          <ShowroomPaymentModal
            bill={paymentMethodModal}
            onClose={() => setPaymentMethodModal(null)}
            onConfirm={confirmMarkPaid}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative w-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>
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
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-x-hidden overflow-y-auto shadow-sm min-h-[300px] md:rounded-lg border border-[var(--border-light)] mb-4" style={{ backgroundColor: 'transparent', overscrollBehavior: 'none' }}>
          {isLoading ? (
            <div className="h-full flex items-center justify-center p-8">
              <PageLoader text="Loading showroom sales..." />
            </div>
          ) : bills.length === 0 ? (
            <EmptyState message="No pending showroom sales. All goods have been paid for!" />
          ) : (
            <table className="block md:table w-full text-center border-collapse">
              <thead className="hidden md:table-header-group sticky top-0 z-20" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                <tr className="text-xs font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-secondary)' }}>
                  <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Date &amp; Time</th>
                  <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Customer Name</th>
                  <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Phone Number</th>
                  <th className="p-3.5 text-center w-28" style={{ borderRight: '1px solid var(--border-medium)' }}>Items</th>
                  <th className="p-3.5 text-center w-36" style={{ borderRight: '1px solid var(--border-medium)' }}>Amount</th>
                  <th className="p-3.5 text-center w-40">Action</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {bills.map(bill => (
                  <Fragment key={bill.id}>
                    {/* Mobile layout */}
                    <tr
                      className="md:hidden block p-4 border-b border-[var(--border-light)] cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                      style={{ borderBottom: '1px solid var(--border-light)' }}
                      onClick={() => setSelectedBill(bill)}
                    >
                      <td className="block p-0 border-none">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                              {formatDateTime(bill.created_at).full}
                            </p>
                            <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                              {bill.customer_name || '—'}
                            </p>
                            {bill.customer_phone && (
                              <p className="text-xs text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5">
                                <Phone className="w-3 h-3 text-[var(--color-accent)] inline shrink-0" />
                                {bill.customer_phone}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
                              &#8377;{Number(bill.total_amount).toFixed(2)}
                            </p>
                            <span
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase inline-block mt-0.5"
                              style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)' }}
                            >
                              SHOWROOM
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--border-light)]" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleMarkPaid(bill); }}
                            disabled={markingPaidId === bill.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md text-white transition-opacity disabled:opacity-50 active:scale-95 cursor-pointer shadow-sm"
                            style={{ backgroundColor: 'var(--color-success)' }}
                          >
                            {markingPaidId === bill.id
                              ? <Spinner className="w-3.5 h-3.5 text-white" />
                              : <CheckCircle size={14} />}
                            Mark as Paid
                          </button>

                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedBill(bill); }}
                            className="px-2.5 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1 cursor-pointer"
                            title="View Bill Details"
                          >
                            <span>View</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Desktop layout */}
                    <tr
                      className="hidden md:table-row cursor-pointer transition-colors hover:bg-[var(--bg-hover)] border-b border-[var(--border-medium)]"
                      style={{ borderBottom: '1px solid var(--border-medium)' }}
                      onClick={() => setSelectedBill(bill)}
                    >
                      <td className="p-3.5 text-sm text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                        {formatDateTime(bill.created_at).full}
                      </td>
                      <td className="p-3.5 text-sm font-medium text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                        {bill.customer_name || '—'}
                      </td>
                      <td className="p-3.5 text-sm text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                        {bill.customer_phone || '—'}
                      </td>
                      <td className="p-3.5 text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)' }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedBill(bill); }}
                          className="px-2.5 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors inline-flex items-center gap-1 cursor-pointer"
                          title="View Bill Details"
                        >
                          <span>View</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                      <td className="p-3.5 text-sm font-bold text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>
                        &#8377;{Number(bill.total_amount).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-center align-middle" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleMarkPaid(bill); }}
                          disabled={markingPaidId === bill.id}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md text-white transition-opacity disabled:opacity-50 active:scale-95 shadow-sm cursor-pointer"
                          style={{ backgroundColor: 'var(--color-success)' }}
                        >
                          {markingPaidId === bill.id
                            ? <Spinner className="w-3.5 h-3.5 text-white" />
                            : <CheckCircle size={13} />}
                          Mark Paid
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
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
        <ShowroomPaymentModal
          bill={paymentMethodModal}
          onClose={() => setPaymentMethodModal(null)}
          onConfirm={confirmMarkPaid}
        />
      )}
    </div>
  );
}

function ShowroomPaymentModal({ bill, onClose, onConfirm }) {
  const [isSplit, setIsSplit] = useState(false);
  const total = Number(bill.total_amount || 0);
  const [splitCash, setSplitCash] = useState('');
  const [splitUpi, setSplitUpi] = useState(total.toFixed(2));
  const [splitError, setSplitError] = useState('');

  const handleCashChange = (val) => {
    setSplitCash(val);
    setSplitError('');
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0) {
      setSplitUpi(Math.max(0, total - num).toFixed(2));
    }
  };

  const handleUpiChange = (val) => {
    setSplitUpi(val);
    setSplitError('');
  };

  const handleConfirmSplit = () => {
    const cash = parseFloat(splitCash) || 0;
    const upi = parseFloat(splitUpi) || 0;
    if (Math.abs((cash + upi) - total) > 0.05) {
      setSplitError(`Amounts must sum to ₹${total.toFixed(2)} (currently ₹${(cash + upi).toFixed(2)})`);
      return;
    }
    onConfirm(bill, 'SPLIT', cash, upi);
  };

  return (
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
            Bill <span className="font-bold" style={{ color: 'var(--text-primary)' }}>#{bill.id.split('-')[0]}</span>
            {bill.customer_name && (
              <span> &mdash; <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{bill.customer_name}</span></span>
            )}
          </p>
          <p className="text-3xl font-bold mb-5" style={{ color: 'var(--color-success)' }}>
            &#8377;{total.toFixed(2)}
          </p>

          {!isSplit ? (
            <>
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
                How did they pay?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onConfirm(bill, 'CASH', total, 0)}
                  className="flex-1 py-3 text-sm font-bold uppercase tracking-wider rounded-lg transition-all hover:opacity-90 active:scale-95 text-white cursor-pointer"
                  style={{ backgroundColor: 'var(--color-success)' }}
                >
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => onConfirm(bill, 'UPI', 0, total)}
                  className="flex-1 py-3 text-sm font-bold uppercase tracking-wider rounded-lg transition-all hover:opacity-90 active:scale-95 text-white cursor-pointer"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  UPI
                </button>
                <button
                  type="button"
                  onClick={() => setIsSplit(true)}
                  className="flex-1 py-3 text-sm font-bold uppercase tracking-wider rounded-lg transition-all hover:opacity-90 active:scale-95 text-white cursor-pointer"
                  style={{ backgroundColor: 'var(--color-warning)' }}
                >
                  UPI+Cash
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Cash Amount (₹)
                </label>
                <input
                  type="number"
                  step="any"
                  autoFocus
                  value={splitCash}
                  onChange={(e) => handleCashChange(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-10 px-3 text-sm rounded-lg border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                  UPI Amount (₹)
                </label>
                <input
                  type="number"
                  step="any"
                  value={splitUpi}
                  onChange={(e) => handleUpiChange(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-10 px-3 text-sm rounded-lg border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none"
                />
              </div>
              {splitError && (
                <p className="text-xs font-semibold text-[var(--color-error)]">{splitError}</p>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSplit(false)}
                  className="px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors border border-[var(--border-medium)] text-[var(--text-secondary)] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSplit}
                  className="flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all text-white bg-[var(--color-accent)] hover:opacity-90 active:scale-95 cursor-pointer"
                >
                  Confirm Split
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 pb-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
