// Dashboard chart and "When customers come" figures: every bill lands in exactly one bar,
// screws stay out, and patterns are only shown when there is enough data to trust them.
import { describe, it, expect } from 'vitest';
import {
  billPoints, hourlyBuckets, dailyBuckets, buildInsights, insightWindow, resolveSelection,
  weekStartOf, hourRangeLabel, INSIGHT_MIN_BILLS,
} from '../services/salesAnalytics';

const at = (isoDate, h, m = 0) => new Date(`${isoDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();
const sum = (bars) => Math.round(bars.reduce((s, b) => s + b.value, 0) * 100) / 100;

describe('per-bill figures', () => {
  it('leaves screws out of revenue and profit, and falls back to the bill when it has no lines', () => {
    const bills = [
      { id: 'a', created_at: at('2026-11-10', 10), total_amount: 999 },
      { id: 'b', created_at: at('2026-11-10', 11), total_amount: 300, total_profit: 75 },
    ];
    const items = [
      { bill_id: 'a', barcode: '1', price_at_sale: 100, billable_quantity: 2, quantity: 2, cost_allocated: 120, profit: 80 },
      { bill_id: 'a', barcode: 'SCREWS', name: 'Screws', price_at_sale: 50, quantity: 1, profit: 50 },
      { bill_id: 'a', barcode: '2', price_at_sale: 10.5, quantity: 3, cost_at_sale: 5 }, // profit worked out: 31.5 - 15
    ];
    const [a, b] = billPoints(bills, items);
    expect(a).toMatchObject({ id: 'a', rev: 231.5, profit: 96.5 });
    expect(b).toMatchObject({ id: 'b', rev: 300, profit: 75 });
  });
});

describe('chart bars', () => {
  const points = [
    { t: new Date(at('2026-11-12', 7, 30)).getTime(), rev: 100, profit: 10 },   // before 8 AM
    { t: new Date(at('2026-11-12', 9, 15)).getTime(), rev: 200, profit: 20 },
    { t: new Date(at('2026-11-12', 9, 45)).getTime(), rev: 50, profit: -5 },
    { t: new Date(at('2026-11-12', 22, 40)).getTime(), rev: 300, profit: 30 },  // after 10 PM
    { t: new Date(at('2026-11-14', 12, 0)).getTime(), rev: 40, profit: 4 },
  ];

  it('one bar per hour; early and late sales get their own hour instead of being lumped in', () => {
    const bars = hourlyBuckets(points.slice(0, 4), 'rev');
    expect(bars[0]).toMatchObject({ label: '7a', fullLabel: '7–8 AM', value: 100 });
    expect(bars.find(b => b.fullLabel === '9–10 AM').value).toBe(250);
    expect(bars.find(b => b.fullLabel === '8–9 AM').value).toBe(0);
    expect(bars[bars.length - 1]).toMatchObject({ fullLabel: '10–11 PM', value: 300 });
    expect(sum(bars)).toBe(650);
    expect(hourlyBuckets(points.slice(0, 4), 'profit').find(b => b.fullLabel === '9–10 AM').value).toBe(15);
  });

  it('shows 8 AM to 9 PM when every sale is inside those hours', () => {
    const bars = hourlyBuckets([points[1]], 'rev');
    expect(bars[0].fullLabel).toBe('8–9 AM');
    expect(bars[bars.length - 1].fullLabel).toBe('8–9 PM');
  });

  it('the week of a day: Monday to Sunday, the chosen day highlighted, days after today marked', () => {
    const bars = dailyBuckets(points, 'rev', '2026-11-09', '2026-11-15', '2026-11-14', '2026-11-12');
    expect(bars.map(b => b.label)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    expect(bars[3]).toMatchObject({ value: 650, highlight: true });
    expect(bars[5]).toMatchObject({ value: 40, future: false });
    expect(bars[6]).toMatchObject({ value: 0, future: true });
  });

  it('long ranges are grouped by week and still add up to the same total', () => {
    const many = Array.from({ length: 60 }, (_, i) => {
      const d = new Date('2026-09-01T10:00:00'); d.setDate(d.getDate() + i);
      return { t: d.getTime(), rev: 10, profit: 1 };
    });
    const bars = dailyBuckets(many, 'rev', '2026-09-01', '2026-10-30');
    expect(bars).toHaveLength(9);
    expect(sum(bars)).toBe(600);
  });
});

describe('date filter meaning', () => {
  const now = new Date('2026-11-14T16:00:00'); // a Saturday

  it('a single day loads its whole week (never past today); today follows the clock', () => {
    expect(weekStartOf('2026-11-14')).toBe('2026-11-09');
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16');
    const sel = resolveSelection('today', '2026-11-01', null, null, now);
    expect(sel).toMatchObject({ kind: 'day', day: '2026-11-14', isToday: true, weekStart: '2026-11-09', weekEnd: '2026-11-15', loadStart: '2026-11-09', loadEnd: '2026-11-14' });
    expect(resolveSelection('date', '2026-11-04', null, null, now)).toMatchObject({ day: '2026-11-04', isToday: false, loadStart: '2026-11-02', loadEnd: '2026-11-08' });
  });

  it('a range is put in order and never reaches past today', () => {
    expect(resolveSelection('range', null, '2026-11-20', '2026-11-01', now)).toMatchObject({ kind: 'range', start: '2026-11-01', end: '2026-11-14' });
  });
});

describe('when customers come', () => {
  const win = { startIso: '2026-10-17', endIso: '2026-11-13' }; // 4 full weeks

  it('uses the last 4 full weeks, ending yesterday', () => {
    expect(insightWindow(new Date('2026-11-14T16:00:00'))).toEqual(win);
    expect(hourRangeLabel(11)).toBe('11 AM–12 PM');
  });

  it('says there is not enough data instead of guessing', () => {
    const few = Array.from({ length: INSIGHT_MIN_BILLS - 1 }, (_, i) => ({ t: new Date(at('2026-10-20', 10, i)).getTime(), rev: 100 }));
    const res = buildInsights(few, win);
    expect(res.enough).toBe(false);
    expect(res).toMatchObject({ bills: 19, openDays: 1 });
  });

  it('finds the busiest hour and day from real averages; sales outside the window are ignored', () => {
    const points = [];
    // Every day for 4 weeks: 1 customer at 10 AM and 3 at 6 PM; closed on Sundays
    for (let i = 0; i < 28; i++) {
      const d = new Date('2026-10-17T00:00:00'); d.setDate(d.getDate() + i);
      if (d.getDay() === 0) continue;
      const iso = d.toLocaleDateString('en-CA');
      points.push({ t: new Date(at(iso, 10)).getTime(), rev: 100 });
      for (let k = 0; k < 3; k++) points.push({ t: new Date(at(iso, 18, k * 10)).getTime(), rev: 50 });
      // Saturdays are busier: 4 extra customers at 4 PM
      if (d.getDay() === 6) for (let k = 0; k < 4; k++) points.push({ t: new Date(at(iso, 16, k)).getTime(), rev: 25 });
    }
    points.push({ t: new Date(at('2026-11-14', 12)).getTime(), rev: 9999 }); // today: not in the window

    const res = buildInsights(points, win);
    expect(res.enough).toBe(true);
    expect(res.openDays).toBe(24);
    expect(res.bills).toBe(24 * 4 + 4 * 4);
    expect(res.peakHour).toMatchObject({ hour: 18, count: 72, avg: 3 });
    expect(res.hours[0].hour).toBe(10);
    expect(res.hours[res.hours.length - 1].hour).toBe(18);
    expect(res.peakDay).toMatchObject({ name: 'Saturday', count: 32, avg: 8, avgRev: 350 });
    expect(res.quietDay).toMatchObject({ name: 'Sunday', count: 0, avg: 0 });
    expect(res.days.map(d => d.label)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    expect(res.avgSalePerCustomer).toBeCloseTo((24 * 250 + 16 * 25) / 112, 6);
  });
});
