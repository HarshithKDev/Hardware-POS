import { useState, useEffect, useRef } from 'react';
import { formatINR } from '../../utils';
import { Modal, Button, Input } from '../ui';

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

  const subtitle = `${batch?.batch_number ? `Batch ${String(batch.batch_number).padStart(2, '0')} · ` : ''}${available !== null ? `${available} ${unitLabel} in stock` : `Measured in ${unitLabel}`}${action === 'checkout' && price > 0 ? ` · ₹${formatINR(price, 2)}/${unitLabel}` : ''}`;

  return (
    <Modal
      as="form"
      onSubmit={handleSubmit}
      onClose={onClose}
      title={`${title}: ${item.name}`}
      subtitle={subtitle}
      titleId="cuttable-modal-title"
      size="sm"
      zIndex={10000}
      focusFirst={false}
      restoreFocus={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSubmit} className="min-w-[96px]">
            {cartItemId ? 'Update' : 'Add'}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <Input
          id="cuttable-qty"
          ref={inputRef}
          label={question}
          size="lg"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={qtyInput}
          onChange={(e) => setQtyInput(e.target.value)}
          placeholder="0"
          suffix={unitLabel}
          error={exceeds}
        />

        {exceeds && (
          <p className="text-xs font-semibold" style={{ color: 'var(--color-error)' }}>
            Insufficient stock! Only {available} {unitLabel} available.
          </p>
        )}
        {action === 'checkout' && qty > 0 && !exceeds && price > 0 && (
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Amount: ₹{formatINR((Math.round(qty * price * 100) / 100), 2)}
          </p>
        )}
      </div>
    </Modal>
  );
}
