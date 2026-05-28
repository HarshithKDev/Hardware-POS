import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { deleteOfflineTransaction, requeueTransaction } from './services/db';

export default function OwnerFailedSyncsModal({ failedSyncs, onClose }) {
  const { showAlert, showConfirm } = useApp();
  const queryClient = useQueryClient();

  const retryMutation = useMutation({
    mutationFn: async (id) => {
      await requeueTransaction(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      showAlert('Transaction requeued. It will attempt to sync shortly.', 'Success');
    }
  });

  const discardMutation = useMutation({
    mutationFn: async (id) => {
      await deleteOfflineTransaction(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      showAlert('Transaction permanently discarded.', 'Info');
    }
  });

  const handleRetry = (id) => {
    retryMutation.mutate(id);
  };

  const handleDiscard = (id) => {
    showConfirm('Are you sure you want to permanently delete this failed transaction? This action cannot be undone.', () => {
      discardMutation.mutate(id);
    }, 'Discard Transaction');
  };

  return (
    <div className="overflow-x-auto w-full">
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 shadow-sm" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-light)' }}>
          <tr className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            <th className="p-3 w-40" style={{ borderRight: '1px solid var(--border-light)' }}>Timestamp</th>
            <th className="p-3" style={{ borderRight: '1px solid var(--border-light)' }}>Transaction Details</th>
            <th className="p-3" style={{ borderRight: '1px solid var(--border-light)' }}>Error Reason</th>
            <th className="p-3 w-40 text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          {failedSyncs.length === 0 ? (
            <tr><td colSpan="4" className="p-8 text-center text-sm font-semibold" style={{ color: 'var(--color-success)' }}>No failed transactions!</td></tr>
          ) : (
            failedSyncs.map(tx => (
              <tr key={tx.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="p-3 text-xs font-mono" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-light)' }}>
                  {new Date(tx.queued_at).toLocaleString()}
                </td>
                <td className="p-3 text-sm" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>
                  <div className="font-bold mb-1" style={{ color: 'var(--color-accent)' }}>{tx.p_action} ({tx.p_location})</div>
                  <div className="text-xs">Cashier: {tx.p_cashier_name}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {tx.p_items?.length} items ({tx.p_items?.map(i => `${i.qty}x`).join(', ')})
                  </div>
                </td>
                <td className="p-3 text-xs font-mono font-medium" style={{ color: 'var(--color-error)', borderRight: '1px solid var(--border-light)', whiteSpace: 'pre-wrap' }}>
                  {tx.error_message || 'Unknown Error'}
                </td>
                <td className="p-3 text-center">
                  <div className="flex flex-col gap-2">
                    <button onClick={() => handleRetry(tx.id)} className="px-2 py-1 text-[10px] font-bold uppercase text-white bg-blue-500 hover:bg-blue-600 transition-colors">
                      Retry
                    </button>
                    <button onClick={() => handleDiscard(tx.id)} className="px-2 py-1 text-[10px] font-bold uppercase transition-colors" style={{ color: 'var(--color-error)', border: '1px solid var(--color-error)' }}>
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
