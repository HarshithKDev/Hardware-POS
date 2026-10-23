import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import React, { useState } from 'react';
import { useSessionState } from '../hooks/useSessionState';

describe('useSessionState Hook', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('initializes with defaultValue when sessionStorage is empty', () => {
    const { result } = renderHook(() => useSessionState('test_key', 'initial'));
    expect(result.current[0]).toBe('initial');
  });

  it('updates state and persists to sessionStorage', () => {
    const { result } = renderHook(() => useSessionState('test_key', 'initial'));

    act(() => {
      result.current[1]('updated_value');
    });

    expect(result.current[0]).toBe('updated_value');
    expect(JSON.parse(window.sessionStorage.getItem('test_key'))).toBe('updated_value');
  });

  it('initializes from existing sessionStorage value on mount', () => {
    window.sessionStorage.setItem('test_key', JSON.stringify('saved_from_session'));

    const { result } = renderHook(() => useSessionState('test_key', 'fallback_default'));
    expect(result.current[0]).toBe('saved_from_session');
  });

  it('supports functional state updaters', () => {
    const { result } = renderHook(() => useSessionState('counter_key', 10));

    act(() => {
      result.current[1](prev => prev + 5);
    });

    expect(result.current[0]).toBe(15);
    expect(JSON.parse(window.sessionStorage.getItem('counter_key'))).toBe(15);
  });

  it('supports clearState to reset back to default', () => {
    const { result } = renderHook(() => useSessionState('filter_key', 'all'));

    act(() => {
      result.current[1]('plumbing');
    });
    expect(result.current[0]).toBe('plumbing');

    act(() => {
      result.current[2](); // clearState
    });

    expect(result.current[0]).toBe('all');
    expect(window.sessionStorage.getItem('filter_key')).toBeNull();
  });

  it('preserves filters across component unmount and remount (simulating page navigation)', () => {
    function FilterComponent({ id }) {
      const [search, setSearch] = useSessionState('shop_123_inv_search', '');
      const [category, setCategory] = useSessionState('shop_123_inv_cat', 'ALL');

      return (
        <div>
          <input
            data-testid="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            data-testid="cat-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="ALL">ALL</option>
            <option value="Electrical">Electrical</option>
            <option value="Hardware">Hardware</option>
          </select>
        </div>
      );
    }

    // 1. User visits page and sets filters
    const { unmount } = render(<FilterComponent id="view1" />);
    const input = screen.getByTestId('search-input');
    const select = screen.getByTestId('cat-select');

    act(() => {
      fireEvent.change(input, { target: { value: 'copper wire' } });
      fireEvent.change(select, { target: { value: 'Electrical' } });
    });

    expect(screen.getByTestId('search-input').value).toBe('copper wire');
    expect(screen.getByTestId('cat-select').value).toBe('Electrical');

    // 2. User navigates to another page (Component unmounts)
    unmount();

    // 3. User navigates back to the page (Component remounts)
    render(<FilterComponent id="view2" />);

    // Filters are preserved exactly as left!
    expect(screen.getByTestId('search-input').value).toBe('copper wire');
    expect(screen.getByTestId('cat-select').value).toBe('Electrical');
  });

  it('resets page filters when PageTitleReset is clicked', async () => {
    const { default: PageTitleReset } = await import('../components/PageTitleReset');

    function PageWithTitleReset() {
      const [search, setSearch] = useSessionState('shop_reset_test_search', '');
      const [category, setCategory] = useSessionState('shop_reset_test_cat', 'ALL');

      const handleReset = () => {
        setSearch('');
        setCategory('ALL');
        window.sessionStorage.removeItem('shop_reset_test_search');
        window.sessionStorage.removeItem('shop_reset_test_cat');
      };

      return (
        <div>
          <PageTitleReset
            title="Store Inventory Actions"
            onReset={handleReset}
          />
          <input
            data-testid="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            data-testid="cat-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="ALL">ALL</option>
            <option value="Pipes">Pipes</option>
          </select>
        </div>
      );
    }

    render(<PageWithTitleReset />);

    // User applies filters
    const searchInput = screen.getByTestId('search-input');
    const catSelect = screen.getByTestId('cat-select');

    act(() => {
      fireEvent.change(searchInput, { target: { value: 'PVC 1/2"' } });
      fireEvent.change(catSelect, { target: { value: 'Pipes' } });
    });

    expect(screen.getByTestId('search-input').value).toBe('PVC 1/2"');
    expect(screen.getByTestId('cat-select').value).toBe('Pipes');

    // User clicks the Page Title to reset the page
    const titleButton = screen.getByRole('button', { name: /Store Inventory Actions/i });
    act(() => {
      fireEvent.click(titleButton);
    });

    // Page state is reset to initial defaults!
    expect(screen.getByTestId('search-input').value).toBe('');
    expect(screen.getByTestId('cat-select').value).toBe('ALL');
  });

  it('imports and evaluates OwnerAuditLogs and other pages without ReferenceError', async () => {
    const auditMod = await import('../OwnerAuditLogs');
    expect(auditMod.default).toBeDefined();

    const ledgerMod = await import('../OwnerLedger');
    expect(ledgerMod.default).toBeDefined();

    const invMod = await import('../OwnerInventory');
    expect(invMod.default).toBeDefined();
  });

  it('maintains open row details state (e.g. showroom dispatch view) when switching sidebar tabs', () => {
    function MasterDetailView() {
      const [selectedRow, setSelectedRow] = useSessionState('pos_test_selected_row', null);

      if (selectedRow) {
        return (
          <div data-testid="detail-view">
            <h2>Details for {selectedRow.customer_name}</h2>
            <button data-testid="back-btn" onClick={() => setSelectedRow(null)}>
              Back
            </button>
          </div>
        );
      }

      return (
        <div data-testid="master-list">
          <h1>List View</h1>
          <button
            data-testid="row-1"
            onClick={() => setSelectedRow({ id: 'bill-123', customer_name: 'Satyam patalu' })}
          >
            Satyam patalu
          </button>
        </div>
      );
    }

    // 1. User views list and clicks into row "Satyam patalu"
    const { unmount } = render(<MasterDetailView />);
    expect(screen.getByTestId('master-list')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('row-1'));
    });

    expect(screen.getByTestId('detail-view')).toBeInTheDocument();
    expect(screen.getByText('Details for Satyam patalu')).toBeInTheDocument();

    // 2. User switches to different sidebar tab (Component unmounts)
    unmount();

    // 3. User comes back to the sidebar tab (Component remounts)
    const remounted = render(<MasterDetailView />);

    // User is STILL inside the row details view — not reset to the list!
    expect(remounted.getByTestId('detail-view')).toBeInTheDocument();
    expect(remounted.getByText('Details for Satyam patalu')).toBeInTheDocument();

    // 4. Clicking Back button returns to the list
    act(() => {
      fireEvent.click(remounted.getByTestId('back-btn'));
    });

    expect(remounted.getByTestId('master-list')).toBeInTheDocument();
  });

  it('maintains selected product batch view in warehouse/store inventory across sidebar navigation', () => {
    function DashboardSimulator() {
      const [tab, setTab] = useState('warehouse');
      const [selectedBarcode, setSelectedBarcode] = useSessionState('pos_test_batch_barcode', null);

      return (
        <div>
          <button data-testid="nav-warehouse" onClick={() => setTab('warehouse')}>Store Inventory</button>
          <button data-testid="nav-checkout" onClick={() => setTab('checkout')}>Checkout</button>
          <button data-testid="nav-sales" onClick={() => setTab('sales')}>Sales</button>

          {tab === 'warehouse' && (
            selectedBarcode ? (
              <div data-testid="batch-details-view">
                <h2>Batch Details for #{selectedBarcode}</h2>
                <button data-testid="back-to-inventory" onClick={() => setSelectedBarcode(null)}>Back to Items</button>
              </div>
            ) : (
              <div data-testid="inventory-table">
                <h2>All Items Table</h2>
                <button data-testid="open-item-1002" onClick={() => setSelectedBarcode('1002')}>Open 1002</button>
              </div>
            )
          )}
          {tab === 'checkout' && <div data-testid="checkout-view">Checkout Content</div>}
          {tab === 'sales' && <div data-testid="sales-view">Sales Content</div>}
        </div>
      );
    }

    render(<DashboardSimulator />);
    expect(screen.getByTestId('inventory-table')).toBeInTheDocument();

    // 1. User clicks into item 1002 row
    act(() => {
      fireEvent.click(screen.getByTestId('open-item-1002'));
    });
    expect(screen.getByTestId('batch-details-view')).toBeInTheDocument();
    expect(screen.getByText('Batch Details for #1002')).toBeInTheDocument();

    // 2. User navigates to Checkout via sidebar
    act(() => {
      fireEvent.click(screen.getByTestId('nav-checkout'));
    });
    expect(screen.getByTestId('checkout-view')).toBeInTheDocument();

    // 3. User navigates to Sales via sidebar
    act(() => {
      fireEvent.click(screen.getByTestId('nav-sales'));
    });
    expect(screen.getByTestId('sales-view')).toBeInTheDocument();

    // 4. User navigates back to Store Inventory via sidebar
    act(() => {
      fireEvent.click(screen.getByTestId('nav-warehouse'));
    });

    // Item 1002 Batch Details view is STILL open!
    expect(screen.getByTestId('batch-details-view')).toBeInTheDocument();
    expect(screen.getByText('Batch Details for #1002')).toBeInTheDocument();

    // 5. Clicking Back returns to inventory table
    act(() => {
      fireEvent.click(screen.getByTestId('back-to-inventory'));
    });
    expect(screen.getByTestId('inventory-table')).toBeInTheDocument();
  });
});
