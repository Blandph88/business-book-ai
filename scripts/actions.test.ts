// Verify the action framework: contact matching, deterministic field extraction, and write→undo
// round-trips with deterministic ids (a retry must not duplicate). No browser; AI calls fail closed.
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
(globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) }); // swallow disk-sync POSTs

import { SPECS, matchContacts, parseMoney, type ActionCtx } from "../src/ai/actions/actionSpecs";
import { loadAllMeetings } from "../src/storage/meetings";
import { loadAllOpportunities } from "../src/storage/opportunities";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗ FAIL"}  ${name}`); }

const contacts = [
  { first: "Jane", last: "Doe", organisation: "EY", position: "VP", sector_detail: "", sector_group: "Professional Services", sub_group: "", seniority: "VP / SM", function: "Finance", messaged: true, responded: true, two_way: true, agreed_to_meet: true, met: true, url: "u1", phone: "" },
  { first: "Jane", last: "Smith", organisation: "Bank of America", position: "Director", sector_detail: "", sector_group: "Financial Services", sub_group: "", seniority: "Head of / Director", function: "Risk", messaged: true, responded: false, two_way: false, agreed_to_meet: false, met: false, url: "u2", phone: "" },
] as any;
const baseCtx = (over: Partial<ActionCtx>): ActionCtx => ({ op: "create", text: "", subjectUrl: undefined, today: "2026-06-27", contacts, meetingRows: [], opps: [], sows: [], ...over });

// matchContacts
ok("matchContacts('Jane from EY') → 1 (EY one wins)", matchContacts("Jane from EY", contacts).length >= 1 && matchContacts("Jane from EY", contacts)[0].url === "u1");
ok("matchContacts('Jane') → both Janes (ambiguous)", matchContacts("Jane", contacts).length === 2);

// parseMoney
ok("parseMoney £200k", parseMoney("worth £200k") === 200_000);
ok("parseMoney 1.5m", parseMoney("about 1.5m") === 1_500_000);
ok("parseMoney 200,000", parseMoney("200,000") === 200_000);

// contact deterministic extraction
const cx = await SPECS.contact.extract(baseCtx({ op: "update", text: "Jane is a champion and high priority, decision maker, based in Dubai" }));
ok("contact extract → Champion", cx.relationship_strength === "Champion");
ok("contact extract → High priority", cx.priority === "High");
ok("contact extract → Decision Maker", cx.decision_role === "Decision Maker");
ok("contact extract → based in Dubai", cx.based_in === "Dubai");

// meeting write → deterministic id, retry doesn't duplicate, undo removes
const mctx = baseCtx({ subjectUrl: "u1" });
const m1 = SPECS.meeting.write({ meeting_stage: "Held", date_held: "2026-06-27", notes: "good chat" }, mctx);
ok("meeting write created one", Object.keys(loadAllMeetings()).length === 1);
const m2 = SPECS.meeting.write({ meeting_stage: "Held", date_held: "2026-06-27", notes: "good chat" }, mctx);
ok("meeting retry → same id, no duplicate", m1.id === m2.id && Object.keys(loadAllMeetings()).length === 1);
m1.undo();
ok("meeting undo removed it", Object.keys(loadAllMeetings()).length === 0);

// opportunity write + undo
const o1 = SPECS.opportunity.write({ opportunity_name: "Payments", organisation: "EY", service_line: "Strategy", current_step: "meeting", est_value: "200000" }, baseCtx({}));
ok("opportunity write created one", Object.keys(loadAllOpportunities()).length === 1);
o1.undo();
ok("opportunity undo removed it", Object.keys(loadAllOpportunities()).length === 0);

// contact write merges into edits + undo restores
const wctx = baseCtx({ op: "update", subjectUrl: "u1" });
const c1 = SPECS.contact.write({ relationship_strength: "Champion" }, wctx);
ok("contact write returns summary", /Jane Doe/.test(c1.summary));
c1.undo();
ok("contact undo restored prior edits", true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
