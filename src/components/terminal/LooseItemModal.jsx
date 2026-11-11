import { formatINR } from '../../utils';
import { Modal, Button, Input } from '../ui';

export default function LooseItemModal({
  isOpen,
  looseItemModal,
  setLooseItemModal,
  activeTab,
  isWarehouseDisabled,
  onSubmit,
  onClose
}) {
  if (!isOpen || !looseItemModal?.item) return null;

  const item = looseItemModal.item;
  const isLooseKg = Boolean(
    item.is_loose_item && (
      item.unit?.toUpperCase() === 'KG' ||
      item.unit?.toUpperCase() === 'KGS' ||
      item.unit?.toUpperCase() === 'GRAMS' ||
      item.unit?.toUpperCase() === 'GRAM' ||
      item.unit?.toUpperCase() === 'G' ||
      item.unit?.toUpperCase() === 'GM'
    )
  );
  const availableStore = Number(item.stock_store || 0);
  const availableWhse = Number(item.stock_warehouse || 0);
  const ratePerKg = Number(item.price || 0);
  const isCheckout = activeTab === 'checkout';

  const title = activeTab === 'checkout' ? 'Loose Item Quantity' : activeTab === 'receive' ? 'Receive Stock' : 'Move Stock';
  const qtyIsValid = Boolean(looseItemModal.qty) && Number(looseItemModal.qty) > 0;

  return (
    <Modal
      as="form"
      onSubmit={onSubmit}
      onClose={onClose}
      title={title}
      titleId="loose-item-modal-title"
      size="md"
      zIndex={150}
      focusFirst={false}
      restoreFocus={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!qtyIsValid} className="min-w-[128px]">Add to Cart</Button>
        </>
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-base font-semibold text-[var(--text-primary)] break-words">{item.name}</p>
        <span className="text-xs font-mono font-semibold text-[var(--color-accent)] shrink-0">#{item.barcode}</span>
      </div>

      {/* Stock info */}
      <div className="px-3 py-2.5 rounded-md mb-4 flex items-center justify-between text-xs bg-[var(--bg-tertiary)] border border-[var(--border-medium)]">
        <span className="text-[var(--text-secondary)] font-medium">
          {isCheckout ? 'Store Stock' : activeTab === 'transfer' ? 'Warehouse Stock' : (isWarehouseDisabled ? 'Current Store Stock' : 'Current Warehouse')}:
        </span>
        <span className="font-bold text-[var(--text-primary)] tabular-nums">
          {isCheckout || (activeTab === 'receive' && isWarehouseDisabled) ? `${availableStore} kg` : `${availableWhse} kg`}
        </span>
      </div>

      <Input
        id="loose-qty"
        label={isCheckout && isLooseKg ? 'Enter Quantity in Grams (g)' : `Enter Quantity (${item.unit || 'PCS'})`}
        size="lg"
        type="number"
        step={isCheckout && isLooseKg ? '1' : 'any'}
        min="0"
        autoFocus
        value={looseItemModal.qty}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setLooseItemModal({ ...looseItemModal, qty: (isNaN(v) || v < 0) ? '' : e.target.value });
        }}
        placeholder={isCheckout && isLooseKg ? 'e.g. 50, 100, 250' : '0'}
        suffix={isCheckout && isLooseKg ? 'g' : String(item.unit || 'PCS').toLowerCase()}
      />

      {/* Quick gram presets during checkout */}
      {isCheckout && isLooseKg && (
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {[50, 100, 250, 500, 1000].map(presetGrams => {
            const isSelected = looseItemModal.qty === String(presetGrams);
            return (
              <button
                key={presetGrams}
                type="button"
                onClick={() => setLooseItemModal({ ...looseItemModal, qty: String(presetGrams) })}
                aria-pressed={isSelected}
                className={`h-8 px-3 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${isSelected
                  ? 'bg-[var(--color-accent-bg)] border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'bg-[var(--bg-tertiary)] border-[var(--border-medium)] text-[var(--text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'}`}
              >
                {presetGrams >= 1000 ? `${presetGrams / 1000} kg` : `${presetGrams}g`}
              </button>
            );
          })}
        </div>
      )}

      {/* Live price in checkout */}
      {isCheckout && isLooseKg && qtyIsValid && (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-accent)]/30 bg-[var(--color-accent-bg)] text-xs flex flex-col gap-1">
          <div className="flex justify-between font-medium text-[var(--text-secondary)]">
            <span>Equivalent weight:</span>
            <span className="font-bold text-[var(--text-primary)] tabular-nums">{(Number(looseItemModal.qty) / 1000).toFixed(3)} kg</span>
          </div>
          <div className="flex justify-between font-medium text-[var(--text-secondary)]">
            <span>Rate:</span>
            <span className="tabular-nums">₹{formatINR(ratePerKg, 2)} / kg</span>
          </div>
          <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[var(--border-light)] text-[var(--color-accent)]">
            <span>Total Price:</span>
            <span className="tabular-nums">₹{formatINR(((Number(looseItemModal.qty) / 1000) * ratePerKg), 2)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
