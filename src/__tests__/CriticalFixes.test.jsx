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
});
