import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScrewsModal from '../components/terminal/ScrewsModal';
import ReceiptTemplate from '../ReceiptTemplate';

describe('Free screws', () => {
  it('saves the entered amount with the free flag when "Give screws for free" is ticked', () => {
    const onSave = vi.fn();
    render(<ScrewsModal isOpen onClose={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/Total Price/), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/Give screws for free/));
    fireEvent.click(screen.getByRole('button', { name: 'Add as Free' }));
    expect(onSave).toHaveBeenCalledWith(30, true);
  });

  it('saves as a normal charged line when the box is not ticked', () => {
    const onSave = vi.fn();
    render(<ScrewsModal isOpen onClose={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/Total Price/), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Bill' }));
    expect(onSave).toHaveBeenCalledWith(30, false);
  });

  it('reopens an existing free screws line with the box still ticked', () => {
    render(<ScrewsModal isOpen onClose={() => {}} onSave={() => {}} initialPrice="30" initialFree isUpdate />);
    expect(screen.getByLabelText(/Give screws for free/)).toBeChecked();
    expect(screen.getByLabelText(/Total Price/)).toHaveValue(30);
  });

  it('prints FREE for a free screws line on the receipt', () => {
    render(<ReceiptTemplate shopSettings={{}} lastReceipt={{
      type: 'checkout', id: '1', date: new Date(), total: 270, roundOff: 0,
      items: [
        { name: 'Pipe', barcode: 'P1', quantity: 1, unit: 'PCS', mrp: 270, finalRate: 270, lineTotal: 270 },
        { name: 'Screws (FREE)', barcode: 'SCREWS', is_screw: true, is_free: true, screw_value: 30, quantity: 1, unit: 'SET', mrp: 0, finalRate: 0, lineTotal: 0 },
      ],
    }} />);
    expect(screen.getByText('FREE')).toBeInTheDocument();
  });
});

// ---- Saving the free amount in the database ----
const rpc = vi.fn();
const insert = vi.fn();
vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    from: () => ({
      insert: (...a) => insert(...a),
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
    }),
  },
}));

import { processSaleAtomic, saleArgsFromPayload } from '../services/posRpc';
import { buildScrewRow, finalizeBillMetadata } from '../services/billFinalize';

const freeScrew = { is_screw: true, barcode: 'SCREWS', is_free: true, screw_value: 30, price: 0, customPriceInput: '0.00' };
const salePayload = (screw) => ({ p_action: 'SALE', p_location: 'Store', p_cashier_name: 'A', p_items: [], screw_item: screw });

describe('Free screws in the database', () => {
  it('sends the free amount with the sale, the screws line itself at ₹0', async () => {
    rpc.mockReset().mockResolvedValue({ data: { bill_id: 'b1' }, error: null });
    await processSaleAtomic(saleArgsFromPayload(salePayload(freeScrew)));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_screw_price: 0, p_screw_free_amount: 30 });
  });

  it('does not send the new argument for charged screws (older databases keep working)', async () => {
    rpc.mockReset().mockResolvedValue({ data: { bill_id: 'b1' }, error: null });
    await processSaleAtomic(saleArgsFromPayload(salePayload({ is_screw: true, barcode: 'SCREWS', price: 30, customPriceInput: '30.00' })));
    expect(rpc.mock.calls[0][1].p_screw_price).toBe(30);
    expect('p_screw_free_amount' in rpc.mock.calls[0][1]).toBe(false);
  });

  it('still saves the sale when the database has not been updated yet', async () => {
    rpc.mockReset()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pos_process_sale' } })
      .mockResolvedValueOnce({ data: { bill_id: 'b1' }, error: null });
    const res = await processSaleAtomic(saleArgsFromPayload(salePayload(freeScrew)));
    expect(res.data).toEqual({ bill_id: 'b1' });
    expect('p_screw_free_amount' in rpc.mock.calls[1][1]).toBe(false);
  });

  it('builds a ₹0 "Screws (FREE)" line with free_amount for the step-by-step path', () => {
    expect(buildScrewRow('b1', 's1', freeScrew)).toMatchObject({
      name: 'Screws (FREE)', price_at_sale: 0, system_price: 0, profit: 0, free_amount: 30,
    });
    const charged = buildScrewRow('b1', 's1', { price: 30, customPriceInput: '30.00' });
    expect(charged).toMatchObject({ name: 'Screws', price_at_sale: 30 });
    expect('free_amount' in charged).toBe(false);
  });

  it('drops free_amount and retries when the column does not exist yet', async () => {
    insert.mockReset()
      .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'free_amount' column of 'bill_items'" } })
      .mockResolvedValueOnce({ error: null });
    const res = await finalizeBillMetadata({ billId: 'b1', updatePayload: {}, screwRow: buildScrewRow('b1', 's1', freeScrew) });
    expect(res.ok).toBe(true);
    expect('free_amount' in insert.mock.calls[1][0]).toBe(false);
    expect(insert.mock.calls[1][0].price_at_sale).toBe(0);
  });
});
