// Unit tests for the WS1/WS3/WS0 additions — the relational/aggregate tools, the confidentiality
// responder, and the interpret gate. Uses SYNTHETIC BookData so we can exercise the positive cases the
// seed book doesn't contain (a naked opp, a contact met twice, an exact join shape).
//
//   npx tsx --test scripts/compute-tools.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contactsMetAtLeast, openOppsWithoutMeeting, companiesWithOppAndContacts, contractsAggregate,
  privacyResponse, shouldInterpretResult, computeForQuery,
} from "../src/ai/compute.ts";
import { conversationPath } from "../src/ai/grounding.ts";
import { personalRegister, crisisSignal, heavyDistress } from "../src/ai/intents.ts";

const today = "2026-07-01";
// Two contacts at Acme (which has held meetings + an open opp), one at Beta (open opp, NO meeting).
const contacts = [
  { url: "u1", first: "Ann", last: "Alpha", organisation: "Acme", position: "COO", messaged: true, responded: true, two_way: true, agreed_to_meet: true, met: true },
  { url: "u2", first: "Ben", last: "Bravo", organisation: "Acme", position: "CFO", messaged: true, responded: false, two_way: false, agreed_to_meet: false, met: false },
  { url: "u3", first: "Cara", last: "Charlie", organisation: "Beta", position: "CEO", messaged: false, responded: false, two_way: false, agreed_to_meet: false, met: false },
] as any[];
const meetingRows = [
  { id: "m1", contact_url: "u1", meeting_stage: "Held", date_held: "2026-05-01", sentiment: "Positive", contactInfo: { name: "Ann Alpha", organisation: "Acme" } },
  { id: "m2", contact_url: "u1", meeting_stage: "Held", date_held: "2026-06-01", sentiment: "Very Positive", contactInfo: { name: "Ann Alpha", organisation: "Acme" } },
] as any[];
const opps = [
  { id: "o1", opportunity_name: "Acme deal", organisation: "Acme", contact_url: "u2", est_value: 100000, current_step: "meeting", probability: 0.3, lost: false },
  { id: "o2", opportunity_name: "Beta deal", organisation: "Beta", contact_url: "u3", est_value: 200000, current_step: "scoping", probability: 0.4, lost: false },
] as any[];
const sows = [
  { id: "s1", engagement_name: "Alpha work", organisation: "Acme", status: "Active", recognised_to_date: 100000 },
  { id: "s2", engagement_name: "Gamma work", organisation: "Gamma", status: "Completed", recognised_to_date: 300000 },
] as any[];
const d = { contacts, meetingRows, opps, sows } as any;

test("contactsMetAtLeast(2) → only the contact met twice", () => {
  const r = contactsMetAtLeast(d, 2);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].cells[0], "Ann Alpha");
  assert.equal(r.rows[0].cells[3], "2"); // times met
  assert.match(r.intro, /more than once/i);
});

test("contactsMetAtLeast(3) → nobody (all met ≤ twice)", () => {
  const r = contactsMetAtLeast(d, 3);
  assert.equal(r.rows.length, 0);
  assert.match(r.intro, /at least 3 times/i);
});

test("openOppsWithoutMeeting → only Beta (Acme has meetings at the org)", () => {
  const r = openOppsWithoutMeeting(d);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].cells[1], "Beta");
});

test("companiesWithOppAndContacts(2) → only Acme (2 contacts + open opp)", () => {
  const r = companiesWithOppAndContacts(d, 2);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].cells[0], "Acme");
  assert.equal(r.rows[0].cells[1], "2"); // contacts
  assert.equal(r.rows[0].cells[2], "1"); // open opps
});

test("contractsAggregate → correct total + average, never a re-list", () => {
  const total = contractsAggregate(d, "how much revenue have I recognised");
  assert.equal(total.rows.length, 0); // a computed sentence, not a table dump
  assert.match(total.intro, /400k/i);
  const avg = contractsAggregate(d, "average recognised per engagement");
  assert.match(avg.intro, /200k/i);
  assert.match(avg.intro, /average/i);
});

test("privacyResponse → detects the question and is backend-aware", () => {
  assert.equal(privacyResponse("who do I know at Shell?"), null); // NOT a privacy question
  const onDev = privacyResponse("can anyone see this or does it get sent to a server?", { backend: "webllm" });
  assert.match(onDev!.intro, /never leave the machine|stays on this device/i);
  const cloud = privacyResponse("where does a client's name actually go?", { backend: "byok", byok: true });
  assert.match(cloud!.intro, /your own API key|under your account/i);
  const general = privacyResponse("is my data private?"); // no backend (eval) → accurate general answer
  assert.match(general!.intro, /stored locally|never uploaded/i);
  assert.doesNotMatch(general!.intro, /never leaves the machine\.?$/i); // must NOT over-promise blanketly
});

test("shouldInterpretResult → analytical yes, bare count no, empty no", () => {
  const table = { intro: "x", columns: ["A"], rows: [{ cells: ["a"] }] } as any;
  const empty = { intro: "x", columns: [], rows: [] } as any;
  assert.equal(shouldInterpretResult("which deals are most at risk?", table), true);
  assert.equal(shouldInterpretResult("how many contacts do I have?", table), false);
  assert.equal(shouldInterpretResult("who are my warmest leads?", table), true);
  assert.equal(shouldInterpretResult("who's gone cold?", empty), false);
});

test("topic-gate: personal / general → companion; book question → book; crisis → crisis", () => {
  // personal/emotional → companion (NEVER treated as a book query)
  for (const q of ["I feel really sad today", "I'm struggling today", "I hate my boss, he took credit again",
    "I want to talk about my personal life", "I'm exhausted and I barely slept", "having a rough week honestly"])
    assert.equal(conversationPath(q, d), "companion", q);
  // general / advice / technical (no book entity) → companion
  for (const q of ["what do you think about moving to Saudi Arabia?", "help me debug this python loop",
    "should I go all in on my startup?", "what makes a good investor pitch?"])
    assert.equal(conversationPath(q, d), "companion", q);
  // grounded book question / advice about a real entity → book
  for (const q of ["should I chase the Acme deal?", "who do I know at Acme?", "draft a note to Ann Alpha",
    "brief me on Ben Bravo", "how's my pipeline looking"])
    assert.equal(conversationPath(q, d), "book", q);
  // a stray book keyword inside a personal vent must NOT flip it to book
  assert.equal(conversationPath("my boss keeps booking pointless meetings and it's draining me", d), "companion");
  // crisis → the deterministic safety floor
  for (const q of ["I don't want to be here anymore", "I've been thinking about ending it all", "I want to kill myself"])
    assert.equal(conversationPath(q, d), "crisis", q);
});

test("personalRegister / crisisSignal basics", () => {
  assert.equal(personalRegister("I just feel low today"), true);
  assert.equal(personalRegister("who do I know at Acme?"), false);
  assert.equal(crisisSignal("I want to end my life"), true);
  assert.equal(crisisSignal("kill that deal, it's going nowhere"), false); // "kill" a deal ≠ crisis
});

test("distress DIAL: acute → crisis floor; heavy → model (companion); ordinary → no support", () => {
  // ACUTE (deterministic floor)
  for (const q of ["I want to kill myself", "I've been thinking about ending it all", "I don't want to be here anymore", "I keep thinking about self-harm"])
    assert.equal(crisisSignal(q), true, q);
  // NOT acute — depression/bullying/situational must NOT hit the deterministic floor
  for (const q of ["I've been really depressed for weeks", "the bullying at work is grinding me down", "I can't go on with this job", "I feel hopeless about everything", "I'm so burnt out"])
    assert.equal(crisisSignal(q), false, q);
  // …but they ARE heavy distress → the model should offer PROPORTIONAL support (not canned)
  for (const q of ["I've been really depressed for weeks", "the constant belittling is wearing me down", "I feel completely hopeless", "I'm burnt out and can't cope"])
    assert.equal(heavyDistress(q), true, q);
  // ordinary low → NOT heavy (pure warmth, no support suggestion)
  for (const q of ["rough day today", "I'm a bit tired and grumpy", "missed my flight, feeling sorry for myself"])
    assert.equal(heavyDistress(q), false, q);
  // routing: heavy distress still goes to the warm companion, never the crisis floor
  assert.equal(conversationPath("I've been really depressed lately", d), "companion");
  assert.equal(conversationPath("I can't go on with this job, it's draining me", d), "companion");
});

test("computeForQuery: filler never becomes a bogus company (no mis-parse)", () => {
  // The old bug: "…at all" / "…at least two contacts at" got grabbed as a company → wrong empty table.
  const r1 = computeForQuery("which of my open deals have no meeting logged against them at all?", d, today);
  assert.ok(r1 && !/no open opportunities at all/i.test(r1.intro));
  const r2 = computeForQuery("which companies do I have both an open opportunity and at least two contacts at?", d, today);
  assert.ok(r2 && /expansion footholds|both an open opportunity/i.test(r2.intro));
});
