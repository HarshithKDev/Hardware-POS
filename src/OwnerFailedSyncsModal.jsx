import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { deleteOfflineTransaction, requeueTransaction } from './services/db';
import { formatDateTime } from './utils';
import { buttonClass } from './components/ui';

export default function OwnerFailedSyncsModal({ failedSyncs }) {
  const { showAlert, showConfirm } = useApp();
  const queryClient = useQueryClient();

  const retryMutation = useMutation({
    mutationFn: async (id) => {
      await requeueTransaction(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      showAlert('Transaction requeued. It will attempt to sync shortly.', 'Success');
    },
    onError: (error) => {
      showAlert(`Failed to requeue transaction: ${error.message}`, 'Retry Error');
    }
  });

  const discardMutation = useMutation({
    mutationFn: async (id) => {
      await deleteOfflineTransaction(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      showAlert('Transaction permanently discarded.', 'Info');
    },
    onError: (error) => {
      showAlert(`Failed to discard transaction: ${error.message}`, 'Discard Error');
    }
  });

  const handleRetry = (id) => {
    retryMutation.mutate(id);
  };

  const handleDiscard = (id) => {
    showConfirm('Delete this failed transaction? This cannot be undone.', () => {
      discardMutation.mutate(id);
    }, 'Discard Transaction', 'Delete Permanently', 'Cancel', true);
  };

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-center border-collapse">
        <thead className="sticky top-0 z-20 shadow-sm" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
          <tr className="h-10 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            <th className="p-3 w-40" style={{ borderRight: '1px solid var(--border-medium)' }}>Timestamp</th>
            <th className="p-3" style={{ borderRight: '1px solid var(--border-medium)' }}>Transaction Details</th>
            <th className="p-3" style={{ borderRight: '1px solid var(--border-medium)' }}>Error Reason</th>
            <th className="p-3 w-40 text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          {failedSyncs.length === 0 ? (
            <tr><td colSpan="4" className="h-[50vh] supports-[height:100dvh]:h-[50dvh] align-middle text-center text-sm font-semibold" style={{ color: 'var(--color-success)' }}>No failed transactions!</td></tr>
          ) : (
            failedSyncs.map(tx => (
              <tr key={tx.id} style={{ borderBottom: '1px solid var(--border-medium)' }}>
                <td className="p-3 text-xs " style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-medium)' }}>
                  {formatDateTime(tx.queued_at).full}
                </td>
                <td className="p-3 text-sm" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }}>
                  <div className="font-bold mb-1" style={{ color: 'var(--color-accent)' }}>{tx.p_action} ({tx.p_location})</div>
                  <div className="text-xs">Cashier: {tx.p_cashier_name}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {tx.p_items?.length || 0} item{(tx.p_items?.length === 1) ? '' : 's'} ({tx.p_items?.map(i => `${i.billable_quantity ?? i.actual_quantity ?? i.quantity ?? 1}x ${i.name || i.barcode}`).join(', ') || 'No item data'})
                  </div>
                </td>
                <td className="p-3 text-xs  font-medium" style={{ color: 'var(--color-error)', borderRight: '1px solid var(--border-medium)', whiteSpace: 'pre-wrap' }}>
                  {tx.error_message || 'Unknown Error'}
                </td>
                <td className="p-3 text-center">
                  <div className="flex flex-col gap-2">
                    <button onClick={() => handleRetry(tx.id)} className="px-2 py-1 text-[11px] font-bold text-white bg-[var(--color-accent-solid)] hover:bg-[var(--color-accent-solid-hover)] transition-colors">
                      Retry
                    </button>
                    <button onClick={() => handleDiscard(tx.id)} className={buttonClass({ variant: 'danger-outline', size: 'sm' })}>
                      Discard
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
