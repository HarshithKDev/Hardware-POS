import React from 'react';

export default function SelectBatchModal({
  isOpen,
  item,
  batches = [],
  activeTab,
  isWarehouseDisabled,
  userRole,
  calculateMSP,
  onSelectBatch,
  onClose
}) {
  if (!isOpen || !item) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[100] print:hidden px-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="select-batch-title"
    >
      <div 
        className="w-[85%] max-w-[450px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" 
        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
      >
        <div className="flex justify-between items-center pr-1 pl-4 py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span id="select-batch-title" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Select Batch for {item.name}
          </span>
        </div>
        
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {batches.map(batch => {
            const stockField = activeTab === 'transfer' ? 'stock_warehouse' : 'stock_store';
            const hasStock = activeTab === 'receive' || Number(batch[stockField]) > 0;
            return (
              <button 
                key={batch.batch_id}
                type="button"
                onClick={() => hasStock ? onSelectBatch(batch) : null}
                disabled={!hasStock}
                className={`w-full text-left p-4 mb-2 rounded-lg border flex justify-between items-center transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${hasStock ? 'hover:bg-[var(--bg-hover)] cursor-pointer' : 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]'}`}
                style={{ borderColor: 'var(--border-medium)', backgroundColor: hasStock ? 'var(--bg-primary)' : 'var(--bg-tertiary)' }}
              >
                <div>
                  <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>₹{Number(batch.selling_price).toFixed(2)}</div>
                  <div className="text-xs uppercase tracking-wider mt-1 group/msp cursor-help" style={{ color: 'var(--text-tertiary)' }}>
                    MSP: {userRole === 'owner' ? `₹${Number(calculateMSP ? calculateMSP(batch, item) : (batch.msp || 0)).toFixed(2)}` : (
                      <span className="transition-all duration-300">
                        <span className="group-hover/msp:hidden">***</span>
                        <span className="hidden group-hover/msp:inline">₹{Number(calculateMSP ? calculateMSP(batch, item) : (batch.msp || 0)).toFixed(2)}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-3">
                    <p className="text-xs font-mono" style={{ color: 'var(--color-accent)' }}>#{item.barcode}-{String(batch.batch_number).padStart(2,'0')}</p>
                    <div className="text-sm font-bold" style={{ color: 'var(--color-accent)' }}>
                      {activeTab === 'receive' ? (isWarehouseDisabled ? batch.stock_store : batch.stock_warehouse) : batch[stockField]} {item.unit}
                    </div>
                  </div>
                  <div className="text-xs uppercase tracking-wider mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    In {activeTab === 'checkout' || (activeTab === 'receive' && isWarehouseDisabled) ? 'Store' : 'Warehouse'}
                  </div>
                </div>
              </button>
            );
          })}
          {batches.length === 0 && (
            <div className="text-center p-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>No batches available for this item.</div>
          )}
        </div>
        
        <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
          <button 
            type="button"
            onClick={onClose} 
            className="h-9 px-6 text-sm font-semibold focus:outline-none rounded-md transition-colors cursor-pointer" 
            style={{ backgroundColor: 'transparent', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
