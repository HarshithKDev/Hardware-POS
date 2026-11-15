// When the app cannot know what is in a list, it says so instead of "nothing here":
// Expenses when the server is unreachable, and the product list on a device that has no saved
// copy of the products yet.
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '../AppContext';
import { createFakeSupabase } from './helpers/fakeSupabase';

const h = vi.hoisted(() => ({ db: null }));
vi.mock('../supabaseClient', () => ({
  supabase: new Proxy({}, { get: (_t, key) => h.db[key] }),
}));

import OwnerExpenses from '../OwnerExpenses';
import { getInventoryByQuery } from '../services/db';

const SHOP = 'shop-1';
const failing = (tables, broken) => {
  const db = createFakeSupabase(tables);
  const realFrom = db.from;
  db.from = (t) => {
    const q = realFrom(t);
    if (broken.includes(String(t).replace(/_public$/, ''))) {
      q.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(res, rej);
      q.maybeSingle = () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
    }
    return q;
  };
  return db;
};
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });

const renderWith = (ui) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AppProvider>{ui}</AppProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('shop_id', SHOP);
  setOnline(true);
});

describe('Expenses when the server cannot be reached', () => {
  it('shows the saved copy with a clear notice that it may be out of date', async () => {
    localStorage.setItem(`hardware_pos_expenses_${SHOP}`, JSON.stringify([
      { id: 'e1', shop_id: SHOP, amount: 120, reason: 'Tea', worker_name: 'General Shop', created_at: '2026-11-14T10:00:00Z' },
    ]));
    h.db = failing({ expenses: [], workers: [] }, ['expenses']);
    renderWith(<OwnerExpenses isOwner />);
    expect(await screen.findByText(/Could not reach the server: showing the copy saved on this device/)).toBeInTheDocument();
    expect((await screen.findAllByText('Tea')).length).toBeGreaterThan(0);
  });

  it('with no saved copy, says it could not load instead of "No expenses recorded yet"', async () => {
    h.db = failing({ expenses: [], workers: [] }, ['expenses']);
    renderWith(<OwnerExpenses isOwner />);
    expect(await screen.findByText(/Could not load the expenses/)).toBeInTheDocument();
    expect(screen.queryByText('No expenses recorded yet.')).toBeNull();

    h.db = createFakeSupabase({ expenses: [], workers: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No expenses recorded yet.')).toBeInTheDocument();
  });
});

describe('product list on a device with no saved products', () => {
  it('offline: the list is reported as unknown, not empty', async () => {
    setOnline(false);
    h.db = createFakeSupabase({ product_master: [] });
    const res = await getInventoryByQuery({ limit: 50, status: 'active' });
    expect(res.data).toEqual([]);
    expect(res.catalogUnavailable).toBe(true);
  });

  it('online but the server read fails: also unknown', async () => {
    h.db = failing({ product_master: [] }, ['product_master']);
    const res = await getInventoryByQuery({ limit: 50, status: 'active' });
    expect(res.catalogUnavailable).toBe(true);
  });

  it('online and the shop really has no products: empty, not unknown', async () => {
    h.db = createFakeSupabase({ product_master: [], inventory_batches: [] });
    const res = await getInventoryByQuery({ limit: 50, status: 'active' });
    expect(res.data).toEqual([]);
    expect(res.catalogUnavailable).toBe(false);
  });
});
