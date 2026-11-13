import { render, screen, fireEvent, act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StaffBottomNav from '../components/nav/StaffBottomNav';
import { receiptAmount } from '../ReceiptTemplate';
import { useActiveDays } from '../hooks/useActiveDays';
import { localToUtcIso } from '../utils';

// ---- Phone bottom bar for staff -------------------------------------------------------
describe('StaffBottomNav', () => {
  const tab = (key, label) => ({ key, label });

  it('shows every screen on the bar when there are 5 or fewer', () => {
    const tabs = [tab('dashboard', 'Dashboard'), tab('receive', 'Inbound'), tab('lookup', 'Item Lookup'), tab('scanner', 'Scanner')];
    render(<StaffBottomNav tabs={tabs} activeTab="lookup" onSelect={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Staff navigation' });
    expect(nav.querySelectorAll('button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Lookup' })).toHaveAttribute('aria-current', 'page');
  });

  it('puts 4 on the bar and the rest under More, which opens a sheet and navigates', () => {
    const onSelect = vi.fn();
    const tabs = [tab('dashboard', 'Dashboard'), tab('checkout', 'Terminal'), tab('sales', 'Sales & Returns'),
      tab('print-barcode', 'Print Barcodes'), tab('expenses', 'Expenses'), tab('screw-boxes', 'Screw Boxes')];
    render(<StaffBottomNav tabs={tabs} activeTab="screw-boxes" onSelect={onSelect} />);
    const nav = screen.getByRole('navigation', { name: 'Staff navigation' });
    // Priority order: Home, Checkout, Sales, Expenses on the bar
    expect([...nav.querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Home', 'Checkout', 'Sales', 'Expenses', 'More']);
    // The active screen is under More, so More is highlighted
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Print Barcodes' }));
    expect(onSelect).toHaveBeenCalledWith('print-barcode');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(onSelect).toHaveBeenLastCalledWith('checkout');
  });
});

// ---- Receipt amounts -----------------------------------------------------------------
describe('receiptAmount', () => {
  it('drops needless zeros but keeps paise when there are any', () => {
    expect(receiptAmount(1300)).toBe('1,300');
    expect(receiptAmount(150000)).toBe('1,50,000');
    expect(receiptAmount(33.33)).toBe('33.33');
    expect(receiptAmount(12.5)).toBe('12.50');
    expect(receiptAmount(0.1 + 0.2)).toBe('0.30');
    expect(receiptAmount(null)).toBe('0');
  });
});

// ---- Day list for Sales & Returns / Audit Logs ---------------------------------------
describe('useActiveDays', () => {
  const at = (day, hh) => new Date(`${day}T${String(hh).padStart(2, '0')}:00:00`).toISOString();
  const rows = (day, n, hh = 12) => Array.from({ length: n }, () => ({ created_at: at(day, hh) }));
  const wrapper = ({ children }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it('keeps loading older days past the first 1,000 rows, continuing before the oldest day', async () => {
    const fetchStep = vi.fn(async (beforeIso) => {
      if (!beforeIso) return { data: [...rows('2026-11-13', 600), ...rows('2026-11-12', 400)], error: null };
      return { data: [...rows('2026-11-12', 300, 9), ...rows('2026-11-10', 200)], error: null };
    });
    const { result } = renderHook(() => useActiveDays(['days-test-1'], fetchStep, { currentIndex: 0 }), { wrapper });

    // The first step has only 2 days, so the next one loads by itself
    await waitFor(() => expect(result.current.dates).toEqual(['2026-11-13', '2026-11-12', '2026-11-10']));
    expect(fetchStep).toHaveBeenCalledTimes(2);
    expect(fetchStep.mock.calls[1][0]).toBe(localToUtcIso('2026-11-12T00:00:00'));
    expect(result.current.hasMore).toBe(false);
  });

  it('waits until the user nears the end of the loaded days', async () => {
    const days = ['2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09'];
    const fetchStep = vi.fn(async (beforeIso) => (beforeIso
      ? { data: rows('2026-10-01', 5), error: null }
      : { data: days.flatMap(d => rows(d, 200)), error: null }));
    const { result, rerender } = renderHook(({ i }) => useActiveDays(['days-test-2'], fetchStep, { currentIndex: i }), { wrapper, initialProps: { i: 0 } });

    await waitFor(() => expect(result.current.dates).toHaveLength(5));
    expect(result.current.hasMore).toBe(true);
    expect(fetchStep).toHaveBeenCalledTimes(1);

    rerender({ i: 3 }); // second-to-last loaded day
    await waitFor(() => expect(result.current.dates).toHaveLength(6));
    expect(result.current.dates[5]).toBe('2026-10-01');
    expect(result.current.hasMore).toBe(false);
  });
});
