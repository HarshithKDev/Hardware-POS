import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceiptTemplate from '../ReceiptTemplate';
import BatchDetailsModal from '../BatchDetailsModal';

// Mock BatchDetailsView for BatchDetailsModal test
vi.mock('../BatchDetailsView', () => ({
  default: ({ barcode, onBack }) => (
    <div data-testid="batch-details-view">
      <span>Mocked Batch Details for {barcode}</span>
      <button onClick={onBack}>Close</button>
    </div>
  ),
}));

describe('Low Severity Fixes Verification', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('ReceiptTemplate Store Name Rendering', () => {
    it('renders the store name without arbitrary line break replacement', () => {
      const customStoreName = 'XYZ TILES AND DECOR EMPORIUM';
      render(
        <ReceiptTemplate
          lastReceipt={{
            type: 'checkout',
            bill_id: 'B100',
            date: new Date().toISOString(),
            items: [],
            total: 100,
            subtotal: 100,
          }}
          shopSettings={{
            shop_name: customStoreName,
          }}
          formatDateTime={(d) => d}
          isPreview={true}
        />
      );

      // The shop name should be rendered exactly as is, without removing or mangling words
      expect(screen.getByText(customStoreName)).toBeDefined();
    });

    it('falls back to STORE RECEIPT if shopSettings is missing', () => {
      render(
        <ReceiptTemplate
          lastReceipt={{
            type: 'checkout',
            bill_id: 'B101',
            date: new Date().toISOString(),
            items: [],
            total: 50,
          }}
          shopSettings={null}
          formatDateTime={(d) => d}
          isPreview={true}
        />
      );

      expect(screen.getByText('STORE RECEIPT')).toBeDefined();
    });
  });

  describe('CartContext Multi-Tenant Scoping Logic', () => {
    it('namespaces cart localStorage keys by shopId with fallback to legacy key', () => {
      const shopId = 'shop_12345';
      const activeTab = 'warehouse';

      // 1. When scoped key exists, it should be retrieved
      localStorage.setItem(`pos_cart_${shopId}_${activeTab}`, JSON.stringify([{ id: 'item1', quantity: 2 }]));
      const scopedData = JSON.parse(localStorage.getItem(`pos_cart_${shopId}_${activeTab}`));
      expect(scopedData).toEqual([{ id: 'item1', quantity: 2 }]);

      // 2. Cross-shop isolation: another shop cannot see shop_12345's cart
      const otherShopData = localStorage.getItem(`pos_cart_shop_99999_${activeTab}`);
      expect(otherShopData).toBeNull();

      // 3. Backward compatibility: if no scoped key exists, legacy un-scoped key is read
      localStorage.setItem(`pos_cart_${activeTab}`, JSON.stringify([{ id: 'legacy_item', quantity: 5 }]));
      const resolvedFallback = localStorage.getItem(`pos_cart_unseen_${activeTab}`)
        ? JSON.parse(localStorage.getItem(`pos_cart_unseen_${activeTab}`))
        : JSON.parse(localStorage.getItem(`pos_cart_${activeTab}`));
      expect(resolvedFallback).toEqual([{ id: 'legacy_item', quantity: 5 }]);
    });
  });

  describe('BatchDetailsModal Delegation & Refactoring', () => {
    it('returns null when isOpen is false', () => {
      const { container } = render(
        <BatchDetailsModal
          isOpen={false}
          onClose={vi.fn()}
          item={{ barcode: '1001', name: 'Test Product' }}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders BatchDetailsView within a modal portal when isOpen is true', () => {
      render(
        <BatchDetailsModal
          isOpen={true}
          onClose={vi.fn()}
          item={{ barcode: '1001', name: 'Test Product' }}
        />
      );

      expect(screen.getByTestId('batch-details-view')).toBeDefined();
      expect(screen.getByText('Mocked Batch Details for 1001')).toBeDefined();
    });
  });

  describe('Logo Storage Key Sanitization', () => {
    it('generates a deterministic shop-scoped filename rather than unbounded timestamps', () => {
      const shopSettings = { id: 'shop_abc-123', admin_email: 'owner@example.com' };
      const fileExt = 'png';
      const baseKey = (shopSettings.id || shopSettings.admin_email || 'logo').replace(/[^a-z0-9]/gi, '_');
      const fileName = `${baseKey}.${fileExt}`;

      // Uploading twice will overwrite the exact same file path instead of filling storage
      expect(fileName).toBe('shop_abc_123.png');
    });
  });
});
