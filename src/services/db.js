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

export const clearInventoryCache = async () => {
  const db = await initDB();
  await db.clear('product_master');
  cachedInventory = null;
  pieceCountCache = {};
};

export const saveInventoryBatch = async (items) => {
  const db = await initDB();
  const tx = db.transaction('product_master', 'readwrite');
  items.forEach(item => {
    tx.store.put(item);
  });
  await tx.done;
  cachedInventory = null;
};

export const getInventoryItemByBarcode = async (barcode) => {
  const db = await initDB();
  const shopId = localStorage.getItem('shop_id');
  return db.get('product_master', [shopId, barcode]);
};

export const getInventoryByQuery = async ({ limit, offset, search, category, subcategory, sortOption, viewType, status = 'active' }) => {
  let allItems;
  if (cachedInventory) {
    allItems = [...cachedInventory];
  } else {
    const db = await initDB();
    const tx = db.transaction('product_master', 'readonly');
    cachedInventory = await tx.store.getAll();
    allItems = [...cachedInventory];
  }
  
  const currentShopId = localStorage.getItem('shop_id');
  allItems = allItems.filter(i => i.shop_id === currentShopId);
  
  if (status === 'deactivated') {
    allItems = allItems.filter(i => i.is_active === false);
  } else {
    allItems = allItems.filter(i => i.is_active !== false);
  }

  if (search) {
    const s = search.toLowerCase();
    const escapedS = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexStr = /[0-9]$/.test(s) ? escapedS + "(?![0-9])" : escapedS;
    const searchRegex = new RegExp(regexStr, 'i');

    allItems = allItems.filter(i => 
      (i.name && searchRegex.test(i.name)) || 
      (i.barcode && searchRegex.test(i.barcode))
    );
  }
  if (category) {
    const catLower = category.trim().toLowerCase();
    allItems = allItems.filter(i => i.category === category || (i.category && i.category.trim().toLowerCase() === catLower));
  }
  if (subcategory) {
    const subLower = subcategory.trim().toLowerCase();
    allItems = allItems.filter(i => i.sub_category === subcategory || (i.sub_category && i.sub_category.trim().toLowerCase() === subLower));
  }

  const compareBarcodes = (a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return String(a).localeCompare(String(b));
  };

  if (sortOption?.startsWith('whsestock') || sortOption?.startsWith('storestock')) {
    const cuttableItems = allItems.filter(i => i.is_cuttable);
    const uncachedItems = cuttableItems.filter(i => !pieceCountCache[`${currentShopId || 'default'}_${i.barcode}`]);
    
    if (uncachedItems.length > 0) {
      const promises = uncachedItems.map(async (item) => {
        try {
          const { data } = await supabase.rpc('get_piece_counts', { p_barcode: String(item.barcode) });
          pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`] = data || { warehouse: 0, store: 0 };
        } catch (err) {
          console.error("Failed to fetch piece count for sort:", err);
          pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`] = { warehouse: 0, store: 0 };
        }
      });
      await Promise.all(promises);
    }
  }

  if (sortOption === 'barcode-asc') allItems.sort((a, b) => compareBarcodes(a.barcode, b.barcode));
  else if (sortOption === 'barcode-desc') allItems.sort((a, b) => compareBarcodes(b.barcode, a.barcode));
  else if (sortOption === 'name-asc') allItems.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortOption === 'name-desc') allItems.sort((a, b) => b.name.localeCompare(a.name));
  else if (sortOption === 'category-asc') allItems.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
  else if (sortOption === 'category-desc') allItems.sort((a, b) => (b.category || '').localeCompare(a.category || ''));
  else if (sortOption === 'subcategory-asc') allItems.sort((a, b) => (a.sub_category || '').localeCompare(b.sub_category || ''));
  else if (sortOption === 'subcategory-desc') allItems.sort((a, b) => (b.sub_category || '').localeCompare(a.sub_category || ''));
  else if (sortOption === 'whsestock-asc') allItems.sort((a, b) => {
      const getWhse = (item) => item.is_cuttable ? (pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`]?.warehouse || 0) : (item.batches?.length ? item.batches.reduce((sum, batch) => sum + Number(batch.stock_warehouse), 0) : Number(item.stock_warehouse || 0));
      return getWhse(a) - getWhse(b);
  });
  else if (sortOption === 'whsestock-desc') allItems.sort((a, b) => {
      const getWhse = (item) => item.is_cuttable ? (pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`]?.warehouse || 0) : (item.batches?.length ? item.batches.reduce((sum, batch) => sum + Number(batch.stock_warehouse), 0) : Number(item.stock_warehouse || 0));
      return getWhse(b) - getWhse(a);
  });
  else if (sortOption === 'storestock-asc') allItems.sort((a, b) => {
      const getStore = (item) => item.is_cuttable ? (pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`]?.store || 0) : (item.batches?.length ? item.batches.reduce((sum, batch) => sum + Number(batch.stock_store), 0) : Number(item.stock_store || 0));
      return getStore(a) - getStore(b);
  });
  else if (sortOption === 'storestock-desc') allItems.sort((a, b) => {
      const getStore = (item) => item.is_cuttable ? (pieceCountCache[`${currentShopId || 'default'}_${item.barcode}`]?.store || 0) : (item.batches?.length ? item.batches.reduce((sum, batch) => sum + Number(batch.stock_store), 0) : Number(item.stock_store || 0));
      return getStore(b) - getStore(a);
  });
  else allItems.sort((a, b) => a.barcode.localeCompare(b.barcode));

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
    if ((!itemShopId || itemShopId === shopId) && !syncedBarcodes.has(cursor.value.barcode)) {
      cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  cachedInventory = null;
};

