import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CartProvider, useCart } from '../contexts/CartContext';
import React from 'react';

import { AppProvider } from '../AppContext';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    clear: () => { store = {}; }
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('CartContext Financial Math', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  const wrapper = ({ children }) => (
    <AppProvider>
      <CartProvider activeTab="test">{children}</CartProvider>
    </AppProvider>
  );

  it('calculates total for empty cart', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.calculateTotal()).toBe(0);
  });

  it('handles floating point precision properly (e.g. 19.99 * 3)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    
    act(() => {
      result.current.setCart([
        { id: '1', quantity: 3, customPriceInput: 19.99 }
      ]);
    });
    
    // 19.99 * 3 = 59.97. Floating point math often gives 59.970000000000006
    expect(result.current.calculateTotal()).toBe(59.97);
  });

  it('prioritizes customPriceInput over standard price', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    
    act(() => {
      result.current.setCart([
        { id: '1', quantity: 2, price: 10, customPriceInput: 8.5 }
      ]);
    });
    
    expect(result.current.calculateTotal()).toBe(17);
  });

  it('prioritizes billableQuantity over quantity', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    
    act(() => {
      result.current.setCart([
        { id: '1', quantity: 2.5, billableQuantity: 3, price: 10, customPriceInput: 10 }
      ]);
    });
    
    expect(result.current.calculateTotal()).toBe(30);
  });

  it('handles extremely large quantities and prices without precision loss', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    
    act(() => {
      result.current.setCart([
        { id: '1', quantity: 10000, customPriceInput: 999.99 }
      ]);
    });
    
    expect(result.current.calculateTotal()).toBe(9999900);
  });
  
  it('correctly calculates total units', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    
    act(() => {
      result.current.setCart([
        { id: '1', quantity: 2.5 },
        { id: '2', quantity: 3 }
      ]);
    });
    
    expect(result.current.calculateTotalUnits()).toBe(5.5);
  });
  
  it('validates split payment correctly (cash + upi = total)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    
    act(() => {
      result.current.setCart([
        { id: '1', quantity: 1, price: 100 }
      ]);
    });
    
    const total = result.current.calculateTotal(); // 100
    
    const validateSplitPayment = (cash, upi) => {
      const parsedCash = cash === '' ? 0 : Number(cash);
      const parsedUpi = upi === '' ? 0 : Number(upi);
      const diff = Math.abs(total - (parsedCash + parsedUpi));
      return diff < 0.01;
    };
    
    // Exact split
    expect(validateSplitPayment(60, 40)).toBe(true);
    // Invalid split
    expect(validateSplitPayment(50, 40)).toBe(false);
    // Overpayment
    expect(validateSplitPayment(100, 10)).toBe(false);
    // Edge case empty inputs
    expect(validateSplitPayment('', 100)).toBe(true);
  });

  it('exposes setActiveCartTab and handles switching between held carts and local', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    expect(typeof result.current.setActiveCartTab).toBe('function');
    expect(typeof result.current.switchCartTab).toBe('function');
    expect(result.current.activeCartTab).toBe('local');

    // Simulate switching to a held cart
    act(() => {
      result.current.setActiveCartTab('held_test_123');
    });
    expect(result.current.activeCartTab).toBe('held_test_123');

    // Simulate completing or returning to local
    act(() => {
      result.current.switchCartTab('local');
    });
    expect(result.current.activeCartTab).toBe('local');
  });

  it('allows canceling a held cart and switches back to local cart if currently active', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.setCart([{ id: 'local-1', name: 'Item 1', quantity: 2, price: 50 }]);
      result.current.setHeldCarts([
        { id: 'held_1', name: 'Hold 1', items: [{ id: 'held-item-1', name: 'Held Product', quantity: 1, price: 100 }] },
        { id: 'held_2', name: 'Hold 2', items: [{ id: 'held-item-2', name: 'Another Product', quantity: 3, price: 20 }] }
      ]);
    });

    act(() => {
      result.current.switchCartTab('held_1');
    });

    expect(result.current.activeCartTab).toBe('held_1');
    expect(result.current.cart.length).toBe(1);
    expect(result.current.cart[0].id).toBe('held-item-1');

    // Now cancel the currently active held cart
    act(() => {
      result.current.cancelHeldCart('held_1');
    });

    // held_1 should be removed
    expect(result.current.heldCarts.find(c => c.id === 'held_1')).toBeUndefined();
    expect(result.current.heldCarts.length).toBe(1);
    expect(result.current.heldCarts[0].id).toBe('held_2');

    // Should have automatically switched back to local cart
    expect(result.current.activeCartTab).toBe('local');
    expect(result.current.cart[0].id).toBe('local-1');
  });

  it('allows canceling an inactive held cart without disrupting active local cart', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.setCart([{ id: 'local-1', name: 'Item 1', quantity: 2, price: 50 }]);
      result.current.setHeldCarts([
        { id: 'held_1', name: 'Hold 1', items: [{ id: 'held-item-1', name: 'Held Product', quantity: 1, price: 100 }] }
      ]);
    });

    expect(result.current.activeCartTab).toBe('local');

    // Cancel held_1 while on local
    act(() => {
      result.current.cancelHeldCart('held_1');
    });

    expect(result.current.heldCarts.length).toBe(0);
    expect(result.current.activeCartTab).toBe('local');
    expect(result.current.cart.length).toBe(1);
  });

  it('syncs heldCarts item changes in real-time when items are modified on a held cart', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.setHeldCarts([
        { id: 'held_1', name: 'Hold 1', items: [{ id: 'item-1', name: 'Original', quantity: 1, price: 10 }] }
      ]);
    });

    act(() => {
      result.current.switchCartTab('held_1');
    });

    // User removes product from held cart
    act(() => {
      result.current.setCart([]);
    });

    // heldCarts should automatically sync
    expect(result.current.heldCarts[0].items.length).toBe(0);
  });
});
