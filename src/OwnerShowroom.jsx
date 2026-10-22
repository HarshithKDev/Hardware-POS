import { useState, Fragment } from 'react';
import { supabase } from './supabaseClient';
import { PageLoader, EmptyState } from './SharedUI';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, useSessionState } from './utils';
import { ChevronRight, Phone } from 'lucide-react';
import ShowroomDetailsView from './ShowroomDetailsView';

const SHOWROOM_PAGE_SIZE = 20;

export default function OwnerShowroom() {
  const shopId = localStorage.getItem('shop_id');
  const [page, setPage] = useSessionState(`pos_showroom_page_${shopId}`, 0);
  const [selectedBill, setSelectedBill] = useState(null);

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
        <div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>
            Showroom Dispatches
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Record of products deducted and sent to the showroom. Excluded from shop sales and profit.
          </p>
        </div>
        {bills.length > 0 && (
          <div className="shrink-0 px-4 py-2 rounded-lg border" style={{ backgroundColor: 'var(--color-accent-bg)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>Total Dispatched Value</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--color-accent)' }}>&#8377;{totalValue.toFixed(2)}</p>
          </div>
        )}
      </div>

      {/* Bills list container */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-x-hidden overflow-y-auto shadow-sm min-h-[300px] md:rounded-lg border border-[var(--border-light)] mb-4" style={{ backgroundColor: 'transparent', overscrollBehavior: 'none' }}>
          {isLoading ? (
            <div className="h-full flex items-center justify-center p-8">
              <PageLoader text="Loading showroom dispatches..." />
            </div>
          ) : bills.length === 0 ? (
            <EmptyState message="No showroom dispatches recorded. Items dispatched to showroom will appear here." />
          ) : (
            <table className="block md:table w-full text-center border-collapse">
              <thead className="hidden md:table-header-group sticky top-0 z-20" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                <tr className="text-xs font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-secondary)' }}>
                  <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Date &amp; Time</th>
                  <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Customer / Recipient</th>
                  <th className="p-3.5 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Phone Number</th>
                  <th className="p-3.5 text-center w-36" style={{ borderRight: '1px solid var(--border-medium)' }}>Total Value</th>
                  <th className="p-3.5 text-center w-36">Deducted Items</th>
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
                        <div className="flex items-center justify-end mt-2 pt-2 border-t border-[var(--border-light)]">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedBill(bill); }}
                            className="px-3 py-1.5 text-xs font-semibold rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-medium)] transition-colors inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>View Deducted Items</span>
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
                      <td className="p-3.5 text-sm font-bold text-center align-middle" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>
                        &#8377;{Number(bill.total_amount).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-center align-middle">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedBill(bill); }}
                          className="px-3 py-1.5 text-xs font-semibold rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-medium)] transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                          title="View Deducted Products"
                        >
                          <span>View Items</span>
                          <ChevronRight className="w-3.5 h-3.5" />
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
    </div>
  );
}
