// Storage shim for zustand `persist` stores that also run server-side.
//
// In the browser this is window.localStorage. Inside the scheduled server
// engine (Cloudflare Worker) there is no localStorage, so persisted stores
// fall back to a per-isolate in-memory map instead of throwing.

const mem = new Map<string, string>();

const memoryStorage: Storage = {
  get length() {
    return mem.size;
  },
  clear: () => mem.clear(),
  getItem: (k) => mem.get(k) ?? null,
  key: (i) => [...mem.keys()][i] ?? null,
  removeItem: (k) => void mem.delete(k),
  setItem: (k, v) => void mem.set(k, v),
};

export function safeStorage(): Storage {
  return typeof window !== "undefined" && window.localStorage ? window.localStorage : memoryStorage;
}
