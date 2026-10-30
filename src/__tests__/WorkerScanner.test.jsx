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

const createQueryBuilder = (resolvedData = []) => {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: (resolve, reject) => Promise.resolve({ data: resolvedData, error: null }).then(resolve, reject),
    catch: (reject) => Promise.resolve({ data: resolvedData, error: null }).catch(reject),
  };
  return builder;
};

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn((table) => {
      if (table === 'inventory_batches') {
        return createQueryBuilder([
          { barcode: '1001', batch_id: 'b1', stock_store: 10, stock_warehouse: 10, selling_price: 100, msp: 80 }
        ]);
      }
      return createQueryBuilder([]);
    }),
    channel: vi.fn(() => ({
      on: vi.fn(() => ({ subscribe: vi.fn() })),
      subscribe: vi.fn()
    })),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: { bill_id: 'BILL-1001' }, error: null })
  }
}));

describe('WorkerScanner Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    
    // Mock the useApp context
    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: vi.fn(),
      showConfirm: vi.fn(),
      showToast: vi.fn(),
      alertConfig: { isOpen: false },
      confirmConfig: { isOpen: false },
    });
  });

  const TestWrapper = ({ children, activeTab = 'checkout' }) => (
    <MemoryRouter>
      <CartProvider activeTab={activeTab}>
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

  it('handles Receive Stock flow: adds out-of-stock items, increments quantity on repeat scan, and completes transaction', async () => {
    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1196') {
        return {
          barcode: '1196',
          name: '13 x 11 Laxmi Vendi',
          price: 1700,
          cost_price: 1300,
          is_cuttable: false,
          stock_store: 0,
          stock_warehouse: 0,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 0, stock_warehouse: 0, selling_price: 1700 }]
        };
      }
      if (barcode === '1190') {
        return {
          barcode: '1190',
          name: 'Medium Box Mirrors',
          price: 500,
          cost_price: 350,
          is_cuttable: false,
          stock_store: 0,
          stock_warehouse: 0,
          batches: [{ batch_id: 'b2', batch_number: 1, stock_store: 0, stock_warehouse: 0, selling_price: 500 }]
        };
      }
      return null;
    });

    render(
      <TestWrapper activeTab="receive">
        <WorkerTerminal activeTab="receive" shopSettings={{ id: 'shop1' }} cashierName="Durjay" />
      </TestWrapper>
    );

    const input = await screen.findByPlaceholderText('Search barcode or name...');

    // 1. Scan item 1196
    fireEvent.change(input, { target: { value: '1196' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('13 x 11 Laxmi Vendi').length).toBeGreaterThan(0);
    });

    // 2. Scan item 1190
    fireEvent.change(input, { target: { value: '1190' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('Medium Box Mirrors').length).toBeGreaterThan(0);
    });

    // 3. Scan item 1196 AGAIN (repeat scan increments quantity to 2)
    fireEvent.change(input, { target: { value: '1196' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('13 x 11 Laxmi Vendi').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Medium Box Mirrors').length).toBeGreaterThan(0);
    });

    // 4. Complete Receive Stock (Press F4)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));

    await waitFor(() => {
      expect(db.saveInventoryBatch).toHaveBeenCalled();
    });
  });

  it('handles Checkout flow: adds products, enforces stock, and completes sale', async () => {
    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1001') {
        return {
          barcode: '1001',
          name: 'Finolex Pipe 1001',
          price: 100,
          is_cuttable: false,
          stock_store: 5,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 5, selling_price: 100 }]
        };
      }
      return null;
    });

    render(
      <TestWrapper activeTab="checkout">
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="John" />
      </TestWrapper>
    );

    const input = await screen.findByPlaceholderText('Search barcode or name...');
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
      expect(screen.getAllByText('₹100.00').length).toBeGreaterThan(0);
    });

    // Scan again -> increments quantity to 2
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('₹200.00').length).toBeGreaterThan(0);
    });

    // Open checkout modal via F4
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText('Complete Sale')).toBeInTheDocument();
    });

    // Enter final negotiated amount
    const negotiatedInput = screen.getByLabelText(/Final Negotiated Amount/i);
    fireEvent.change(negotiatedInput, { target: { value: '200' } });

    // Press Enter in checkout modal to complete sale
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await waitFor(() => {
      expect(db.saveInventoryBatch).toHaveBeenCalled();
    });
  });

  it('allows checkout with screws without stock check errors', async () => {
    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1001') {
        return {
          barcode: '1001',
          name: 'Finolex Pipe 1001',
          price: 100,
          is_cuttable: false,
          stock_store: 5,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 5, selling_price: 100 }]
        };
      }
      return null;
    });

    render(
      <TestWrapper activeTab="checkout">
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="John" />
      </TestWrapper>
    );

    const input = await screen.findByPlaceholderText('Search barcode or name...');
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
    });

    // Click "Include Screws" button
    const includeScrewsBtn = screen.getByText('Include Screws');
    fireEvent.click(includeScrewsBtn);

    // Enter price in screws modal
    await waitFor(() => {
      expect(screen.getByText('Include Screws', { selector: 'h3' })).toBeInTheDocument();
    });
    const priceInput = screen.getByLabelText(/Price \(₹\)/i);
    fireEvent.change(priceInput, { target: { value: '15' } });

    // Submit screws modal
    const addScrewsBtn = screen.getByText('Add to Bill');
    fireEvent.submit(addScrewsBtn.closest('form'));

    // Verify Screws is now in the cart
    await waitFor(() => {
      expect(screen.getByText(/Screws: ₹/i)).toBeInTheDocument();
      expect(screen.getAllByText('1 SET').length).toBeGreaterThan(0);
    });

    // Complete sale (F4)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText('Complete Sale')).toBeInTheDocument();
    });

    const negotiatedInput = screen.getByLabelText(/Final Negotiated Amount/i);
    fireEvent.change(negotiatedInput, { target: { value: '115' } });

    // Press Enter to complete sale
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Verify it completed without throwing "Not enough stock for screws"
    await waitFor(() => {
      expect(db.saveInventoryBatch).toHaveBeenCalled();
    });
  });

  it('negotiated total discount applies exclusively to other products and leaves screws price unchanged', async () => {
    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1001') {
        return {
          barcode: '1001',
          name: 'Finolex Pipe 1001',
          price: 100,
          msp: 80,
          msp_price: 80,
          is_cuttable: false,
          stock_store: 5,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 5, selling_price: 100, msp: 80 }]
        };
      }
      return null;
    });

    const { supabase } = await import('../supabaseClient');

    render(
      <TestWrapper activeTab="checkout">
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="John" />
      </TestWrapper>
    );

    const input = await screen.findByPlaceholderText('Search barcode or name...');
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
    });

    // Add screws at ₹30
    const includeScrewsBtn = screen.getByText('Include Screws');
    fireEvent.click(includeScrewsBtn);

    await waitFor(() => {
      expect(screen.getByText('Include Screws', { selector: 'h3' })).toBeInTheDocument();
    });
    const priceInput = screen.getByLabelText(/Price \(₹\)/i);
    fireEvent.change(priceInput, { target: { value: '30' } });

    const addScrewsBtn = screen.getByText('Add to Bill');
    fireEvent.submit(addScrewsBtn.closest('form'));

    await waitFor(() => {
      expect(screen.getByText(/Screws: ₹/i)).toBeInTheDocument();
    });

    // Open checkout modal (F4)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText('Complete Sale')).toBeInTheDocument();
      // Should show screws helper
      expect(screen.getByText(/Screws: ₹30\.00 \(Fixed price\)/i)).toBeInTheDocument();
    });

    // Enter negotiated total: 120 (Cart total was 100 + 30 = 130, discount is 10)
    const negotiatedInput = screen.getByLabelText(/Final Negotiated Amount/i);
    fireEvent.change(negotiatedInput, { target: { value: '120' } });

    // Press Enter to complete sale
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith(
        'process_pos_transaction_unsafe',
        expect.objectContaining({
          p_items: expect.arrayContaining([
            expect.objectContaining({
              barcode: '1001',
              final_price: 90 // Full ₹10 discount applied to the pipe
            })
          ])
        })
      );
      // Screws inserted at exact untouched price of ₹30
      expect(supabase.from).toHaveBeenCalledWith('bill_items');
    });
  });

  it('strictly enforces MSP of other items when screws are in the cart even for owner, showing warning, disabling complete button, and preventing checkout below min allowed total', async () => {
    const showAlertMock = vi.fn();
    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: showAlertMock,
      showConfirm: vi.fn(),
      showToast: vi.fn(),
      alertConfig: { isOpen: false },
      confirmConfig: { isOpen: false },
      userRole: 'owner',
      isWarehouseDisabled: false
    });

    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1001') {
        return {
          barcode: '1001',
          name: 'Finolex Pipe 1001',
          price: 100,
          msp: 80,
          msp_price: 80,
          is_cuttable: false,
          stock_store: 5,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 5, selling_price: 100, msp: 80 }]
        };
      }
      return null;
    });

    const { supabase } = await import('../supabaseClient');
    supabase.rpc.mockClear();

    render(
      <TestWrapper activeTab="checkout">
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="Owner" />
      </TestWrapper>
    );

    const input = await screen.findByPlaceholderText('Search barcode or name...');
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
    });

    // Add screws at ₹20
    const includeScrewsBtn = screen.getByText('Include Screws');
    fireEvent.click(includeScrewsBtn);

    await waitFor(() => {
      expect(screen.getByText('Include Screws', { selector: 'h3' })).toBeInTheDocument();
    });
    const priceInput = screen.getByLabelText(/Price \(₹\)/i);
    fireEvent.change(priceInput, { target: { value: '20' } });

    const addScrewsBtn = screen.getByText('Add to Bill');
    fireEvent.submit(addScrewsBtn.closest('form'));

    await waitFor(() => {
      expect(screen.getByText(/Screws: ₹/i)).toBeInTheDocument();
    });

    // Open checkout modal (F4)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText('Complete Sale')).toBeInTheDocument();
      expect(screen.getByText(/Min Allowed: ₹100\.00/i)).toBeInTheDocument();
    });

    // Enter negotiated total: 50 (above screw price 20, but below minPossibleTotal 100)
    const negotiatedInput = screen.getByLabelText(/Final Negotiated Amount/i);
    fireEvent.change(negotiatedInput, { target: { value: '50' } });

    // Warning must be displayed
    await waitFor(() => {
      expect(screen.getByText(/Cannot discount below minimum selling limit/i)).toBeInTheDocument();
      expect(screen.getByText(/Products cannot be sold below MSP/i)).toBeInTheDocument();
    });

    // Complete Sale button must be disabled
    const completeBtn = screen.getByText('Complete Sale').closest('button');
    expect(completeBtn).toBeDisabled();

    // Trigger Enter key to attempt submission
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Must trigger minimum price error alert and NOT call supabase.rpc
    expect(showAlertMock).toHaveBeenCalledWith(
      expect.stringContaining('Absolute minimum allowed total is ₹100.00'),
      'Minimum Price Error'
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('allows holding a cart and canceling the held cart completely via tab ✕ button or banner', async () => {
    const showConfirmMock = vi.fn((msg, callback) => {
      if (callback) callback();
    });

    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: vi.fn(),
      showConfirm: showConfirmMock,
      showToast: vi.fn(),
      alertConfig: { isOpen: false },
      confirmConfig: { isOpen: false },
    });

    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1001') {
        return {
          barcode: '1001',
          name: 'Finolex Pipe 1001',
          price: 100,
          msp: 80,
          msp_price: 80,
          is_cuttable: false,
          stock_store: 5,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 5, selling_price: 100, msp: 80 }]
        };
      }
      return null;
    });

    render(
      <TestWrapper activeTab="checkout">
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="John" />
      </TestWrapper>
    );

    // Add item to local cart
    const input = await screen.findByPlaceholderText('Search barcode or name...');
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
    });

    // Click Hold Cart
    const holdCartBtn = screen.getByText('Hold Cart');
    fireEvent.click(holdCartBtn);

    // After holding, held cart tab should appear with close button
    await waitFor(() => {
      const cancelHeldBtn = screen.getByTitle(/Cancel and discard/i);
      expect(cancelHeldBtn).toBeInTheDocument();
    });

    // Switch to held cart by clicking the tab
    const heldTabBtn = screen.getByTitle(/Switch to Hold/i);
    fireEvent.click(heldTabBtn);

    // Bottom action bar should show "Cancel Held Cart" button
    await waitFor(() => {
      expect(screen.getByTestId('bottom-cancel-held-cart')).toBeInTheDocument();
    });

    // Click "Cancel Held Cart" on the bottom action bar
    const bottomCancelBtn = screen.getByTestId('bottom-cancel-held-cart');
    fireEvent.click(bottomCancelBtn);

    // Expect showConfirm to have been called with "Cancel Held Cart"
    expect(showConfirmMock).toHaveBeenCalledWith(
      expect.stringContaining('Cancel "Hold'),
      expect.any(Function),
      'Cancel Held Cart',
      'Cancel Cart',
      'Keep Cart',
      true
    );

    // After confirmation, held cart is removed and we are back to Local Cart
    await waitFor(() => {
      expect(screen.queryByTestId('bottom-cancel-held-cart')).not.toBeInTheDocument();
      expect(screen.queryByTitle(/Cancel and discard/i)).not.toBeInTheDocument();
    });
  });

  it('strictly clamps unit price to MSP in the cart table even when edited by owner', async () => {
    const showAlertMock = vi.fn();
    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: showAlertMock,
      showConfirm: vi.fn(),
      showToast: vi.fn(),
      alertConfig: { isOpen: false },
      confirmConfig: { isOpen: false },
      userRole: 'owner',
      isWarehouseDisabled: false
    });

    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1196-01') {
        return {
          barcode: '1196-01',
          name: '13 x 11 Laxmi Vendi',
          price: 2600,
          msp: 1900,
          msp_price: 1900,
          is_cuttable: false,
          stock_store: 5,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 5, selling_price: 2600, msp: 1900 }]
        };
      }
      return null;
    });

    render(
      <TestWrapper activeTab="checkout">
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="Owner" />
      </TestWrapper>
    );

    const input = await screen.findByPlaceholderText('Search barcode or name...');
    fireEvent.change(input, { target: { value: '1196-01' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('13 x 11 Laxmi Vendi').length).toBeGreaterThan(0);
    });

    // Find the MRP price input in the cart table
    const mrpInput = screen.getByLabelText(/13 x 11 Laxmi Vendi MRP/i);
    expect(mrpInput.value).toBe('2600.00');

    // Type 1200 (below MSP 1900)
    fireEvent.change(mrpInput, { target: { value: '1200' } });

    // On blur, it must clamp to 1900 and trigger alert
    fireEvent.blur(mrpInput);

    await waitFor(() => {
      expect(showAlertMock).toHaveBeenCalledWith(
        expect.stringContaining('Cannot sell 13 x 11 Laxmi Vendi below MSP (₹1900.00)'),
        'Price Error'
      );
      expect(mrpInput.value).toBe('1900.00');
    });
  });

  it('auto-fills Final Negotiated Amount with cart total when opening checkout, allowing immediate completion without retyping', async () => {
    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: vi.fn(),
      showConfirm: vi.fn(),
      showToast: vi.fn(),
      alertConfig: { isOpen: false },
      confirmConfig: { isOpen: false },
      userRole: 'worker',
      isWarehouseDisabled: false
    });

    db.getInventoryItemByBarcode.mockImplementation(async (barcode) => {
      if (barcode === '1001') {
        return {
          barcode: '1001',
          name: 'Finolex Pipe 1001',
          price: 100,
          msp: 80,
          msp_price: 80,
          is_cuttable: false,
          stock_store: 5,
          batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 5, selling_price: 100, msp: 80 }]
        };
      }
      return null;
    });

    const { supabase } = await import('../supabaseClient');
    supabase.rpc.mockClear();

    render(
      <TestWrapper activeTab="checkout">
        <WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="Worker 1" />
      </TestWrapper>
    );

    const input = await screen.findByPlaceholderText('Search barcode or name...');
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(screen.getAllByText('Finolex Pipe 1001').length).toBeGreaterThan(0);
    });

    // Open checkout modal (F4)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText('Complete Sale')).toBeInTheDocument();
    });

    // Verify Final Negotiated Amount is auto-filled with system total (100)
    const negotiatedInput = screen.getByLabelText(/Final Negotiated Amount/i);
    expect(negotiatedInput.value).toBe('100');

    // Complete sale without touching the negotiated amount
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith(
        'process_pos_transaction_unsafe',
        expect.objectContaining({
          p_items: expect.arrayContaining([
            expect.objectContaining({
              barcode: '1001',
              final_price: 100
            })
          ])
        })
      );
    });
  });
});



