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
export const SCAN_TIMEOUT_MS = 200;

// --- Auth ---
export const ADMIN_EMAIL = 'admin@hardwarepos.com';
export const getWorkerEmail = (name) =>
  `${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}@hardwarepos.com`;

// --- Unit Types ---
export const UNIT_TYPES = [
  { value: 'PCS', label: 'Pieces' },
  { value: 'GRAMS', label: 'Grams' },
  { value: 'SQFT', label: 'Sq Ft' },
];

// --- React Query Cache ---
export const STALE_TIME_5MIN = 1000 * 60 * 5;
