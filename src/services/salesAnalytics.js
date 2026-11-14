// Sales figures for the Overview dashboard: per-bill revenue and profit, and chart buckets.
// Everything here is pure (no database), so it can be tested.
//
// Same rules as the Revenue and Profit cards:
//  - screws are tracked in sales history but left out of dashboard revenue and profit;
//  - returns are already applied to the bill (returned lines are removed or reduced, fully
//    returned bills are voided and never loaded), so a sale counts at the time it was made.

export const isScrewItem = (item) => item?.barcode === 'SCREWS' || item?.name === 'Screws' || Boolean(item?.is_screw);

/** Revenue, cost and profit of one bill line (rupees). */
export function lineFigures(item) {
  const qty = Number(item.billable_quantity || item.quantity || 0);
  const price = Number(item.price_at_sale || 0);
  const rev = price * qty;
  const cost = item.cost_allocated !== undefined && item.cost_allocated !== null
    ? Number(item.cost_allocated)
    : Number(item.cost_at_sale || 0) * Number(item.quantity || 0);
  const profit = item.profit !== undefined && item.profit !== null ? Number(item.profit) : rev - cost;
  return { qty, price, rev, cost, profit };
}

/**
 * One point per bill: { t: time in ms, rev, profit } with screws left out.
 * Bills whose lines could not be read fall back to the bill's own total and profit.
 */
export function billPoints(bills, items) {
  const byBill = new Map();
  (items || []).forEach(it => {
    const list = byBill.get(it.bill_id);
    if (list) list.push(it); else byBill.set(it.bill_id, [it]);
  });
  return (bills || []).map(bill => {
    const lines = byBill.get(bill.id);
    let revCents = 0;
    let profitCents = 0;
    if (lines && lines.length > 0) {
      lines.forEach(it => {
        if (isScrewItem(it)) return;
        const f = lineFigures(it);
        revCents += Math.round(f.rev * 100);
        profitCents += Math.round(f.profit * 100);
      });
    } else {
      revCents = Math.round(Number(bill.total_amount || 0) * 100);
      profitCents = Math.round(Number(bill.total_profit || 0) * 100);
    }
    return { id: bill.id, t: new Date(bill.created_at).getTime(), rev: revCents / 100, profit: profitCents / 100 };
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d) => d.toLocaleDateString('en-CA');
const atMidnight = (isoDate) => new Date(`${isoDate}T00:00:00`);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const shortWeekday = (d) => d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
const shortDate = (d) => `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}`;

/** "6 PM" style label for an hour 0-23. */
export function hourLabel(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? 'AM' : 'PM'}`;
}
/** "6–7 PM" style label for the hour starting at h. */
export function hourRangeLabel(h) {
  const end = (h + 1) % 24;
  const sameHalf = (h < 12) === (end < 12) && end !== 0;
  const h12 = (x) => (x % 12 === 0 ? 12 : x % 12);
  return sameHalf ? `${h12(h)}–${h12(end)} ${h < 12 ? 'AM' : 'PM'}` : `${hourLabel(h)}–${hourLabel(end)}`;
}
/** Short axis label: 8a, 12p, 7p */
const hourTick = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;

/** Monday of the week that contains the given date (yyyy-mm-dd). */
export function weekStartOf(isoDate) {
  const d = atMidnight(isoDate);
  const back = (d.getDay() + 6) % 7;
  return iso(addDays(d, -back));
}

/**
 * What the date filter means as dates (yyyy-mm-dd):
 *  - start/end: the period the cards show (one day, or the range);
 *  - loadStart/loadEnd: what to read, which for a single day is that day's whole week
 *    (Monday to Sunday, never past today) so the "By day" chart can show the week around it.
 * "today" follows the clock, so a dashboard left open past midnight moves to the new day.
 */
export function resolveSelection(timeframe, customDate, startDate, endDate, now = new Date()) {
  const todayIso = now.toLocaleDateString('en-CA');
  if (timeframe === 'range') {
    let s = startDate || todayIso;
    let e = endDate || todayIso;
    if (s > e) [s, e] = [e, s];
    if (e > todayIso) e = todayIso;
    if (s > e) s = e;
    return { kind: 'range', start: s, end: e, loadStart: s, loadEnd: e, todayIso };
  }
  let day = timeframe === 'today' ? todayIso : (customDate || todayIso);
  if (day > todayIso) day = todayIso;
  const weekStart = weekStartOf(day);
  const sunday = new Date(`${weekStart}T00:00:00`);
  sunday.setDate(sunday.getDate() + 6);
  const weekEnd = sunday.toLocaleDateString('en-CA');
  return {
    kind: 'day', start: day, end: day, day, isToday: day === todayIso,
    weekStart, weekEnd, loadStart: weekStart, loadEnd: weekEnd < todayIso ? weekEnd : todayIso, todayIso,
  };
}

/**
 * One bar per hour. Shows 8 AM–9 PM by default and widens to any hour that has a sale,
 * so a sale at 7 AM or 10:30 PM is never hidden or counted under another hour.
 */
export function hourlyBuckets(points, metric) {
  const totals = new Array(24).fill(0);
  const has = new Array(24).fill(false);
  points.forEach(p => {
    const h = new Date(p.t).getHours();
    totals[h] += Math.round(p[metric] * 100);
    has[h] = true;
  });
  let first = 8;
  let last = 20;
  has.forEach((v, h) => { if (v) { first = Math.min(first, h); last = Math.max(last, h); } });
  const out = [];
  for (let h = first; h <= last; h++) {
    out.push({ key: `h${h}`, label: hourTick(h), fullLabel: hourRangeLabel(h), value: totals[h] / 100 });
  }
  return out;
}

/**
 * One bar per day from start to end (yyyy-mm-dd), or per week when the span is longer than
 * 31 days. Days after `todayIso` are marked as future (no bar).
 */
export function dailyBuckets(points, metric, startIso, endIso, todayIso, highlightIso) {
  const start = atMidnight(startIso);
  const end = atMidnight(endIso);
  const days = Math.round((end - start) / DAY_MS) + 1;
  const out = [];
  if (days <= 31) {
    const byDay = new Map();
    points.forEach(p => {
      const k = iso(new Date(p.t));
      byDay.set(k, (byDay.get(k) || 0) + Math.round(p[metric] * 100));
    });
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const k = iso(d);
      out.push({
        key: k,
        label: days <= 7 ? shortWeekday(d) : (days <= 14 ? shortDate(d) : String(d.getDate())),
        fullLabel: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        value: (byDay.get(k) || 0) / 100,
        future: Boolean(todayIso && k > todayIso),
        highlight: k === highlightIso,
      });
    }
    return out;
  }
  // Long spans: weeks starting on the first day of the range (the last one may be shorter)
  for (let s = 0; s < days; s += 7) {
    const from = addDays(start, s);
    const to = addDays(start, Math.min(s + 6, days - 1));
    const fromMs = from.getTime();
    const toMs = addDays(to, 1).getTime();
    let cents = 0;
    points.forEach(p => { if (p.t >= fromMs && p.t < toMs) cents += Math.round(p[metric] * 100); });
    out.push({
      key: iso(from),
      label: shortDate(from),
      fullLabel: `${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
      value: cents / 100,
    });
  }
  return out;
}

/** Short rupee label for chart bars: ₹850, ₹2.5k, ₹1.2L */
export function compactINR(n) {
  const v = Number(n) || 0;
  // One decimal, rounded DOWN, so a label never shows more than was sold (₹10,830 -> ₹10.8k)
  const short = (x) => (Math.floor(x * 10) / 10).toFixed(1).replace(/\.0$/, '');
  if (v >= 100000) return `₹${short(v / 100000)}L`;
  if (v >= 1000) return `₹${short(v / 1000)}k`;
  return `₹${Math.round(v)}`;
}
