import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// 1. Modals
import {
  CheckoutModal,
  SelectBatchModal,
  LooseItemModal,
  CutLengthModal,
  ManualInstanceBarcodeModal
} from '../components/terminal';

// 2. Direct ESC/POS Thermal Printing Service
import {
  buildEscPosReceipt,
  isWebSerialSupported,
  isWebUsbSupported,
  isDirectEscPosSupported,
  getThermalPrinterStatus
} from '../services/escpos';

// 3. Realtime Terminal Stock Broadcasting Service
import {
  getTerminalId,
  broadcastStockUpdate,
  subscribeToStockUpdates
} from '../services/realtimeStock';

// Mocks
vi.mock('../services/db', () => ({
  getInventoryItemByBarcode: vi.fn(),
  saveInventoryBatch: vi.fn().mockResolvedValue(true)
}));

vi.mock('../supabaseClient', () => {
  const listeners = [];
  const mockChannel = {
    on: vi.fn((type, config, callback) => {
      listeners.push({ type, config, callback });
      return mockChannel;
    }),
    subscribe: vi.fn(() => mockChannel),
    send: vi.fn().mockResolvedValue(true)
  };
  return {
    supabase: {
      channel: vi.fn(() => mockChannel),
      removeChannel: vi.fn()
    },
    __listeners: listeners
  };
});

describe('4. Code Architecture & Performance Optimizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  describe('Part 1: Decomposed Terminal Modals', () => {
    describe('CheckoutModal', () => {
      it('renders payment method options and tender pills correctly', () => {
        const setCheckoutModal = vi.fn();
        const onComplete = vi.fn();
        const mockModalState = {
          isOpen: true,
          cashGiven: '',
          negotiatedTotal: '',
          paymentMethod: 'CASH',
          splitUpi: '',
          splitCash: '',
          customerName: '',
          customerPhone: '',
          error: ''
        };

        const getQuickTenderOptions = (total) => [
          { label: `Exact (₹${total})`, value: total, isExact: true },
          { label: '₹500', value: 500 }
        ];

        render(
          <CheckoutModal
            isOpen={true}
            onClose={vi.fn()}
            checkoutModal={mockModalState}
            setCheckoutModal={setCheckoutModal}
            activeTotal={450}
            cartTotal={450}
            minPossibleTotal={300}
            userRole="worker"
            cashierName="cashier1"
            isCheckingOut={false}
            onCompleteTransaction={onComplete}
            getQuickTenderOptions={getQuickTenderOptions}
          />
        );

        expect(screen.getByText('Checkout Payment')).toBeDefined();
        expect(screen.getByText('₹450.00')).toBeDefined();
        expect(screen.getByText('Exact (₹450)')).toBeDefined();
        expect(screen.getByText('₹500')).toBeDefined();
        expect(screen.getByText('Cash')).toBeDefined();
        expect(screen.getByText('UPI')).toBeDefined();
      });

      it('shows warning when negotiated total is below minPossibleTotal for workers', () => {
        const mockModalState = {
          isOpen: true,
          cashGiven: '',
          negotiatedTotal: '200',
          paymentMethod: 'CASH',
          splitUpi: '',
          splitCash: '',
          error: ''
        };

        render(
          <CheckoutModal
            isOpen={true}
            onClose={vi.fn()}
            checkoutModal={mockModalState}
            setCheckoutModal={vi.fn()}
            activeTotal={200}
            cartTotal={500}
            minPossibleTotal={350} // 200 < 350
            userRole="worker"
            cashierName="cashier1"
            isCheckingOut={false}
            onCompleteTransaction={vi.fn()}
            getQuickTenderOptions={() => []}
          />
        );

        expect(screen.getByText(/Cannot discount below minimum selling limit/)).toBeDefined();
      });
    });

    describe('LooseItemModal', () => {
      it('calculates equivalent kg and price correctly for gram inputs', () => {
        const mockItem = {
          barcode: '5001',
          name: 'Steel Nails Loose',
          is_loose_item: true,
          unit: 'KG',
          price: 120, // 120 per kg
          stock_store: 25
        };

        const mockState = {
          isOpen: true,
          item: mockItem,
          qty: '250' // 250 grams
        };

        render(
          <LooseItemModal
            isOpen={true}
            looseItemModal={mockState}
            setLooseItemModal={vi.fn()}
            activeTab="checkout"
            isWarehouseDisabled={false}
            onSubmit={vi.fn()}
            onClose={vi.fn()}
          />
        );

        // 250g = 0.250 kg @ 120/kg = 30.00
        expect(screen.getByText('0.250 kg')).toBeDefined();
        expect(screen.getByText('₹120.00 / kg')).toBeDefined();
        expect(screen.getByText('₹30.00')).toBeDefined();
      });
    });

    describe('CutLengthModal', () => {
      it('detects remnant scrap when remaining length is less than 1 unit', () => {
        const mockItem = {
          barcode: '6001',
          name: 'Finolex Submersible Cable 3 Core',
          unit: 'm'
        };

        const mockInstance = {
          instance_barcode: '6001-01',
          current_length: '10' // 10 meters available
        };

        const mockState = {
          isOpen: true,
          item: mockItem,
          instance: mockInstance,
          cutQty: '9.4', // cutting 9.4 -> 0.6m left (< 1m scrap)
          discardScrap: true
        };

        render(
          <CutLengthModal
            isOpen={true}
            cutLengthModal={mockState}
            setCutLengthModal={vi.fn()}
            cart={[]}
            onSubmit={vi.fn()}
            onClose={vi.fn()}
          />
        );

        expect(screen.getByText(/Only 0.60 m left. Discard remaining scrap\?/)).toBeDefined();
      });
    });
  });

  describe('Part 2: Direct ESC/POS Raw Thermal Printing', () => {
    it('generates proper binary ESC/POS bytecode structure', () => {
      const receiptData = {
        id: '12345',
        date: new Date('2026-10-22T10:00:00'),
        paymentMethod: 'CASH',
        cashAmount: '500',
        total: 420,
        items: [
          {
            name: 'PVC Elbow 1 inch',
            quantity: 3,
            unit: 'PCS',
            finalRate: 40,
            lineTotal: 120
          },
          {
            name: 'Brass Bib Tap Heavy',
            quantity: 1,
            unit: 'PCS',
            finalRate: 300,
            lineTotal: 300
          }
        ]
      };

      const shopSettings = {
        shop_name: 'Metro Hardware Stores',
        phone: '9845012345',
        shop_address: '100 Ring Road, Bengaluru',
        gstin: '29ABCDE1234F1Z5'
      };

      const bytes = buildEscPosReceipt(receiptData, shopSettings, {
        charsPerLine: 32,
        openDrawer: true,
        cutPaper: true
      });

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(100);

      // Verify ESC/POS initialization byte sequence: ESC @ -> [0x1B, 0x40]
      expect(bytes[0]).toBe(0x1B);
      expect(bytes[1]).toBe(0x40);

      // Verify Cash Drawer Kick Pulse was included: ESC p 0 25 250 -> [0x1B, 0x70, 0x00, 0x19, 0xFA]
      expect(bytes[2]).toBe(0x1B);
      expect(bytes[3]).toBe(0x70);
      expect(bytes[4]).toBe(0x00);
      expect(bytes[5]).toBe(0x19);
      expect(bytes[6]).toBe(0xFA);

      // Decode the ASCII text portion to verify content
      const decodedText = new TextDecoder().decode(bytes);
      expect(decodedText).toContain('Metro Hardware Stores');
      expect(decodedText).toContain('100 Ring Road, Bengaluru');
      expect(decodedText).toContain('Bill No: #12345');
      expect(decodedText).toContain('PVC Elbow 1 inch');
      expect(decodedText).toContain('Brass Bib Tap Heavy');
      expect(decodedText).toContain('TOTAL: Rs.420.00');
      expect(decodedText).toContain('Cash Tendered: Rs.500.00');
      expect(decodedText).toContain('Change Returned: Rs.80.00');
      expect(decodedText).toContain('THANK YOU FOR YOUR BUSINESS!');

      // Verify Paper Cut command at the end: GS V 65 3 -> [0x1D, 0x56, 0x41, 0x03]
      const len = bytes.length;
      expect(bytes[len - 4]).toBe(0x1D);
      expect(bytes[len - 3]).toBe(0x56);
      expect(bytes[len - 2]).toBe(0x41);
      expect(bytes[len - 1]).toBe(0x03);
    });

    it('reports thermal printer connection status correctly', () => {
      const status = getThermalPrinterStatus();
      expect(status).toHaveProperty('isConnected');
      expect(status.isConnected).toBe(false);
    });
  });

  describe('Part 3: Realtime Terminal Stock Broadcasting', () => {
    it('persists a unique terminal ID in sessionStorage for the session', () => {
      const term1 = getTerminalId();
      expect(term1).toMatch(/^term_/);

      const term2 = getTerminalId();
      expect(term2).toBe(term1); // Must be stable within same tab session
    });

    it('suppresses self-echo and ignores updates sent by the current terminal', async () => {
      const onUpdate = vi.fn();
      const currentTermId = getTerminalId();

      const sub = subscribeToStockUpdates({
        shopId: 'shop_123',
        onStockUpdate: onUpdate
      });

      // Find the broadcast listener registered with supabase channel
      const { supabase } = await import('../supabaseClient');
      const channelMock = supabase.channel('pos_stock_shop_123');
      const onCall = channelMock.on.mock.calls.find(c => c[0] === 'broadcast');
      const handler = onCall[2];

      // Simulate broadcast sent from SELF
      await handler({
        payload: {
          senderTerminalId: currentTermId,
          shopId: 'shop_123',
          type: 'checkout',
          items: [{ barcode: '7001', quantity: 2 }]
        }
      });

      // Self-echo should be discarded, onUpdate not called
      expect(onUpdate).not.toHaveBeenCalled();

      sub.unsubscribe();
    });

    it('enforces multi-store isolation and ignores updates from another shop', async () => {
      const onUpdate = vi.fn();

      const sub = subscribeToStockUpdates({
        shopId: 'shop_alpha',
        onStockUpdate: onUpdate
      });

      const { supabase } = await import('../supabaseClient');
      const channelMock = supabase.channel('pos_stock_shop_alpha');
      const onCall = channelMock.on.mock.calls.find(c => c[0] === 'broadcast');
      const handler = onCall[2];

      // Simulate broadcast from ANOTHER SHOP
      await handler({
        payload: {
          senderTerminalId: 'term_other_cashier',
          shopId: 'shop_beta', // Different shop!
          type: 'checkout',
          items: [{ barcode: '7001', quantity: 1 }]
        }
      });

      expect(onUpdate).not.toHaveBeenCalled();
      sub.unsubscribe();
    });

    it('detects cart conflict when a peer terminal sells an item currently in cashier cart', async () => {
      const onConflict = vi.fn();
      const { getInventoryItemByBarcode } = await import('../services/db');
      getInventoryItemByBarcode.mockResolvedValue({
        barcode: '8001',
        name: 'Brass Ball Valve 1/2 inch',
        stock_store: 2, // Only 2 remaining
        unit: 'PCS'
      });

      const sub = subscribeToStockUpdates({
        shopId: 'shop_123',
        getCartItems: () => [{ barcode: '8001', name: 'Brass Ball Valve 1/2 inch', quantity: 3 }], // In cart: 3 units
        onCartConflict: onConflict
      });

      const { supabase } = await import('../supabaseClient');
      const channelMock = supabase.channel('pos_stock_shop_123');
      const onCall = channelMock.on.mock.calls.find(c => c[0] === 'broadcast');
      const handler = onCall[2];

      // Another terminal completes checkout of 1 unit
      await handler({
        payload: {
          senderTerminalId: 'term_peer_pos',
          shopId: 'shop_123',
          type: 'checkout',
          items: [{ barcode: '8001', quantity: 1 }]
        }
      });

      // Conflict should be triggered because cart has 3, but remaining store stock dropped to 1
      expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({
        item: expect.objectContaining({ barcode: '8001' }),
        remainingStoreStock: 1
      }));

      sub.unsubscribe();
    });

    it('handles offline mode gracefully without attempting to broadcast', async () => {
      const origOnLine = navigator.onLine;
      try {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        const res = await broadcastStockUpdate({
          type: 'checkout',
          items: [{ barcode: '9999', quantity: 1 }]
        });
        expect(res).toBe(false);
      } finally {
        Object.defineProperty(navigator, 'onLine', { value: origOnLine, configurable: true });
      }
    });

    it('returns false when items array is empty or undefined', async () => {
      const res1 = await broadcastStockUpdate({ items: [] });
      const res2 = await broadcastStockUpdate({ items: null });
      expect(res1).toBe(false);
      expect(res2).toBe(false);
    });

    it('successfully broadcasts stock updates when online', async () => {
      const res = await broadcastStockUpdate({
        type: 'checkout',
        items: [{ barcode: '1234', quantity: 2, name: 'Sample Item' }],
        shopId: 'shop_xyz'
      });
      expect(res).toBe(true);
    });
  });

  describe('Part 4: Edge Cases & Robustness', () => {
    it('buildEscPosReceipt handles empty receipt, null items, and undefined shop settings without error', () => {
      expect(() => {
        const bytes = buildEscPosReceipt(null, null, { openDrawer: false, cutPaper: false });
        expect(bytes).toBeInstanceOf(Uint8Array);
      }).not.toThrow();

      expect(() => {
        const bytes = buildEscPosReceipt({
          items: [
            { name: null, quantity: null, finalRate: null, lineTotal: null }
          ]
        }, {});
        expect(bytes).toBeInstanceOf(Uint8Array);
      }).not.toThrow();
    });

    it('buildEscPosReceipt properly formats 48-column rolls for 80mm printers', () => {
      const bytes = buildEscPosReceipt({
        id: '80MM-001',
        total: 100,
        items: [
          { name: 'Wide Item Name For 80mm Paper', quantity: 2, unit: 'PCS', finalRate: 50, lineTotal: 100 }
        ]
      }, { shop_name: 'Superstore' }, { charsPerLine: 48 });

      const decoded = new TextDecoder().decode(bytes);
      expect(decoded).toContain('ITEM                     QTY     RATE    AMOUNT');
      expect(decoded).toContain('Wide Item Name For 80mm ');
    });

    it('evaluates browser capability checks properly', () => {
      // In happy-dom / node environment
      expect(typeof isDirectEscPosSupported()).toBe('boolean');
      expect(typeof isWebSerialSupported()).toBe('boolean');
      expect(typeof isWebUsbSupported()).toBe('boolean');
    });
  });
});
