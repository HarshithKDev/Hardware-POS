import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OwnerCatalog from '../OwnerCatalog';
import * as AppContext from '../AppContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import '@testing-library/jest-dom';

vi.mock('../services/sync', () => ({
  syncInventoryToLocal: vi.fn().mockResolvedValue()
}));

const mockFrom = vi.fn();
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { email: 'owner@example.com' } } })
    }
  }
}));

describe('OwnerCatalog Barcode Assignment', () => {
  let queryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity }
      }
    });

    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: vi.fn(),
      isWarehouseDisabled: false,
      shopSettings: { id: 'shop-test-123' }
    });
  });

  const renderComponent = () => render(
    <QueryClientProvider client={queryClient}>
      <OwnerCatalog />
    </QueryClientProvider>
  );

  it('correctly loads and displays the next sequential barcode from product_master_public', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'categories' || table === 'subcategories') {
        return {
          select: () => ({ order: () => ({ eq: () => Promise.resolve({ data: [] }) }) })
        };
      }
      if (table === 'product_master_public') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ barcode: '1001' }, { barcode: '1002' }, { barcode: '1050' }],
              error: null
            })
          })
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [] }) })
      };
    });

    renderComponent();

    // Should calculate max(1001, 1002, 1050) + 1 = 1051
    await waitFor(() => {
      expect(screen.getByText('1051')).toBeInTheDocument();
    });
  });

  it('retains next barcode when unmounting and remounting (cache resilience)', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'categories' || table === 'subcategories') {
        return {
          select: () => ({ order: () => ({ eq: () => Promise.resolve({ data: [] }) }) })
        };
      }
      if (table === 'product_master_public') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ barcode: '1198' }],
              error: null
            })
          })
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [] }) })
      };
    });

    const { unmount } = renderComponent();

    await waitFor(() => {
      expect(screen.getByText('1199')).toBeInTheDocument();
    });

    unmount();

    // Remount with same query client to simulate navigating back to Add Items tab
    renderComponent();

    // Must immediately render 1199 without getting stuck on '...'
    expect(screen.getByText('1199')).toBeInTheDocument();
  });
});
