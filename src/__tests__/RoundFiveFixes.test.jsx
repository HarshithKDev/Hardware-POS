// - Bill / showroom details: items that could not be loaded are shown as "could not load",
//   never as "no items" or as the whole bill being a screws charge.
// - Manage Staff: a staff sign-in left behind by an interrupted attempt can be finished from the app.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '../AppContext';
import { createFakeSupabase } from './helpers/fakeSupabase';

const h = vi.hoisted(() => ({ db: null, prov: null }));
vi.mock('../supabaseClient', () => ({
  supabase: new Proxy({}, { get: (_t, key) => h.db[key] }),
  provisioningClient: { auth: new Proxy({}, { get: (_t, key) => h.prov[key] }) },
}));

import BillDetailsView from '../BillDetailsView';
import ShowroomDetailsView from '../ShowroomDetailsView';
import OwnerStaff from '../OwnerStaff';

const SHOP = 'shop-1';
const bill = { id: 'b1', shop_id: SHOP, total_amount: 520, status: 'completed', payment_method: 'CASH', created_at: new Date().toISOString(), cashier_name: 'Ravi' };
const lines = [
  { id: 'l1', bill_id: 'b1', shop_id: SHOP, barcode: '1001', name: 'Pad Lock', quantity: 2, billable_quantity: 2, price_at_sale: 260, profit: 80, unit: 'PCS' },
];

function database(tables, { failItems = false } = {}) {
  const db = createFakeSupabase(tables);
  const realFrom = db.from;
  db.failItems = failItems;
  db.from = (t) => {
    const q = realFrom(t);
    if (db.failItems && String(t).replace(/_public$/, '') === 'bill_items') {
      q.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(res, rej);
    }
    return q;
  };
  return db;
}

const renderWith = (ui) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AppProvider>{ui}</AppProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('shop_id', SHOP);
  localStorage.setItem('owner_email', 'owner@example.com');
});

describe('bill details when the items cannot be loaded', () => {
  it('says so, shows no "Screws" line for the whole bill, and Try again loads the items', async () => {
    h.db = database({ bill_items: lines }, { failItems: true });
    renderWith(<BillDetailsView bill={bill} onBack={() => {}} showProfit />);
    expect(await screen.findByText(/Could not load the items of this bill/)).toBeInTheDocument();
    expect(screen.queryByText('Screws')).toBeNull();
    expect(screen.queryByText('No items recorded for this bill.')).toBeNull();

    h.db.failItems = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Pad Lock')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Screws')).toBeNull();
  });

  it('showroom details say "could not load" instead of "No items recorded"', async () => {
    h.db = database({ bill_items: lines }, { failItems: true });
    renderWith(<ShowroomDetailsView bill={{ ...bill, payment_method: 'SHOWROOM', status: 'showroom_pending' }} onBack={() => {}} />);
    expect(await screen.findByText(/Could not load the items of this dispatch/)).toBeInTheDocument();
    expect(screen.queryByText('No items recorded for this showroom dispatch.')).toBeNull();
  });
});

describe('adding a staff member whose sign-in already exists', () => {
  const addStaff = async () => {
    renderWith(<OwnerStaff />);
    fireEvent.change(screen.getByPlaceholderText('e.g. John Doe'), { target: { value: 'Ravi' } });
    fireEvent.change(screen.getByPlaceholderText('Min. 6 characters'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByPlaceholderText('e.g. John Doe').closest('form'));
    const ownerPwd = await screen.findByPlaceholderText('Owner Password');
    fireEvent.change(ownerPwd, { target: { value: 'owner-pass' } });
    fireEvent.submit(ownerPwd.closest('form'));
  };
  beforeEach(() => {
    h.db = database({ workers: [], audit_logs: [] });
    h.db.auth = { ...h.db.auth, signInWithPassword: vi.fn(async () => ({ data: {}, error: null })) };
  });

  it('finishes adding them when the PIN entered opens that sign-in', async () => {
    h.prov = {
      signUp: vi.fn(async () => ({ data: { user: null }, error: { message: 'User already registered' } })),
      signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'user-ravi' } }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    };
    await addStaff();
    await waitFor(() => expect(h.db.writes.some(w => w.table === 'workers' && w.op === 'insert')).toBe(true));
    const insert = h.db.writes.find(w => w.table === 'workers' && w.op === 'insert');
    expect(insert.payload[0]).toMatchObject({ id: 'user-ravi', shop_id: SHOP, name: 'Ravi' });
    expect(h.prov.signInWithPassword).toHaveBeenCalledWith(expect.objectContaining({ password: '123456' }));
  });

  it('with a different PIN: nothing is added', async () => {
    h.prov = {
      signUp: vi.fn(async () => ({ data: { user: null }, error: { message: 'User already registered' } })),
      signInWithPassword: vi.fn(async () => ({ data: { user: null }, error: { message: 'Invalid login credentials' } })),
      signOut: vi.fn(async () => ({ error: null })),
    };
    await addStaff();
    await waitFor(() => expect(h.prov.signInWithPassword).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));
    expect(h.db.writes.some(w => w.table === 'workers')).toBe(false);
  });
});
