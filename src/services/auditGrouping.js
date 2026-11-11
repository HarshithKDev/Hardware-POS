import { formatINR } from '../utils';

/**
 * A sale or showroom dispatch writes one audit row per item, plus (since the audit
 * completeness update) one summary row for the whole bill. All of them are written in the
 * same database transaction, so they share exactly the same created_at and performer.
 *
 * This merges those rows into ONE row per transaction so the owner sees a single entry
 * per bill / dispatch, with the items listed in its details. Rows that are not part of a
 * sale or dispatch are returned untouched, in their original order.
 *
 * Each input log needs: id, created_at (raw string), action_type, barcode, item_name,
 * performed_by, summary, details, and optionally rawChanges + unit.
 */
const familyOf = (log) => {
  if (log.action_type === 'SALE' || log.action_type === 'BILL') return 'SALE';
  if (log.action_type === 'SHOWROOM') return 'SHOWROOM';
  return null;
};

const isSummaryRow = (log) =>
  log.action_type === 'BILL' || (log.action_type === 'SHOWROOM' && (!log.barcode || log.barcode === '---'));

function parseLine(log) {
  try {
    const o = JSON.parse(log.rawChanges || '');
    const qty = Number(o.quantity);
    const price = Number(o.price);
    if (Number.isFinite(qty) && Number.isFinite(price)) return { qty, price };
  } catch { /* not JSON */ }
  return null;
}

function mergeGroup(members) {
  const family = familyOf(members[0]);
  const summaryRow = members.find(isSummaryRow);
  const items = members.filter((m) => !isSummaryRow(m));
  const first = members[0];

  let total = 0;
  let totalKnown = items.length > 0;
  const details = items.map((m) => {
    const line = parseLine(m);
    const name = String(m.item_name || m.barcode || 'Item').replace(/: /g, ' - ');
    if (!line) { totalKnown = false; return `${name}: ${m.summary || '—'}`; }
    total += line.qty * line.price;
    const u = m.unit ? ` ${String(m.unit).toLowerCase()}` : '';
    return `${name}: ${line.qty}${u} × ₹${formatINR(line.price, 2)} = ₹${formatINR(line.qty * line.price, 2)}`;
  });

  const n = items.length;
  let summary = summaryRow?.summary;
  if (!summary || summary === '—') {
    const value = totalKnown ? ` · value ₹${formatINR(total, 2)}` : '';
    summary = family === 'SHOWROOM'
      ? `Sent ${n} item(s) to the showroom${value}`
      : `Sold ${n} item(s)${totalKnown ? ` · ₹${formatINR(total, 2)}` : ''}`;
  }

  return {
    ...first,
    id: `txn-${first.id}`,
    action_type: family,
    actions: [...new Set(members.map((m) => m.action_type))],
    barcode: n === 1 ? items[0].barcode : '---',
    barcodeLabel: n > 1 ? `${n} items` : undefined,
    item_name: n === 0 ? summaryRow?.item_name : items.map((m) => m.item_name).join(', '),
    summary,
    // a single item has nothing more to show than the line above
    details: n > 1 ? details : (n === 1 && summaryRow ? details : []),
    grouped: true,
  };
}

export function groupTransactionLogs(logs = []) {
  const groups = new Map();
  const order = [];
  for (const log of logs) {
    const family = familyOf(log);
    if (!family || !log.created_at) { order.push({ single: log }); continue; }
    const key = `${family}|${log.created_at}|${log.performed_by || ''}`;
    let g = groups.get(key);
    if (!g) { g = { members: [] }; groups.set(key, g); order.push(g); }
    g.members.push(log);
  }
  return order.map((entry) => {
    if (entry.single) return entry.single;
    if (entry.members.length === 1) return entry.members[0];
    return mergeGroup(entry.members);
  });
}
