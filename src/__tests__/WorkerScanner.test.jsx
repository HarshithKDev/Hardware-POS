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
});
