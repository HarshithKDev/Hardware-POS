// End-to-end checks of the counter flows on the real WorkerTerminal screen,
// with the database replaced by an in-memory fake.
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WorkerTerminal from '../WorkerTerminal';
import { CartProvider } from '../contexts/CartContext';
import * as db from '../services/db';
import * as AppContext from '../AppContext';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

vi.mock('../services/db', () => ({
  getInventoryItemByBarcode: vi.fn(),
  queueOfflineTransaction: vi.fn(),
  getInventoryByQuery: vi.fn().mockResolvedValue([]),
  saveInventoryBatch: vi.fn()
}));
vi.mock('../services/sync', () => ({
  syncInventoryToLocal: vi.fn().mockResolvedValue()
}));
// The phone camera cannot run in tests: stand in a fake that hands us its onScan callback
const cameraHook = vi.hoisted(() => ({ onScan: null }));
vi.mock('../components/scanner/InlineContinuousScanner', () => ({
  default: (props) => { cameraHook.onScan = props.onScan; return <div data-testid="camera-view" />; },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() }))
}));

const builders = [];
const LIVE_BATCHES = [
  { barcode: '1001', batch_id: 'b1', stock_store: 10, stock_warehouse: 0, selling_price: 100, msp: 80, is_active: true },
  { barcode: '2001', batch_id: 'p1', stock_store: 100, stock_warehouse: 0, selling_price: 25, msp: 20, is_active: true },
];
const makeBuilder = (table) => {
  const calls = { table, update: null, insert: null };
  const data = table === 'inventory_batches' ? LIVE_BATCHES : [];
  const b = {
    calls,
    select: vi.fn(() => b), in: vi.fn(() => b), eq: vi.fn(() => b), is: vi.fn(() => b),
    order: vi.fn(() => b), limit: vi.fn(() => b), range: vi.fn(() => b), delete: vi.fn(() => b),
    update: vi.fn((p) => { calls.update = p; return b; }),
    insert: vi.fn((p) => { calls.insert = p; return b; }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data, error: null, count: 1 }).then(res, rej),
  };
  builders.push(b);
  return b;
};
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn((table) => makeBuilder(String(table).replace(/_public$/, ''))),
    channel: vi.fn(() => ({ on: vi.fn(() => ({ subscribe: vi.fn() })), subscribe: vi.fn(), send: vi.fn() })),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: { bill_id: 'BILL-9001' }, error: null })
  }
}));

// Press F4 until the checkout popup opens. The screen can show a newly scanned item a
// moment before the keyboard handler sees the updated cart; a real cashier is never that
// fast, but a test can be. F4 does nothing once the popup is open, so retrying is safe.
// End-to-end counter tests: allow slow CI machines; individual waits stay at 5 s
vi.setConfig({ testTimeout: 15000 });

const pressF4UntilCheckoutOpens = () => waitFor(() => {
  if (!screen.queryByText('Complete Sale')) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));
  }
  expect(screen.getByText('Complete Sale')).toBeInTheDocument();
}, { timeout: 5000 });


const hinge = {
  barcode: '1001', name: 'Door Hinge', unit: 'PCS', price: 100, msp: 80, is_cuttable: false, stock_store: 10,
  batches: [{ batch_id: 'b1', batch_number: 1, stock_store: 10, stock_warehouse: 0, selling_price: 100, msp: 80, purchase_cost: 60 }]
};
const pipe = {
  barcode: '2001', name: 'PVC Pipe 1 inch', unit: 'FT', price: 25, msp: 20, is_cuttable: true, stock_store: 100,
  batches: [{ batch_id: 'p1', batch_number: 1, stock_store: 100, stock_warehouse: 0, selling_price: 25, msp: 20, purchase_cost: 15 }]
};

const Wrapper = ({ children, tab }) => (
  <MemoryRouter><CartProvider activeTab={tab}>{children}</CartProvider></MemoryRouter>
);

const scan = async (code) => {
  const input = await screen.findByPlaceholderText('Search barcode or name...');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest('form'));
};

describe('Counter business flows (end to end)', () => {
  afterEach(async () => {
    // carts are saved to localStorage after a short delay; let that finish, then wipe it
    await new Promise(r => setTimeout(r, 350));
    localStorage.clear();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    builders.length = 0;
    localStorage.clear();
    localStorage.setItem('shop_id', 'shop1');
    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: vi.fn(), showConfirm: vi.fn(), showToast: vi.fn(),
      alertConfig: { isOpen: false }, confirmConfig: { isOpen: false },
      userRole: 'worker', isWarehouseDisabled: false
    });
    // Like the real local database, hand out a fresh copy every time
    db.getInventoryItemByBarcode.mockImplementation(async (bc) => structuredClone(bc === '1001' ? hinge : bc === '2001' ? pipe : null));
    const { supabase } = await import('../supabaseClient');
    supabase.rpc.mockClear();
  });

  it('sells 30 ft of a cut-length pipe: one prompt for the total, 30 ft deducted, ₹750 charged', async () => {
    const { supabase } = await import('../supabaseClient');
    render(<Wrapper tab="checkout"><WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="Raju" /></Wrapper>);

    await scan('2001');
    fireEvent.change(await screen.findByLabelText(/Total ft to sell/i, {}, { timeout: 5000 }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.getAllByText(/Total 30 ft/i).length).toBeGreaterThan(0), { timeout: 5000 });

    await pressF4UntilCheckoutOpens();
    expect(screen.getByLabelText(/Final Negotiated Amount/i).value).toBe('750');
    fireEvent.click(screen.getByText('Complete Sale'));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('pos_process_sale', expect.objectContaining({
        p_action: 'SALE',
        p_items: [expect.objectContaining({ barcode: '2001', actual_quantity: 30, billable_quantity: 30, final_price: 25 })]
      }));
    }, { timeout: 5000 });

    // local stock is reduced by exactly 30 ft right after the sale
    await waitFor(() => {
      const saved = db.saveInventoryBatch.mock.calls.flatMap(c => c[0]).find(i => i.barcode === '2001');
      expect(saved.batches[0].stock_store).toBe(70);
    });

    // payment details are saved in the same database call as the sale
    expect(supabase.rpc).toHaveBeenCalledWith('pos_process_sale', expect.objectContaining({
      p_payment_method: 'CASH', p_cash_amount: 750, p_upi_amount: 0, p_total_amount: 750,
      p_client_ref: expect.any(String)
    }));
    expect(builders.find(b => b.calls.table === 'bills' && b.calls.update)).toBeUndefined();
  });

  it('receives 200 ft of pipe as a single total', async () => {
    const { supabase } = await import('../supabaseClient');
    render(<Wrapper tab="receive"><WorkerTerminal activeTab="receive" shopSettings={{ id: 'shop1' }} cashierName="Raju" /></Wrapper>);

    await scan('2001');
    fireEvent.change(await screen.findByLabelText(/Total ft received/i, {}, { timeout: 5000 }), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText(/Total 200 ft/i).length).toBeGreaterThan(0), { timeout: 5000 });

    // F4 saves directly here; pressed again only while nothing has been sent yet
    await waitFor(() => {
      if (!supabase.rpc.mock.calls.some(c => c[0] === 'pos_process_sale')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true }));
      }
      expect(supabase.rpc).toHaveBeenCalledWith('pos_process_sale', expect.objectContaining({
        p_action: 'RECEIVE',
        p_location: 'Warehouse-Inbound',
        p_items: [expect.objectContaining({ barcode: '2001', actual_quantity: 200, num_rolls: 1, default_length: 200 })]
      }));
    }, { timeout: 5000 });
  });

  it('phone camera closes after one item is added, and stays open for an unknown barcode', async () => {
    render(<Wrapper tab="checkout"><WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="Raju" /></Wrapper>);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan barcode with camera' }));
    expect(await screen.findByTestId('camera-view')).toBeInTheDocument();

    // Unknown barcode: nothing added, so the camera stays open to try again
    await act(async () => { await cameraHook.onScan('9999'); });
    expect(screen.getByTestId('camera-view')).toBeInTheDocument();

    // Known barcode: the item is added and the camera closes
    await act(async () => { await cameraHook.onScan('1001'); });
    await waitFor(() => expect(screen.queryByTestId('camera-view')).toBeNull(), { timeout: 5000 });
    expect(screen.getAllByText('Door Hinge').length).toBeGreaterThan(0);

    // The owner can open it again for the next item
    fireEvent.click(screen.getByRole('button', { name: 'Scan barcode with camera' }));
    expect(await screen.findByTestId('camera-view')).toBeInTheDocument();
  });

  it('cannot sell more cut-length stock than the store has', async () => {
    render(<Wrapper tab="checkout"><WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="Raju" /></Wrapper>);
    await scan('2001');
    fireEvent.change(await screen.findByLabelText(/Total ft to sell/i, {}, { timeout: 5000 }), { target: { value: '150' } });
    // (exact number can be lower if a previous test's cart is still saved on this test machine)
    expect(screen.getByText(/Insufficient stock! Only \d+ ft available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('showroom dispatch: no negotiated amount, recorded as showroom (not a sale)', async () => {
    const { supabase } = await import('../supabaseClient');
    render(<Wrapper tab="checkout"><WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="Raju" /></Wrapper>);

    await scan('1001');
    await waitFor(() => expect(screen.getAllByText('Door Hinge').length).toBeGreaterThan(0), { timeout: 5000 });
    await pressF4UntilCheckoutOpens();

    fireEvent.click(screen.getByRole('button', { name: 'Showroom' }));
    expect(screen.queryByLabelText(/Final Negotiated Amount/i)).toBeNull();
    fireEvent.click(screen.getByText('Send to Showroom'));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('pos_process_sale', expect.objectContaining({
      p_action: 'SALE', p_payment_method: 'SHOWROOM', p_cash_amount: 0, p_upi_amount: 0
    })), { timeout: 5000 });
  });
});

describe('Counter flows before the database update (fallback path)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    builders.length = 0;
    localStorage.clear();
    localStorage.setItem('shop_id', 'shop1');
    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: vi.fn(), showConfirm: vi.fn(), showToast: vi.fn(),
      alertConfig: { isOpen: false }, confirmConfig: { isOpen: false },
      userRole: 'worker', isWarehouseDisabled: false
    });
    db.getInventoryItemByBarcode.mockImplementation(async (bc) => structuredClone(bc === '2001' ? pipe : null));
    const { supabase } = await import('../supabaseClient');
    supabase.rpc.mockImplementation(async (name) => (name === 'pos_process_sale'
      ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pos_process_sale' } }
      : { data: { bill_id: 'BILL-OLD' }, error: null }));
  });
  afterEach(async () => {
    await new Promise(r => setTimeout(r, 350));
    localStorage.clear();
    const { supabase } = await import('../supabaseClient');
    supabase.rpc.mockImplementation(async () => ({ data: { bill_id: 'BILL-9001' }, error: null }));
  });

  it('falls back to the old sale call and saves payment details separately', async () => {
    const { supabase } = await import('../supabaseClient');
    render(<Wrapper tab="checkout"><WorkerTerminal activeTab="checkout" shopSettings={{ id: 'shop1' }} cashierName="Raju" /></Wrapper>);
    await scan('2001');
    fireEvent.change(await screen.findByLabelText(/Total ft to sell/i, {}, { timeout: 5000 }), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText(/Total 10 ft/i).length).toBeGreaterThan(0), { timeout: 5000 });
    await pressF4UntilCheckoutOpens();
    fireEvent.click(screen.getByText('Complete Sale'));

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('process_pos_transaction_unsafe', expect.objectContaining({ p_action: 'SALE' })), { timeout: 5000 });
    await waitFor(() => {
      const billUpdate = builders.find(b => b.calls.table === 'bills' && b.calls.update);
      expect(billUpdate.calls.update).toMatchObject({ payment_method: 'CASH', cash_amount: 250, total_amount: 250 });
    });
  });
});
