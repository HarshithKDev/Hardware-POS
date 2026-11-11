import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, TableSkeleton, table } from '../ui';
import { computeDayClosing, fetchDayClosingData } from '../../services/dayClosing';
import { formatINR, formatDayHeader, formatDateTime } from '../../utils';
import { logActivity } from '../../services/auditLog';

const rupees = (n) => `₹${formatINR(Number(n) || 0, 2)}`;
const storageKey = (shopId, day) => `pos_day_closing_${shopId || 'shop'}_${day}`;

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 80 mm receipt-style HTML for the thermal printer (or any printer). */
export function buildPrintHtml(r, { shopName, day }) {
  const line = (label, value, bold = false) =>
    `<div class="row${bold ? ' b' : ''}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
  const cashierRows = r.byCashier.map((c) => line(`${c.name} (${c.count})`, rupees(c.total))).join('');
  const diff = r.difference === null ? '' : line(r.difference === 0 ? 'Difference' : r.difference < 0 ? 'SHORT by' : 'EXCESS by', rupees(Math.abs(r.difference)), true);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Day closing ${escapeHtml(day)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0 auto; color: #000; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
  .c { text-align: center; } .muted { font-size: 11px; }
  .row { display: flex; justify-content: space-between; gap: 6px; margin: 2px 0; }
  .b { font-weight: bold; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  h2 { font-size: 12px; margin: 6px 0 2px; text-transform: uppercase; }
</style></head><body>
<h1>${escapeHtml(shopName || 'Day Closing')}</h1>
<div class="c b">DAY CLOSING REPORT</div>
<div class="c muted">${escapeHtml(formatDayHeader(day))}</div>
<div class="c muted">Printed ${escapeHtml(formatDateTime(new Date()).full)}</div>
<hr>
<h2>Sales</h2>
${line(`Bills (${r.sales.count})`, rupees(r.sales.total), true)}
${line('Cash', rupees(r.sales.cash))}
${line('UPI', rupees(r.sales.upi))}
${r.fullyReturned.count ? line(`Fully returned bills (${r.fullyReturned.count})`, rupees(r.fullyReturned.value)) : ''}
${r.showroom.count ? line(`Showroom dispatches (${r.showroom.count})`, rupees(r.showroom.value)) : ''}
<h2>Returns today</h2>
${line(`Refunds (${r.returns.count})`, rupees(r.returns.cash + r.returns.upi))}
${line(' of which for earlier days', rupees(r.returns.earlierCash + r.returns.earlierUpi))}
<h2>Expenses</h2>
${line(`Total (${r.expenses.count})`, rupees(r.expenses.total))}
${line('Paid in cash', rupees(r.expenses.cash + r.expenses.unspecified))}
<hr>
<h2>Cash drawer</h2>
${line('Opening cash', rupees(r.openingCash))}
${line('+ Cash sales', rupees(r.sales.cash))}
${line('- Cash refunds (earlier days)', rupees(r.returns.earlierCash))}
${line('- Cash expenses', rupees(r.expenses.cash + r.expenses.unspecified))}
${line('= Expected cash', rupees(r.expectedCash), true)}
${r.countedCash === null ? '' : line('Counted cash', rupees(r.countedCash))}
${diff}
${line('Expected UPI (net)', rupees(r.expectedUpi))}
${cashierRows ? `<hr><h2>By cashier</h2>${cashierRows}` : ''}
<hr><div class="c muted">Signature: ____________________</div>
</body></html>`;
}

function printHtml(html) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } finally {
      setTimeout(() => iframe.remove(), 2000);
    }
  }, 250);
}

const Line = ({ label, value, sign, muted = false }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5">
    <span className={`text-sm ${muted ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'}`}>{label}</span>
    <span className="text-sm font-semibold tabular-nums whitespace-nowrap text-[var(--text-primary)]">
      {sign && <span className="mr-1 text-[var(--text-tertiary)]">{sign}</span>}{value}
    </span>
  </div>
);

const Stat = ({ label, value, sub }) => (
  <div className="flex-1 min-w-[150px] px-4 py-3">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{label}</p>
    <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">{value}</p>
    {sub && <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{sub}</p>}
  </div>
);

/**
 * End-of-day summary for the owner: sales by payment method, returns, expenses,
 * showroom dispatches, the cash that should be in the drawer, and a per-cashier split.
 * Opening and counted cash are typed in and kept on this device for that day.
 */
export default function DayClosingModal({ isOpen, onClose, day, shopId, shopName }) {
  const key = storageKey(shopId, day);
  const [opening, setOpening] = useState('');
  const [counted, setCounted] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      setOpening(saved.opening ?? '');
      setCounted(saved.counted ?? '');
    } catch { setOpening(''); setCounted(''); }
  }, [isOpen, key]);

  useEffect(() => {
    if (!isOpen) return;
    try { localStorage.setItem(key, JSON.stringify({ opening, counted })); } catch { /* ignore */ }
  }, [isOpen, key, opening, counted]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['dayClosing', shopId, day],
    queryFn: () => fetchDayClosingData(shopId, day),
    enabled: isOpen && !!day,
    staleTime: 30 * 1000,
  });

  const report = useMemo(() => (data ? computeDayClosing({
    ...data,
    openingCash: opening === '' ? 0 : Number(opening),
    countedCash: counted === '' ? null : Number(counted),
  }) : null), [data, opening, counted]);

  if (!isOpen) return null;

  const diff = report?.difference;
  const diffTone = diff === null || diff === undefined ? undefined : Math.abs(diff) < 0.5 ? 'var(--color-success)' : 'var(--color-warning)';
  const diffLabel = diff === null || diff === undefined ? 'Enter the counted cash' : Math.abs(diff) < 0.5 ? 'Matches' : diff < 0 ? `Short by ${rupees(-diff)}` : `Excess ${rupees(diff)}`;

  return (
    <Modal
      onClose={onClose}
      title="Day Closing Report"
      subtitle={formatDayHeader(day)}
      titleId="day-closing-title"
      size="lg"
      zIndex={100}
      footer={(
        <>
          <span className="mr-auto text-xs text-[var(--text-tertiary)] hidden sm:inline">Amounts you type are saved on this device for this day.</span>
          <Button variant="ghost" onClick={() => refetch()} loading={isFetching && !isLoading}>Refresh</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            disabled={!report}
            onClick={() => {
              logActivity({
                action: 'DAY CLOSING',
                itemName: `Day closing ${formatDayHeader(day)}`,
                changes: `Sales ${rupees(report.sales.total)} (cash ${rupees(report.sales.cash)}, UPI ${rupees(report.sales.upi)}) | Expected cash ${rupees(report.expectedCash)}`
                  + (report.countedCash === null ? '' : ` | Counted ${rupees(report.countedCash)} | ${Math.abs(report.difference) < 0.5 ? 'Matches' : report.difference < 0 ? `Short ${rupees(-report.difference)}` : `Excess ${rupees(report.difference)}`}`),
              });
              printHtml(buildPrintHtml(report, { shopName, day }));
            }}
          >
            Print
          </Button>
        </>
      )}
    >
      {isLoading ? (
        <TableSkeleton rows={8} cols={3} label="Loading the day's figures…" />
      ) : error ? (
        <p className="py-10 text-center text-sm font-semibold" style={{ color: 'var(--color-error)' }}>
          Could not load the day's figures: {error.message}
        </p>
      ) : report && (
        <div className="flex flex-col gap-5">
          {/* 1. Sales at a glance */}
          <div className="flex flex-wrap divide-x divide-[var(--border-light)] rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-primary)]">
            <Stat label="Total sales" value={rupees(report.sales.total)} sub={`${report.sales.count} ${report.sales.count === 1 ? 'bill' : 'bills'}`} />
            <Stat label="Cash" value={rupees(report.sales.cash)} />
            <Stat label="UPI" value={rupees(report.sales.upi)} />
          </div>

          {/* 2. Cash drawer check */}
          <section className="rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-primary)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-light)]">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">Cash drawer check</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="p-4 flex flex-col gap-4 md:border-r border-[var(--border-light)]">
                <Input id="closing-opening" label="Opening cash (morning)" prefix="₹" type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
                <Input id="closing-counted" label="Cash counted now" prefix="₹" type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={counted} onChange={(e) => setCounted(e.target.value)} />
              </div>
              <div className="p-4 flex flex-col">
                <Line label="Opening cash" value={rupees(report.openingCash)} />
                <Line label="Cash sales" sign="+" value={rupees(report.sales.cash)} />
                {report.returns.earlierCash > 0 && <Line label="Cash refunds (earlier days' bills)" sign="−" value={rupees(report.returns.earlierCash)} />}
                {(report.expenses.cash + report.expenses.unspecified) > 0 && <Line label="Expenses paid in cash" sign="−" value={rupees(report.expenses.cash + report.expenses.unspecified)} />}
                <div className="mt-2 pt-3 border-t border-[var(--border-light)] flex items-baseline justify-between gap-4">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Should be in drawer</span>
                  <span className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">{rupees(report.expectedCash)}</span>
                </div>
                <div
                  className="mt-3 rounded-md px-3 py-2.5 text-sm font-semibold text-center"
                  style={diff === null || diff === undefined
                    ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }
                    : { backgroundColor: Math.abs(diff) < 0.5 ? 'var(--color-success-bg)' : 'var(--color-warning-bg)', color: diffTone }}
                  role="status"
                >
                  {diff === null || diff === undefined ? 'Enter the cash counted now to check the drawer' : Math.abs(diff) < 0.5 ? '✓ Drawer matches' : diffLabel}
                </div>
              </div>
            </div>
          </section>

          {/* 3. Other figures (only what happened) */}
          {(report.returns.count > 0 || report.expenses.count > 0 || report.showroom.count > 0 || report.fullyReturned.count > 0 || report.returns.earlierUpi > 0) && (
            <section className="rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-2">
              {report.expenses.count > 0 && <Line label={`Expenses (${report.expenses.count})`} value={rupees(report.expenses.total)} />}
              {report.returns.count > 0 && <Line label={`Returns refunded today (${report.returns.count})`} value={rupees(report.returns.cash + report.returns.upi)} />}
              {report.fullyReturned.count > 0 && <Line label={`Bills fully returned (${report.fullyReturned.count})`} value={rupees(report.fullyReturned.value)} />}
              {report.showroom.count > 0 && <Line label={`Sent to showroom (${report.showroom.count}) · not a sale`} value={rupees(report.showroom.value)} />}
              {(report.returns.earlierUpi > 0 || report.expenses.upi > 0) && <Line label="UPI to check in bank (after refunds and UPI expenses)" value={rupees(report.expectedUpi)} />}
            </section>
          )}

          {/* 4. By cashier */}
          {report.byCashier.length > 1 && (
            <div className={table.wrap}>
              <table className={table.table}>
                <thead className={table.thead}>
                  <tr>
                    <th className={table.th}>Cashier</th>
                    <th className={table.th}>Bills</th>
                    <th className={table.th}>Cash</th>
                    <th className={table.th}>UPI</th>
                    <th className={table.th}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byCashier.map((c) => (
                    <tr key={c.name} className={table.tr}>
                      <td className={`${table.td} capitalize`}>{c.name}</td>
                      <td className={table.num}>{c.count}</td>
                      <td className={table.num}>{rupees(c.cash)}</td>
                      <td className={table.num}>{rupees(c.upi)}</td>
                      <td className={`${table.num} font-semibold`}>{rupees(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
