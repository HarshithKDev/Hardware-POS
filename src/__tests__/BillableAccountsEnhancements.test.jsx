import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import BillDetailsView from '../BillDetailsView';
import WorkerPrintBarcode from '../WorkerPrintBarcode';
import { AppProvider } from '../AppContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-barcode', () => ({
  default: ({ value }) => <div data-testid="mock-barcode">{value}</div>
}));

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    }))
  }
}));

vi.mock('../services/db', () => ({
  getInventoryByQuery: vi.fn().mockResolvedValue({
    items: [
      {
        barcode: '1001',
        name: 'Brass Bib Cock',
        category: 'Plumbing',
        price: 250,
        batches: [
          { batch_number: 1, selling_price: 250, stock_store: 20, is_active: true }
        ]
      }
    ],
    totalCount: 1
  })
}));

describe('Billable Accounts Enhancements', () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });
    vi.clearAllMocks();
  });

  const renderWithProviders = (ui, role = 'worker') => {
    sessionStorage.setItem('posUserRole', role);
    return render(
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          {ui}
        </AppProvider>
      </QueryClientProvider>
    );
  };

  it('BillDetailsView hides Gross Profit card and Profit table column when showProfit is false', async () => {
    const mockBill = {
      id: 'test-bill-001',
      created_at: '2026-11-07T10:00:00Z',
      customer_name: 'Customer A',
      customer_phone: '9876543210',
      total_amount: 500,
      payment_method: 'CASH',
      status: 'completed'
    };

    const mockItems = [
      {
        id: 'bi-1',
        bill_id: 'test-bill-001',
        name: 'PVC Pipe 1 inch',
        barcode: '1010',
        quantity: 2,
        price_at_sale: 250,
        selling_price: 250,
        profit: 80
      }
    ];

    renderWithProviders(
      <BillDetailsView
        bill={mockBill}
        onBack={vi.fn()}
        onProcessReturn={vi.fn()}
        cachedItems={mockItems}
        showProfit={false}
      />,
      'worker'
    );

    // Verify Total Items and Discount are visible
    expect(screen.getByText('Total Items')).toBeDefined();
    expect(screen.getAllByText('Discount').length).toBeGreaterThan(0);

    // Verify Gross Profit and Profit column are NOT rendered
    expect(screen.queryByText('Gross Profit')).toBeNull();
    expect(screen.queryByText('Profit')).toBeNull();
  });

  it('BillDetailsView shows Gross Profit card and Profit table column when showProfit is true', async () => {
    const mockBill = {
      id: 'test-bill-002',
      created_at: '2026-11-07T10:00:00Z',
      customer_name: 'Customer B',
      total_amount: 300,
      payment_method: 'UPI',
      status: 'completed'
    };

    const mockItems = [
      {
        id: 'bi-2',
        bill_id: 'test-bill-002',
        name: 'Anchor Bolt',
        barcode: '1020',
        quantity: 1,
        price_at_sale: 300,
        selling_price: 300,
        profit: 90
      }
    ];

    renderWithProviders(
      <BillDetailsView
        bill={mockBill}
        onBack={vi.fn()}
        onProcessReturn={vi.fn()}
        cachedItems={mockItems}
        showProfit={true}
      />,
      'owner'
    );

    // Verify Gross Profit is rendered
    expect(screen.getByText('Gross Profit')).toBeDefined();
  });

  it('WorkerPrintBarcode renders directory search, batch info, and print button', async () => {
    renderWithProviders(<WorkerPrintBarcode />);

    expect(screen.getByText('Print Barcodes')).toBeDefined();
    const searchInput = screen.getByPlaceholderText(/search directory by name/i);
    expect(searchInput).toBeDefined();

    // Initially, no items are shown until search is performed
    expect(screen.getByText('Type barcode or product name to find items')).toBeDefined();
    expect(screen.getByText('Select a Product')).toBeDefined();

    // Type in search query to show items
    fireEvent.change(searchInput, { target: { value: 'Brass' } });

    // Wait for matching search results
    await waitFor(() => {
      expect(screen.getAllByText('Brass Bib Cock').length).toBeGreaterThan(0);
    });

    // Select the product from the search results
    const itemCard = screen.getAllByText('Brass Bib Cock')[0].closest('button');
    fireEvent.click(itemCard);

    // Check quantity configuration and print button
    expect(screen.getByText(/Number of Labels/i)).toBeDefined();
    expect(screen.getByText(/Print 10 Barcode Labels/i)).toBeDefined();
  });
});
