import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

// ---------------------------------------------------------------
// Application Context
// Provides shared state (shopSettings, userRole, dark mode) and
// shared functions (showAlert, showConfirm) to all descendants,
// eliminating prop drilling through 3-4 component levels.
// ---------------------------------------------------------------

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <AppProvider>');
  return ctx;
}

export function AppProvider({ children }) {
  const [shopSettings, setShopSettings] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('cached_shop_settings');
      if (cached) {
        try { return JSON.parse(cached); } catch (e) {}
      }
    }
    return null;
  });

  const [userRole, setUserRole] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('posUserRole') || localStorage.getItem('posUserRole') || null;
    }
    return null;
  });

  const [cashierName, setCashierName] = useState(() => {
    if (typeof window !== 'undefined') {
      const role = sessionStorage.getItem('posUserRole') || localStorage.getItem('posUserRole');
      if (role === 'owner') {
        const cached = localStorage.getItem('cached_shop_settings');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            return parsed.owner_name || 'Administrator';
          } catch (e) {}
        }
        return 'Administrator';
      }
      return role || '';
    }
    return '';
  });

  // --- Dark Mode ---
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('posDarkMode');
      if (saved !== null) {
        try { return JSON.parse(saved); } catch (e) { /* fallback */ }
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('posDarkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  const toggleDarkMode = useCallback(() => setIsDarkMode((v) => !v), []);

  // --- Alert Dialog ---
  const [alertConfig, setAlertConfig] = useState({
    isOpen: false,
    message: '',
    title: 'Notice',
  });

  const showAlert = useCallback((message, title = 'Notice') => {
    setAlertConfig({ isOpen: true, message, title });
  }, []);

  const closeAlert = useCallback(() => {
    setAlertConfig((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    message: '',
    title: 'Confirm Action',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    isDestructive: false,
  });

  // Store callback in a ref to keep it out of state (functions aren't serializable)
  const confirmCallbackRef = useRef(null);

  const showConfirm = useCallback((message, onConfirmCallback, title = 'Confirm Action', confirmLabel = 'Confirm', cancelLabel = 'Cancel', isDestructive = false) => {
    confirmCallbackRef.current = onConfirmCallback;
    setConfirmConfig({ isOpen: true, message, title, confirmLabel, cancelLabel, isDestructive });
  }, []);

  const handleConfirm = useCallback(() => {
    if (typeof confirmCallbackRef.current === 'function') {
      confirmCallbackRef.current();
    }
    confirmCallbackRef.current = null;
    setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const closeConfirm = useCallback(() => {
    confirmCallbackRef.current = null;
    setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // --- Toast Notification ---
  const [toast, setToast] = useState({ isOpen: false, message: '' });
  const showToast = useCallback((message, duration = 2000) => {
    setToast({ isOpen: true, message });
    setTimeout(() => {
      setToast(prev => prev.message === message ? { isOpen: false, message: '' } : prev);
    }, duration);
  }, []);

  // --- Warehouse Settings ---
  const [warehouseDisabledState, setWarehouseDisabledState] = useState(() => {
    if (typeof window !== 'undefined') {
      const s1 = localStorage.getItem(`disable_warehouse_${localStorage.getItem('shop_id') || 'default'}`);
      const s2 = localStorage.getItem('disable_warehouse');
      if (s1 !== null) return s1 === 'true';
      if (s2 !== null) return s2 === 'true';
    }
    return false;
  });

  const isWarehouseDisabled = Boolean(
    (shopSettings && shopSettings.disable_warehouse !== undefined && shopSettings.disable_warehouse !== null)
      ? shopSettings.disable_warehouse
      : warehouseDisabledState
  );

  const setWarehouseDisabled = useCallback((disabled) => {
    const shopId = shopSettings?.id || (typeof window !== 'undefined' ? localStorage.getItem('shop_id') : 'default');
    if (typeof window !== 'undefined') {
      localStorage.setItem(`disable_warehouse_${shopId}`, String(disabled));
      localStorage.setItem('disable_warehouse', String(disabled));
    }
    setWarehouseDisabledState(Boolean(disabled));
    setShopSettings((prev) => prev ? { ...prev, disable_warehouse: disabled } : { disable_warehouse: disabled });
  }, [shopSettings?.id]);

  const value = {
    // Shop & auth
    shopSettings,
    setShopSettings,
    userRole,
    setUserRole,
    cashierName,
    setCashierName,
    isWarehouseDisabled,
    setWarehouseDisabled,

    // Dark mode
    isDarkMode,
    toggleDarkMode,

    // Alert dialog
    alertConfig,
    showAlert,
    closeAlert,

    // Confirm dialog
    confirmConfig,
    showConfirm,
    handleConfirm,
    closeConfirm,

    // Toast
    showToast,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      {toast.isOpen && (
        <div 
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[9999] bg-gray-800 text-white px-4 py-2 rounded-md shadow-lg text-sm font-medium flex items-center gap-2 animate-fade-in-down pointer-events-none"
          style={{ 
            backgroundColor: 'var(--color-accent, #3b82f6)',
            animation: 'fadeInDown 0.3s ease-out'
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {toast.message}
        </div>
      )}
    </AppContext.Provider>
  );
}
