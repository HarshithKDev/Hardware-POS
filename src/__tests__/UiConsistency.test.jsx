// One look across the app: page titles, date style, list footers.
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '../AppContext';
import { createFakeSupabase } from './helpers/fakeSupabase';
import PageTitleReset from '../components/PageTitleReset';
import { formatDateTime } from '../utils';

const h = vi.hoisted(() => ({ db: null }));
vi.mock('../supabaseClient', () => ({ supabase: new Proxy({}, { get: (_t, key) => h.db[key] }) }));

import OwnerShowroom from '../OwnerShowroom';

describe('page title', () => {
  it('pages with something to reset get the title and the reset button', () => {
    render(<PageTitleReset title="Sales & Returns" onReset={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Sales & Returns' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
  });

  it('pages with nothing to reset get the same title without the button', () => {
    render(<PageTitleReset title="Print Barcodes" />);
    expect(screen.getByRole('heading', { name: 'Print Barcodes' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('dates', () => {
  it('use one style everywhere: "15 Nov 2026, 10:13 AM"', () => {
    const d = formatDateTime(new Date(2026, 10, 15, 10, 13));
    expect(d.datePart).toBe('15 Nov 2026');
    expect(d.full).toBe('15 Nov 2026, 10:13 AM');
  });
});

describe('Showroom list', () => {
  it('is titled like its menu entry and its footer says which page and how many', async () => {
    localStorage.setItem('shop_id', 'shop-1');
    h.db = createFakeSupabase({ bills: [1, 2, 3].map(i => ({
      id: `b${i}`, shop_id: 'shop-1', location: 'Store', status: 'showroom_pending', payment_method: 'SHOWROOM',
      total_amount: 100 * i, created_at: new Date(2026, 10, 10 + i, 11, 0).toISOString(), customer_name: `Customer ${i}`,
    })) });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppProvider><OwnerShowroom /></AppProvider>
      </QueryClientProvider>
    );
    expect(screen.getByRole('heading', { name: 'Showroom' })).toBeInTheDocument();
    expect(await screen.findByText(/Page 1/)).toHaveTextContent('3 dispatches');
  });
});

import { PaymentBadge } from '../components/ui';

describe('payment badge', () => {
  it.each([['CASH', 'Cash', 1], ['UPI', 'UPI', 1], ['SPLIT', 'Split', 2]])('%s shows "%s" with %i icon(s)', (method, label, icons) => {
    const { container } = render(<PaymentBadge method={method} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(icons);
  });
  it('shows nothing when the bill has no payment method', () => {
    const { container } = render(<PaymentBadge method={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
