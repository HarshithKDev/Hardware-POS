import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OwnerLedger from '../OwnerLedger';
import { AppProvider } from '../AppContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockBills = [
  {
    id: 'bill-101',
    created_at: '2026-10-19T10:00:00Z',
    customer_name: 'Ramesh Patel',
    customer_phone: '9876543210',
    cashier_name: 'Harshith',
    total_amount: 500,
    payment_method: 'CASH',
    status: 'completed',
    location: 'Store'
  },
  {
    id: 'bill-102',
    created_at: '2026-10-19T11:00:00Z',
    customer_name: null,
    customer_phone: null,
    cashier_name: 'Harshith',
    total_amount: 250,
    payment_method: 'UPI',
    status: 'completed',
    location: 'Store'
  },
  {
    id: 'bill-103',
    created_at: '2026-10-19T12:00:00Z',
    customer_name: 'Anita Roy',
    customer_phone: '9123456789',
    cashier_name: 'Harshith',
    total_amount: 1000,
    payment_method: 'CASH',
    status: 'voided',
    location: 'Store'
  }
];

const mockItems = [
  {
    id: 'item-1',
    bill_id: 'bill-101',
    name: 'Stainless Steel Screws',
    barcode: 'SCR-001',
    quantity: 5,
    billable_quantity: 5,
    actual_quantity: 5,
    price_at_sale: 20,
    unit: 'pc'
  },
  {
    id: 'item-2',
    bill_id: 'bill-101',
    name: 'Copper Wire Cut',
    barcode: 'WIR-001',
    instance_barcode: 'WIR-001-01',
    quantity: 1,
    billable_quantity: 1,
    actual_quantity: 1,
    price_at_sale: 150,
    unit: 'm'
  }
];

const createMockBuilder = (resultData) => {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => Promise.resolve({ data: resultData, error: null })),
    limit: vi.fn(() => Promise.resolve({ data: resultData, error: null })),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    or: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve({ data: Array.isArray(resultData) ? resultData[0] : resultData, error: null })),
    in: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    insert: vi.fn(() => Promise.resolve({ error: null })),
    then: (resolve) => resolve({ data: resultData, error: null })
  };
  return builder;
};

vi.mock('../supabaseClient', () => {
  return {
    supabase: {
      from: vi.fn((table) => {
        if (table === 'bills') {
          return createMockBuilder(mockBills);
        }
        if (table === 'bill_items') {
          return createMockBuilder(mockItems);
        }
        if (table === 'product_master') {
          return createMockBuilder([{ barcode: 'SCR-001', is_cuttable: false }]);
        }
        if (table === 'inventory_batches') {
          return createMockBuilder({ stock_store: 20 });
        }
        if (table === 'audit_logs') {
          return createMockBuilder([]);
        }
        return createMockBuilder([]);
      })
    }
  };
});

describe('OwnerLedger (Sales History & Merged Returns)', () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <OwnerLedger isActive={true} />
        </AppProvider>
      </QueryClientProvider>
    );
  };

  it('renders sales history with search input and customer suggestion support', async () => {
    renderComponent();

    const searchInput = screen.getByPlaceholderText(/search phone, name, or bill #/i);
    expect(searchInput).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('9876543210').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Walk-in Customer/i).length).toBeGreaterThan(0);
    });
  });

  it('renders dedicated Return button for active bills and RETURNED badge for voided bills', async () => {
    renderComponent();

    await waitFor(() => {
      const returnButtons = screen.getAllByRole('button', { name: /return/i });
      expect(returnButtons.length).toBeGreaterThan(0);

      const returnedBadges = screen.getAllByText(/RETURNED/i);
      expect(returnedBadges.length).toBeGreaterThan(0);
    });
  });

  it('opens ReturnItemsModal when Return button is clicked on a bill row', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('9876543210').length).toBeGreaterThan(0);
    });

    const returnButtons = screen.getAllByRole('button', { name: /return/i });
    fireEvent.click(returnButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/process return & refund/i)).toBeInTheDocument();
      expect(screen.getByText('Stainless Steel Screws')).toBeInTheDocument();
      expect(screen.getByText('Copper Wire Cut')).toBeInTheDocument();
      expect(screen.getByText(/non-returnable \(cut item\)/i)).toBeInTheDocument();
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).not.toBeDisabled();
      expect(checkboxes[1]).toBeDisabled();
    });
  });

  it('opens full screen bill details view when View button is clicked and returns back', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('9876543210').length).toBeGreaterThan(0);
    });

    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    expect(viewButtons.length).toBeGreaterThan(0);
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to sales/i })).toBeInTheDocument();
      expect(screen.getByText(/Item Details/i)).toBeInTheDocument();
    });

    const backButton = screen.getByRole('button', { name: /back to sales/i });
    fireEvent.click(backButton);

    await waitFor(() => {
      expect(screen.getByText(/sales history/i)).toBeInTheDocument();
    });
  });

  it('displays day-by-day pagination controls in normal mode', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText(/sales/i).length).toBeGreaterThan(0);
      // Expect day badge (e.g. 19 Oct 2026 from mockBills)
      expect(screen.getByText(/19 Oct 2026/i)).toBeInTheDocument();
      // Expect Newer and Older navigation buttons
      expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
  });

  it('switches to global search mode across all history when search term is entered', async () => {
    renderComponent();

    const searchInput = screen.getByPlaceholderText(/search phone, name, or bill #/i);
    fireEvent.change(searchInput, { target: { value: 'Ramesh' } });

    await waitFor(() => {
      expect(screen.getByText(/global search:/i)).toBeInTheDocument();
      expect(screen.getByText(/searching all dates across all history/i)).toBeInTheDocument();
    });
  });
});

