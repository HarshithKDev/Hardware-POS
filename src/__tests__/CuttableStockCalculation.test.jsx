import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CuttableCheckoutModal from '../components/terminal/CuttableCheckoutModal';

describe('Cuttable Checkout Stock Calculations', () => {
  it('correctly uses combined stock_store and stock_warehouse when isWarehouseDisabled is true', () => {
    const item = {
      barcode: '1308',
      name: 'Test Mesh',
      unit: 'SQFT',
      is_cuttable: true,
      default_length: 100,
      default_width: 4,
      price: 40
    };

    // Stranded stock scenario: 10 sqft in store, 3990 sqft in warehouse
    const batch = {
      batch_id: 'batch-1308-01',
      batch_number: 1,
      stock_store: 10,
      stock_warehouse: 3990,
      selling_price: 40
    };

    render(
      <CuttableCheckoutModal
        isOpen={true}
        modalData={{ item, batch }}
        cart={[]}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        isWarehouseDisabled={true}
      />
    );

    // Verify header stock shows 4000 sqft in stock, not 10 sqft
    expect(screen.getByText(/4000 sqft in stock/i)).toBeInTheDocument();

    // Verify it does NOT show insufficient stock error for 400 sqft (100 ft roll)
    expect(screen.queryByText(/Insufficient stock/i)).not.toBeInTheDocument();
  });

  it('respects pure store stock when isWarehouseDisabled is false', () => {
    const item = {
      barcode: '1308',
      name: 'Test Mesh',
      unit: 'SQFT',
      is_cuttable: true,
      default_length: 100,
      default_width: 4,
      price: 40
    };

    const batch = {
      batch_id: 'batch-1308-01',
      batch_number: 1,
      stock_store: 10,
      stock_warehouse: 3990,
      selling_price: 40
    };

    render(
      <CuttableCheckoutModal
        isOpen={true}
        modalData={{ item, batch }}
        cart={[]}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        isWarehouseDisabled={false}
      />
    );

    // In two-tier mode, store only has 10 sqft
    expect(screen.getByText(/10 sqft in stock/i)).toBeInTheDocument();
    expect(screen.getByText(/Insufficient stock! Only 10 sqft available/i)).toBeInTheDocument();
  });
});
