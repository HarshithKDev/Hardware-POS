// A list that could not be loaded must say so, never "nothing here": a blip in the connection
// should not look like the shop has no sales, showroom dispatches or staff.
// Also: deleting a category never goes ahead without knowing whether items use it.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, useApp } from '../AppContext';
import { createFakeSupabase } from './helpers/fakeSupabase';

const h = vi.hoisted(() => ({ db: null }));
vi.mock('../supabaseClient', () => ({
  supabase: new Proxy({}, { get: (_t, key) => h.db[key] }),
  provisioningClient: { auth: { signUp: async () => ({ data: {}, error: null }) } },
}));

import OwnerLedger from '../OwnerLedger';
import OwnerShowroom from '../OwnerShowroom';
import OwnerStaff from '../OwnerStaff';
import OwnerCategories from '../OwnerCategories';

const SHOP = 'shop-1';
const today = new Date().toISOString();

/** Fake database where reads of the given tables fail until `heal()` is called. */
function databaseWith(tables, failing) {
  const db = createFakeSupabase(tables);
  const broken = new Set(failing);
  const realFrom = db.from;
  db.from = (t) => {
    const q = realFrom(t);
    if (broken.has(String(t).replace(/_public$/, ''))) {
      q.then = (res, rej) => Promise.resolve({ data: null, count: null, error: { message: 'Failed to fetch' } }).then(res, rej);
      q.maybeSingle = q.single = () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
    }
    return q;
  };
  db.heal = () => broken.clear();
  return db;
}

// The app draws its confirm and alert boxes in App.jsx; a plain stand-in here
function Dialogs() {
  const { confirmConfig, handleConfirm, alertConfig } = useApp();
  return (
    <>
      {confirmConfig.isOpen && (
        <div role="dialog"><p>{confirmConfig.message}</p><button type="button" onClick={handleConfirm}>{confirmConfig.confirmLabel}</button></div>
      )}
      {alertConfig.isOpen && <div role="alert">{alertConfig.message}</div>}
    </>
  );
}

const renderWith = (ui) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AppProvider>{ui}<Dialogs /></AppProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('shop_id', SHOP);
});

describe('a failed load is shown as a failed load', () => {
  it('Sales & Returns: "Could not load the sales", no "No sales found", and Try again works', async () => {
    h.db = databaseWith({
      bills: [{ id: 'b1', shop_id: SHOP, location: 'Store', status: 'completed', payment_method: 'CASH', total_amount: 500, created_at: today, cashier_name: 'Ravi' }],
      bill_items: [], audit_logs: [],
    }, ['bills']);
    renderWith(<OwnerLedger isActive />);
    expect(await screen.findByText(/Could not load the sales/)).toBeInTheDocument();
    expect(screen.queryByText('No sales found for this period.')).toBeNull();
    expect(screen.getByText('Not loaded')).toBeInTheDocument();
    expect(screen.queryByText('0 sales')).toBeNull();

    h.db.heal();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 sale')).toBeInTheDocument();
  });

  it('Showroom: "Could not load the showroom dispatches" instead of "none recorded"', async () => {
    h.db = databaseWith({ bills: [] }, ['bills']);
    renderWith(<OwnerShowroom />);
    expect(await screen.findByText(/Could not load the showroom dispatches/)).toBeInTheDocument();
    expect(screen.queryByText(/No showroom dispatches recorded/)).toBeNull();
  });

  it('Manage Staff: "Could not load the staff list" instead of "No staff members added yet"', async () => {
    h.db = databaseWith({ workers: [{ id: 'w1', shop_id: SHOP, name: 'Ravi', password: 'SECURED_IN_AUTH:BILLABLE' }] }, ['workers']);
    renderWith(<OwnerStaff />);
    expect((await screen.findAllByText(/Could not load the staff list/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('No staff members added yet.')).toBeNull();

    h.db.heal();
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect((await screen.findAllByText('Ravi')).length).toBeGreaterThan(0);
  });
});

describe('deleting a category', () => {
  const tables = () => ({
    categories: [{ id: 1, shop_id: SHOP, name: 'Locks' }],
    subcategories: [
      { id: 1, shop_id: SHOP, name: 'Pad Locks', category_name: 'Locks' },
      { id: 2, shop_id: SHOP, name: 'Door Locks', category_name: 'Locks' },
    ],
    product_master: [], audit_logs: [],
  });
  const deleteLocks = async () => {
    renderWith(<OwnerCategories />);
    const detail = screen.getByLabelText('Sub-categories');
    fireEvent.click(await within(detail).findByRole('button', { name: 'Delete category Locks' }));
    expect(await screen.findByText(/Its 2 sub-categories will be deleted too/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Category' }).pop());
  };

  it('also deletes its sub-categories', async () => {
    h.db = databaseWith(tables(), []);
    await deleteLocks();
    await waitFor(() => expect(h.db.writes.some(w => w.table === 'subcategories' && w.op === 'delete')).toBe(true));
    expect(h.db.writes.some(w => w.table === 'categories' && w.op === 'delete')).toBe(true);
  });

  it('deletes nothing when it cannot check whether items use the category', async () => {
    h.db = databaseWith(tables(), ['product_master']);
    await deleteLocks();
    expect(await screen.findByText(/Could not check whether any items use "Locks", so nothing was deleted/)).toBeInTheDocument();
    expect(h.db.writes.some(w => w.op === 'delete')).toBe(false);
  });
});
