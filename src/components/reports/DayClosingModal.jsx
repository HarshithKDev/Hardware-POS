import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, TableSkeleton, table } from '../ui';
import { computeDayClosing, fetchDayClosingData } from '../../services/dayClosing';
import { formatINR, formatDayHeader, formatDateTime } from '../../utils';

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

const Row = ({ label, value, strong = false, tone, hint }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <span className={`text-sm ${strong ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
      {label}
      {hint && <span className="block text-xs text-[var(--text-tertiary)]">{hint}</span>}
    </span>
    <span className={`tabular-nums whitespace-nowrap ${strong ? 'text-base font-bold' : 'text-sm font-semibold'}`} style={{ color: tone || 'var(--text-primary)' }}>{value}</span>
  </div>
);

const Section = ({ title, children }) => (
  <section className="rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-primary)] p-4">
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">{title}</h4>
    {children}
  </section>
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
      size="xl"
      zIndex={100}
      footer={(
        <>
          <Button variant="ghost" onClick={() => refetch()} loading={isFetching && !isLoading}>Refresh</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!report} onClick={() => printHtml(buildPrintHtml(report, { shopName, day }))}>Print</Button>
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
        <div className="flex flex-col gap-4">
          {/* Headline figures */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: `Sales (${report.sales.count} bills)`, value: report.sales.total },
              { label: 'Cash sales', value: report.sales.cash },
              { label: 'UPI sales', value: report.sales.upi },
              { label: `Expenses (${report.expenses.count})`, value: report.expenses.total },
            ].map((c) => (
              <div key={c.label} className="rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-primary)] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{c.label}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">{rupees(c.value)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Drawer */}
            <Section title="Cash drawer">
              <div className="grid grid-cols-2 gap-3 mb-2">
                <Input id="closing-opening" label="Opening cash" prefix="₹" type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
                <Input id="closing-counted" label="Counted cash" prefix="₹" type="number" min="0" step="any" inputMode="decimal" placeholder="Count the drawer" value={counted} onChange={(e) => setCounted(e.target.value)} />
              </div>
              <Row label="Opening cash" value={rupees(report.openingCash)} />
              <Row label="+ Cash sales" value={rupees(report.sales.cash)} hint="Already net of returns on today's bills" />
              <Row label="− Cash refunds for earlier days' bills" value={rupees(report.returns.earlierCash)} />
              <Row label="− Expenses paid in cash" value={rupees(report.expenses.cash + report.expenses.unspecified)} hint={report.expenses.unspecified > 0 ? `Includes ${rupees(report.expenses.unspecified)} with no payment mode recorded` : undefined} />
              <div className="border-t border-[var(--border-light)] mt-1 pt-1">
                <Row label="Expected cash in drawer" value={rupees(report.expectedCash)} strong />
                {report.countedCash !== null && <Row label="Counted cash" value={rupees(report.countedCash)} />}
                <Row label="Difference" value={diffLabel} strong tone={diffTone} />
              </div>
            </Section>

            {/* UPI, returns, other */}
            <Section title="UPI, returns and other">
              <Row label="UPI sales" value={rupees(report.sales.upi)} />
              <Row label="− UPI refunds for earlier days' bills" value={rupees(report.returns.earlierUpi)} />
              <Row label="− Expenses paid by UPI / other" value={rupees(report.expenses.upi)} />
              <div className="border-t border-[var(--border-light)] mt-1 pt-1 mb-2">
                <Row label="Expected UPI received (net)" value={rupees(report.expectedUpi)} strong />
              </div>
              <Row
                label={`Returns processed today (${report.returns.count})`}
                value={rupees(report.returns.cash + report.returns.upi)}
                hint={report.returnsAvailable ? 'Refunds on today\'s bills are already taken off today\'s sales' : 'Return records are not available'}
              />
              {report.fullyReturned.count > 0 && <Row label={`Bills fully returned (${report.fullyReturned.count})`} value={rupees(report.fullyReturned.value)} />}
              <Row label={`Showroom dispatches (${report.showroom.count})`} value={rupees(report.showroom.value)} hint="Stock moved to the showroom, not a sale" />
            </Section>
          </div>

          {/* By cashier */}
          {report.byCashier.length > 0 && (
            <div className={table.wrap}>
              <table className={table.table}>
                <thead className={table.thead}>
                  <tr>
                    <th className={table.th}>Cashier</th>
                    <th className={table.th}>Bills</th>
                    <th className={table.th}>Total</th>
                    <th className={table.th}>Cash</th>
                    <th className={table.th}>UPI</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byCashier.map((c) => (
                    <tr key={c.name} className={table.tr}>
                      <td className={`${table.td} capitalize`}>{c.name}</td>
                      <td className={table.num}>{c.count}</td>
                      <td className={`${table.num} font-semibold`}>{rupees(c.total)}</td>
                      <td className={table.num}>{rupees(c.cash)}</td>
                      <td className={table.num}>{rupees(c.upi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-[var(--text-tertiary)]">
            Opening and counted cash are saved on this device for this day. Figures update when you press Refresh.
          </p>
        </div>
      )}
    </Modal>
  );
}
