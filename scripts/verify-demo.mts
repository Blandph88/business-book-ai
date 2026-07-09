// Faithful DEMO-seed verification harness. Builds the SAME BookData the ?demo=1 app sees — contacts from
// public/contacts_enriched.csv with seedDemoEnrichment applied (so thread/warmth match the app, the gap that
// stopped us pinning warmth-ranked answers before), plus seed_meetings/seed_extras for meetings/opps/sows —
// then routes a battery of the previously-FAILED prompts through computeForQuery and prints where each lands.
// This verifies the deterministic + regex-router half end-to-end; the LLM router's tool-selection needs a live
// capable model (tested in-app). Run: npx tsx scripts/verify-demo.mts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { computeForQuery } from "../src/ai/compute.ts";
import { seedDemoEnrichment } from "../src/data/demoEnrichment.ts";

const ROOT = "/Users/unplannedphilbland/Heirloom/Business-Book/Business-Book-AI";
const today = "2026-07-09";
const tb = (v?: string) => /^(true|yes|1|y)$/i.test((v ?? "").trim());
let contacts = (Papa.parse<any>(readFileSync(join(ROOT, "public/contacts_enriched.csv"), "utf8"), { header: true, skipEmptyLines: true }).data)
  .filter((r: any) => r.url)
  .map((r: any) => ({ first: r.first ?? "", last: r.last ?? "", organisation: r.organisation ?? "", position: r.position ?? "", seniority: r.seniority ?? "", function: r.function ?? "", sector_group: r.sector_group ?? "", sector_detail: r.sector_detail ?? "", sub_group: r.sub_group ?? "", phone: r.phone ?? "", messaged: tb(r.messaged), responded: tb(r.responded), two_way: tb(r.two_way), agreed_to_meet: tb(r.agreed_to_meet), met: false, url: r.url ?? "" }));
contacts = seedDemoEnrichment(contacts as any) as any; // populate thread/inbound/warmth like the demo
const byUrl = new Map(contacts.map((c: any) => [c.url, c]));
const sm = JSON.parse(readFileSync(join(ROOT, "public/seed_meetings.json"), "utf8"));
const meetingRows = sm.map((m: any) => { const c = byUrl.get(m.contact_url); return { ...m, id: `${m.contact_url}#${m.meeting_no}`, contactInfo: { name: c ? `${c.first} ${c.last}`.trim() : "?", organisation: c?.organisation ?? "—" } }; });
for (const m of meetingRows) if (m.meeting_stage === "Held") { const c = byUrl.get(m.contact_url); if (c) c.met = true; }
const opps = sm.filter((m: any) => m.opportunity).map((m: any, i: number) => { const op = m.opportunity; const c = byUrl.get(m.contact_url); return { id: `opp:seed-${i}`, opportunity_name: op.opportunity_name, organisation: c?.organisation ?? "—", primary_contact: c ? `${c.first} ${c.last}`.trim() : "", service_line: op.service_line, current_step: op.step || "meeting", est_value: op.est_value, probability: op.probability, lost: !!op.lost, contact_url: m.contact_url }; });
const sows = JSON.parse(readFileSync(join(ROOT, "public/seed_extras.json"), "utf8")).sows ?? [];
const d: any = { contacts, meetingRows, opps, sows };

console.log(`Seed: ${contacts.length} contacts · ${opps.length} opps · ${sows.length} engagements · ${meetingRows.length} meetings\n`);

// The previously-FAILED prompts (the exact live-test phrasings), grouped by what they should resolve to.
const battery: [string, string][] = [
  ["what am I actually banking if every deal closes at the odds", "weighted ~£1.6m"],
  ["how much of my pipeline is wishful thinking", "gap ~£2.8m"],
  ["what's a deal typically worth to me", "average ~£218k"],
  ["have I actually made money this year", "revenue £3.5m"],
  ["what's the fattest engagement on my books", "largest HSBC £440k"],
  ["give me my pipeline in one number", "total £4.4m"],
  ["where's my bench deepest", "sector breakdown"],
  ["if a bank rang tomorrow who could I put in the room", "FS contacts"],
  ["any live deals in oil, gas or utilities", "energy opps"],
  ["who do I know that actually runs finance functions", "finance-function contacts"],
  ["am I too concentrated in one industry", "sector breakdown"],
  ["which accounts do I have both a deal and real relationships in", "join"],
  ["where am I chasing a deal but haven't sat down with a soul", "opps anti-join"],
  ["any meetings I've had that never turned into anything", "meetings anti-join"],
  ["cold contacts sitting inside companies I'm already working with", "cross-join"],
  ["who've I left on read", "owed replies"],
  ["am I ghosting anyone important", "owed replies"],
  ["who's gone quiet that I should probably rescue", "gone cold"],
  ["who likes me most right now", "warmest"],
  ["what's landing on me over the next couple of weeks", "upcoming ≤14d"],
  ["give me the lay of the land at HSBC before I call them", "HSBC account"],
  ["how deep am I really at Barclays", "Barclays account"],
  ["what's my history with Omar", "disambiguate 46"],
  ["log £40k of revenue", "decline"],
];
for (const [q, expect] of battery) {
  const r = computeForQuery(q, d, today);
  const got = r ? (r.intro || "").split("\n")[0].slice(0, 62) : "NULL → LLM router / fallback";
  console.log(`${r ? "•" : "·"} ${JSON.stringify(q).slice(0, 58).padEnd(60)} [${expect}]\n     → ${got}${r?.rows?.length ? ` [${r.rows.length} rows]` : ""}`);
}
