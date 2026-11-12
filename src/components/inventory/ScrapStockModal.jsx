import { useState } from 'react';
import { Modal, Button, Input, FieldLabel } from '../ui';

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

  const selectClass = 'w-full h-10 px-3 text-sm rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]';

  return (
    <Modal
      as="form"
      onSubmit={handleSubmit}
      onClose={isSaving ? undefined : onClose}
      title="Scrap Stock"
      subtitle={`${item.name} · Batch ${String(batch.batch_number || 1).padStart(2, '0')}`}
      titleId="scrap-stock-title"
      size="sm"
      zIndex={10000}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button type="submit" variant="danger" loading={isSaving} className="min-w-[96px]">Scrap</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        {!isWarehouseDisabled && (
          <div>
            <FieldLabel htmlFor="scrap-location">From</FieldLabel>
            <select id="scrap-location" value={location} onChange={(e) => { setLocation(e.target.value); setError(''); }} className={selectClass}>
              <option value="store">Store ({store} {unit})</option>
              <option value="warehouse">Warehouse ({whse} {unit})</option>
            </select>
          </div>
        )}

        <Input
          id="scrap-qty"
          label={`Quantity to scrap (${unit})`}
          hint={`available ${Math.round(available * 100) / 100}`}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          autoFocus
          value={qty}
          onChange={(e) => { setQty(e.target.value); setError(''); }}
          placeholder="e.g. 10"
          suffix={String(unit).toLowerCase()}
        />

        <Input
          id="scrap-reason"
          label="Reason (optional)"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. offcuts, damaged"
        />

        {error && <p role="alert" className="text-xs font-semibold" style={{ color: 'var(--color-error)' }}>{error}</p>}
        <p className="text-xs text-[var(--text-tertiary)]">This permanently removes the quantity from stock and is recorded in the audit log.</p>
      </div>
    </Modal>
  );
}
