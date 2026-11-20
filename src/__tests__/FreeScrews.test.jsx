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
