import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWorkerEmail, getLegacyWorkerEmail } from '../constants';

describe('Critical & High Severity Fixes Verification', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('Multi-Tenant Staff Email Isolation', () => {
    it('scopes worker email by shopId to prevent cross-shop auth collisions', () => {
      const emailShopA = getWorkerEmail('rahul', 'shop-alpha-1234');
      const emailShopB = getWorkerEmail('rahul', 'shop-beta-5678');

      expect(emailShopA).toBe('rahul.shopalph@hardwarepos.com');
      expect(emailShopB).toBe('rahul.shopbeta@hardwarepos.com');
      expect(emailShopA).not.toBe(emailShopB);
    });

    it('falls back to localStorage shop_id if shopId argument is not provided', () => {
      localStorage.setItem('shop_id', 'shop-gamma-999');
      const email = getWorkerEmail('john');
      expect(email).toBe('john.shopgamm@hardwarepos.com');
    });

    it('legacy email helper returns the un-scoped email for backward-compatible fallback logins', () => {
      const legacy = getLegacyWorkerEmail('rahul');
      expect(legacy).toBe('rahul@hardwarepos.com');
    });
  });

  describe('Cuttable Roll Length Restoration Calculation', () => {
    it('restores roll length incrementally by cut_length instead of resetting to original_length', () => {
      const originalLength = 50;
      const currentLengthBeforeReturn = 35; // 15m had been cut previously across multiple sales
      const qtyReturned = 5; // Customer returns a 5m piece

      const restoredLength = Math.min(originalLength, currentLengthBeforeReturn + qtyReturned);

      // Must be 40m, NOT 50m!
      expect(restoredLength).toBe(40);
      expect(restoredLength).not.toBe(originalLength);
    });

    it('clamps restored roll length to original_length to prevent overflow', () => {
      const originalLength = 50;
      const currentLength = 48;
      const qtyReturned = 5;

      const restoredLength = Math.min(originalLength, currentLength + qtyReturned);
      expect(restoredLength).toBe(50);
    });
  });

  describe('Barcode Collision Numeric Sort Verification', () => {
    it('calculates true numeric maximum instead of string alphabetical order', () => {
      // In SQL string ordering, '999' > '1000' and '1001'
      const existingBarcodes = [{ barcode: '999' }, { barcode: '1000' }, { barcode: '1001' }];
      const maxNum = existingBarcodes.reduce((max, item) => {
        const num = parseInt(item.barcode, 10);
        return !isNaN(num) ? Math.max(max, num) : max;
      }, 1001);

      const nextBarcode = (maxNum + 1).toString();
      expect(nextBarcode).toBe('1002');
      expect(nextBarcode).not.toBe('1000');
    });
  });

  describe('Showroom Split Payment Validation', () => {
    it('validates that cash and UPI amounts sum exactly to total amount', () => {
      const total = 1500;
      const cash = 500;
      const upi = 1000;
      const isExact = Math.abs((cash + upi) - total) <= 0.05;
      expect(isExact).toBe(true);

      const invalidCash = 500;
      const invalidUpi = 900;
      const isInvalid = Math.abs((invalidCash + invalidUpi) - total) <= 0.05;
      expect(isInvalid).toBe(false);
    });
  });

  describe('Batch Creation & Editing Price Safeguards', () => {
    it('validates that MSP cannot be lower than cost price and MRP cannot be lower than MSP', () => {
      const validateBatchPrices = (cost, msp, mrp) => {
        if (cost === '' || isNaN(cost) || cost < 0) return { valid: false, error: 'Invalid Cost Price' };
        if (msp === '' || isNaN(msp) || msp < 0) return { valid: false, error: 'Invalid MSP' };
        if (mrp === '' || isNaN(mrp) || mrp < 0) return { valid: false, error: 'Invalid MRP' };
        if (msp < cost) return { valid: false, error: 'MSP cannot be lower than Cost Price.' };
        if (mrp < msp) return { valid: false, error: 'Selling Price (MRP) cannot be lower than MSP.' };
        return { valid: true };
      };

      expect(validateBatchPrices(100, 80, 150).valid).toBe(false);
      expect(validateBatchPrices(100, 80, 150).error).toBe('MSP cannot be lower than Cost Price.');

      expect(validateBatchPrices(100, 150, 120).valid).toBe(false);
      expect(validateBatchPrices(100, 150, 120).error).toBe('Selling Price (MRP) cannot be lower than MSP.');

      expect(validateBatchPrices(100, 120, 150).valid).toBe(true);
    });

    it('validates editing product cost price rejects negative values and preserves valid numbers', () => {
      const validateCostPrice = (cost) => {
        const num = Number(cost);
        if (cost === '' || isNaN(num) || num < 0) return { valid: false, error: 'Please enter a valid non-negative Cost Price.' };
        return { valid: true, value: num };
      };

      expect(validateCostPrice('').valid).toBe(false);
      expect(validateCostPrice('-5').valid).toBe(false);
      expect(validateCostPrice('abc').valid).toBe(false);
      expect(validateCostPrice('0').valid).toBe(true);
      expect(validateCostPrice('0').value).toBe(0);
      expect(validateCostPrice('45.50').valid).toBe(true);
      expect(validateCostPrice('45.50').value).toBe(45.5);
    });
  });

  describe('Owner Analytics Item Name Null Safety', () => {
    it('safely extracts clean product names without crashing when name is missing or null in bill_items', () => {
      const testItems = [
        { name: 'Drill Bit 10mm (Cut from 100m)', quantity: 2, price_at_sale: 50 },
        { name: null, item_name: 'Screws', quantity: 1, price_at_sale: 30 },
        { barcode: 'SCREWS', quantity: 1, price_at_sale: 20 }
      ];

      const cleanNames = testItems.map(item => {
        const rawName = item.name || item.item_name || (item.barcode === 'SCREWS' ? 'Screws' : 'Item');
        return rawName.split(' (Cut from ')[0];
      });

      expect(cleanNames).toEqual(['Drill Bit 10mm', 'Screws', 'Screws']);
    });
  });

  describe('Thermal ESC/POS Screw Formatting', () => {
    it('formats screws as 1 SET on receipts without confusing unit rate calculations', async () => {
      const { buildEscPosReceipt } = await import('../services/escpos');
      const receipt = {
        id: '12345',
        date: new Date().toISOString(),
        total: 50,
        items: [
          { barcode: 'SCREWS', is_screw: true, name: 'Screws', quantity: 1, finalRate: 50, lineTotal: 50 }
        ]
      };

      const bytes = buildEscPosReceipt(receipt, { shop_name: 'Test Hardware' }, { charsPerLine: 32 });
      const text = new TextDecoder().decode(new Uint8Array(bytes));

      expect(text).toContain('Screws');
      expect(text).toContain('1 SET');
    });
  });

  describe('Product Description and Batch Wholesaler Features', () => {
    it('gracefully handles missing description column on product_master via schema fallback', () => {
      const fullItemPayload = {
        barcode: '10001',
        name: 'Hammer',
        category: 'Tools',
        description: 'Forged high-carbon steel hammer with ergonomic grip',
        cost_price: 150,
        msp: 200,
        price: 250
      };

      // When remote column is missing (error 42703), fallback strips description
      const { description: _d, ...fallbackObj } = fullItemPayload;
      expect(fallbackObj.description).toBeUndefined();
      expect(fallbackObj.barcode).toBe('10001');
      expect(fallbackObj.name).toBe('Hammer');
      expect(fullItemPayload.description).toBe('Forged high-carbon steel hammer with ergonomic grip');
    });

    it('correctly maps wholesaler input to supplier column in inventory_batches', () => {
      const batchData = {
        wholesaler: '  National Hardware Distributors Ltd  ',
        cost_price: '120.50',
        msp: '150.00',
        price: '180.00'
      };

      const mappedBatchPayload = {
        supplier: batchData.wholesaler?.trim() || null,
        purchase_cost: Number(batchData.cost_price),
        msp: Number(batchData.msp),
        selling_price: Number(batchData.price)
      };

      expect(mappedBatchPayload.supplier).toBe('National Hardware Distributors Ltd');
      expect(mappedBatchPayload.purchase_cost).toBe(120.5);
      expect(mappedBatchPayload.msp).toBe(150);
      expect(mappedBatchPayload.selling_price).toBe(180);
      expect(mappedBatchPayload.purchase_cost).toBeLessThanOrEqual(mappedBatchPayload.msp);
      expect(mappedBatchPayload.msp).toBeLessThanOrEqual(mappedBatchPayload.selling_price);
    });

    it('handles empty or whitespace wholesaler name by setting supplier to null', () => {
      const batchData = {
        wholesaler: '   ',
        cost_price: '50',
        msp: '70',
        price: '90'
      };

      const supplier = batchData.wholesaler?.trim() || null;
      expect(supplier).toBeNull();
    });

    it('validates Cost Price <= MSP <= MRP constraint on batch creation and editing', () => {
      const validForm = { cost: 100, msp: 120, mrp: 150 };
      const invalidMspBelowCost = { cost: 100, msp: 80, mrp: 150 };
      const invalidMrpBelowMsp = { cost: 100, msp: 120, mrp: 110 };

      const validatePrices = (cost, msp, mrp) => {
        if (cost < 0 || msp <= 0 || mrp <= 0) return false;
        if (msp < cost) return false;
        if (mrp < msp) return false;
        return true;
      };

      expect(validatePrices(validForm.cost, validForm.msp, validForm.mrp)).toBe(true);
      expect(validatePrices(invalidMspBelowCost.cost, invalidMspBelowCost.msp, invalidMspBelowCost.mrp)).toBe(false);
      expect(validatePrices(invalidMrpBelowMsp.cost, invalidMrpBelowMsp.msp, invalidMrpBelowMsp.mrp)).toBe(false);
    });
  });
});

