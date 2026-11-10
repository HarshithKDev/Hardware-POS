import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CuttableQuantityModal from '../components/terminal/CuttableQuantityModal';

// Cut-length items are tracked only as a total (ft / m / sqft): no pieces, roll lengths or widths.
const mesh = { barcode: '1308', name: 'Test Mesh', unit: 'SQFT', is_cuttable: true, price: 40 };
const pipe = { barcode: '1402', name: 'PVC Pipe', unit: 'FT', is_cuttable: true, price: 25 };
const batch = { batch_id: 'b-1', batch_number: 1, stock_store: 10, stock_warehouse: 3990, selling_price: 40 };

describe('Cut-length items: total-quantity dialog', () => {
  it('uses store + warehouse stock when the warehouse is disabled', () => {
    render(<CuttableQuantityModal isOpen modalData={{ item: mesh, batch, action: 'checkout' }} cart={[]} onSubmit={vi.fn()} onClose={vi.fn()} isWarehouseDisabled />);
    expect(screen.getByText(/4000 sqft in stock/i)).toBeInTheDocument();
  });

  it('limits a sale to store stock when the warehouse is enabled', () => {
    render(<CuttableQuantityModal isOpen modalData={{ item: mesh, batch, action: 'checkout' }} cart={[]} onSubmit={vi.fn()} onClose={vi.fn()} isWarehouseDisabled={false} />);
    expect(screen.getByText(/10 sqft in stock/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Total sqft to sell/i), { target: { value: '25' } });
    expect(screen.getByText(/Insufficient stock! Only 10 sqft available/i)).toBeInTheDocument();
  });

  it('subtracts what is already in the cart from the available stock', () => {
    const cart = [{ id: 'x', barcode: '1402', batch_id: 'b-1', quantity: 4, actual_quantity: 4 }];
    render(<CuttableQuantityModal isOpen modalData={{ item: pipe, batch: { ...batch, stock_store: 30 }, action: 'checkout' }} cart={cart} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/26 ft in stock/i)).toBeInTheDocument();
  });

  it('receiving has no stock limit and submits the entered total', () => {
    const onSubmit = vi.fn();
    render(<CuttableQuantityModal isOpen modalData={{ item: pipe, batch, action: 'receive' }} cart={[]} onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Total ft received/i), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ qty: 200, action: 'receive' }));
  });

  it('transfer is limited to warehouse stock', () => {
    render(<CuttableQuantityModal isOpen modalData={{ item: pipe, batch: { ...batch, stock_warehouse: 50 }, action: 'transfer' }} cart={[]} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/50 ft in stock/i)).toBeInTheDocument();
  });
});
