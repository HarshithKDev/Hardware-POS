import { describe, it, expect } from 'vitest';
import { buildTransactionItems } from '../services/transactionPayload';

const pipeLine = (extra = {}) => ({
  barcode: '1402', name: 'PVC Pipe', unit: 'FT', is_cuttable: true, batch_id: 'b1',
  quantity: 200, actual_quantity: 200, billableQuantity: 200,
  price: '25.00', selling_price: '25.00', customPriceInput: '25.00', msp_price: '20.00', purchase_cost: '15.00',
  ...extra,
});

describe('Cut-length items are sent as totals', () => {
  it('receive: 200 ft is sent as one 200 ft length (shape the DB function already accepts)', () => {
    const [row] = buildTransactionItems([pipeLine()], 'receive');
    expect(row).toMatchObject({ actual_quantity: 200, billable_quantity: 200, num_rolls: 1, default_length: 200, default_width: null, cut_length: null, discard_scrap: false });
  });

  it('receive mesh: total sqft with width 1, so rolls × length × width = total', () => {
    const [row] = buildTransactionItems([pipeLine({ unit: 'SQFT', quantity: 450, actual_quantity: 450, billableQuantity: 450 })], 'receive');
    expect(row.num_rolls * row.default_length * row.default_width).toBe(450);
    expect(row.actual_quantity).toBe(450);
  });

  it('sale: 30 ft deducts 30 ft', () => {
    const [row] = buildTransactionItems([pipeLine({ quantity: 30, actual_quantity: 30, billableQuantity: 30 })], 'checkout');
    expect(row).toMatchObject({ actual_quantity: 30, billable_quantity: 30, num_rolls: null, cut_length: 30 });
  });

  it('sale of an old product with a 12 ft default length keeps a valid cut length', () => {
    const [row] = buildTransactionItems([pipeLine({ quantity: 30, actual_quantity: 30, billableQuantity: 30, default_length: 12 })], 'checkout');
    expect(row.actual_quantity).toBe(30);
    expect(row.cut_length).toBe(12);
  });

  it('transfer sends the total, not pieces × length', () => {
    const [row] = buildTransactionItems([pipeLine({ quantity: 50, actual_quantity: 50, billableQuantity: 50, default_length: 12 })], 'transfer');
    expect(row.actual_quantity).toBe(50);
    expect(row.num_rolls).toBeNull();
  });
});

describe('Normal items are unchanged', () => {
  it('sends quantity and prices', () => {
    const [row] = buildTransactionItems([{ barcode: '1001', name: 'Hinge', unit: 'PCS', quantity: 3, price: 10, selling_price: 10, customPriceInput: '9.50' }], 'checkout');
    expect(row).toMatchObject({ actual_quantity: 3, billable_quantity: 3, final_price: 9.5, system_price: 10, cut_length: null, num_rolls: null });
  });

  it('excludes screws (saved separately)', () => {
    expect(buildTransactionItems([{ barcode: 'SCREWS', is_screw: true, quantity: 1 }], 'checkout')).toEqual([]);
  });
});
