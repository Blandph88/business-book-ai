import { describe, it, expect, vi, beforeEach } from "vitest";

// Force OWNED mode so scopedKey uses the bob.owned.* namespace (matches a purchased copy).
vi.hoisted(() => {
  (window as unknown as { __FREEHOLD_DEMO__?: boolean }).__FREEHOLD_DEMO__ = false;
});

import { serializeBackup, parseBackup, exportBook, importBook, BackupError } from "./backup";
import { scopedKey } from "./persist";
import * as imported from "./importedContacts";

const contact = (first: string, url: string) => ({ first, last: "X", organisation: "Acme", position: "", url } as any);

beforeEach(() => {
  localStorage.clear();
  // stub the IndexedDB contacts store with an in-memory one
  let store: any[] = [];
  vi.spyOn(imported, "loadImportedContacts").mockImplementation(async () => store);
  vi.spyOn(imported, "saveImportedContacts").mockImplementation(async (c: any[]) => { store = c; return c; });
});

describe("backup round-trip", () => {
  it("plaintext: export → serialize → parse restores stores + contacts + copilot chats/memory", async () => {
    localStorage.setItem(scopedKey("bob.meetings.v2"), JSON.stringify([{ id: "m1" }]));
    localStorage.setItem(scopedKey("bob.chats.v1"), JSON.stringify([{ id: "c1", turns: [] }]));
    localStorage.setItem(scopedKey("bob.memory.v1"), JSON.stringify([{ id: "n1", text: "prefers concise emails" }]));
    (imported.saveImportedContacts as any)([contact("Ada", "u/ada")]);

    const book = await exportBook();
    const file = await serializeBackup(book);
    // wipe everything, then restore from the file
    localStorage.clear();
    (imported.saveImportedContacts as any)([]);
    const restored = await parseBackup(file);
    await importBook(restored);

    expect(JSON.parse(localStorage.getItem(scopedKey("bob.meetings.v2"))!)).toEqual([{ id: "m1" }]);
    expect(JSON.parse(localStorage.getItem(scopedKey("bob.chats.v1"))!)[0].id).toBe("c1");
    expect(JSON.parse(localStorage.getItem(scopedKey("bob.memory.v1"))!)[0].text).toBe("prefers concise emails");
    expect((await imported.loadImportedContacts())[0].first).toBe("Ada");
  });

  it("encrypted: correct passphrase round-trips; wrong passphrase throws; missing passphrase throws", async () => {
    localStorage.setItem(scopedKey("bob.opportunities.v2"), JSON.stringify([{ id: "o1", est_value: 5000 }]));
    const book = await exportBook();
    const file = await serializeBackup(book, "hunter2");

    expect(file).not.toContain("est_value"); // ciphertext — the data isn't readable in the file
    expect(file).not.toContain("o1");

    await expect(parseBackup(file)).rejects.toBeInstanceOf(BackupError); // no passphrase
    await expect(parseBackup(file, "wrong")).rejects.toBeInstanceOf(BackupError); // wrong passphrase (GCM auth fail)

    const ok = await parseBackup(file, "hunter2");
    expect((ok.stores["bob.opportunities.v2"] as any[])[0].est_value).toBe(5000);
  });

  it("rejects a foreign / non-backup file cleanly without touching data", async () => {
    await expect(parseBackup("{}")).rejects.toBeInstanceOf(BackupError);
    await expect(parseBackup(JSON.stringify({ format: "freehold-book-backup", app: "some-other-app" }))).rejects.toThrow(/different app/i);
    await expect(parseBackup("not json")).rejects.toBeInstanceOf(BackupError);
  });
});
