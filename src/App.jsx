import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import { MobileScannerModal, ProductInfoModal } from './AppModals';
import { AlertDialog, ConfirmDialog } from './Dialog';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './AppContext';
import { startBackgroundSync, stopBackgroundSync } from './services/sync';
import { startLiveRefresh, stopLiveRefresh } from './services/liveRefresh';
import { isRoleConsistentWithEmail, isNetworkishError } from './services/roleGuard';
import { escapeIlike } from './utils';
import { stripOwnerOnlyDataFromLocalInventory, getOfflineQueue } from './services/db';
import { WifiOff, ScanBarcode, Moon, Sun, LogOut, Wifi, RefreshCw, CloudUpload } from 'lucide-react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

const WorkerBilling = lazy(() => import('./WorkerBilling'));
const OwnerDashboard = lazy(() => import('./OwnerDashboard'));
const EntryFlow = lazy(() => import('./EntryFlow'));

function App() {
  const {
    shopSettings, setShopSettings,
    userRole, setUserRole,
    cashierName, setCashierName,
    isDarkMode, toggleDarkMode, setDarkMode,
    alertConfig, showAlert, closeAlert,
    confirmConfig, handleConfirm, closeConfirm,
    showToast,
  } = useApp();

  const [isInitialLoad, setIsInitialLoad] = useState(() => {
    // If shop settings are cached, avoid initial loading spinner block for instant cold start.
    // Exception: a stored "owner" role is held until it is verified against the signed-in
    // account, so owner screens are never shown to a tampered staff session.
    const storedRole = sessionStorage.getItem('posUserRole') || localStorage.getItem('posUserRole');
    return !localStorage.getItem('cached_shop_settings') || storedRole === 'owner';
  });
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncCount, setSyncCount] = useState(0);
  const manifestBlobUrlRef = useRef(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const savedShopId = localStorage.getItem('shop_id');

  // Periodically confirm the logged-in staff member still exists. Removing a worker in
  // Owner > Staff now signs them out on their device within a few minutes.
  // Only a successful "no such worker" answer counts — network errors are ignored so
  // offline counters keep working.
  const { data: workerExists } = useQuery({
    queryKey: ['workerStillExists', savedShopId, cashierName],
    queryFn: async () => {
      let query = supabase.from('workers').select('id').ilike('name', escapeIlike(cashierName));
      if (savedShopId) {
        query = query.eq('shop_id', savedShopId);
      }
      const { data, error } = await query.limit(1);
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },
    enabled: !!cashierName && !!userRole && userRole !== 'owner',
    retry: false,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (workerExists === false && userRole && userRole !== 'owner') {
      queryClient.clear();
      setUserRole(null);
      setCashierName('');
      sessionStorage.removeItem('posUserRole');
      localStorage.removeItem('posUserRole');
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      navigate('/');
      setTimeout(() => showAlert("Your staff account was removed by the owner. You have been logged out.", "Session Expired"), 100);
    }
  }, [workerExists, userRole, navigate, setUserRole, setCashierName, showAlert, queryClient]);




  // Sales saved on this device and not yet sent (shown in the top bar)
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (!userRole) return undefined;
    let alive = true;
    const refresh = () => {
      getOfflineQueue()
        .then(q => { if (alive) setPendingCount(q.filter(t => !t.status || t.status === 'pending' || t.status === 'submitting').length); })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    window.addEventListener('queue_sync_end', refresh);
    window.addEventListener('online', refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('queue_sync_end', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [userRole]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('Back online. Saved sales are being sent.', { tone: 'success', title: 'Online' });
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Keep base font-size normalized at standard 16px to prevent layout distortion on Windows screens
    document.documentElement.style.fontSize = '16px';

    const handleSyncStart = (e) => {
      setIsSyncing(true);
      if (e.detail?.count) setSyncCount(e.detail.count);
    };
    const handleSyncEnd = () => {
      setIsSyncing(false);
      setSyncCount(0);
    };
    window.addEventListener('queue_sync_start', handleSyncStart);
    window.addEventListener('queue_sync_end', handleSyncEnd);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('queue_sync_start', handleSyncStart);
      window.removeEventListener('queue_sync_end', handleSyncEnd);
    };
  }, [showToast]);

  useEffect(() => {
    if (userRole) {
      startBackgroundSync(userRole);
      // Refresh sales / dashboard / showroom / expenses screens when another device changes them
      startLiveRefresh(queryClient, localStorage.getItem('shop_id'));
    }
    return () => {
      stopBackgroundSync();
      stopLiveRefresh();
    };
  }, [userRole, queryClient]);

  useEffect(() => {
    const faviconLink = document.getElementById('app-favicon') || document.querySelector('link[rel="icon"]');
    const appleLink = document.getElementById('app-apple-touch-icon') || document.querySelector('link[rel="apple-touch-icon"]');
    const manifestLink = document.getElementById('app-manifest') || document.querySelector('link[rel="manifest"]');

    if (!shopSettings?.shop_name) {
      document.title = 'Hardware POS System';
      if (faviconLink) faviconLink.href = '/favicon.ico';
      return;
    }

    document.title = shopSettings.shop_name;

    const updateManifest = (icon192Url, icon512Url) => {
      try {
        const dynamicManifest = {
          name: shopSettings.shop_name || 'Hardware POS System',
          short_name: (shopSettings.shop_name || 'Hardware POS').slice(0, 16),
          description: 'Point of Sale & Inventory Management System',
          start_url: '/',
          display: 'standalone',
          theme_color: '#121212',
          background_color: '#121212',
          icons: [
            {
              src: icon192Url,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: icon512Url,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: icon512Url,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        };

        const blob = new Blob([JSON.stringify(dynamicManifest, null, 2)], { type: 'application/manifest+json' });
        const blobUrl = URL.createObjectURL(blob);

        if (manifestBlobUrlRef.current) {
          URL.revokeObjectURL(manifestBlobUrlRef.current);
        }
        manifestBlobUrlRef.current = blobUrl;

        if (manifestLink) {
          manifestLink.href = blobUrl;
        }
      } catch (err) {
        console.error('Failed to inject dynamic manifest:', err);
      }
    };

    const setIcons = (faviconUrl, appleTouchUrl, icon192Url, icon512Url) => {
      if (faviconLink) faviconLink.href = faviconUrl;
      if (appleLink) appleLink.href = appleTouchUrl;
      updateManifest(icon192Url, icon512Url);
    };

    const renderContainedIcon = (img, size, paddingRatio = 0.15, isCircularFavicon = false) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      if (isCircularFavicon) {
        // Full circular clip for desktop browser tab favicon
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        // Transparent outside and behind the circle - no black background border
      } else {
        // Dark background matching #121212 theme for mobile home screen icons
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, size, size);
      }

      if (img) {
        const nw = img.naturalWidth || img.width || 1;
        const nh = img.naturalHeight || img.height || 1;
        const aspect = nw / nh;

        let drawW, drawH;
        if (isCircularFavicon) {
          // Circular desktop favicon: fill the circle edge-to-edge so there are NO black borders
          if (aspect > 1) {
            drawH = size;
            drawW = size * aspect;
          } else {
            drawW = size;
            drawH = size / aspect;
          }
        } else {
          // Mobile PWA / touch icons: safe-zone containment
          const maxDim = size * (1 - paddingRatio * 2);
          if (aspect > 1) {
            drawH = maxDim / aspect;
            drawW = maxDim;
          } else {
            drawW = maxDim * aspect;
            drawH = maxDim;
          }
        }

        const offsetX = (size - drawW) / 2;
        const offsetY = (size - drawH) / 2;

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      }

      return canvas.toDataURL('image/png');
    };

    if (shopSettings.logo_url) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          // 1. Favicon (64x64): edge-to-edge circular logo, 0 padding, no black border
          const favDataUrl = renderContainedIcon(img, 64, 0, true);

          // 2. Apple Touch Icon & PWA 192x192 with safe-zone containment
          const icon192DataUrl = renderContainedIcon(img, 192, 0.15, false);

          // 3. PWA 512x512 high-res maskable icon
          const icon512DataUrl = renderContainedIcon(img, 512, 0.15, false);

          setIcons(favDataUrl, icon192DataUrl, icon192DataUrl, icon512DataUrl);
        } catch (canvasErr) {
          console.warn('Canvas export tainted by CORS, using direct logo URL for icons:', canvasErr);
          setIcons(shopSettings.logo_url, shopSettings.logo_url, shopSettings.logo_url, shopSettings.logo_url);
        }
      };
      img.onerror = () => {
        setIcons(shopSettings.logo_url, shopSettings.logo_url, shopSettings.logo_url, shopSettings.logo_url);
      };
      img.src = shopSettings.logo_url;
    } else {
      // Dynamic avatar when no custom logo is uploaded
      const initial = (shopSettings.shop_name || 'H').trim().charAt(0).toUpperCase();

      const renderInitialIcon = (size, paddingRatio = 0.15, isCircularFavicon = false) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        if (isCircularFavicon) {
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.fillStyle = '#2563eb';
          ctx.fillRect(0, 0, size, size);
        } else {
          ctx.fillStyle = '#121212';
          ctx.fillRect(0, 0, size, size);

          const badgeSize = size * (1 - paddingRatio * 2);
          ctx.fillStyle = '#2563eb';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, badgeSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        const badgeSize = isCircularFavicon ? size : size * (1 - paddingRatio * 2);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(badgeSize * 0.55)}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initial, size / 2, size / 2 + Math.round(badgeSize * 0.04));

        return canvas.toDataURL('image/png');
      };

      const favDataUrl = renderInitialIcon(64, 0, true);
      const icon192DataUrl = renderInitialIcon(192, 0.15, false);
      const icon512DataUrl = renderInitialIcon(512, 0.15, false);

      setIcons(favDataUrl, icon192DataUrl, icon192DataUrl, icon512DataUrl);
    }

    return () => {
      if (manifestBlobUrlRef.current) {
        URL.revokeObjectURL(manifestBlobUrlRef.current);
      }
    };
  }, [shopSettings?.shop_name, shopSettings?.logo_url]);

  const fetchInitialData = useCallback(async () => {
    try {
      // 1. Instantly rehydrate remembered shop settings from localStorage
      let cachedShop = null;
      try {
        const raw = localStorage.getItem('cached_shop_settings');
        if (raw) cachedShop = JSON.parse(raw);
      } catch (e) {
        console.warn('Failed to parse cached shop settings:', e);
      }

      const savedShopId = localStorage.getItem('shop_id') || cachedShop?.id;

      if (cachedShop) {
        setShopSettings(cachedShop);
        if (cachedShop.id && !localStorage.getItem('shop_id')) {
          localStorage.setItem('shop_id', cachedShop.id);
        }
      }

      // If we have either a saved shop ID or cached shop settings, the shop is remembered!
      const shopIsRegistered = Boolean(savedShopId || cachedShop);
      setIsSetupNeeded(!shopIsRegistered);

      // 2. Check active Supabase authentication session
      const { data: { session } } = await supabase.auth.getSession();
      let currentShop = cachedShop;

      if (session) {
        // If authenticated and we have a shopId, refresh shop settings from database in background
        let settingsRow = null;
        let settingsUnreachable = false;
        if (savedShopId) {
          try {
            let settingsQuery = supabase
              .from('shop_settings')
              .select('*')
              .eq('id', savedShopId);
            // Don't hang start-up on a dead connection: give up after 8s and use the cached copy
            if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
              settingsQuery = settingsQuery.abortSignal(AbortSignal.timeout(8000));
            }
            const { data: settingsData, error: settingsError } = await settingsQuery.maybeSingle();

            if (settingsError) {
              settingsUnreachable = isNetworkishError(settingsError);
              console.warn('Could not refresh shop settings from server:', settingsError);
            }
            if (settingsData) {
              settingsRow = settingsData;
              currentShop = settingsData;
              setShopSettings(settingsData);
              try {
                localStorage.setItem('cached_shop_settings', JSON.stringify(settingsData));
                localStorage.setItem('shop_id', settingsData.id);
              } catch (e) {}
            }
          } catch (settingsErr) {
            settingsUnreachable = isNetworkishError(settingsErr);
            console.warn('Could not refresh shop settings from server:', settingsErr);
          }
        }

        // Restore active user role if rememberMe or session exists
        const savedRole = sessionStorage.getItem('posUserRole') || localStorage.getItem('posUserRole');
        if (savedRole) {
          // The stored role is editable in the browser, so verify it against the account that
          // actually logged in. For "owner" we trust the admin email from the server; only when
          // the server is unreachable (offline) do we fall back to the cached copy.
          const adminEmail = settingsRow?.admin_email
            || (settingsUnreachable || !savedShopId ? cachedShop?.admin_email : null);
          const roleIsGenuine = isRoleConsistentWithEmail(savedRole, session.user?.email, {
            adminEmail,
            shopId: savedShopId,
          });

          if (roleIsGenuine) {
            setUserRole(savedRole);
            const displayName = savedRole === 'owner'
              ? (currentShop?.owner_name || 'Administrator')
              : savedRole;
            setCashierName(displayName);
          } else {
            console.warn('[Auth] Stored role does not match the signed-in account. Signing out.');
            sessionStorage.removeItem('posUserRole');
            localStorage.removeItem('posUserRole');
            setUserRole(null);
            setCashierName('');
            queryClient.clear();
            try { await supabase.auth.signOut({ scope: 'local' }); } catch (e) {}
            setTimeout(() => showAlert('Your session could not be verified. Please log in again.', 'Session Expired'), 100);
          }
        }
      } else {
        // Ephemeral session expired or not authenticated
        sessionStorage.removeItem('posUserRole');
        localStorage.removeItem('posUserRole');
      }
    } catch (error) {
      console.error('System Load Error:', error.message);
    } finally {
      setIsInitialLoad(false);
    }
  }, [setShopSettings, setUserRole, setCashierName, queryClient, showAlert]);

  useEffect(() => { fetchInitialData(); }, [fetchInitialData]);

  const closeMobileScanner = useCallback(() => setIsMobileScannerOpen(false), []);

  const handleLoginSuccess = (role, rememberMe = false) => {
    setUserRole(role);
    if (rememberMe) {
      localStorage.setItem('posUserRole', role);
      sessionStorage.removeItem('posUserRole');
    } else {
      sessionStorage.setItem('posUserRole', role);
      localStorage.removeItem('posUserRole');
    }
    const displayName = role === 'owner'
      ? (shopSettings?.owner_name || 'Administrator')
      : role;
    setCashierName(displayName);
    if (role === 'owner') navigate('/owner/dashboard');
    else navigate('/terminal/dashboard');
  };

  const confirmLogout = async () => {
    // Stop background sync first so it can't re-download cost data while we strip it
    stopBackgroundSync();
    if (userRole === 'owner') {
      try {
        await stripOwnerOnlyDataFromLocalInventory();
      } catch (e) {
        console.warn('Could not clear owner-only data from this device:', e);
      }
    }
    await supabase.auth.signOut();
    queryClient.clear();
    setUserRole(null);
    setCashierName('');
    sessionStorage.removeItem('posUserRole');
    localStorage.removeItem('posUserRole');
    setShowLogoutConfirm(false);
    navigate('/');
  };

  if (isInitialLoad) {
    return (
      <div
        className="w-full min-h-[100dvh] flex flex-col items-center justify-center"
        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
      >
        <PageLoader text="Initializing Subsystems" />
      </div>
    );
  }

  if (isSetupNeeded || !userRole) {
    return (
      <Suspense fallback={<div className="w-full min-h-[100dvh] flex items-center justify-center bg-[var(--bg-tertiary)]"><PageLoader text="Loading..." /></div>}>
        <EntryFlow
          onLoginSuccess={handleLoginSuccess}
          isSetupNeeded={isSetupNeeded}
          onSetupComplete={(s) => {
            queryClient.clear();
            setShopSettings(s);
            try {
              localStorage.setItem('cached_shop_settings', JSON.stringify(s));
            } catch (e) {}
            setIsSetupNeeded(false);
          }}
          shopSettings={shopSettings}
        />
      </Suspense>
    );
  }

  return (
    <div
      className="w-full h-[100dvh] flex flex-col overflow-hidden relative"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      {!isOnline && (
        <div role="status" className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-center py-1.5 z-[100] print:hidden" style={{ backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderBottom: '1px solid var(--color-warning-border)' }}>
          <WifiOff size={15} aria-hidden="true" />
          <span>Offline: sales are saved on this device and sent when the internet is back.</span>
        </div>
      )}
      {isOnline && isSyncing && (
        <div role="status" className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-center py-1.5 z-[100] print:hidden" style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', borderBottom: '1px solid var(--color-accent-border)' }}>
          <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
          <span>Sending {syncCount} saved sale{syncCount !== 1 ? 's' : ''} to the server…</span>
        </div>
      )}
      {/* SHARED DIALOGS — rendered from context state */}
      <AlertDialog
        isOpen={alertConfig.isOpen}
        title={alertConfig.title}
        message={alertConfig.message}
        onClose={closeAlert}
      />
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
        confirmLabel={confirmConfig.confirmLabel}
        cancelLabel={confirmConfig.cancelLabel}
        isDestructive={confirmConfig.isDestructive}
      />

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="Sign Out"
        message="You will be logged out of the current session. Any unsaved data will be lost. Continue?"
        confirmLabel="Sign Out"
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      {isMobileScannerOpen && (
        <MobileScannerModal
          onClose={closeMobileScanner}
          setScannedProduct={setScannedProduct}
        />
      )}

      {scannedProduct && (
        <ProductInfoModal
          product={scannedProduct}
          onClose={() => setScannedProduct(null)}
        />
      )}


      {/* NAVBAR */}
      <nav
        className="w-full md:w-auto shadow-sm h-[46px] md:h-[58px] flex-shrink-0 relative z-[9999] print:hidden md:mx-3 md:my-2 lg:mx-4 lg:my-3 md:rounded-xl border-b md:border border-[var(--border-medium)] md:border-[var(--border-light)]"
        style={{
          backgroundColor: 'var(--bg-secondary)',
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="w-full flex items-center justify-between h-full">
          <div className="h-full flex items-center gap-2.5 flex-shrink-0 min-w-0 px-3 md:px-4 w-auto md:w-56 lg:w-auto">
            {shopSettings?.logo_url ? (
              <img src={shopSettings.logo_url} alt="" className="w-7 h-7 md:w-8 md:h-8 rounded-md object-cover shrink-0 border border-[var(--border-light)]" />
            ) : (
              <span aria-hidden="true" className="w-7 h-7 md:w-8 md:h-8 rounded-md shrink-0 flex items-center justify-center text-sm font-bold text-white bg-[var(--color-accent-solid)]">
                {(shopSettings?.shop_name || 'H').trim().charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-semibold truncate max-w-[40vw] md:max-w-[260px]" style={{ color: 'var(--text-primary)' }} title={shopSettings?.shop_name || ''}>
                {shopSettings?.shop_name || 'Hardware POS'}
              </p>
              <p className="text-xs truncate max-w-[40vw] md:max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                {cashierName}{userRole ? ` · ${userRole === 'owner' ? 'Owner' : 'Staff'}` : ''}
              </p>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex items-center justify-end gap-1.5 md:gap-3 h-full pl-2 pr-2.5 md:pr-4 overflow-x-hidden md:overflow-x-auto hide-scrollbar" style={{ scrollbarWidth: 'none' }}>
            {pendingCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 border"
                style={{ color: 'var(--color-warning)', backgroundColor: 'var(--color-warning-bg)', borderColor: 'var(--color-warning-border)' }}
                title="Sales saved on this device that have not reached the server yet"
              >
                <CloudUpload size={14} aria-hidden="true" />
                <span>{pendingCount}<span className="hidden md:inline"> waiting to send</span></span>
              </span>
            )}
            <span
              role="status"
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 border"
              style={!isOnline
                ? { color: 'var(--color-warning)', backgroundColor: 'var(--color-warning-bg)', borderColor: 'var(--color-warning-border)' }
                : isSyncing
                  ? { color: 'var(--color-accent)', backgroundColor: 'var(--color-accent-bg)', borderColor: 'var(--color-accent-border)' }
                  : { color: 'var(--color-success)', backgroundColor: 'var(--color-success-bg)', borderColor: 'var(--color-success-border)' }}
              title={!isOnline ? 'No internet: sales are saved on this device' : isSyncing ? 'Sending saved sales' : 'Connected'}
            >
              {!isOnline ? <WifiOff size={14} aria-hidden="true" /> : isSyncing ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <Wifi size={14} aria-hidden="true" />}
              <span className="hidden sm:inline">{!isOnline ? 'Offline' : isSyncing ? 'Sending…' : 'Online'}</span>
            </span>



            <button
              type="button"
              onClick={toggleDarkMode}
              className="h-8 w-8 md:h-9 md:w-auto rounded-md px-0 md:px-3 text-xs font-semibold transition-colors shrink-0 flex items-center justify-center gap-2 border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-heavy)] cursor-pointer"
              aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              title={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {isDarkMode ? <Sun size={15} strokeWidth={2.25} /> : <Moon size={15} strokeWidth={2.25} />}
              <span className="hidden md:inline">{isDarkMode ? 'Light' : 'Dark'}</span>
            </button>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="h-8 w-8 md:h-9 md:w-auto rounded-md px-0 md:px-4 text-xs font-semibold transition-colors shrink-0 flex items-center justify-center gap-2 border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-heavy)] cursor-pointer"
              aria-label="Sign Out"
              title="Sign Out"
            >
              <span className="hidden md:inline">Sign Out</span>
              <LogOut size={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main
        className="flex-1 flex flex-col w-full md:px-3 md:pb-3 lg:px-4 lg:pb-4 overflow-y-auto min-h-0 relative z-10 print:static"
        role="main"
        aria-label="Application content"
      >
        <Suspense fallback={<div className="w-full h-full flex-1 flex flex-col items-center justify-center min-h-[300px] p-8"><PageLoader text="Loading..." /></div>}>
          <Routes>
            {userRole === 'owner' && (
              <>
                <Route path="/owner/:tab" element={<OwnerDashboard />} />
                <Route path="/owner" element={<Navigate to="/owner/dashboard" replace />} />
              </>
            )}
            {userRole && (
              <>
                <Route path="/terminal/:tab" element={<WorkerBilling />} />
                <Route path="/terminal" element={<Navigate to="/terminal/dashboard" replace />} />
              </>
            )}
            <Route path="*" element={<Navigate to={userRole === 'owner' ? "/owner/dashboard" : "/terminal/dashboard"} replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default App;