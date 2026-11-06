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

export const db = {
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
