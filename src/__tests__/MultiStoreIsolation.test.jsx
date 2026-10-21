import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';
import { supabase } from '../supabaseClient';
import WorkerBilling from '../WorkerBilling';
import { 
  queueOfflineTransaction, 
  getOfflineQueue, 
  getFailedTransactions, 
  clearInventoryCache 
} from '../services/db';

const memoryStore = {
  offline_queue: [],
  product_master: [],
  sync_status: [],
};

vi.mock('idb', () => ({
  openDB: vi.fn().mockResolvedValue({
    put: vi.fn((store, item) => {
      memoryStore[store] = memoryStore[store] || [];
      const id = item.id || memoryStore[store].length + 1;
      const stored = { ...item, id };
      memoryStore[store].push(stored);
      return Promise.resolve(id);
    }),
    getAll: vi.fn((store) => Promise.resolve([...(memoryStore[store] || [])])),
    get: vi.fn((store, id) => Promise.resolve((memoryStore[store] || []).find(x => x.id === id))),
    delete: vi.fn((store, id) => {
      memoryStore[store] = (memoryStore[store] || []).filter(x => x.id !== id);
      return Promise.resolve();
    }),
    clear: vi.fn((store) => {
      memoryStore[store] = [];
      return Promise.resolve();
    }),
  }),
}));

vi.mock('../supabaseClient', () => {
  return {
    supabase: {
      from: vi.fn(),
      rpc: vi.fn(),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user' } } }),
      },
    },
  };
});

// Mock AppContext
vi.mock('../AppContext', () => ({
  useApp: () => ({
    shopSettings: { id: 'shop-alpha', shop_name: 'Alpha Hardware' },
    cashierName: 'Cashier John',
    userRole: 'worker',
    showAlert: vi.fn(),
  }),
}));

// Mock child views to isolate WorkerBilling test
vi.mock('../WorkerDashboardView', () => ({
  default: () => <div data-testid="worker-dashboard-view">Dashboard Mock</div>
}));

describe('Multi-Store Isolation Guarantee', () => {
  let queryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('shop_id', 'shop-alpha');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('WorkerBilling queries worker permissions filtered strictly by shop_id', async () => {
    const eqCalls = [];
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { password: 'secret:BILLABLE' },
        error: null,
      }),
    };

    supabase.from.mockImplementation((table) => {
      if (table === 'workers') return chain;
      return chain;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/terminal/dashboard']}>
          <WorkerBilling />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('worker-dashboard-view')).toBeInTheDocument();
    });

    // Verify shop_id filter was applied to workers table
    const shopIdFilter = eqCalls.find(c => c.col === 'shop_id');
    expect(shopIdFilter).toBeDefined();
    expect(shopIdFilter.val).toBe('shop-alpha');
  });

  it('queueOfflineTransaction scopes queued items by shop_id and getOfflineQueue filters by shop_id', async () => {
    localStorage.setItem('shop_id', 'store-1');
    await queueOfflineTransaction({ action: 'sale', amount: 50 });

    localStorage.setItem('shop_id', 'store-2');
    await queueOfflineTransaction({ action: 'sale', amount: 100 });

    const store1Queue = await getOfflineQueue('store-1');
    const store2Queue = await getOfflineQueue('store-2');

    expect(store1Queue.every(item => item.shop_id === 'store-1')).toBe(true);
    expect(store2Queue.every(item => item.shop_id === 'store-2')).toBe(true);
    expect(store1Queue.find(item => item.amount === 100)).toBeUndefined();
    expect(store2Queue.find(item => item.amount === 50)).toBeUndefined();
  });

  it('getFailedTransactions isolates failed transactions by shop_id', async () => {
    localStorage.setItem('shop_id', 'store-1');
    await queueOfflineTransaction({ action: 'transfer', status: 'failed', shop_id: 'store-1' });

    localStorage.setItem('shop_id', 'store-2');
    await queueOfflineTransaction({ action: 'transfer', status: 'failed', shop_id: 'store-2' });

    const store1Failed = await getFailedTransactions('store-1');
    const store2Failed = await getFailedTransactions('store-2');

    expect(store1Failed.every(t => t.shop_id === 'store-1')).toBe(true);
    expect(store2Failed.every(t => t.shop_id === 'store-2')).toBe(true);
  });
});
