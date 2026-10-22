import React from 'react';
import { createPortal } from 'react-dom';
import BatchDetailsView from './BatchDetailsView';

/**
 * BatchDetailsModal
 * Lightweight modal wrapper that delegates to BatchDetailsView.
 * Eliminates ~57KB of duplicated code while maintaining identical modal API.
 */
export default function BatchDetailsModal({
  isOpen,
  onClose,
  item,
  viewType = 'warehouse'
}) {
  if (!isOpen || !item) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      role="dialog"
      aria-modal="true"
    >
      <div 
        className="w-full max-w-6xl h-[92vh] rounded-2xl overflow-hidden shadow-2xl border border-[var(--border-light)] flex flex-col p-4 sm:p-6"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        <BatchDetailsView
          barcode={item.barcode}
          initialItem={item}
          onBack={onClose}
          viewType={viewType}
        />
      </div>
    </div>,
    document.body
  );
}
