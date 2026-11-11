import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

// ---------------------------------------------------------------
// Application Context
// Provides shared state (shopSettings, userRole, dark mode) and
// shared functions (showAlert, showConfirm) to all descendants,
// eliminating prop drilling through 3-4 component levels.
// ---------------------------------------------------------------

const AppContext = createContext(null);

const SUCCESS_TITLES = new Set(['success', 'saved', 'box opened', 'stock updated', 'recorded', 'item restored', 'restored', 'updated', 'deleted', 'done']);
const isSuccessTitle = (title) => SUCCESS_TITLES.has(String(title || '').trim().toLowerCase());

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

  const pushToastRef = useRef(null);

  // --- Alert Dialog ---
  const [alertConfig, setAlertConfig] = useState({
    isOpen: false,
    message: '',
    title: 'Notice',
  });

  // Success confirmations ("Saved", "Box Opened"...) don't need to interrupt work:
  // they go to a small auto-closing notice (bottom-right). Errors, warnings and
  // anything that needs reading stay in the alert box.
  const showAlert = useCallback((message, title = 'Notice') => {
    if (isSuccessTitle(title)) {
      pushToastRef.current?.(message, { tone: 'success', title: String(title).toLowerCase() === 'success' ? '' : title });
      return;
    }
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

  // --- Toast Notifications (non-blocking, bottom-right, stack up to 3) ---
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const dismissToast = useCallback((id) => setToasts(list => list.filter(t => t.id !== id)), []);
  const pushToast = useCallback((message, { tone = 'info', title = '', duration } = {}) => {
    const id = ++toastIdRef.current;
    const text = typeof message === 'string' ? message : String(message ?? '');
    const ms = duration ?? Math.min(6000, Math.max(2500, text.length * 45));
    setToasts(list => [...list.slice(-2), { id, message: text, tone, title }]);
    setTimeout(() => dismissToast(id), ms);
  }, [dismissToast]);
  useEffect(() => { pushToastRef.current = pushToast; }, [pushToast]);
  // Old signature kept: showToast(message, durationMs)
  const showToast = useCallback((message, durationOrOptions) => {
    if (typeof durationOrOptions === 'number') pushToast(message, { duration: durationOrOptions });
    else pushToast(message, durationOrOptions || {});
  }, [pushToast]);

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
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[99999] flex flex-col items-end gap-2 pointer-events-none print:hidden" role="status" aria-live="polite">
          {toasts.map(t => (
            <div
              key={t.id}
              onClick={() => dismissToast(t.id)}
              className="pointer-events-auto cursor-pointer w-[min(92vw,360px)] flex items-start gap-2.5 px-4 py-3 rounded-[10px] shadow-2xl border animate-fade-in"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: t.tone === 'success' ? 'var(--color-success)' : 'var(--border-medium)',
                borderLeftWidth: 4,
              }}
              title="Click to dismiss"
            >
              {t.tone === 'success' ? (
                <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              <div className="min-w-0">
                {t.title && <p className="text-sm font-semibold text-[var(--text-primary)]">{t.title}</p>}
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-line break-words">{t.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppContext.Provider>
  );
}
