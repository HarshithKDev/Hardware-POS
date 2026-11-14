// Inventory "Edit Selected": only real changes to real product columns are saved.
import { describe, it, expect } from 'vitest';
import { productEditChanges } from '../services/productEdit';

const item = (over = {}) => ({
  barcode: '1001', name: 'Door Hinge', category: 'Hardware', sub_category: 'Hinges', cost_price: 60,
  stock_store: 4, stock_warehouse: 0,
  batches: [{ batch_id: 'b1', is_active: true, stock_store: 10, purchase_cost: 60 }],
  ...over,
});

describe('productEditChanges', () => {
  it('sends only the changed fields, never the batch list or stock totals', () => {
    const original = item();
    const res = productEditChanges(original, { ...original, name: ' Steel Hinge ', category: 'Fittings', sub_category: '' });
    expect(res.changes).toEqual({ name: 'Steel Hinge', category: 'Fittings', sub_category: null });
    expect(res.changes).not.toHaveProperty('batches');
    expect(res.error).toBeNull();
    expect(productEditChanges(original, { ...original }).changes).toEqual({});
  });

  it('a new cost goes to the only batch; with several batches each keeps its own cost', () => {
    const one = item();
    expect(productEditChanges(one, { ...one, cost_price: '65' })).toMatchObject({
      changes: { cost_price: 65 }, batchCost: { batch_id: 'b1', purchase_cost: 65 }, costKeptOnBatches: false,
    });
    const two = item({ batches: [{ batch_id: 'b1', purchase_cost: 60 }, { batch_id: 'b2', purchase_cost: 70 }] });
    expect(productEditChanges(two, { ...two, cost_price: '65' })).toMatchObject({
      changes: { cost_price: 65 }, batchCost: null, costKeptOnBatches: true,
    });
  });

  it('stock is ignored for items with batches and saved for items without', () => {
    const withBatches = item();
    expect(productEditChanges(withBatches, { ...withBatches, stock_store: '99' }).changes).toEqual({});
    const noBatches = item({ batches: [] });
    expect(productEditChanges(noBatches, { ...noBatches, stock_store: '7' }).changes).toEqual({ stock_store: 7 });
  });

  it('refuses an empty name, a negative cost or negative stock', () => {
    const original = item({ batches: [] });
    expect(productEditChanges(original, { ...original, name: '  ' }).error).toMatch(/name cannot be empty/);
    expect(productEditChanges(original, { ...original, cost_price: '-1' }).error).toMatch(/cost price/);
    expect(productEditChanges(original, { ...original, stock_store: '-2' }).error).toMatch(/negative/);
  });
});
