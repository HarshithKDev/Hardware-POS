import { describe, it, expect } from 'vitest';
import { groupTransactionLogs } from '../services/auditGrouping';

const T1 = '2026-11-11T09:58:12.123456+00:00';
const T2 = '2026-11-11T10:05:00.000001+00:00';
const line = (id, action, barcode, name, qty, price, at = T1, by = 'Mary') => ({
  id: `audit-${id}`, created_at: at, action_type: action, barcode, item_name: name, performed_by: by,
  rawChanges: JSON.stringify({ quantity: qty, price }), summary: `${action} ${name}`, details: [], unit: 'PCS',
});

describe('groupTransactionLogs', () => {
  it('merges a two-item showroom dispatch into one row', () => {
    const out = groupTransactionLogs([
      line(1, 'SHOWROOM', '1057', '10 × 7 shiva', 5, 150),
      line(2, 'SHOWROOM', '1048', '10 × 7 Laxmi', 5, 150),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].action_type).toBe('SHOWROOM');
    expect(out[0].barcodeLabel).toBe('2 items');
    expect(out[0].summary).toBe('Sent 2 item(s) to the showroom · value ₹1,500.00');
    expect(out[0].details).toEqual([
      '10 × 7 shiva: 5 pcs × ₹150.00 = ₹750.00',
      '10 × 7 Laxmi: 5 pcs × ₹150.00 = ₹750.00',
    ]);
  });

  it('uses the server summary row when present and keeps one row per bill', () => {
    const out = groupTransactionLogs([
      { id: 'audit-9', created_at: T1, action_type: 'BILL', barcode: '---', item_name: 'Bill #abcd1234', performed_by: 'Mary', summary: 'Bill ₹320.00 · CASH · 2 item(s)', details: [] },
      line(7, 'SALE', '1201', '2ft Towel Rod', 1, 200),
      line(8, 'SALE', '1304', 'Lamination', 1, 120),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].action_type).toBe('SALE');
    expect(out[0].summary).toBe('Bill ₹320.00 · CASH · 2 item(s)');
    expect(out[0].actions.sort()).toEqual(['BILL', 'SALE']);
    expect(out[0].item_name).toBe('2ft Towel Rod, Lamination');
  });

  it('keeps separate transactions, other actions and single-item sales as they are', () => {
    const logs = [
      line(1, 'SALE', '1226', 'Ayyappa', 1, 200, T1),
      line(2, 'SALE', '1226', 'Ayyappa', 1, 200, T2),
      { id: 'audit-3', created_at: T2, action_type: 'EXPENSE', barcode: '---', item_name: 'Expense', performed_by: 'Mary', summary: 'Tea', details: [] },
      line(4, 'SALE', '1038', 'Stand', 1, 150, T1, 'Durjay'),
    ];
    const out = groupTransactionLogs(logs);
    expect(out).toEqual(logs);
  });
});
