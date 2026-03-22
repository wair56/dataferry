type TransferCacheItem = {
  id: string; // url 或 token 作为唯一键
  token: string;
  name: string;
  type: string;
  path: string;
  spaceId?: string;
  modifiedTime?: number; // 服务端返回的 modified_time，用来做比对
  lastTransferredTime?: number; // 上次成功传输到目标端的时间或版本特征
  status?: string; // success 等
};

export type DataCacheItem = {
  id: string; // fileToken 或者 blockId
  type: string; // 'docx' | 'bitable' | 'sheet' 等
  payload: any; // 原始块或者数据的巨型 JSON
  fetchedAt: number;
};

const DB_NAME = 'feishu-lark-cache';
const STORE_NAME = 'transfer_history';
const DATA_STORE_NAME = 'data_cache';
const DB_VERSION = 2; // 升级版本号以创建新表

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') return Promise.reject('Only browser environment supported');
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(DATA_STORE_NAME)) {
          // 用于存储超大 JSON Payload 的新表
          db.createObjectStore(DATA_STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }
  return dbPromise;
}

export async function saveDataCache(item: DataCacheItem): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(DATA_STORE_NAME);
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getDataCache(id: string): Promise<DataCacheItem | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE_NAME, 'readonly');
    const store = tx.objectStore(DATA_STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// 修改原有的 clearAllHistory 顺手也清理数据缓存
export async function clearAllDetailsCache(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(DATA_STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function saveTransferHistory(item: TransferCacheItem): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function saveTransferHistories(items: TransferCacheItem[]): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getTransferHistory(id: string): Promise<TransferCacheItem | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function clearAllHistory(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function checkNeedTransfer(files: { id: string; modifiedTime?: number }[]): Promise<Record<string, { need: boolean; cachedItem?: TransferCacheItem }>> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const result: Record<string, { need: boolean; cachedItem?: TransferCacheItem }> = {};
    let pending = files.length;
    
    if (pending === 0) {
      resolve(result);
      return;
    }

    files.forEach(file => {
      const request = store.get(file.id);
      request.onsuccess = () => {
        const cached = request.result as TransferCacheItem;
        if (cached && cached.status === 'success' && cached.modifiedTime && file.modifiedTime && cached.modifiedTime >= file.modifiedTime) {
          result[file.id] = { need: false, cachedItem: cached };
        } else {
          result[file.id] = { need: true, cachedItem: cached };
        }
        pending--;
        if (pending === 0) resolve(result);
      };
      request.onerror = () => {
        result[file.id] = { need: true }; // 报错默认传
        pending--;
        if (pending === 0) resolve(result);
      };
    });
  });
}

export async function checkHasDataCache(ids: string[]): Promise<Record<string, boolean>> {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction(DATA_STORE_NAME, 'readonly');
    const store = tx.objectStore(DATA_STORE_NAME);
    const result: Record<string, boolean> = {};
    let pending = ids.length;
    
    if (pending === 0) return resolve(result);

    ids.forEach(id => {
      const request = store.get(id);
      request.onsuccess = () => {
        result[id] = !!request.result;
        pending--;
        if (pending === 0) resolve(result);
      };
      request.onerror = () => {
        result[id] = false;
        pending--;
        if (pending === 0) resolve(result);
      };
    });
  });
}
