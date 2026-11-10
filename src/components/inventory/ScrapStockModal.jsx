import { useState } from 'react';
import { Spinner } from '../../SharedUI';

/**
 * "Scrap" for one batch: the owner enters how much to write off (e.g. 10 ft of offcuts,
 * 3 broken pieces) and it is simply removed from that batch's stock. No piece tracking.
 */
export default function ScrapStockModal({ isOpen, item, batch, isWarehouseDisabled, onClose, onConfirm }) {
  const [qty, setQty] = useState('');
  const [location, setLocation] = useState('store');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen || !item || !batch) return null;

  const unit = item.unit || 'PCS';
  const store = Number(batch.stock_store || 0);
  const whse = Number(batch.stock_warehouse || 0);
  const available = isWarehouseDisabled ? store + whse : (location === 'warehouse' ? whse : store);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const n = Number(qty);
    if (!(n > 0)) { setError('Enter a quantity greater than 0.'); return; }
    if (n > available + 1e-9) { setError(`Only ${available} ${unit} available here.`); return; }
    setError('');
    setIsSaving(true);
    try {
      await onConfirm({ qty: n, location: isWarehouseDisabled ? 'store' : location, reason: reason.trim() });
      setQty(''); setReason(''); setLocation('store');
    } catch (err) {
      setError(err.message || 'Could not scrap stock.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass = 'w-full h-10 px-3 text-sm rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]';

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-[var(--border-light)] shadow-2xl overflow-hidden bg-[var(--bg-primary)]">
        <div className="p-4 border-b border-[var(--border-light)] bg-[var(--bg-tertiary)]">
          <h2 className="text-base font-bold text-[var(--text-primary)]">Scrap Stock</h2>
          <p className="text-xs mt-0.5 text-[var(--text-secondary)]">
            {item.name} · Batch {String(batch.batch_number || 1).padStart(2, '0')}
          </p>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {!isWarehouseDisabled && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">From</label>
              <select value={location} onChange={(e) => { setLocation(e.target.value); setError(''); }} className={inputClass}>
                <option value="store">Store ({store} {unit})</option>
                <option value="warehouse">Warehouse ({whse} {unit})</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
              Quantity to scrap ({unit}) <span className="normal-case font-normal">· available {Math.round(available * 100) / 100}</span>
            </label>
            <input
              type="number"
              step="any"
              min="0"
              autoFocus
              value={qty}
              onChange={(e) => { setQty(e.target.value); setError(''); }}
              placeholder={`e.g. 10`}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">Reason (optional)</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. offcuts, damaged" className={inputClass} />
          </div>

          {error && <p className="text-xs font-semibold" style={{ color: 'var(--color-error)' }}>{error}</p>}
          <p className="text-[11px] text-[var(--text-tertiary)]">This permanently removes the quantity from stock and is recorded in the audit log.</p>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={isSaving} className="h-9 px-4 text-xs font-semibold rounded-md border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="h-9 px-4 text-xs font-bold uppercase tracking-wider rounded-md text-white flex items-center gap-2 disabled:opacity-50" style={{ backgroundColor: 'var(--color-error)' }}>
            {isSaving ? <Spinner className="w-3.5 h-3.5 text-white" /> : 'Scrap'}
          </button>
        </div>
      </form>
    </div>
  );
}
