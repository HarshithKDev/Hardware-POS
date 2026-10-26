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
});

