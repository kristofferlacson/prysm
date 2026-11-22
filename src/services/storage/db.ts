/** Minimal promise wrapper around IndexedDB. */

const DB_NAME = 'prysm';
const DB_VERSION = 2;
export type StoreName = 'projects' | 'assets' | 'rasters';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rasters')) db.createObjectStore('rasters', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const dbGet = <T>(store: StoreName, id: string) => run<T | undefined>(store, 'readonly', (s) => s.get(id));
export const dbGetAll = <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll());
export const dbKeys = (store: StoreName) => run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
export const dbPut = <T>(store: StoreName, value: T) => run(store, 'readwrite', (s) => s.put(value));
export const dbDelete = (store: StoreName, id: string) => run(store, 'readwrite', (s) => s.delete(id));
