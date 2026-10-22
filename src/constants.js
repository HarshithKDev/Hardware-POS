// ---------------------------------------------------------------
// Application-wide constants
// Centralizes magic numbers and configuration values that were
// previously scattered across components.
// ---------------------------------------------------------------

// --- Inventory Thresholds ---
export const STORE_LOW_STOCK_THRESHOLD = 10;
export const WAREHOUSE_LOW_STOCK_THRESHOLD = 20;
export const DEAD_STOCK_ALARM_VALUE = 5000;

// --- Pagination ---
export const INV_PER_PAGE = 50;
export const SALES_PER_PAGE = 20;

// --- Barcode ---
export const BARCODE_START_VALUE = '1001';
export const BARCODE_RETRY_ATTEMPTS = 5;
export const SCAN_TIMEOUT_MS = 400;

// --- Auth ---
export const getAdminEmail = () => localStorage.getItem('owner_email') || 'admin@hardwarepos.com';
export const getWorkerEmail = (name, shopId) => {
  const cleanName = (name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const resolvedShopId = (shopId || (typeof localStorage !== 'undefined' ? localStorage.getItem('shop_id') : '') || '')
    .trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (resolvedShopId) {
    return `${cleanName}.${resolvedShopId.slice(0, 8)}@hardwarepos.com`;
  }
  return `${cleanName}@hardwarepos.com`;
};

export const getLegacyWorkerEmail = (name) => {
  const cleanName = (name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${cleanName}@hardwarepos.com`;
};

// --- Unit Types ---
export const UNIT_TYPES = [
  { value: 'PCS', label: 'Pieces' },
  { value: 'KG', label: 'KG (per kg)' },
  { value: 'SQFT', label: 'Sq Ft' },
  { value: 'METER', label: 'Meters (m)' },
  { value: 'FT', label: 'Feet (FT)' },
];

// --- React Query Cache ---
export const STALE_TIME_5MIN = 1000 * 60 * 5;
