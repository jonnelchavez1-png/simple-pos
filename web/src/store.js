// Local storage. The app keeps everything on the device first (IndexedDB), so selling works
// without internet. Google Sheets sync (sync.js) copies data out when a connection is available.
//
// Two interchangeable stores share one API: openDb() for the browser and memoryStore() for tests.
// Records that need syncing carry a numeric `synced` field (0 = waiting, 1 = sent).

import { uid } from './util.js';

const DB_VERSION = 1;
const STORE_DEFS = [
  ['sales', 'id', ['synced', 'date']],
  ['expenses', 'id', ['synced', 'date']],
  ['products', 'id', []],
  ['kv', 'key', []],
];
export const STORE_NAMES = STORE_DEFS.map((d) => d[0]);

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

class IdbStore {
  constructor(db) {
    this.db = db;
  }
  os(store, mode = 'readonly') {
    return this.db.transaction(store, mode).objectStore(store);
  }
  async put(store, value) {
    await wrap(this.os(store, 'readwrite').put(value));
    return value;
  }
  get(store, key) {
    return wrap(this.os(store).get(key));
  }
  getAll(store) {
    return wrap(this.os(store).getAll());
  }
  delete(store, key) {
    return wrap(this.os(store, 'readwrite').delete(key));
  }
  clear(store) {
    return wrap(this.os(store, 'readwrite').clear());
  }
  unsynced(store) {
    return wrap(this.os(store).index('synced').getAll(IDBKeyRange.only(0)));
  }
  close() {
    this.db.close();
  }
}

export function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [store, key, indexes] of STORE_DEFS) {
        if (db.objectStoreNames.contains(store)) continue;
        const os = db.createObjectStore(store, { keyPath: key });
        for (const i of indexes) os.createIndex(i, i);
      }
    };
    req.onsuccess = () => resolve(new IdbStore(req.result));
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other tabs using this app and try again.'));
  });
}

export function deleteDb(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export function memoryStore() {
  const data = Object.fromEntries(STORE_DEFS.map(([s, key]) => [s, { key, rows: new Map() }]));
  const copy = (v) => (v === undefined ? v : structuredClone(v));
  return {
    async put(store, value) {
      data[store].rows.set(value[data[store].key], copy(value));
      return value;
    },
    async get(store, key) {
      return copy(data[store].rows.get(key));
    },
    async getAll(store) {
      return [...data[store].rows.values()].map(copy);
    },
    async delete(store, key) {
      data[store].rows.delete(key);
    },
    async clear(store) {
      data[store].rows.clear();
    },
    async unsynced(store) {
      return [...data[store].rows.values()].filter((r) => r.synced === 0).map(copy);
    },
    close() {},
  };
}

/** The list of businesses on this device (names only; the data lives in one database per business). */
export function createProfiles(storage = globalThis.localStorage) {
  const LIST = 'pos.businesses';
  const ACTIVE = 'pos.activeBusiness';
  const read = () => {
    try {
      return JSON.parse(storage.getItem(LIST) || '[]');
    } catch {
      return [];
    }
  };
  const write = (list) => storage.setItem(LIST, JSON.stringify(list));
  return {
    list: read,
    active() {
      const list = read();
      const id = storage.getItem(ACTIVE);
      return list.find((b) => b.id === id) ?? list[0] ?? null;
    },
    add(name) {
      const list = read();
      const profile = { id: uid().slice(0, 8), name };
      list.push(profile);
      write(list);
      storage.setItem(ACTIVE, profile.id);
      return profile;
    },
    setActive(id) {
      if (read().some((b) => b.id === id)) storage.setItem(ACTIVE, id);
    },
    rename(id, name) {
      write(read().map((b) => (b.id === id ? { ...b, name } : b)));
    },
    remove(id) {
      write(read().filter((b) => b.id !== id));
      if (storage.getItem(ACTIVE) === id) storage.removeItem(ACTIVE);
    },
  };
}

export const dbNameFor = (id) => `simple-pos-${id}`;
