import { openDB } from 'idb';
import { supabase } from '../supabaseClient';

const DB_NAME = 'HardwarePOSDB';
const DB_VERSION = 4;

let cachedInventory = null;
let pieceCountCache = {};

let dbPromise = null;

export const initDB = async () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 4) {
          if (db.objectStoreNames.contains('product_master')) {
            db.deleteObjectStore('product_master');
          }
        }
        
        if (!db.objectStoreNames.contains('product_master')) {
          db.createObjectStore('product_master', { keyPath: ['shop_id', 'barcode'] });
        }
        if (!db.objectStoreNames.contains('offline_queue')) {
          db.createObjectStore('offline_queue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('sync_status')) {
          db.createObjectStore('sync_status', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
};

export const setCachedInventory = (items) => {
  cachedInventory = items ? [...items] : null;
};

export const clearInventoryCache = async () => {
  if (typeof indexedDB !== 'undefined') {
    const db = await initDB();
    await db.clear('product_master');
  }
  cachedInventory = null;
  pieceCountCache = {};
};

export const saveInventoryBatch = async (items) => {
  if (typeof indexedDB === 'undefined') {
    cachedInventory = items ? [...items] : [];
    return;
  }
  const db = await initDB();
  const tx = db.transaction('product_master', 'readwrite');
  items.forEach(item => {
    tx.store.put(item);
  });
  await tx.done;
  cachedInventory = null;
};

export const getInventoryItemByBarcode = async (barcode) => {
  const shopId = localStorage.getItem('shop_id');
  let item;
  if (typeof indexedDB === 'undefined') {
    item = (cachedInventory || []).find(i => i.shop_id === shopId && String(i.barcode) === String(barcode));
  } else {
    const db = await initDB();
    item = await db.get('product_master', [shopId, barcode]);
  }
  if (item && item.batches) {
    item.batches = item.batches.filter(b => b.is_active !== false);
  }
  return item;
};

/**
 * Linguistic helper to stem plurals to singular forms for hardware terminology.
 * (e.g., 'screws' -> 'screw', 'elbows' -> 'elbow', 'inches' -> 'inch')
 */
export function getStem(word) {
  if (!word || word.length <= 3) return word;
  // Plurals ending in -ches, -shes, -sses, -xes, -zes (e.g. inches -> inch, boxes -> box)
  if (/(?:ch|sh|ss|x|z)es$/i.test(word)) {
    return word.slice(0, -2);
  }
  // Standard plurals ending in -s (e.g. screws -> screw, pipes -> pipe, elbows -> elbow)
  if (word.endsWith('s')) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Normalizes hardware dimensions, acronyms, and special characters for token comparison.
 * e.g., 'G.I. Pipe' -> 'gi pipe', '1/2"' -> '1/2 inch', '2.5mm' -> '2.5 mm', punctuation -> spaces
 */
export function normalizeSearchText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    // Acronyms with periods: G.I. -> gi, M.S. -> ms, S.S. -> ss
    .replace(/\b([a-z])\.([a-z])(?:\.([a-z]))?(?:\.)?/g, '$1$2$3')
    // Periods not between digits (preserve 2.5, convert sq.mm -> sq mm, no.1 -> no 1)
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    // Normalize dimensions: 1/2" or 1" -> 1/2 inch, 1 inch
    .replace(/(\d+(?:\/\d+|\.\d+)?)\s*"/g, '$1 inch ')
    // 10' -> 10 ft
    .replace(/(\d+(?:\/\d+|\.\d+)?)\s*'/g, '$1 ft ')
    // Metric & imperial units: separate numbers from unit suffixes (2.5mm -> 2.5 mm, 1/2inch -> 1/2 inch)
    .replace(/(\d+(?:\/\d+|\.\d+)?)\s*(sqmm|sqft|mm|cm|mtr|m|ft|inch|inches|kg|gms|gm|g)\b/gi, '$1 $2 ')
    // Replace punctuation and symbols with spaces, preserving fractions (/) and decimals (.)
    .replace(/["'\-;,:\\_()[\]{}!@#$%^&*+=|~`?<>]/g, ' ')
    // Collapse multi-spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits query string into distinct normalized search tokens.
 */
export function tokenizeQuery(query) {
  if (!query) return [];
  const normalized = normalizeSearchText(query);
  return normalized.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Custom Multi-Token Ranked Scorer (0 KB dependencies)
 * Computes relevance score for hardware & electrical product matches:
 * - Exact barcode match: 10,000 pts
 * - Barcode prefix match: 3,000 pts
 * - Exact product name match: 5,000 pts
 * - Multi-token requirement: Every query token must match in barcode, name, category, or unit
 * - Prefix word match vs exact word match bonuses
 * - Shorter name tie-breaker bonus
 */
export function scoreProductSearch(product, queryTokens, rawCleanQuery) {
  if (!product || !queryTokens || queryTokens.length === 0) return 0;

  const rawBarcode = String(product.barcode || '').trim().toLowerCase();
  const rawName = String(product.name || '').trim().toLowerCase();
  const category = String(product.category || '').trim().toLowerCase();
  const subCategory = String(product.sub_category || '').trim().toLowerCase();
  const unit = String(product.unit || '').trim().toLowerCase();

  // 1. FAST PATH: Exact Barcode Match
  if (rawBarcode === rawCleanQuery) {
    return 10000;
  }

  // 2. Barcode Prefix Match (e.g. typing '100' matches barcode '1001')
  if (rawCleanQuery.length >= 2 && rawBarcode.startsWith(rawCleanQuery)) {
    return 3000 + (rawBarcode.length === rawCleanQuery.length ? 500 : 0);
  }

  // 3. Exact Full Name Match
  if (rawName === rawCleanQuery) {
    return 5000;
  }

  const normName = normalizeSearchText(product.name);
  const nameWords = normName.split(/\s+/).filter(Boolean);

  // Multi-Token Requirement: EVERY token must be matched in barcode, name, category, or unit
  for (const token of queryTokens) {
    const tokenStem = getStem(token);

    // Barcode matching: exact token match, or prefix match of at least 3 characters
    const inBarcode = rawBarcode === token || (token.length >= 3 && rawBarcode.startsWith(token));

    // Name matching: substring or stem match
    const inName = normName.includes(token) || (tokenStem && normName.includes(tokenStem));

    // Category / Subcategory / Unit matching
    const inCat = category.includes(token) || subCategory.includes(token) || unit === token;

    // Unit synonym matching (e.g. 'inch' or 'in' matched if product has fraction or unit 'inch')
    const inUnitSynonym = (token === 'inch' || token === 'in') && (normName.includes('inch') || unit === 'inch' || /\d+\/\d+/.test(normName));

    if (!inBarcode && !inName && !inCat && !inUnitSynonym) {
      return 0; // Missing token, discard
    }
  }

  let score = 100;

  // Bonus: Product name starts with the raw search query
  if (normName.startsWith(rawCleanQuery)) {
    score += 1500;
  } else if (normName.includes(rawCleanQuery)) {
    score += 600;
  }

  // Bonus: First word of product name matches first query token
  if (nameWords.length > 0 && queryTokens.length > 0) {
    const token0Stem = getStem(queryTokens[0]);
    if (nameWords[0] === queryTokens[0] || (token0Stem && nameWords[0] === token0Stem)) {
      score += 400;
    } else if (nameWords[0].startsWith(queryTokens[0])) {
      score += 250;
    }
  }

  // Bonus: Query tokens appear consecutively in the name
  if (queryTokens.length > 1 && normName.includes(queryTokens.join(' '))) {
    score += 300;
  }

  // Token-level scoring
  for (const token of queryTokens) {
    const tokenStem = getStem(token);

    if (nameWords.some(w => w === token || (tokenStem && w === tokenStem))) {
      score += 200; // Exact word match (e.g. 'tap' in 'brass tap')
    } else if (nameWords.some(w => w.startsWith(token) || (tokenStem && w.startsWith(tokenStem)))) {
      score += 100; // Prefix word match (e.g. 'tap' in 'tapping screw')
    } else if (normName.includes(token)) {
      score += 30; // Internal substring match
    }

    if (rawBarcode === token) {
      score += 500;
    } else if (token.length >= 3 && rawBarcode.startsWith(token)) {
      score += 250;
    }

    if (category.includes(token) || subCategory.includes(token) || unit === token) {
      score += 30;
    }
  }

  // Brevity bonus: concise names rank slightly higher for specific searches
  const lengthBonus = Math.max(0, 50 - Math.floor(rawName.length * 0.4));
  score += lengthBonus;

  return score;
}

const compareBarcodes = (a, b) => {
  const numA = parseInt(a, 10);
  const numB = parseInt(b, 10);
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB;
  }
  return String(a).localeCompare(String(b));
};

const applySort = (items, sortOption, currentShopId) => {
  if (sortOption === 'barcode-asc') items.sort((a, b) => compareBarcodes(a.barcode, b.barcode));
  else if (sortOption === 'barcode-desc') items.sort((a, b) => compareBarcodes(b.barcode, a.barcode));
  else if (sortOption === 'name-asc') items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else if (sortOption === 'name-desc') items.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
  else if (sortOption === 'category-asc') items.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
  else if (sortOption === 'category-desc') items.sort((a, b) => (b.category || '').localeCompare(a.category || ''));
  else if (sortOption === 'subcategory-asc') items.sort((a, b) => (a.sub_category || '').localeCompare(b.sub_category || ''));
  else if (sortOption === 'subcategory-desc') items.sort((a, b) => (b.sub_category || '').localeCompare(a.sub_category || ''));
  else if (sortOption === 'whsestock-asc') items.sort((a, b) => {
    const getWhse = (item) => item.is_cuttable ? (pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`]?.warehouse || 0) : (item.batches?.length ? item.batches.filter(b => b.is_active !== false).reduce((sum, batch) => sum + Number(batch.stock_warehouse), 0) : Number(item.stock_warehouse || 0));
    return getWhse(a) - getWhse(b);
  });
  else if (sortOption === 'whsestock-desc') items.sort((a, b) => {
    const getWhse = (item) => item.is_cuttable ? (pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`]?.warehouse || 0) : (item.batches?.length ? item.batches.filter(b => b.is_active !== false).reduce((sum, batch) => sum + Number(batch.stock_warehouse), 0) : Number(item.stock_warehouse || 0));
    return getWhse(b) - getWhse(a);
  });
  else if (sortOption === 'storestock-asc') items.sort((a, b) => {
    const getStore = (item) => item.is_cuttable ? (pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`]?.store || 0) : (item.batches?.length ? item.batches.filter(b => b.is_active !== false).reduce((sum, batch) => sum + Number(batch.stock_store), 0) : Number(item.stock_store || 0));
    return getStore(a) - getStore(b);
  });
  else if (sortOption === 'storestock-desc') items.sort((a, b) => {
    const getStore = (item) => item.is_cuttable ? (pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`]?.store || 0) : (item.batches?.length ? item.batches.filter(b => b.is_active !== false).reduce((sum, batch) => sum + Number(batch.stock_store), 0) : Number(item.stock_store || 0));
    return getStore(b) - getStore(a);
  });
  else items.sort((a, b) => compareBarcodes(a.barcode, b.barcode));
};

export const getInventoryByQuery = async ({ limit, offset, search, category, subcategory, sortOption, viewType, status = 'active' }) => {
  let allItems;
  if (cachedInventory) {
    allItems = [...cachedInventory];
  } else if (typeof indexedDB !== 'undefined') {
    const db = await initDB();
    const tx = db.transaction('product_master', 'readonly');
    cachedInventory = await tx.store.getAll();
    allItems = [...cachedInventory];
  } else {
    allItems = [];
  }
  
  const currentShopId = localStorage.getItem('shop_id');
  allItems = allItems.filter(i => i.shop_id === currentShopId);
  
  if (status === 'deactivated') {
    allItems = allItems.filter(i => i.is_active === false);
  } else {
    allItems = allItems.filter(i => i.is_active !== false);
  }

  // Filter out any inactive batches on active items
  allItems.forEach(i => {
    if (i.batches) {
      i.batches = i.batches.filter(b => b.is_active !== false);
    }
  });

  if (category) {
    const catLower = category.trim().toLowerCase();
    allItems = allItems.filter(i => i.category === category || (i.category && i.category.trim().toLowerCase() === catLower));
  }
  if (subcategory) {
    const subLower = subcategory.trim().toLowerCase();
    allItems = allItems.filter(i => i.sub_category === subcategory || (i.sub_category && i.sub_category.trim().toLowerCase() === subLower));
  }

  // Multi-Token Ranked Search Scorer
  const cleanSearch = (search || '').trim().toLowerCase();
  const queryTokens = cleanSearch ? tokenizeQuery(cleanSearch) : [];

  if (queryTokens.length > 0) {
    const scoredItems = [];
    for (const item of allItems) {
      const score = scoreProductSearch(item, queryTokens, cleanSearch);
      if (score > 0) {
        scoredItems.push({ item, score });
      }
    }

    // If user explicitly picked a non-default column sort (e.g. store stock, warehouse stock, name),
    // respect that order; otherwise rank by search score descending
    const isExplicitCustomSort = sortOption && sortOption !== 'barcode-asc' && sortOption !== 'relevance';

    if (isExplicitCustomSort) {
      allItems = scoredItems.map(s => s.item);
      if (sortOption?.startsWith('whsestock') || sortOption?.startsWith('storestock')) {
        const cuttableItems = allItems.filter(i => i.is_cuttable);
        const uncachedItems = cuttableItems.filter(i => !pieceCountCache[`${currentShopId || 'default'}_${i.barcode}`]);
        if (uncachedItems.length > 0) {
          const promises = uncachedItems.map(async (item) => {
            try {
              const { data } = await supabase.rpc('get_piece_counts', { p_barcode: String(item.barcode) });
              pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`] = data || { warehouse: 0, store: 0 };
            } catch (err) {
              pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`] = { warehouse: 0, store: 0 };
            }
          });
          await Promise.all(promises);
        }
      }
      applySort(allItems, sortOption, currentShopId);
    } else {
      // Relevance-ranked order
      scoredItems.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return compareBarcodes(a.item.barcode, b.item.barcode);
      });
      allItems = scoredItems.map(s => s.item);
    }
  } else {
    // No search query: fetch stock counts if needed and apply requested sortOption
    if (sortOption?.startsWith('whsestock') || sortOption?.startsWith('storestock')) {
      const cuttableItems = allItems.filter(i => i.is_cuttable);
      const uncachedItems = cuttableItems.filter(i => !pieceCountCache[`${currentShopId || 'default'}_${i.barcode}`]);
      if (uncachedItems.length > 0) {
        const promises = uncachedItems.map(async (item) => {
          try {
            const { data } = await supabase.rpc('get_piece_counts', { p_barcode: String(item.barcode) });
            pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`] = data || { warehouse: 0, store: 0 };
          } catch (err) {
            pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`] = { warehouse: 0, store: 0 };
          }
        });
        await Promise.all(promises);
      }
    }
    applySort(allItems, sortOption, currentShopId);
  }

  return {
    data: allItems.slice(offset, offset + limit),
    totalCount: allItems.length
  };
};

export const queueOfflineTransaction = async (payload) => {
  const db = await initDB();
  const timestamp = new Date().toISOString();
  const shopId = payload.shop_id || localStorage.getItem('shop_id');
  await db.put('offline_queue', { ...payload, shop_id: shopId, queued_at: timestamp, status: 'pending', error_message: null });
};

export const getOfflineQueue = async (targetShopId) => {
  const db = await initDB();
  const all = await db.getAll('offline_queue');
  const shopId = targetShopId || localStorage.getItem('shop_id');
  if (shopId) {
    return all.filter(tx => !tx.shop_id || tx.shop_id === shopId);
  }
  return all;
};

export const deleteOfflineTransaction = async (id) => {
  const db = await initDB();
  await db.delete('offline_queue', id);
};

export const markTransactionFailed = async (id, errorMessage) => {
  const db = await initDB();
  const tx = await db.get('offline_queue', id);
  if (tx) {
    await db.put('offline_queue', { ...tx, status: 'failed', error_message: errorMessage });
  }
};

export const requeueTransaction = async (id) => {
  const db = await initDB();
  const tx = await db.get('offline_queue', id);
  if (tx) {
    await db.put('offline_queue', { ...tx, status: 'pending', error_message: null });
  }
};

export const getFailedTransactions = async (targetShopId) => {
  const db = await initDB();
  const all = await db.getAll('offline_queue');
  const shopId = targetShopId || localStorage.getItem('shop_id');
  return all.filter(tx => tx.status === 'failed' && (!shopId || !tx.shop_id || tx.shop_id === shopId));
};

export const getSyncStatus = async (key) => {
  const db = await initDB();
  return db.get('sync_status', key);
};

export const setSyncStatus = async (key, value) => {
  const db = await initDB();
  await db.put('sync_status', { key, ...value });
};

export const getLocalInventoryCount = async (targetShopId) => {
  const db = await initDB();
  const shopId = targetShopId || localStorage.getItem('shop_id');
  const all = await db.getAll('product_master');
  return all.filter(i => !shopId || !i.shop_id || i.shop_id === shopId).length;
};

export const deleteInventoryItemByBarcode = async (barcode, targetShopId) => {
  const db = await initDB();
  const shopId = targetShopId || localStorage.getItem('shop_id');
  await db.delete('product_master', [shopId, barcode]);
  cachedInventory = null;
};

export const deleteOrphanedInventory = async (syncedBarcodes) => {
  const db = await initDB();
  const tx = db.transaction('product_master', 'readwrite');
  let cursor = await tx.store.openCursor();
  const shopId = localStorage.getItem('shop_id');
  while (cursor) {
    const itemShopId = cursor.value.shop_id;
    const bc = cursor.value.barcode;
    const bcStr = String(bc);
    if ((!itemShopId || itemShopId === shopId) && !syncedBarcodes.has(bcStr) && !syncedBarcodes.has(bc)) {
      cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  cachedInventory = null;
};

