// Returns from a very old bill whose screws charge is only in the total (a rebuilt "Screws" line):
// the real lines still go through the single all-or-nothing database return.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '../AppContext';
import { createFakeSupabase } from './helpers/fakeSupabase';

const h = vi.hoisted(() => ({ db: null }));
vi.mock('../supabaseClient', () => ({
  supabase: new Proxy({}, { get: (_t, key) => h.db[key] }),
}));

import OwnerLedger from '../OwnerLedger';

const SHOP = 'shop-1';
const BILL = '11111111-1111-4111-8111-111111111111';
const LINE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('shop_id', SHOP);
  localStorage.setItem('posUserRole', 'owner');
  h.db = createFakeSupabase({
    bills: [{ id: BILL, shop_id: SHOP, location: 'Store', status: 'completed', payment_method: 'CASH', total_amount: 520, cash_amount: 520, created_at: new Date().toISOString(), cashier_name: 'Ravi', customer_phone: '9000000001' }],
    // ₹250 + ₹250 of items; the other ₹20 was screws, never saved as a line
    bill_items: [
      { id: LINE_A, bill_id: BILL, shop_id: SHOP, barcode: '1001', name: 'Pad Lock', quantity: 1, billable_quantity: 1, price_at_sale: 250, unit: 'PCS' },
      { id: LINE_B, bill_id: BILL, shop_id: SHOP, barcode: '1002', name: 'Door Hinge', quantity: 1, billable_quantity: 1, price_at_sale: 250, unit: 'PCS' },
    ],
    product_master: [], inventory_batches: [], audit_logs: [],
  });
  h.db.rpc = vi.fn(async () => ({ data: { success: true, new_total: 270 }, error: null }));
});

const openReturn = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppProvider><OwnerLedger isActive /></AppProvider>
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.getAllByText('9000000001').length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByRole('button', { name: /^return$/i })[0]);
  return await screen.findByText(/process return & refund/i).then(() => screen.getByRole('dialog'));
};
// One more of this item to return (the card's "+" button)
const addOne = (dialog, name) => {
  const card = within(dialog).getByText(name).closest('div.rounded-lg');
  fireEvent.click(within(card).getByRole('button', { name: '+' }));
};
const returnCalls = () => h.db.rpc.mock.calls.filter(([name]) => name === 'pos_return_items');

it('returning one item uses the single database return with that line only', async () => {
  const dialog = await openReturn();
  expect(within(dialog).getByText('Refunded only with the full bill')).toBeInTheDocument();

  addOne(dialog, 'Pad Lock');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Return' }));

  await waitFor(() => expect(returnCalls()).toHaveLength(1));
  const [, args] = returnCalls()[0];
  expect(args.p_void_all).toBe(false);
  expect(args.p_items).toEqual([{ bill_item_id: LINE_A, quantity: 1 }]);
});

it('returning every item voids the whole bill (screws included) in the single database return', async () => {
  const dialog = await openReturn();
  addOne(dialog, 'Pad Lock');
  addOne(dialog, 'Door Hinge');
  expect(within(dialog).getByText('Refunded with the full bill')).toBeInTheDocument();
  expect(within(dialog).getByText('₹520.00')).toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Void Full Bill' }));
  await waitFor(() => expect(returnCalls()).toHaveLength(1));
  const [, args] = returnCalls()[0];
  expect(args.p_void_all).toBe(true);
  expect(args.p_items.map(i => i.bill_item_id).sort()).toEqual([LINE_A, LINE_B]);
});
