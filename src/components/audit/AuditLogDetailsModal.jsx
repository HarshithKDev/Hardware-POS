import { Modal, Button } from '../ui';
import { formatINR } from '../../utils';

const hasValue = (v) => v !== null && v !== undefined && v !== '' && v !== '---';

/** "Label: value" lines → definition list (same format the log details have always used). */
function DetailList({ details }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-left">
      {details.map((part, i) => {
        const idx = part.indexOf(': ');
        const label = idx > 0 ? part.slice(0, idx) : '';
        const value = idx > 0 ? part.slice(idx + 2) : part;
        return (
          <div key={i} className="min-w-0 text-sm">
            {label && <dt className="text-xs text-[var(--text-secondary)]">{label}</dt>}
            <dd className="break-words text-[var(--text-primary)] font-medium">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function ItemTable({ items, total }) {
  return (
    <div className="rounded-lg border border-[var(--border-medium)] overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-tertiary)] text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
          <tr>
            <th className="p-2.5 text-left font-semibold">Item</th>
            <th className="p-2.5 text-center font-semibold hidden sm:table-cell">Barcode</th>
            <th className="p-2.5 text-right font-semibold">Qty</th>
            <th className="p-2.5 text-right font-semibold">Price</th>
            <th className="p-2.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-t border-[var(--border-light)]">
              <td className="p-2.5 text-left text-[var(--text-primary)] font-medium break-words min-w-[7rem]">
                {it.name}
                {it.barcode && <span className="block sm:hidden text-xs font-semibold text-[var(--color-accent)] tabular-nums">{it.barcode}</span>}
              </td>
              <td className="p-2.5 text-center text-[var(--color-accent)] font-semibold tabular-nums hidden sm:table-cell">{it.barcode || '—'}</td>
              {it.qty === null ? (
                <td colSpan={3} className="p-2.5 text-right text-[var(--text-secondary)]">{it.note || '—'}</td>
              ) : (
                <>
                  <td className="p-2.5 text-right tabular-nums whitespace-nowrap">{it.qty}{it.unit ? <span className="text-[var(--text-secondary)] text-xs"> {String(it.unit).toLowerCase()}</span> : null}</td>
                  <td className="p-2.5 text-right tabular-nums whitespace-nowrap">₹{formatINR(it.price, 2)}</td>
                  <td className="p-2.5 text-right tabular-nums whitespace-nowrap font-semibold">₹{formatINR(it.total, 2)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
        {total !== null && total !== undefined && (
          <tfoot>
            <tr className="border-t border-[var(--border-medium)] bg-[var(--bg-tertiary)]">
              <td colSpan={4} className="p-2.5 text-right hidden sm:table-cell text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Items total</td>
              <td colSpan={3} className="p-2.5 text-right text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] sm:hidden">Items total</td>
              <td className="p-2.5 text-right tabular-nums whitespace-nowrap font-bold">₹{formatINR(total, 2)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Everything recorded for one audit log row. Opened by clicking a row in Audit Logs.
 * Sales and showroom dispatches (merged rows) show their items as a table.
 */
export default function AuditLogDetailsModal({ log, badgeStyle, actionLabel, onClose }) {
  if (!log) return null;
  const items = log.items || [];
  const details = log.details || [];
  const single = items.length === 0;

  const facts = [
    ['Date & time', log.date],
    ['User', log.performed_by],
    ['Reference', log.reference],
    single && hasValue(log.barcode) && !['CATEGORY', 'SUB-CATEGORY'].includes(log.barcode) ? ['Barcode', log.barcode] : null,
    single ? ['Item', log.item_name] : null,
  ].filter((f) => f && hasValue(f[1]));

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={actionLabel}
      subtitle={`${log.date} · ${log.performed_by}`}
      titleId="audit-log-details-title"
      size="lg"
      closeOnBackdrop
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-sm shrink-0" style={{ backgroundColor: badgeStyle?.bg, color: badgeStyle?.text }}>
            {String(log.action_type || '').replace(/_/g, ' ')}
          </span>
          <p className="text-base font-semibold text-[var(--text-primary)] break-words">{log.summary && log.summary !== '—' ? log.summary : (log.item_name || '—')}</p>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0 text-sm">
              <dt className="text-xs text-[var(--text-secondary)]">{label}</dt>
              <dd className="break-words font-medium text-[var(--text-primary)]">{value}</dd>
            </div>
          ))}
        </dl>

        {items.length > 0 ? (
          <ItemTable items={items} total={log.itemsTotal} />
        ) : details.length > 0 ? (
          <div className="pt-3 border-t border-[var(--border-light)]">
            <DetailList details={details} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
