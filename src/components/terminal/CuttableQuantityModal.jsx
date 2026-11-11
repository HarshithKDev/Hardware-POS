import { useState, useEffect, useRef } from 'react';
import { formatINR } from '../../utils';

/**
 * Cut-length items (pipes, mesh, wire…) are tracked only as a TOTAL quantity in their unit
 * (ft / m / sqft). No pieces, roll lengths or widths: receiving "200 ft" adds 200 ft,
 * selling "30 ft" removes 30 ft.
 *
 * modalData: { item, batch, action: 'receive' | 'transfer' | 'checkout', cartItemId?, initialQty? }
 */
export default function CuttableQuantityModal({
  isOpen,
  modalData,
  cart = [],
  isWarehouseDisabled = false,
  onSubmit,
  onClose
}) {
  const [qtyInput, setQtyInput] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQtyInput(modalData?.initialQty !== undefined && modalData?.initialQty !== null ? String(modalData.initialQty) : '');
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, modalData]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !modalData?.item) return null;

  const { item, batch, action = 'checkout', cartItemId } = modalData;
  const unitLabel = String(item.unit || 'FT').toLowerCase();
  const price = Number(batch?.selling_price ?? (item.price || 0));

  // Stock available for this action (receive has no limit)
  let available = null;
  if (action === 'checkout' || action === 'transfer') {
    const sumBatches = (field) => (item.batches || []).reduce((s, b) => s + Number(b[field] || 0), 0);
    const store = batch ? Number(batch.stock_store || 0) : (item.batches?.length ? sumBatches('stock_store') : Number(item.stock_store || 0));
    const whse = batch ? Number(batch.stock_warehouse || 0) : (item.batches?.length ? sumBatches('stock_warehouse') : Number(item.stock_warehouse || 0));
    const total = action === 'transfer' ? whse : (isWarehouseDisabled ? store + whse : store);
    const inCart = (cart || [])
      .filter(c => c.id !== cartItemId && c.barcode === item.barcode && (!batch?.batch_id || c.batch_id === batch.batch_id))
      .reduce((s, c) => s + (Number(c.actual_quantity !== undefined && c.actual_quantity !== '' ? c.actual_quantity : c.quantity) || 0), 0);
    available = Math.max(0, Math.round((total - inCart) * 100) / 100);
  }

  const qty = Math.round((parseFloat(qtyInput) || 0) * 100) / 100;
  const exceeds = available !== null && qty > available;
  const canSubmit = qty > 0 && !exceeds;

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!canSubmit) return;
    onSubmit({ item, batch, qty, cartItemId: cartItemId || null, action });
  };

  const title = action === 'receive' ? 'Receive Stock' : action === 'transfer' ? 'Send to Store' : 'Sell';
  const question = action === 'receive'
    ? `Total ${unitLabel} received`
    : action === 'transfer'
      ? `Total ${unitLabel} to send to the store`
      : `Total ${unitLabel} to sell`;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-[var(--border-light)] shadow-2xl overflow-hidden bg-[var(--bg-primary)]">
        <div className="p-4 border-b border-[var(--border-light)] bg-[var(--bg-tertiary)]">
          <h2 className="text-base font-bold text-[var(--text-primary)]">{title}: {item.name}</h2>
          <p className="text-xs mt-0.5 text-[var(--text-secondary)]">
            {batch?.batch_number ? `Batch ${String(batch.batch_number).padStart(2, '0')} · ` : ''}
            {available !== null ? `${available} ${unitLabel} in stock` : `Measured in ${unitLabel}`}
            {action === 'checkout' && price > 0 ? ` · ₹${formatINR(price, 2)}/${unitLabel}` : ''}
          </p>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <label htmlFor="cuttable-qty" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {question}
          </label>
          <div className="flex items-center rounded-md bg-[var(--bg-input)] border border-[var(--border-input)] focus-within:border-[var(--color-accent)] px-3 h-12">
            <input
              id="cuttable-qty"
              ref={inputRef}
              type="number"
              step="any"
              min="0"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              placeholder="0"
              className="w-full h-full bg-transparent text-xl font-bold text-[var(--text-input)] p-0"
              style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
            />
            <span className="text-sm font-bold text-[var(--text-secondary)] ml-2 shrink-0">{unitLabel}</span>
          </div>

          {exceeds && (
            <p className="text-xs font-bold" style={{ color: 'var(--color-error)' }}>
              Insufficient stock! Only {available} {unitLabel} available.
            </p>
          )}
          {action === 'checkout' && qty > 0 && !exceeds && price > 0 && (
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Amount: ₹{formatINR((Math.round(qty * price * 100) / 100), 2)}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 text-xs font-semibold rounded-md border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit} className="h-9 px-5 text-xs font-bold uppercase tracking-wider rounded-md text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>
            {cartItemId ? 'Update' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}
