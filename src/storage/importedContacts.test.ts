import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadImportedContacts,
  saveImportedContacts,
  hasImportedContacts,
} from "./importedContacts";
import type { Contact } from "../data/contacts";

// jsdom ships no IndexedDB. These functions are written to degrade gracefully when the
// store is unavailable, AND to round-trip when it is. We test both: first the
// no-IndexedDB fallback, then the happy path against a tiny in-memory fake that
// implements exactly the request/transaction shape importedContacts.ts uses.

function contact(over: Partial<Contact> = {}): Contact {
  return {
    first: "Jane",
    last: "Doe",
    organisation: "Acme",
    position: "Manager",
    sector_detail: "",
    sector_group: "Technology",
    sub_group: "",
    seniority: "Manager",
    function: "Technology & Engineering",
    messaged: false,
    responded: false,
    two_way: false,
    agreed_to_meet: false,
    met: false,
    url: "https://x.com/in/jane",
    phone: "",
    ...over,
  };
}

// ── Minimal in-memory IndexedDB fake ────────────────────────────────────────
// Backing store: dbName → storeName → (key → value).
function makeFakeIndexedDB() {
  const data = new Map<string, Map<string, Map<string, unknown>>>();

  function fireAsync<T extends { onsuccess?: (() => void) | null }>(
    req: T,
    apply: () => void,
  ) {
    queueMicrotask(() => {
      apply();
      req.onsuccess?.();
    });
  }

  return {
    _data: data,
    open(name: string) {
      const req: {
        result: unknown;
        error: unknown;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      } = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      if (!data.has(name)) data.set(name, new Map());
      const stores = data.get(name)!;

      const db = {
        objectStoreNames: {
          contains: (s: string) => stores.has(s),
        },
        createObjectStore: (s: string) => {
          if (!stores.has(s)) stores.set(s, new Map());
          return {};
        },
        transaction: (storeName: string) => {
          if (!stores.has(storeName)) stores.set(storeName, new Map());
          const store = stores.get(storeName)!;
          const tx: {
            oncomplete: (() => void) | null;
            onerror: (() => void) | null;
            error: unknown;
            objectStore: (n: string) => unknown;
          } = {
            oncomplete: null,
            onerror: null,
            error: null,
            objectStore: () => ({
              get: (key: string) => {
                const r: {
                  result: unknown;
                  error: unknown;
                  onsuccess: (() => void) | null;
                  onerror: (() => void) | null;
                } = { result: undefined, error: null, onsuccess: null, onerror: null };
                fireAsync(r, () => {
                  r.result = store.get(key);
                });
                return r;
              },
              put: (value: unknown, key: string) => {
                store.set(key, value);
                queueMicrotask(() => tx.oncomplete?.());
                return {};
              },
            }),
          };
          return tx;
        },
      };
      req.result = db;
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  // Opt into demo so the record key is "demo". (The safe default is now "owned"; this store
  // keys at call time, so setting the flag here — not before import — is sufficient.)
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("graceful degradation without IndexedDB", () => {
  it("loadImportedContacts returns [] when indexedDB is unavailable", async () => {
    // jsdom has no indexedDB; ensure the call resolves to [] rather than throwing.
    await expect(loadImportedContacts()).resolves.toEqual([]);
  });

  it("hasImportedContacts returns false when indexedDB is unavailable", async () => {
    await expect(hasImportedContacts()).resolves.toBe(false);
  });
});

describe("round-trip against an in-memory IndexedDB fake", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", makeFakeIndexedDB());
  });

  it("saves then loads the same contacts", async () => {
    const contacts = [contact({ url: "https://x.com/in/a" }), contact({ url: "https://x.com/in/b" })];
    const returned = await saveImportedContacts(contacts);
    expect(returned).toBe(contacts); // returns the same array it was given
    expect(await loadImportedContacts()).toEqual(contacts);
  });

  it("reports hasImportedContacts true once something is saved", async () => {
    expect(await hasImportedContacts()).toBe(false);
    await saveImportedContacts([contact()]);
    expect(await hasImportedContacts()).toBe(true);
  });

  it("a re-import replaces the previous set (latest export wins)", async () => {
    await saveImportedContacts([contact({ url: "https://x.com/in/old" })]);
    await saveImportedContacts([contact({ url: "https://x.com/in/new" })]);
    const loaded = await loadImportedContacts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].url).toBe("https://x.com/in/new");
  });

  it("scopes demo vs owned under separate record keys", async () => {
    // Save in demo mode.
    await saveImportedContacts([contact({ url: "https://x.com/in/demo" })]);

    // Switch to owned mode → a different record key, so it sees no contacts yet.
    (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = false;
    expect(await loadImportedContacts()).toEqual([]);

    await saveImportedContacts([contact({ url: "https://x.com/in/owned" })]);
    expect((await loadImportedContacts())[0].url).toBe("https://x.com/in/owned");

    // Back to demo: the original demo set is intact.
    (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = true;
    expect((await loadImportedContacts())[0].url).toBe("https://x.com/in/demo");
  });
});
