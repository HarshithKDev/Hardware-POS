import { useState, Fragment } from 'react';
import { supabase } from './supabaseClient';
import { PageLoader, EmptyState } from './SharedUI';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, useSessionState } from './utils';
import { ChevronRight, Phone } from 'lucide-react';
import ShowroomDetailsView from './ShowroomDetailsView';
import PageTitleReset from './components/PageTitleReset';

const SHOWROOM_PAGE_SIZE = 20;

export default function OwnerShowroom() {
  const shopId = localStorage.getItem('shop_id');
  const [page, setPage] = useSessionState(`pos_showroom_page_${shopId}`, 0);
  const [selectedBill, setSelectedBill] = useSessionState(`pos_showroom_selected_${shopId}`, null);

  const handleResetShowroom = () => {
    setPage(0);
    setSelectedBill(null);
    try {
      window.sessionStorage.removeItem(`pos_showroom_page_${shopId}`);
      window.sessionStorage.removeItem(`pos_showroom_selected_${shopId}`);
    } catch (e) {}
  };

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['showroom-sales', shopId, page],
    queryFn: async () => {
      const from = page * SHOWROOM_PAGE_SIZE;
      let query = supabase
        .from('bills')
        .select('*')
        .eq('location', 'Store')
        .or('status.eq.showroom_pending,payment_method.eq.SHOWROOM,status.eq.showroom');
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

  const totalValue = bills.reduce((sum, b) => sum + Number(b.total_amount || 0), 0);

  if (selectedBill) {
    return (
      <div className="h-full flex flex-col relative w-full animate-fade-in">
        <ShowroomDetailsView
          bill={selectedBill}
          onBack={() => setSelectedBill(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative w-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
        <PageTitleReset
          title="Showroom Dispatches"
          subtitle="Record of products deducted and sent to the showroom. Excluded from shop sales and profit."
          onReset={handleResetShowroom}
          tooltip="Click title to reset showroom dispatches to first page"
        />
        {bills.length > 0 && (
          <div className="shrink-0 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] px-5 py-3 shadow-sm text-left sm:text-right">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-0.5">
              Total Dispatched Value
            </span>
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums">
              ₹{totalValue.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Bills list container */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-x-hidden overflow-y-auto shadow-sm min-h-[300px] rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] mb-4" style={{ overscrollBehavior: 'none' }}>
          {isLoading ? (
            <div className="h-full flex items-center justify-center p-8">
              <PageLoader text="Loading showroom dispatches..." />
            </div>
          ) : bills.length === 0 ? (
            <EmptyState message="No showroom dispatches recorded. Items dispatched to showroom will appear here." />
          ) : (
            <table className="block md:table w-full text-left border-collapse">
              <thead className="hidden md:table-header-group sticky top-0 z-20" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                <tr className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  <th className="py-3.5 px-5 text-left md:w-[28%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Date &amp; Time</th>
                  <th className="py-3.5 px-5 text-left md:w-[32%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Customer / Recipient</th>
                  <th className="py-3.5 px-4 text-center md:w-[22%]" style={{ borderRight: '1px solid var(--border-medium)' }}>Phone Number</th>
                  <th className="py-3.5 px-6 text-right md:w-[18%]">Total Value</th>
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
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)]">
                              {formatDateTime(bill.created_at).full}
                            </p>
                            <p className="text-sm font-bold text-[var(--text-primary)] mt-0.5">
                              {bill.customer_name || 'Showroom Recipient'}
                            </p>
                            {bill.customer_phone && (
                              <p className="text-xs text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5">
                                <Phone className="w-3 h-3 text-[var(--color-accent)] inline shrink-0" />
                                {bill.customer_phone}
                              </p>
                            )}
                          </div>
                          <div className="text-right flex items-center gap-2">
                            <div>
                              <p className="text-base font-bold text-[var(--text-primary)] tabular-nums">
                                ₹{Number(bill.total_amount).toFixed(2)}
                              </p>
                              <span
                                className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase inline-block mt-0.5 tracking-wider"
                                style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', border: '1px solid rgba(59, 130, 246, 0.2)' }}
                              >
                                SHOWROOM
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* Desktop layout */}
                    <tr
                      className="hidden md:table-row cursor-pointer transition-colors hover:bg-[var(--bg-hover)] border-b border-[var(--border-medium)] group"
                      style={{ borderBottom: '1px solid var(--border-medium)' }}
                      onClick={() => setSelectedBill(bill)}
                    >
                      <td className="py-4 px-5 text-sm text-left align-middle" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                        <div className="font-semibold text-sm text-[var(--text-primary)]">{formatDateTime(bill.created_at).datePart}</div>
                        <div className="text-xs text-[var(--text-secondary)]">{formatDateTime(bill.created_at).timePart}</div>
                      </td>
                      <td className="py-4 px-5 text-sm font-semibold text-left align-middle" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                        {bill.customer_name || '—'}
                      </td>
                      <td className="py-4 px-4 text-sm text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                        {bill.customer_phone ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-xs text-[var(--text-primary)]">
                            <Phone className="w-3.5 h-3.5 text-[var(--color-accent)] inline shrink-0" />
                            {bill.customer_phone}
                          </span>
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-sm font-bold text-right align-middle tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        <div className="flex items-center justify-end gap-2">
                          <span>₹{Number(bill.total_amount).toFixed(2)}</span>
                          <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
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
    </div>
  );
}
