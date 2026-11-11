import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabaseClient', () => ({ supabase: { from: vi.fn() } }));

import { describeLogChange } from '../OwnerAuditLogs';

describe('Audit log: one readable line per entry', () => {
  it('sale (JSON): quantity, unit, price and discount in one sentence', () => {
    const d = describeLogChange('SALE', '{"quantity":3,"location":"Store","price":450,"discountPct":5}', 'PCS');
    expect(d.summary).toBe('Sold 3 pcs at ₹450.00 each (5% off)');
    expect(d.details).toEqual(['Quantity: 3 pcs', 'Location: Store', 'Price: ₹450.00', 'Discount: 5%']);
  });

  it('stock in and transfer (JSON)', () => {
    expect(describeLogChange('STOCK IN', '{"quantity":200,"location":"Warehouse"}', 'FT').summary).toBe('Received 200 ft into Warehouse');
    expect(describeLogChange('TRANSFER', '{"quantity":5,"location":"Store"}', 'PCS').summary).toBe('Moved 5 pcs (Store)');
  });

  it('showroom dispatch lines read as dispatches, not sales', () => {
    expect(describeLogChange('SHOWROOM', '{"quantity":3,"price":855}', 'PCS').summary).toBe('Sent 3 pcs to the showroom at ₹855.00 each');
    const bill = 'Sent 2 item(s) to the showroom · value ₹2,565.00 · Kamakshi Studios';
    expect(describeLogChange('SHOWROOM', bill).summary).toBe(bill);
  });

  it('catalog item created: short line, rest as details', () => {
    const d = describeLogChange('CREATE', 'Item: Door Hinge | Category: Hardware | Sub-Category: Hinges | Unit: PCS');
    expect(d.summary).toBe('Added to catalog');
    expect(d.details).toEqual(['Category: Hardware', 'Sub-Category: Hinges', 'Unit: PCS']);
  });

  it('CSV import and batch creation', () => {
    expect(describeLogChange('CREATE', 'Bulk Imported CSV Item: Pipe | Category: Pipes').summary).toBe('Imported from CSV');
    const d = describeLogChange('CREATE', 'Created Batch #2 | Wholesaler: Acme | Cost: ₹15.00 | MSP: ₹20.00 | MRP: ₹25.00');
    expect(d.summary).toBe('Created Batch #2');
    expect(d.details).toHaveLength(4);
  });

  it('plain sentences are shown as they are, without a details link', () => {
    const text = 'Expense: ₹120.00 (CASH, Food) for "Tea" (General)';
    expect(describeLogChange('EXPENSE', text)).toEqual({ summary: text, details: [] });
    expect(describeLogChange('SCRAP', 'Scrapped 10 FT from Batch 1 (store) — offcuts').details).toEqual([]);
  });

  it('JSON list and empty values', () => {
    const d = describeLogChange('UPDATE', '["Store Stock: 5 -> 7","MSP: 20 -> 22"]');
    expect(d.summary).toBe('Store Stock: 5 -> 7 (+1 more)');
    expect(d.details).toHaveLength(2);
    expect(describeLogChange('UPDATE', '').summary).toBe('—');
    expect(describeLogChange('UPDATE', null).summary).toBe('—');
  });

  it('broken JSON falls back to the text itself', () => {
    expect(describeLogChange('SALE', '{not json').summary).toBe('{not json');
  });
});
