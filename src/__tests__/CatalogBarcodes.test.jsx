import { describe, it, expect, vi, beforeEach } from 'vitest';

let rowsByTable = {};
const rangeCalls = [];
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn((table) => {
      const state = { table, from: 0, to: 0 };
      const b = {
        select: () => b, eq: () => b, order: () => b,
        range: (f, t) => { state.from = f; state.to = t; rangeCalls.push([table, f, t]); return b; },
        then: (res, rej) => Promise.resolve({ data: (rowsByTable[table] || []).slice(state.from, state.to + 1), error: null }).then(res, rej),
      };
      return b;
    }),
  },
}));

import { fetchAllShopBarcodes, nextNumericBarcode } from '../services/catalog';

beforeEach(() => { rowsByTable = {}; rangeCalls.length = 0; });

describe('BI1: barcode lookup is complete beyond 1000 products', () => {
  it('pages through all rows', async () => {
    rowsByTable.product_master = Array.from({ length: 2350 }, (_, i) => ({ barcode: String(1001 + i) }));
    const all = await fetchAllShopBarcodes('shop');
    expect(all).toHaveLength(2350);
    expect(nextNumericBarcode(all)).toBe(String(1001 + 2350));
  });

  it('falls back to the public view when the table returns nothing', async () => {
    rowsByTable.product_master_public = [{ barcode: '1500' }];
    expect(await fetchAllShopBarcodes('shop')).toEqual(['1500']);
  });
});

describe('nextNumericBarcode', () => {
  it('starts at 1001 and ignores non-numeric barcodes', () => {
    expect(nextNumericBarcode([])).toBe('1001');
    expect(nextNumericBarcode(['ABC', '8901234', '1005'])).toBe('8901235');
  });
  it('respects a minimum', () => {
    expect(nextNumericBarcode(['1001'], 1200)).toBe('1200');
  });
});
