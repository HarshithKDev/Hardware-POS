import React, { useEffect } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import KeyboardShortcutsModal from '../KeyboardShortcutsModal';
import CartTable from '../components/cart/CartTable';
import { CartProvider, useCart } from '../contexts/CartContext';
import { AppProvider } from '../AppContext';

function CartTestConsumer({ selectedCartIndex, onSelectCartIndex }) {
  const { setCart } = useCart();
  useEffect(() => {
    setCart([
      { id: 'item-1', name: 'Standard Hex Bolt 10mm', barcode: '1001', quantity: 2, price: 15, unit: 'PCS' },
      { id: 'item-2', name: 'Nylon Anchor Plug', barcode: '1002', quantity: 5, price: 5, unit: 'PCS' }
    ]);
  }, [setCart]);

  return (
    <CartTable
      activeTab="checkout"
      selectedCartIndex={selectedCartIndex}
      onSelectCartIndex={onSelectCartIndex}
      onUpdateQuantity={vi.fn()}
      onUpdateDimensions={vi.fn()}
      onCustomPriceChange={vi.fn()}
      onCustomTotalChange={vi.fn()}
      onCustomPriceBlur={vi.fn()}
      onCustomPriceChangeGroup={vi.fn()}
      onCustomTotalChangeGroup={vi.fn()}
      onCustomPriceBlurGroup={vi.fn()}
      onRemoveItem={vi.fn()}
    />
  );
}

describe('Keyboard Accessibility & Shortcuts', () => {
  it('KeyboardShortcutsModal renders all key categories and responds to Escape', () => {
    const handleClose = vi.fn();
    const { rerender } = render(
      <KeyboardShortcutsModal isOpen={true} onClose={handleClose} />
    );

    // Verify modal sections and key badges are rendered
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('POS Speed Mode')).toBeInTheDocument();
    expect(screen.getByText('Checkout & Billing')).toBeInTheDocument();
    expect(screen.getByText('Payment Modal')).toBeInTheDocument();
    expect(screen.getByText('Cart Navigation & Quantities')).toBeInTheDocument();

    // Verify key badges
    expect(screen.getAllByText('F4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('F2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('F1').length).toBeGreaterThan(0);

    // Press Escape to close
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Press F1 to toggle close
    fireEvent.keyDown(window, { key: 'F1' });
    expect(handleClose).toHaveBeenCalledTimes(2);

    // When closed, renders null
    rerender(<KeyboardShortcutsModal isOpen={false} onClose={handleClose} />);
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('CartTable displays keyboard speed status footer and row selection highlight', () => {
    const handleSelectIndex = vi.fn();

    render(
      <AppProvider>
        <CartProvider activeTab="checkout">
          <CartTestConsumer
            selectedCartIndex={1}
            onSelectCartIndex={handleSelectIndex}
          />
        </CartProvider>
      </AppProvider>
    );

    // Verify table items are rendered
    expect(screen.getByText('Standard Hex Bolt 10mm')).toBeInTheDocument();
    expect(screen.getByText('Nylon Anchor Plug')).toBeInTheDocument();

    // Verify keyboard status footer bar is rendered with shortcuts
    expect(screen.getByText('Hotkeys:')).toBeInTheDocument();
    expect(screen.getByText('Del')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Pay')).toBeInTheDocument();

    // Click first row to verify onSelectCartIndex callback
    fireEvent.click(screen.getByText('Standard Hex Bolt 10mm').closest('tr'));
    expect(handleSelectIndex).toHaveBeenCalledWith(0);
  });
});
