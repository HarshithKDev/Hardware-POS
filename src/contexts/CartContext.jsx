import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { generateId } from '../utils';
import { useApp } from '../AppContext';

const CartContext = createContext(null);

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}

export function CartProvider({ children, activeTab }) {
  const { showToast } = useApp();
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
    const timer = setTimeout(() => {
      localStorage.setItem(`pos_cart_sessions_${activeTab}`, JSON.stringify(cartSessions));
    }, 300);
    return () => clearTimeout(timer);
  }, [cartSessions, activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(`pos_cart_${activeTab}`, JSON.stringify(cart));
    }, 300);
    return () => clearTimeout(timer);
  }, [cart, activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(`pos_held_carts_${activeTab}`, JSON.stringify(heldCarts));
    }, 300);
    return () => clearTimeout(timer);
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

  const calculateBillableQuantity = useCallback((actualQty, method = 'exact') => {
    let qty = Number(actualQty) || 0;
    if (method === 'round_up') {
      qty = Math.round(qty);
    }
    // Handle floating point precision issues (e.g. 6.500000001)
    return Math.round(qty * 1000) / 1000;
  }, []);

  const updateQuantity = useCallback((id, newQty) => {
    // Basic validation to prevent negative values or NaN strings
    if (newQty !== '' && (isNaN(newQty) || Number(newQty) < 0)) return;
    
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const actualQty = newQty;
        const method = item.billing_method || 'exact';
        const billableQty = calculateBillableQuantity(actualQty, method);
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
    if (val !== '' && (isNaN(val) || Number(val) < 0)) return;
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

  const customPriceChangeGroup = useCallback((groupKey, val) => {
    if (val !== '' && (isNaN(val) || Number(val) < 0)) return;
    setCart(prev => prev.map(i => {
      const iKey = i.barcode + '_' + (i.batch_id || 'default');
      return (iKey === groupKey && i.is_cuttable) ? { ...i, customPriceInput: val } : i;
    }));
  }, []);

  const customPriceBlurGroup = useCallback((groupKey) => {
    setCart(prev => prev.map(i => {
      const iKey = i.barcode + '_' + (i.batch_id || 'default');
      if (iKey === groupKey && i.is_cuttable && (i.customPriceInput === '' || i.customPriceInput === undefined)) {
        return { ...i, customPriceInput: i.price };
      }
      return i;
    }));
  }, []);

  const removeItem = useCallback((id) => {
    setCart(prev => {
      const itemToRemove = prev.find(i => i.id === id);
      if (itemToRemove) {
        const listName = activeTab === 'receive' ? 'Inbound List' : activeTab === 'transfer' ? 'Transfer List' : 'Cart';
        showToast(`${itemToRemove.name} removed from ${listName}`);
      }
      return prev.filter(i => i.id !== id);
    });
  }, [activeTab, showToast]);

  const calculateTotal = useCallback(() => cart.reduce((tot, i) => {
    const qty = i.billableQuantity !== undefined && i.billableQuantity !== '' ? Number(i.billableQuantity) : (i.quantity === '' ? 0 : Number(i.quantity));
    const price = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
    return tot + Math.round(price * qty * 100);
  }, 0) / 100, [cart]);
  
  const calculateTotalUnits = useCallback(() => cart.reduce((tot, i) => tot + (i.quantity === '' ? 0 : Number(i.quantity)), 0), [cart]);

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
    removeItem,
    calculateTotal,
    calculateTotalUnits
  };

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}
