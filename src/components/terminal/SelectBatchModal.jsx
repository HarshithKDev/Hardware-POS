import { formatINR } from '../../utils';
import { Modal, Button } from '../ui';

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
    <Modal
      onClose={onClose}
      title={`Select Batch for ${item.name}`}
      titleId="select-batch-title"
      size="md"
      zIndex={100}
      focusFirst={false}
      restoreFocus={false}
      bodyClassName="p-4"
      footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}
    >
        <div className="flex flex-col gap-2">
          {batches.map(batch => {
            const stockField = activeTab === 'transfer' ? 'stock_warehouse' : 'stock_store';
            const hasStock = activeTab === 'receive' || Number(batch[stockField]) > 0;
            return (
              <button 
                key={batch.batch_id}
                type="button"
                onClick={() => hasStock ? onSelectBatch(batch) : null}
                disabled={!hasStock}
                className={`w-full text-left p-4 rounded-[10px] border flex justify-between items-center gap-3 transition-colors ${hasStock ? 'hover:bg-[var(--bg-hover)] cursor-pointer' : 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]'}`}
                style={{ borderColor: 'var(--border-medium)', backgroundColor: hasStock ? 'var(--bg-primary)' : 'var(--bg-tertiary)' }}
              >
                <div>
                  <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>₹{formatINR(Number(batch.selling_price), 2)}</div>
                  <div className="text-xs uppercase tracking-wider mt-1 group/msp cursor-help" style={{ color: 'var(--text-tertiary)' }}>
                    MSP: {userRole === 'owner' ? `₹${formatINR(Number(calculateMSP ? calculateMSP(batch, item) : (batch.msp || 0)), 2)}` : (
                      <span className="transition-all duration-300">
                        <span className="group-hover/msp:hidden">***</span>
                        <span className="hidden group-hover/msp:inline">₹{formatINR(Number(calculateMSP ? calculateMSP(batch, item) : (batch.msp || 0)), 2)}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-3">
                    <p className="text-xs font-mono" style={{ color: 'var(--color-accent)' }}>#{item.barcode}-{String(batch.batch_number).padStart(2,'0')}</p>
                    <div className="text-sm font-bold" style={{ color: 'var(--color-accent)' }}>
                      {isWarehouseDisabled 
                        ? (Number(batch.stock_store || 0) + Number(batch.stock_warehouse || 0)) 
                        : (activeTab === 'receive' ? (batch.stock_warehouse || 0) : (batch[stockField] || 0))} {item.unit}
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
        
    </Modal>
  );
}
