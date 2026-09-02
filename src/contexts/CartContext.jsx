import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { generateId } from '../utils';

const CartContext = createContext(null);

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}

export function CartProvider({ children, activeTab }) {
  const [activeCartTab, setActiveCartTab] = useState('local');
  const [cartSessions, setCartSessions] = useState(() => {
    try { const saved = localStorage.getItem(`pos_cart_sessions_${activeTab}`); return saved ? JSON.parse(saved) : { local: [] }; } catch { return { local: [] }; }
  });
  
  const [cart, setCart] = useState(() => {
    try { const saved = localStorage.getItem(`pos_cart_${activeTab}`); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });

  const [heldCarts, setHeldCarts] = useState(() => {
    try { const saved = localStorage.getItem(`pos_held_carts_${activeTab}`); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });

  // Save cart sessions to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(`pos_cart_sessions_${activeTab}`, JSON.stringify(cartSessions));
  }, [cartSessions, activeTab]);

  useEffect(() => {
    localStorage.setItem(`pos_cart_${activeTab}`, JSON.stringify(cart));
  }, [cart, activeTab]);

  useEffect(() => {
    localStorage.setItem(`pos_held_carts_${activeTab}`, JSON.stringify(heldCarts));
  }, [heldCarts, activeTab]);

  // Sycing cart changes to active session
  useEffect(() => {
    setCartSessions(prev => ({ ...prev, [activeCartTab]: cart }));
  }, [cart, activeCartTab]);


  const switchCartTab = useCallback((tabId, overrideItems = null) => {
    setActiveCartTab(tabId);
    if (overrideItems !== null) {
      setCart(cartSessions[tabId] || overrideItems);
    } else if (tabId === 'local') {
      setCart(cartSessions['local'] || []);
    } else {
      const hc = heldCarts.find(c => c.id === tabId);
      setCart(cartSessions[tabId] || (hc ? hc.items : []));
    }
  }, [cartSessions, heldCarts]);

  const clearCart = useCallback(() => {
    setCart([]);
    if (activeCartTab === 'local') {
      setCartSessions(prev => ({ ...prev, local: [] }));
    } else {
      setCartSessions(prev => ({ ...prev, [activeCartTab]: [] }));
    }
  }, [activeCartTab]);

  const calculateBillableQuantity = useCallback((actualQty, increment = 0, method = 'exact') => {
    let qty = Number(actualQty) || 0;
    if (method === 'round_up' && increment > 0) {
      qty = Math.ceil(qty / increment) * increment;
    }
    // Handle floating point precision issues (e.g. 6.500000001)
    return Math.round(qty * 1000) / 1000;
  }, []);

  const updateQuantity = useCallback((id, newQty) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const actualQty = newQty;
        const inc = Number(item.billing_increment || 0.01);
        const method = item.billing_method || 'exact';
        const billableQty = calculateBillableQuantity(actualQty, inc, method);
        return { ...item, quantity: actualQty, billableQuantity: billableQty };
      }
      return item;
    }));
  }, [calculateBillableQuantity]);

  const updateDimensions = useCallback((id, field, value) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  }, []);

  const customPriceChange = useCallback((id, val) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, customPriceInput: val } : i));
  }, []);

  const customPriceBlur = useCallback((id) => {
    setCart(prev => prev.map(i => {
      if (i.id === id && (i.customPriceInput === '' || i.customPriceInput === undefined)) {
        return { ...i, customPriceInput: i.price };
      }
      return i;
    }));
  }, []);

  const customPriceChangeGroup = useCallback((barcode, val) => {
    setCart(prev => prev.map(i => (i.barcode === barcode && i.is_cuttable) ? { ...i, customPriceInput: val } : i));
  }, []);

  const customPriceBlurGroup = useCallback((barcode) => {
    setCart(prev => prev.map(i => {
      if (i.barcode === barcode && i.is_cuttable && (i.customPriceInput === '' || i.customPriceInput === undefined)) {
        return { ...i, customPriceInput: i.price };
      }
      return i;
    }));
  }, []);

  const removeItem = useCallback((id) => {
    setCart(prev => prev.filter(i => i.id !== id));
  }, []);

  const value = {
    cart, setCart,
    activeCartTab, switchCartTab,
    cartSessions, setCartSessions,
    heldCarts, setHeldCarts,
    clearCart,
    updateQuantity,
    updateDimensions,
    customPriceChange,
    customPriceBlur,
    customPriceChangeGroup,
    customPriceBlurGroup,
    removeItem
  };

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}
