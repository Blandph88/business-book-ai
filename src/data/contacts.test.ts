import { describe, it, expect, vi, beforeEach } from "vitest";
import { OTHER_INDUSTRY_LABEL } from "../config/markets";

// ── Module mocks ────────────────────────────────────────────────────────────────────────
// contacts.ts branches on getAppMode(): "demo" fetches the baked-in CSV (we stub fetch),
// "owned" reads loadImportedContacts() (we mock it). We control both via vi.mock + helpers
// the factories close over, so individual tests can flip mode / imported rows per case.

// vi.mock factories are HOISTED above the file body, and the transitive import chain
// (contacts → ownedContacts → persist) calls getAppMode() at module-load time. So the mock
// state must be initialised BEFORE the factories run — a plain top-level `let` would still be
// in its temporal dead zone. vi.hoisted returns an object created alongside the hoisted mocks.
const state = vi.hoisted(() => ({
  appMode: "demo" as "demo" | "owned",
  importedRows: [] as unknown[],
}));

vi.mock("../lib/appMode", () => ({
  getAppMode: () => state.appMode,
  isDemo: () => state.appMode === "demo",
  isOwned: () => state.appMode === "owned",
}));

vi.mock("../storage/importedContacts", () => ({
  loadImportedContacts: async () => state.importedRows,
}));

// Import AFTER the mocks are registered.
import { loadContacts, loadConnections } from "./contacts";

// A row already in Contact shape (what loadImportedContacts yields).
function importedContact(overrides: Record<string, unknown> = {}) {
  return {
    first: "A",
    last: "B",
    organisation: "Org",
    position: "Pos",
    sector_detail: "",
    sector_group: "Technology",
    sub_group: "Technology",
    seniority: "Manager",
    function: "",
    messaged: false,
    responded: false,
    two_way: false,
    agreed_to_meet: false,
    met: false,
    url: "https://x",
    phone: "",
    ...overrides,
  };
}

function stubFetchCsv(csv: string, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      text: async () => csv,
    }),
  );
}

beforeEach(() => {
  state.appMode = "demo";
  state.importedRows = [];
  vi.unstubAllGlobals();
});

// ── parseContactRows (tested via loadContacts in demo mode) ───────────────────────────────
describe("parseContactRows (via loadContacts, demo mode)", () => {
  const HEADER =
    "first,last,organisation,position,sector_detail,sector_group,sub_group,seniority,function,messaged,responded,two_way,agreed_to_meet,met,url,phone";

  it("parses a full row into a typed Contact", async () => {
    stubFetchCsv(
      `${HEADER}\nJane,Doe,Acme,Engineer,AcmeCo,Technology,Software & SaaS,Manager,Tech,True,False,True,False,True,https://li/jane,966557312825`,
    );
    const [c] = await loadContacts();
    expect(c).toMatchObject({
      first: "Jane",
      last: "Doe",
      organisation: "Acme",
      position: "Engineer",
      sector_detail: "AcmeCo",
      sector_group: "Technology",
      sub_group: "Software & SaaS",
      seniority: "Manager",
      function: "Tech",
      messaged: true,
      responded: false,
      two_way: true,
      agreed_to_meet: false,
      met: true,
      url: "https://li/jane",
      phone: "966557312825",
    });
  });

  it("handles quoted fields with embedded commas", async () => {
    stubFetchCsv(
      `${HEADER}\nJohn,Smith,"Capital, Insurance & Invest",CEO,"Detail, with comma",Financial Services,Banks,Executive Leadership,Finance,False,False,False,False,False,https://li/john,`,
    );
    const [c] = await loadContacts();
    expect(c.organisation).toBe("Capital, Insurance & Invest");
    expect(c.sector_detail).toBe("Detail, with comma");
  });

  it("falls back sub_group to sector_group when sub_group is missing", async () => {
    // CSV has no sub_group column at all.
    const header = "first,last,organisation,sector_group";
    stubFetchCsv(`${header}\nJane,Doe,Acme,Technology`);
    const [c] = await loadContacts();
    expect(c.sub_group).toBe("Technology");
  });

  it("falls back sub_group to sector_group when sub_group is present but empty", async () => {
    const header = "first,sector_group,sub_group";
    stubFetchCsv(`${header}\nJane,Technology,`);
    const [c] = await loadContacts();
    expect(c.sub_group).toBe("Technology");
  });

  it("supplies safe defaults for missing columns", async () => {
    // Only a couple of columns present; everything else should default.
    const header = "first,url";
    stubFetchCsv(`${header}\nJane,https://li/jane`);
    const [c] = await loadContacts();
    expect(c).toMatchObject({
      first: "Jane",
      last: "",
      organisation: "",
      position: "",
      sector_detail: "",
      sector_group: "",
      sub_group: "",
      seniority: "",
      function: "",
      messaged: false,
      responded: false,
      two_way: false,
      agreed_to_meet: false,
      met: false,
      url: "https://li/jane",
      phone: "",
    });
  });

  it("returns [] for a header-only CSV", async () => {
    stubFetchCsv(HEADER);
    expect(await loadContacts()).toEqual([]);
  });

  it("returns [] for an empty CSV", async () => {
    stubFetchCsv("");
    expect(await loadContacts()).toEqual([]);
  });

  it("parses multiple rows", async () => {
    stubFetchCsv(
      `first,last,sector_group\nJane,Doe,Technology\nJohn,Smith,Financial Services`,
    );
    const rows = await loadContacts();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.first)).toEqual(["Jane", "John"]);
  });
});

// ── toBool (tested via the boolean columns of a parsed row) ───────────────────────────────
describe("toBool (via loadContacts boolean columns)", () => {
  async function parseMessaged(value: string): Promise<boolean> {
    // Quote the value so leading/trailing spaces survive CSV parsing.
    stubFetchCsv(`first,messaged\nX,"${value}"`);
    const [c] = await loadContacts();
    return c.messaged;
  }

  it("treats 'True' as true", async () => {
    expect(await parseMessaged("True")).toBe(true);
  });

  it("treats uppercase 'TRUE' as true", async () => {
    expect(await parseMessaged("TRUE")).toBe(true);
  });

  it("treats ' True ' (padded) as true", async () => {
    expect(await parseMessaged(" True ")).toBe(true);
  });

  it("treats 'False' as false", async () => {
    expect(await parseMessaged("False")).toBe(false);
  });

  it("treats lowercase 'false' as false", async () => {
    expect(await parseMessaged("false")).toBe(false);
  });

  it("treats an empty value as false", async () => {
    expect(await parseMessaged("")).toBe(false);
  });

  it("treats a missing column (undefined) as false", async () => {
    stubFetchCsv(`first\nX`);
    const [c] = await loadContacts();
    expect(c.messaged).toBe(false);
  });

  it("treats a non-'true' string as false", async () => {
    expect(await parseMessaged("yes")).toBe(false);
    expect(await parseMessaged("1")).toBe(false);
  });
});

// ── normalizeGroups (the healing) ─────────────────────────────────────────────────────────
describe("normalizeGroups (via loadContacts)", () => {
  it("folds an unknown sector_group into the OTHER catch-all", async () => {
    // Legacy "Other Industries" is not a current SECTOR_GROUP.
    stubFetchCsv(`first,sector_group\nX,Other Industries`);
    const [c] = await loadContacts();
    expect(c.sector_group).toBe(OTHER_INDUSTRY_LABEL);
  });

  it("leaves a known sector_group untouched", async () => {
    stubFetchCsv(`first,sector_group\nX,Technology`);
    const [c] = await loadContacts();
    expect(c.sector_group).toBe("Technology");
  });

  it("does NOT relabel an empty sector_group (guarded by truthiness)", async () => {
    stubFetchCsv(`first,sector_group\nX,`);
    const [c] = await loadContacts();
    expect(c.sector_group).toBe("");
  });

  it("heals legacy 'Head of' seniority to 'Head of / Director'", async () => {
    stubFetchCsv(`first,seniority\nX,Head of`);
    const [c] = await loadContacts();
    expect(c.seniority).toBe("Head of / Director");
  });

  it("leaves other seniority values untouched", async () => {
    stubFetchCsv(`first,seniority\nX,Manager`);
    const [c] = await loadContacts();
    expect(c.seniority).toBe("Manager");
  });

  it("heals both sector_group and seniority on the same row", async () => {
    stubFetchCsv(`first,sector_group,seniority\nX,Other Industries,Head of`);
    const [c] = await loadContacts();
    expect(c.sector_group).toBe(OTHER_INDUSTRY_LABEL);
    expect(c.seniority).toBe("Head of / Director");
  });
});

// ── loadContacts in owned mode ────────────────────────────────────────────────────────────
describe("loadContacts (owned mode)", () => {
  it("reads imported contacts and heals stale groups/seniority", async () => {
    state.appMode = "owned";
    state.importedRows = [
      importedContact({ sector_group: "Other Industries", seniority: "Head of" }),
    ];
    const [c] = await loadContacts();
    expect(c.sector_group).toBe(OTHER_INDUSTRY_LABEL);
    expect(c.seniority).toBe("Head of / Director");
  });

  it("does not fetch the demo CSV in owned mode", async () => {
    state.appMode = "owned";
    state.importedRows = [importedContact()];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await loadContacts();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] when there are no imported contacts", async () => {
    state.appMode = "owned";
    state.importedRows = [];
    expect(await loadContacts()).toEqual([]);
  });
});

// ── loadContacts error path ───────────────────────────────────────────────────────────────
describe("loadContacts (demo mode, fetch failure)", () => {
  it("throws a descriptive error when the CSV cannot be loaded", async () => {
    stubFetchCsv("", false, 404);
    await expect(loadContacts()).rejects.toThrow(/HTTP 404/);
  });
});

// ── loadConnections ───────────────────────────────────────────────────────────────────────
describe("loadConnections", () => {
  it("parses the connections CSV in demo mode", async () => {
    stubFetchCsv(`first,last,sector_group\nJane,Doe,Out of Scope`);
    const rows = await loadConnections();
    expect(rows).toHaveLength(1);
    expect(rows[0].first).toBe("Jane");
  });

  it("defaults funnel flags to false (file has no flag columns)", async () => {
    stubFetchCsv(`first,sector_group\nJane,Technology`);
    const [c] = await loadConnections();
    expect(c.messaged).toBe(false);
    expect(c.responded).toBe(false);
    expect(c.met).toBe(false);
  });

  it("returns [] when the connections file is not present (non-ok)", async () => {
    stubFetchCsv("", false, 404);
    expect(await loadConnections()).toEqual([]);
  });

  it("does NOT normalize groups (returns raw parsed rows)", async () => {
    // loadConnections calls parseContactRows directly, no normalizeGroups —
    // a stale group should pass through unchanged.
    stubFetchCsv(`first,sector_group\nX,Other Industries`);
    const [c] = await loadConnections();
    expect(c.sector_group).toBe("Other Industries");
  });

  it("reads imported contacts in owned mode without normalizing", async () => {
    state.appMode = "owned";
    state.importedRows = [importedContact({ sector_group: "Other Industries" })];
    const [c] = await loadConnections();
    expect(c.sector_group).toBe("Other Industries");
  });
});
