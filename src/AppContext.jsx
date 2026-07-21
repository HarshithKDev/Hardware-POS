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
  const [shopSettings, setShopSettings] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [cashierName, setCashierName] = useState('');

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

  // --- Confirm Dialog ---
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    message: '',
    title: 'Confirm Action',
  });

  // Store callback in a ref to keep it out of state (functions aren't serializable)
  const confirmCallbackRef = useRef(null);

  const showConfirm = useCallback((message, onConfirmCallback, title = 'Confirm Action') => {
    confirmCallbackRef.current = onConfirmCallback;
    setConfirmConfig({ isOpen: true, message, title });
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirmCallbackRef.current) confirmCallbackRef.current();
    confirmCallbackRef.current = null;
    setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const closeConfirm = useCallback(() => {
    confirmCallbackRef.current = null;
    setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const value = {
    // Shop & auth
    shopSettings,
    setShopSettings,
    userRole,
    setUserRole,
    cashierName,
    setCashierName,

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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
