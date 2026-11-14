// Dashboard chart figures: every bill lands in exactly one bar and screws stay out.
import { describe, it, expect } from 'vitest';
import {
  billPoints, hourlyBuckets, dailyBuckets, resolveSelection, weekStartOf, hourRangeLabel, compactINR,
} from '../services/salesAnalytics';

const at = (isoDate, h, m = 0) => new Date(`${isoDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();
const sum = (bars) => Math.round(bars.reduce((s, b) => s + b.value, 0) * 100) / 100;

describe('per-bill figures', () => {
  it('revenue is what the customer paid minus screws, so Revenue + Screws = money received', () => {
    // 3 items listed ₹1,000 each, negotiated to ₹2,000 for all three: the app spreads that as
    // ₹666.67 each (lines add up to ₹2,000.01). Plus ₹50 of screws. Customer paid ₹2,050.
    const bills = [{ id: 'a', created_at: at('2026-11-10', 10), total_amount: 2050 }];
    const items = [
      { bill_id: 'a', barcode: '1', price_at_sale: 666.67, billable_quantity: 3, quantity: 3, system_price: 1000, cost_allocated: 1500, profit: 500.01 },
      { bill_id: 'a', barcode: 'SCREWS', name: 'Screws', price_at_sale: 50, quantity: 1, profit: 50 },
    ];
    const [a] = billPoints(bills, items);
    expect(a.rev).toBe(2000);        // not 2,000.01
    expect(a.screws).toBe(50);
    expect(a.rev + a.screws).toBe(2050);
    expect(a.profit).toBe(500);      // the paise round-off comes off profit too
    expect(a.listed).toBe(3000);     // discount given = 3,000 - 2,000
  });

  it('works out line profit when it was not stored, and falls back to the bill when it has no lines', () => {
    const bills = [
      { id: 'a', created_at: at('2026-11-10', 10), total_amount: 31.5 },
      { id: 'b', created_at: at('2026-11-10', 11), total_amount: 300, total_profit: 75 },
    ];
    const items = [{ bill_id: 'a', barcode: '2', price_at_sale: 10.5, quantity: 3, cost_at_sale: 5 }];
    const [a, b] = billPoints(bills, items);
    expect(a).toMatchObject({ rev: 31.5, profit: 16.5, screws: 0 });
    expect(b).toMatchObject({ rev: 300, profit: 75 });
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
    expect(hourRangeLabel(11)).toBe('11 AM–12 PM');
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

describe('bar labels', () => {
  it('never show more than was sold', () => {
    expect(compactINR(10830.01)).toBe('₹10.8k');
    expect(compactINR(9999)).toBe('₹9.9k');
    expect(compactINR(15000)).toBe('₹15k');
    expect(compactINR(2190)).toBe('₹2.1k');
    expect(compactINR(865)).toBe('₹865');
    expect(compactINR(125000)).toBe('₹1.2L');
  });
});
