import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WorkerTerminal from '../WorkerTerminal';
import { CartProvider } from '../contexts/CartContext';
import * as db from '../services/db';
import * as AppContext from '../AppContext';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import '@testing-library/jest-dom';

// Mock dependencies
vi.mock('../services/db', () => ({
  getInventoryItemByBarcode: vi.fn(),
  queueOfflineTransaction: vi.fn(),
  getInventoryByQuery: vi.fn(),
  saveInventoryBatch: vi.fn()
}));
vi.mock('../services/sync', () => ({
  syncInventoryToLocal: vi.fn().mockResolvedValue()
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() }))
}));
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: [] }) })) })),
      delete: vi.fn(() => ({ eq: vi.fn(() => ({ then: vi.fn(() => ({ catch: vi.fn() })) })) }))
    })),
    channel: vi.fn(() => ({
      on: vi.fn(() => ({ subscribe: vi.fn() })),
      subscribe: vi.fn()
    })),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null })
  }
}));

describe('WorkerScanner Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock the useApp context
    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: vi.fn(),
      showConfirm: vi.fn(),
      showToast: vi.fn(),
      alertConfig: { isOpen: false },
      confirmConfig: { isOpen: false },
    });
  });

  const TestWrapper = ({ children }) => (
    <MemoryRouter>
      <CartProvider activeTab="checkout">
        {children}
      </CartProvider>
    </MemoryRouter>
  );

  it('batches rapid-fire scanner inputs into a single line item with correct quantity', async () => {
    // Setup mock item response
    db.getInventoryItemByBarcode.mockResolvedValue({
      barcode: '123456789',
      name: 'Hammer',
      price: 15,
      is_cuttable: false,
      batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 100, selling_price: 15 }]
    });

    render(
      <TestWrapper>
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="John" />
      </TestWrapper>
    );

    // Find the manual barcode input
    const input = await screen.findByPlaceholderText('Search barcode or name...');
    
    // Simulate rapid fire by pasting and submitting 3 times quickly
    fireEvent.change(input, { target: { value: '123456789' } });
    fireEvent.submit(input.closest('form'));
    
    fireEvent.change(input, { target: { value: '123456789' } });
    fireEvent.submit(input.closest('form'));
    
    fireEvent.change(input, { target: { value: '123456789' } });
    fireEvent.submit(input.closest('form'));

    // Wait for state updates
    await waitFor(() => {
      // Total should be 45 (15 * 3) indicating 3 items were batched
      expect(screen.getAllByText('₹45.00').length).toBeGreaterThan(0);
    });
    
    expect(db.getInventoryItemByBarcode).toHaveBeenCalled();
  });

  it('reproduces hardware scanner hyphen replacing previous item when scanning hyphenated barcodes', async () => {
    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1001') {
        return {
          barcode: '1001',
          name: 'Finolex Pipe 1001',
          price: 50,
          is_cuttable: false,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 100, selling_price: 50 }]
        };
      }
      if (barcode === '1002') {
        return {
          barcode: '1002',
          name: 'Supreme Elbow 1002',
          price: 30,
          is_cuttable: false,
          batches: [{ batch_id: 'b2', batch_number: 1, stock_store: 100, selling_price: 30 }]
        };
      }
      return null;
    });

    render(
      <TestWrapper>
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="John" />
      </TestWrapper>
    );

    // Simulate scanning barcode '1001-01' via hardware scanner keydown burst (15ms interval)
    const scanBarcode = (code) => {
      for (const char of code) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    };

    scanBarcode('1001-01');

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
    });

    // Wait a tick for React to commit selectedCartIndex state
    await new Promise(r => setTimeout(r, 50));

    // Setup mock items
    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1001') {
        return { barcode: '1001', name: 'Finolex Pipe 1001', price: 50, is_cuttable: false, batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 100, selling_price: 50 }] };
      }
      if (barcode === '1002') {
        return { barcode: '1002', name: 'Supreme Elbow 1002', price: 30, is_cuttable: false, batches: [{ batch_id: 'b2', batch_number: 1, stock_store: 100, selling_price: 30 }] };
      }
      if (barcode === '1003') {
        return { barcode: '1003', name: 'Brass Valve 1003', price: 40, is_cuttable: false, batches: [{ batch_id: 'b3', batch_number: 1, stock_store: 100, selling_price: 40 }] };
      }
      return null;
    });

    // Now scan second product '1002-01'
    scanBarcode('1002-01');

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Supreme Elbow 1002').length).toBeGreaterThan(0);
    });

    await new Promise(r => setTimeout(r, 50));

    // Now scan third product '1003-01'
    scanBarcode('1003-01');

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Supreme Elbow 1002').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Brass Valve 1003').length).toBeGreaterThan(0);
      expect(screen.getAllByText('₹120.00').length).toBeGreaterThan(0);
    });
  });

  it('allows hotkey + and - to adjust quantity when barcode buffer is empty', async () => {
    db.getInventoryItemByBarcode.mockResolvedValue({
      barcode: '1001',
      name: 'Finolex Pipe 1001',
      price: 50,
      is_cuttable: false,
      batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 100, selling_price: 50 }]
    });

    render(
      <TestWrapper>
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="John" />
      </TestWrapper>
    );

    const input = await screen.findByPlaceholderText('Search barcode or name...');
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
    });

    await new Promise(r => setTimeout(r, 50));

    // Press '+' to increment quantity
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));

    await waitFor(() => {
      // Total should now be 100 (50 * 2)
      expect(screen.getAllByText('₹100.00').length).toBeGreaterThan(0);
    });

    // Wait for next human keypress (> 100ms so it is not mistaken for a 20ms scanner burst)
    await new Promise(r => setTimeout(r, 120));

    // Press '-' to decrement quantity back to 1
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));

    await waitFor(() => {
      // Total should be back to 50
      expect(screen.getAllByText('₹50.00').length).toBeGreaterThan(0);
    });
  });
});


