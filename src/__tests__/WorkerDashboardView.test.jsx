import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WorkerDashboardView from '../WorkerDashboardView';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import React from 'react';
import '@testing-library/jest-dom';

vi.mock('../supabaseClient', () => {
  return {
    supabase: {
      from: vi.fn(),
    },
  };
});

describe('WorkerDashboardView Multi-Store Isolation', () => {
  let queryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('shop_id', 'test-shop-123');
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  it('queries product_master_public strictly filtered by current shop_id', async () => {
    const eqCalls = [];
    const createChain = () => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((col, val) => {
          eqCalls.push({ col, val });
          return chain;
        }),
        lt: vi.fn(() => chain),
        order: vi.fn(() => chain),
        range: vi.fn(() => Promise.resolve({ data: [{ id: '1', barcode: '1001', name: 'Shop 123 Screws', price: 10, stock_store: 5, stock_warehouse: 10 }], count: 1, error: null })),
        then: vi.fn((resolve) => resolve({ count: 1 })),
      };
      return chain;
    };

    supabase.from.mockImplementation(() => createChain());

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkerDashboardView isBillable={true} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Shop 123 Screws')).toBeInTheDocument();
    });

    // Check that shop_id 'test-shop-123' was used in the eq filters
    const shopIdFilters = eqCalls.filter(c => c.col === 'shop_id');
    expect(shopIdFilters.length).toBeGreaterThan(0);
    expect(shopIdFilters.every(c => c.val === 'test-shop-123')).toBe(true);
  });
});
