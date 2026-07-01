// QA harness: for a prompt (or the default battery), print the GROUND-TRUTH answer computed straight
// from the seed data, so we can compare it against what the model said in the browser and catch
// "confidently wrong" cases (the way we caught WebLLM showing future August meetings as "last two weeks").
//
//   npx tsx scripts/qa-ground-truth.mts                       # run the default battery
//   npx tsx scripts/qa-ground-truth.mts "warmest leads"      # one prompt
//   QA_TODAY=2026-06-29 npx tsx scripts/qa-ground-truth.mts   # pin "today" (defaults to the system date)
//
// It reuses the SAME computeForQuery the app uses, so the ground truth here IS what the app now renders
// for these queries — a regression guard as much as a QA tool.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Papa from "papaparse";
import { computeForQuery, computeText } from "../src/ai/compute.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const today = process.env.QA_TODAY || new Date().toISOString().slice(0, 10);
const toBool = (v: string | undefined) => /^(true|yes|1|y)$/i.test((v ?? "").trim());

// ── Load contacts + meetings from the seed files into the BookData shape compute expects ──────────
type AnyRow = Record<string, string>;
const contactsCsv = readFileSync(join(ROOT, "public/contacts_enriched.csv"), "utf8");
const contacts = (Papa.parse<AnyRow>(contactsCsv, { header: true, skipEmptyLines: true }).data).map((r) => ({
  first: r.first ?? "", last: r.last ?? "", organisation: r.organisation ?? "", position: r.position ?? "",
  seniority: r.seniority ?? "", function: r.function ?? "", sector_group: r.sector_group ?? "", phone: r.phone ?? "",
  messaged: toBool(r.messaged), responded: toBool(r.responded), two_way: toBool(r.two_way),
  agreed_to_meet: toBool(r.agreed_to_meet), met: false, url: r.url ?? "",
})) as any[];
const byUrl = new Map(contacts.map((c) => [c.url, c]));

const seedMeetings = JSON.parse(readFileSync(join(ROOT, "public/seed_meetings.json"), "utf8")) as AnyRow[];
const meetingRows = seedMeetings.map((m) => {
  const c = byUrl.get(m.contact_url as string);
  return {
    ...m,
    id: `${m.contact_url}#${m.meeting_no}`,
    contactInfo: { name: c ? `${c.first} ${c.last}`.trim() : "(unknown)", organisation: c?.organisation ?? "—" },
  };
}) as any[];
// Derive `met` the way the app does: a contact with a Held meeting has been met.
for (const m of meetingRows) if (m.meeting_stage === "Held") { const c = byUrl.get(m.contact_url); if (c) c.met = true; }

// Build opportunities from the embedded opportunity on each seed meeting (where the app sources them).
const opps = seedMeetings.filter((m) => (m as any).opportunity).map((m, i) => {
  const op = (m as any).opportunity; const c = byUrl.get(m.contact_url as string);
  return { id: `opp:seed-${i}`, opportunity_name: op.opportunity_name, organisation: c?.organisation ?? "—", primary_contact: c ? `${c.first} ${c.last}`.trim() : "", service_line: op.service_line, current_step: op.step || "meeting", est_value: op.est_value, probability: op.probability, lost: !!op.lost, contact_url: m.contact_url };
}) as any[];

let sows: any[] = [];
try { sows = (JSON.parse(readFileSync(join(ROOT, "public/seed_extras.json"), "utf8")).sows ?? []) as any[]; } catch { /* none */ }
const data = { contacts, meetingRows, opps, sows } as any;

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────
const battery = [
  "Show meetings from the last two weeks",
  "Find my warmest leads right now",
  "Who's gone cold that I should re-engage?",
  "List my open opportunities",
  "Show my biggest deals",
  "Which opportunities are at risk of stalling?",
  "How's my pipeline looking?",
  "Is my network weighted toward any one sector?",
  "Show me everyone at JPMorgan",
  "Who have I agreed to meet but haven't met yet?",
  "Brief me on Amelia Wright",
  "What should I focus on this week?", // → null (open-ended, the model answers)
];
const prompts = process.argv.slice(2).length ? [process.argv.slice(2).join(" ")] : battery;

console.log(`\nGround truth as of ${today}  (${contacts.length} contacts, ${meetingRows.length} meetings)\n${"=".repeat(70)}`);
for (const p of prompts) {
  const r = computeForQuery(p, data, today);
  console.log(`\n▶ "${p}"`);
  if (!r) { console.log("  (no deterministic tool — the model answers this one)"); continue; }
  console.log(computeText(r).split("\n").map((l) => "  " + l).join("\n"));
  console.log(`  [${r.rows.filter((row) => row.record).length} clickable row(s)]`);
}
console.log("");
