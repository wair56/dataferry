export const IDB_STORE = 'transfer-cache';
export const SYNC_STORE = 'sync-state'; // 用来存上次传输成功时的版本号及目标端token映射

let dbPromise: Promise<IDBDatabase> | null = null;
function getDB() {
  if (typeof window === 'undefined') return Promise.reject('SSR unsupported');
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('DataFerryDB', 2);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        if (!db.objectStoreNames.contains(SYNC_STORE)) db.createObjectStore(SYNC_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function idbGet(storeName: string, key: string): Promise<any> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

export async function idbSet(storeName: string, key: string, value: any): Promise<void> {
  try {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
}

export async function idbClear(storeName: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
}

/**
 * 带 IDB 强缓存的 fetch 包装器（支持 POST Body 散列，非常强大）
 */
export async function fetchWithIdbCache(url: string, options?: RequestInit, forceRefresh = false): Promise<any> {
   const cacheKey = url + (options?.body ? `|${String(options.body)}` : '');
   
   if (!forceRefresh) {
     const cached = await idbGet(IDB_STORE, cacheKey);
     if (cached) return cached;
   }
   
   const res = await fetch(url, options);
   const data = await res.json();
   
   // 仅对请求成功且存在文件/子节点的数据进行拦截存储
   if (res.ok && data) {
     if (!data.error && (Array.isArray(data.items) || Array.isArray(data.files))) {
       await idbSet(IDB_STORE, cacheKey, data);
     }
   }
   return data;
}
