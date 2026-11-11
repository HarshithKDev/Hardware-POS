import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabaseClient', () => ({ supabase: { from: vi.fn() } }));

import { computeDayClosing, billPaymentSplit } from '../services/dayClosing';

const bill = (id, total, method, extra = {}) => ({ id, total_amount: total, payment_method: method, status: 'completed', location: 'Store', cashier_name: 'Raju', ...extra });

describe('Day closing report', () => {
  it('splits cash/UPI per bill, with fallbacks for older bills', () => {
    expect(billPaymentSplit(bill('a', 500, 'CASH'))).toEqual({ cash: 500, upi: 0 });
    expect(billPaymentSplit(bill('b', 300, 'UPI'))).toEqual({ cash: 0, upi: 300 });
    expect(billPaymentSplit(bill('c', 1000, 'SPLIT', { upi_amount: 400 }))).toEqual({ cash: 600, upi: 400 });
    expect(billPaymentSplit(bill('d', 1000, 'SPLIT', { cash_amount: 250, upi_amount: 750 }))).toEqual({ cash: 250, upi: 750 });
  });

  it('totals sales, expenses and the expected cash in the drawer', () => {
    const r = computeDayClosing({
      bills: [bill('a', 500, 'CASH'), bill('b', 300, 'UPI'), bill('c', 1000, 'SPLIT', { cash_amount: 600, upi_amount: 400, cashier_name: 'Durjay' })],
      expenses: [{ amount: 120, payment_mode: 'CASH' }, { amount: 200, payment_mode: 'UPI' }],
      openingCash: 2000,
      countedCash: 2950,
    });
    expect(r.sales).toEqual({ count: 3, total: 1800, cash: 1100, upi: 700 });
    expect(r.expenses.cash).toBe(120);
    expect(r.expectedCash).toBe(2000 + 1100 - 120);
    expect(r.expectedUpi).toBe(700 - 200);
    expect(r.difference).toBe(2950 - 2980);
    expect(r.byCashier.map((c) => c.name)).toEqual(['Durjay', 'Raju']);
  });

  it('refunds on today\'s bills are already netted; refunds on earlier bills leave the drawer today', () => {
    const r = computeDayClosing({
      // bill a was 500 and had 100 returned today (already reduced to 400 in the database)
      bills: [bill('a', 400, 'CASH', { cash_amount: 400 })],
      returns: [
        { original_bill_id: 'a', refund_method: 'CASH', refund_amount: 100 },
        { original_bill_id: 'old-1', refund_method: 'CASH', refund_amount: 250 },
        { original_bill_id: 'old-2', refund_method: 'UPI', refund_amount: 80 },
      ],
      openingCash: 1000,
    });
    expect(r.sales.cash).toBe(400);
    expect(r.returns).toMatchObject({ count: 3, cash: 350, upi: 80, earlierCount: 2, earlierCash: 250, earlierUpi: 80 });
    expect(r.expectedCash).toBe(1000 + 400 - 250);
    expect(r.expectedUpi).toBe(0 - 80);
    expect(r.difference).toBeNull();
  });

  it('keeps fully returned bills and showroom dispatches out of sales', () => {
    const r = computeDayClosing({
      bills: [
        bill('a', 500, 'CASH'),
        bill('v', 700, 'CASH', { status: 'voided' }),
        bill('s', 3000, 'SHOWROOM', { status: 'showroom' }),
        bill('w', 900, null, { location: 'Warehouse-Inbound' }),
      ],
      returns: [{ original_bill_id: 'v', refund_method: 'CASH', refund_amount: 700 }],
    });
    expect(r.sales).toEqual({ count: 1, total: 500, cash: 500, upi: 0 });
    expect(r.fullyReturned).toEqual({ count: 1, value: 700 });
    expect(r.showroom).toEqual({ count: 1, value: 3000 });
    // the voided bill was today's, so its refund does not reduce the drawer again
    expect(r.returns.earlierCash).toBe(0);
    expect(r.expectedCash).toBe(500);
  });

  it('expenses without a payment mode are counted as cash', () => {
    const r = computeDayClosing({ expenses: [{ amount: 50 }, { amount: 70, payment_mode: '' }] });
    expect(r.expenses.unspecified).toBe(120);
    expect(r.expectedCash).toBe(-120);
  });
});
