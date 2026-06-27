// Verify the retrieval layer: a question that names a company surfaces that company's REAL records
// (the bug: the copilot only had aggregates). No browser — assembleContext is pure.
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { assembleContext, type BookData } from "../src/ai/bookContext";

const data = {
  contacts: [
    { first: "Jane", last: "Doe", organisation: "JPMorgan Chase", position: "VP Finance", sector_detail: "", sector_group: "Financial Services", sub_group: "", seniority: "VP / SM", function: "Finance", messaged: true, responded: true, two_way: true, agreed_to_meet: true, met: true, url: "u1", phone: "" },
    { first: "Sam", last: "Lee", organisation: "Microsoft", position: "Director", sector_detail: "", sector_group: "Technology", sub_group: "", seniority: "Head of / Director", function: "Technology", messaged: true, responded: false, two_way: false, agreed_to_meet: false, met: false, url: "u2", phone: "" },
  ],
  opps: [
    { id: "o1", opportunity_name: "Payments transformation", organisation: "JPMorgan Chase", primary_contact: "Jane Doe", service_line: "Strategy", current_step: "scoping", est_value: 1_000_000, probability: 0.5, lost: false },
    { id: "o2", opportunity_name: "Cloud migration", organisation: "Microsoft", primary_contact: "Sam Lee", service_line: "Technology", current_step: "contracting", est_value: 500_000, probability: 0.9, lost: false },
  ],
  meetingRows: [
    { id: "m1", contact_url: "u1", meeting_no: 1, meeting_stage: "Held", date_held: "2026-06-01", sentiment: "Positive", purpose: "Intro discussion", contactInfo: { name: "Jane Doe", organisation: "JPMorgan Chase" } },
  ],
  sows: [],
} as unknown as BookData;

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗ FAIL"}  ${name}`); }

const today = "2026-06-27";

// THE BUG: "do these companies have active opportunities" — naming JPMorgan must surface its opp.
const c1 = assembleContext("do JPMorgan have active opportunities", data, 6000, today);
ok("names JPMorgan → includes its opportunity", /JPMorgan Chase/.test(c1) && /Payments transformation/.test(c1));
ok("includes an Opportunities section", /[Oo]pportunit/.test(c1));

// Generic pipeline question → open opportunities list present.
const c2 = assembleContext("how is my pipeline looking", data, 6000, today);
ok("pipeline question → Open opportunities listed (open deal present)", /Open opportunities/.test(c2) && /Payments transformation/.test(c2));

// Meetings question → recent meetings included.
const c3 = assembleContext("what meetings have I had", data, 6000, today);
ok("meetings question → recent meetings included", /Recent meetings/.test(c3) && /Jane Doe/.test(c3));

// Always includes the summary header.
ok("always includes the book summary", /Network size:/.test(c1));

// Tiny budget still returns something (summary) without throwing.
const c4 = assembleContext("do JPMorgan have opportunities", data, 200, today);
ok("tiny budget degrades gracefully", c4.length > 0 && /Network size:/.test(c4));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
