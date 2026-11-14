import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '../AppContext';
import { createFakeSupabase } from './helpers/fakeSupabase';

const h = vi.hoisted(() => ({ db: null }));
vi.mock('../supabaseClient', () => ({
  supabase: new Proxy({}, { get: (_t, key) => h.db[key] }),
}));
vi.mock('../services/db', async (orig) => ({
  ...(await orig()),
  getFailedTransactions: async () => [],
  getInventoryByQuery: async () => ({ items: [] }),
}));

import OwnerStats from '../OwnerStats';
import OwnerCategories from '../OwnerCategories';
import OwnerDashboard from '../OwnerDashboard';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const SHOP = 'shop-1';
const renderWith = (ui) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AppProvider>{ui}</AppProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('shop_id', SHOP);
});

describe('Overview (OwnerStats)', () => {
  it("counts every bill of a busy day in Revenue, Cash Received and UPI Received, past the 1,000-row limit", async () => {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const span = Math.max(1000, Date.now() - midnight.getTime() - 1000);
    const bills = []; const items = [];
    for (let i = 0; i < 1500; i++) {
      const cash = i % 3 === 0; const split = i % 3 === 1;
      bills.push({
        id: `b${i}`, shop_id: SHOP, location: 'Store', status: 'completed',
        created_at: new Date(midnight.getTime() + Math.floor((i * span) / 1500)).toISOString(),
        total_amount: 100, total_profit: 40,
        payment_method: cash ? 'CASH' : split ? 'SPLIT' : 'UPI',
        cash_amount: cash ? 100 : split ? 30 : 0, upi_amount: cash ? 0 : split ? 70 : 100,
      });
      items.push({ id: i, bill_id: `b${i}`, shop_id: SHOP, barcode: '1223', name: i === 1499 ? 'Recent Seller' : 'Pad Lock', quantity: 1, price_at_sale: 100, cost_at_sale: 60, profit: 40, system_price: 100, billable_quantity: 1 });
    }
    const product = (barcode, name, qty, cost) => ({ barcode, name, shop_id: SHOP, is_active: true, unit: 'PCS', price: cost * 2, cost_price: cost, stock_store: qty, stock_warehouse: 0, inventory_batches: [{ stock_store: qty, stock_warehouse: 0, purchase_cost: cost, is_active: true }] });
    h.db = createFakeSupabase({
      bills, bill_items: items, expenses: [], returns: [], workers: [],
      product_master: [product('1223', 'Pad Lock', 2, 60), product('5001', 'Recent Seller', 10, 50), product('5002', 'Never Sold', 4, 25)],
    });

    renderWith(<OwnerStats isActive />);

    // 1,500 bills x ₹100. Cash: 500 cash bills x 100 + 500 split x 30. UPI: 500 x 100 + 500 x 70.
    const card = (title) => screen.getByText(title, { selector: 'h3, p, span, div' }).closest('div').parentElement;
    await waitFor(() => expect(card('Revenue')).toHaveTextContent('₹1,50,000.00'), { timeout: 5000 });
    await waitFor(() => expect(card('Cash Received')).toHaveTextContent('₹65,000.00'));
    expect(card('UPI Received')).toHaveTextContent('₹85,000.00');
    // "Recent Seller" sold in the 1,500th bill, so only "Never Sold" (4 x ₹25) is dead stock
    await waitFor(() => expect(card('Dead Stock Value')).toHaveTextContent('₹100'));
  });
});

describe('Overview chart and date filter', () => {
  it('shows Today by default, switches Revenue/Profit and By hour/By day, and offers Day / Date Range only', async () => {
    const at = (h) => { const d = new Date(); d.setHours(h, 5, 0, 0); return d.toISOString(); };
    const h1 = Math.min(new Date().getHours(), 9); // earlier today, never in the future
    h.db = createFakeSupabase({
      bills: [
        { id: 'x1', shop_id: SHOP, location: 'Store', status: 'completed', created_at: at(h1), total_amount: 300, payment_method: 'CASH', cash_amount: 300, upi_amount: 0 },
        { id: 'x2', shop_id: SHOP, location: 'Store', status: 'completed', created_at: at(h1), total_amount: 200, payment_method: 'UPI', cash_amount: 0, upi_amount: 200 },
      ],
      bill_items: [
        { id: 1, bill_id: 'x1', shop_id: SHOP, barcode: '1', name: 'Pad Lock', quantity: 3, billable_quantity: 3, price_at_sale: 100, cost_allocated: 180, profit: 120, system_price: 100 },
        { id: 2, bill_id: 'x2', shop_id: SHOP, barcode: '2', name: 'Hinge', quantity: 2, billable_quantity: 2, price_at_sale: 100, cost_allocated: 150, profit: 50, system_price: 100 },
      ],
      expenses: [], returns: [], workers: [], product_master: [],
    });

    renderWith(<OwnerStats isActive />);

    expect(await screen.findByText('Revenue by day', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Today/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull();

    // The hour of the sales holds the same totals as the cards (₹500 revenue, ₹170 profit)
    fireEvent.click(screen.getByRole('button', { name: 'By hour' }));
    expect(screen.getByText('Revenue by hour')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByLabelText(/₹500$/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Profit', exact: true }));
    expect(screen.getByText('Profit by hour')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/₹170$/).length).toBeGreaterThan(0);

    // The picker has two tabs; Today is just the default day
    fireEvent.click(screen.getByRole('button', { name: /^Today/ }));
    expect(screen.getByRole('tab', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Date Range' })).toBeInTheDocument();
    expect(screen.queryByText('Choose Date')).toBeNull();

  });
});

describe('Categories page', () => {
  beforeEach(() => {
    h.db = createFakeSupabase({
      categories: [{ id: 1, shop_id: SHOP, name: 'Locks' }, { id: 2, shop_id: SHOP, name: 'Pipes' }],
      subcategories: [
        { id: 1, shop_id: SHOP, name: 'Pad Locks', category_name: 'Locks' },
        { id: 2, shop_id: SHOP, name: 'Door Locks', category_name: 'Locks' },
        { id: 3, shop_id: SHOP, name: 'PVC', category_name: 'Pipes' },
      ],
      product_master: [], audit_logs: [],
    });
  });

  it('lists categories with their sub-category counts and shows the chosen one', async () => {
    renderWith(<OwnerCategories />);
    const list = await screen.findByRole('region', { name: 'Categories' }).catch(() => screen.getByLabelText('Categories'));
    const locks = await within(list).findByRole('button', { name: /Locks/ });
    expect(locks).toHaveTextContent('2');
    expect(within(list).getByRole('button', { name: /Pipes/ })).toHaveTextContent('1');

    fireEvent.click(within(list).getByRole('button', { name: /Pipes/ }));
    const detail = screen.getByLabelText('Sub-categories');
    expect(within(detail).getByRole('heading', { name: 'Pipes' })).toBeInTheDocument();
    expect(within(detail).getByText('PVC')).toBeInTheDocument();
    expect(within(detail).queryByText('Pad Locks')).toBeNull();
  });

  it('searches categories (shown once there are more than 6) and adds a sub-category to the chosen one', async () => {
    const more = ['Paints', 'Tools', 'Wires', 'Hinges', 'Glass', 'Tiles'].map((name, i) => ({ id: 10 + i, shop_id: SHOP, name }));
    h.db = createFakeSupabase({ categories: [{ id: 1, shop_id: SHOP, name: 'Locks' }, { id: 2, shop_id: SHOP, name: 'Pipes' }, ...more], subcategories: [], product_master: [], audit_logs: [] });
    renderWith(<OwnerCategories />);
    const list = screen.getByLabelText('Categories');
    await within(list).findByRole('button', { name: /Pipes/ });

    fireEvent.change(screen.getByPlaceholderText('Search categories'), { target: { value: 'pip' } });
    expect(within(list).queryByRole('button', { name: /Locks/ })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: /Pipes/ }));

    const input = screen.getByPlaceholderText('New sub-category in Pipes');
    fireEvent.change(input, { target: { value: 'CPVC' } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(h.db.writes.find(w => w.table === 'subcategories' && w.op === 'insert')).toBeTruthy());
    const insert = h.db.writes.find(w => w.table === 'subcategories' && w.op === 'insert');
    expect(insert.payload[0]).toMatchObject({ category_name: 'Pipes', shop_id: SHOP });
    expect(String(insert.payload[0].name).toUpperCase()).toBe('CPVC');
  });
});

describe('Owner phone navigation', () => {
  it('opens the More sheet with the screens that are not on the bar, and goes to the chosen one', async () => {
    h.db = createFakeSupabase({ bills: [], bill_items: [], expenses: [], product_master: [], categories: [], subcategories: [], workers: [], audit_logs: [] });
    const Where = () => <output data-testid="path">{useLocation().pathname}</output>;
    renderWith(
      <MemoryRouter initialEntries={['/owner/dashboard']}>
        <Routes><Route path="/owner/:tab" element={<><OwnerDashboard /><Where /></>} /></Routes>
      </MemoryRouter>
    );
    const bar = screen.getByRole('navigation', { name: 'Mobile Bottom Navigation' });
    expect([...bar.querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Overview', 'Inventory', 'Checkout', 'Sales & Ret.', 'More']);

    fireEvent.click(within(bar).getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog');
    const names = within(sheet).getAllByRole('button').map(b => b.textContent.trim()).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(['Expenses', 'Audit Logs', 'Categories']));
    expect(names).not.toContain('Checkout');

    fireEvent.click(within(sheet).getByRole('button', { name: 'Expenses' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/owner/expenses'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
