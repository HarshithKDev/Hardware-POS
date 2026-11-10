import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceiptTemplate from '../ReceiptTemplate';

const baseReceipt = {
  id: 'abc123',
  type: 'checkout',
  date: new Date(2026, 10, 10, 12, 0, 0),
  paymentMethod: 'CASH',
  cashAmount: 99.99,
  upiAmount: 0,
  items: [
    { barcode: '1', name: 'Hinge', quantity: 3, actual_quantity: 3, finalRate: 33.33, mrp: 35, lineTotal: 99.99, unit: 'PCS', pieceCount: 1 },
  ],
};

describe('A7: receipt shows the amount actually charged', () => {
  it('shows a Round Off line and NET DUE equal to the charged total', () => {
    render(<ReceiptTemplate lastReceipt={{ ...baseReceipt, total: 100, roundOff: 0.01 }} shopSettings={{ shop_name: 'Test' }} />);
    expect(screen.getByText('Round Off')).toBeInTheDocument();
    expect(screen.getByText('+₹0.01')).toBeInTheDocument();
    expect(screen.getByText(/NET DUE/).nextSibling.textContent).toContain('100.00');
  });

  it('omits the Round Off line when there is no difference', () => {
    render(<ReceiptTemplate lastReceipt={{ ...baseReceipt, total: 99.99, roundOff: 0 }} shopSettings={{ shop_name: 'Test' }} />);
    expect(screen.queryByText('Round Off')).toBeNull();
  });
});
