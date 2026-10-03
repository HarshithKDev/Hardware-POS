import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CartProvider, useCart } from '../contexts/CartContext';
import React from 'react';

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

  const wrapper = ({ children }) => <CartProvider activeTab="test">{children}</CartProvider>;

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
});
