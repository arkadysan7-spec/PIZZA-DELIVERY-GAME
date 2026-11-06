// Tiny IndexedDB wrapper: customers + renders (images stored as Blobs on the device).
const DB_NAME = 'shower-visualizer';
let dbp;
function open() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('customers', { keyPath: 'id' });
      const r = d.createObjectStore('renders', { keyPath: 'id' });
      r.createIndex('customerId', 'customerId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(stores, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const idb = {
  async customers() {
    const all = await tx('customers', 'readonly', (t) => reqP(t.objectStore('customers').getAll()));
    return all.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  },
  putCustomer(c) {
    return tx('customers', 'readwrite', (t) => t.objectStore('customers').put({ ...c, updatedAt: Date.now() }));
  },
  async deleteCustomer(id) {
    const renders = await this.rendersFor(id);
    return tx(['customers', 'renders'], 'readwrite', (t) => {
      t.objectStore('customers').delete(id);
      renders.forEach((r) => t.objectStore('renders').delete(r.id));
    });
  },
  async rendersFor(customerId) {
    const all = await tx('renders', 'readonly', (t) => reqP(t.objectStore('renders').index('customerId').getAll(customerId)));
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  async renderCounts() {
    const keys = await tx('renders', 'readonly', (t) => {
      const idx = t.objectStore('renders').index('customerId');
      return new Promise((res) => {
        const counts = {};
        idx.openKeyCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return res(counts);
          counts[c.key] = (counts[c.key] || 0) + 1;
          c.continue();
        };
      });
    });
    return keys;
  },
  async putRender(r) {
    await tx('renders', 'readwrite', (t) => t.objectStore('renders').put(r));
    const c = await tx('customers', 'readonly', (t) => reqP(t.objectStore('customers').get(r.customerId)));
    if (c) await this.putCustomer(c); // bump to top of the list
  },
  deleteRender(id) {
    return tx('renders', 'readwrite', (t) => t.objectStore('renders').delete(id));
  },
};

// In-memory fallback when IndexedDB is unavailable (private mode, blocked site data).
const mem = { customers: new Map(), renders: new Map() };
const memDb = {
  async customers() { return [...mem.customers.values()].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)); },
  async putCustomer(c) { mem.customers.set(c.id, { ...c, updatedAt: Date.now() }); },
  async deleteCustomer(id) { mem.customers.delete(id); for (const [k, r] of mem.renders) if (r.customerId === id) mem.renders.delete(k); },
  async rendersFor(id) { return [...mem.renders.values()].filter((r) => r.customerId === id).sort((a, b) => b.createdAt - a.createdAt); },
  async renderCounts() { const c = {}; for (const r of mem.renders.values()) c[r.customerId] = (c[r.customerId] || 0) + 1; return c; },
  async putRender(r) { mem.renders.set(r.id, r); const c = mem.customers.get(r.customerId); if (c) await this.putCustomer(c); },
  async deleteRender(id) { mem.renders.delete(id); },
};

let impl = null;
async function pick() {
  if (impl) return impl;
  try {
    if (!('indexedDB' in self)) throw new Error('no idb');
    await open();
    impl = idb;
  } catch {
    impl = memDb;
  }
  return impl;
}
export const db = new Proxy({}, {
  get: (_, name) => async (...args) => (await pick())[name](...args),
});
