import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as AppContext from '../AppContext';

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../services/db', () => ({
  getLocalScrewBoxes: vi.fn(async () => ([
    { barcode: '1400', name: 'Screw Box 8x1', unit: 'BOX', batches: [{ batch_id: 'B1', batch_number: 1, stock_store: 2, stock_warehouse: 0 }] },
    { barcode: '1401', name: 'Screw Box 10x2', unit: 'BOX', batches: [{ batch_id: 'B9', batch_number: 1, stock_store: 0, stock_warehouse: 6 }] },
  ])),
}));
const openScrewBox = vi.fn(async () => ({}));
vi.mock('../services/screwBox', async (orig) => ({ ...(await orig()), openScrewBox: (...a) => openScrewBox(...a) }));
vi.mock('../supabaseClient', () => ({ supabase: { from: vi.fn() } }));

import ScrewBoxesView from '../ScrewBoxesView';

describe('Staff Screw Boxes screen', () => {
  let confirmCb;
  beforeEach(() => {
    openScrewBox.mockClear();
    vi.spyOn(AppContext, 'useApp').mockReturnValue({
      showAlert: vi.fn(),
      showConfirm: vi.fn((msg, cb) => { confirmCb = cb; }),
      isWarehouseDisabled: false,
      shopSettings: { id: 'S' },
    });
  });

  it('lists screw boxes with store stock and opens one after confirming', async () => {
    render(<ScrewBoxesView />);
    expect(await screen.findByText('Screw Box 8x1')).toBeInTheDocument();
    expect(screen.getByText('2 boxes in store')).toBeInTheDocument();
    expect(screen.getByText('0 boxes in store')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: 'Open 1 Box' });
    expect(buttons[1]).toBeDisabled(); // nothing in the store for the second one

    fireEvent.click(buttons[0]);
    await confirmCb();
    await waitFor(() => expect(openScrewBox).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ barcode: '1400' }) })));
  });

  it('filters by search', async () => {
    render(<ScrewBoxesView />);
    await screen.findByText('Screw Box 8x1');
    fireEvent.change(screen.getByLabelText('Search screw boxes'), { target: { value: '10x2' } });
    expect(screen.queryByText('Screw Box 8x1')).toBeNull();
    expect(screen.getByText('Screw Box 10x2')).toBeInTheDocument();
  });
});
