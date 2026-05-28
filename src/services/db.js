import { openDB } from 'idb';

const DB_NAME = 'HardwarePOSDB';
const DB_VERSION = 1;

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('inventory')) {
        db.createObjectStore('inventory', { keyPath: 'barcode' });
      }
      if (!db.objectStoreNames.contains('offline_queue')) {
        db.createObjectStore('offline_queue', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('sync_status')) {
        db.createObjectStore('sync_status', { keyPath: 'key' });
      }
    },
  });
};

export const clearInventoryCache = async () => {
  const db = await initDB();
  await db.clear('inventory');
};

export const saveInventoryBatch = async (items) => {
  const db = await initDB();
  const tx = db.transaction('inventory', 'readwrite');
  items.forEach(item => {
    tx.store.put(item);
  });
  await tx.done;
};

export const getInventoryItemByBarcode = async (barcode) => {
  const db = await initDB();
  return db.get('inventory', barcode);
};

export const getInventoryByQuery = async ({ limit, offset, search, category, subcategory, sortOption, viewType }) => {
  const db = await initDB();
  const tx = db.transaction('inventory', 'readonly');
  let allItems = await tx.store.getAll();
  allItems = allItems.filter(i => i.is_active !== false);

  if (search) {
    const s = search.toLowerCase();
    allItems = allItems.filter(i => 
      (i.name && i.name.toLowerCase().includes(s)) || 
      (i.barcode && i.barcode.toLowerCase().includes(s))
    );
  }
  if (category) {
    allItems = allItems.filter(i => i.category === category);
  }
  if (subcategory) {
    allItems = allItems.filter(i => i.sub_category === subcategory);
  }

  const compareBarcodes = (a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return String(a).localeCompare(String(b));
  };

  if (sortOption === 'barcode-asc') allItems.sort((a, b) => compareBarcodes(a.barcode, b.barcode));
  else if (sortOption === 'barcode-desc') allItems.sort((a, b) => compareBarcodes(b.barcode, a.barcode));
  else if (sortOption === 'name-asc') allItems.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortOption === 'name-desc') allItems.sort((a, b) => b.name.localeCompare(a.name));
  else if (sortOption === 'stock-asc') allItems.sort((a, b) => Number(viewType === 'warehouse' ? a.stock_warehouse : a.stock_store) - Number(viewType === 'warehouse' ? b.stock_warehouse : b.stock_store));
  else if (sortOption === 'stock-desc') allItems.sort((a, b) => Number(viewType === 'warehouse' ? b.stock_warehouse : b.stock_store) - Number(viewType === 'warehouse' ? a.stock_warehouse : a.stock_store));
  else allItems.sort((a, b) => a.barcode.localeCompare(b.barcode));

  return {
    data: allItems.slice(offset, offset + limit),
    totalCount: allItems.length
  };
};

export const queueOfflineTransaction = async (payload) => {
  const db = await initDB();
  const timestamp = new Date().toISOString();
  await db.put('offline_queue', { ...payload, queued_at: timestamp });
};

export const getOfflineQueue = async () => {
  const db = await initDB();
  return db.getAll('offline_queue');
};

export const deleteOfflineTransaction = async (id) => {
  const db = await initDB();
  await db.delete('offline_queue', id);
};

export const getSyncStatus = async (key) => {
  const db = await initDB();
  return db.get('sync_status', key);
};

export const setSyncStatus = async (key, value) => {
  const db = await initDB();
  await db.put('sync_status', { key, ...value });
};
