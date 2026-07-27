// SEED CONSISTENCY AUDIT (2026-07-27): cross-record rules over the generated demo book — every
// meeting's contact/org must exist and match, agreed ≤ held, follow-up ≥ held, sentiment only on
// Held, opp org = contact org, sane values/probabilities, sequential meeting_no, engagements at
// real orgs. Run after any gen-demo change: `node scripts/seed-audit.mjs` (expect ISSUES: 7 — the
// seven standalone engagements at orgs with no won opp are DELIBERATE: pre-book history is real).
import fs from "fs";
const seeds = JSON.parse(fs.readFileSync("public/seed_meetings.json", "utf8"));
const extras = JSON.parse(fs.readFileSync("public/seed_extras.json", "utf8"));
const csv = fs.readFileSync("public/contacts_enriched.csv", "utf8").split("\n").filter(Boolean);
const hdr = csv[0].split(",");
const idx = (k) => hdr.indexOf(k);
function cells(line) {
  const out = []; let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}
const contacts = csv.slice(1).map(cells).map((c) => ({
  first: c[idx("first")], last: c[idx("last")], org: c[idx("organisation")], url: c[idx("url")],
}));
const byUrl = new Map(contacts.map((c) => [c.url, c]));
const byName = new Map(contacts.map((c) => [(c.first + " " + c.last).toLowerCase(), c]));
const issues = [];
let n = 0;
// inspect one record's keys first
console.log("meeting keys:", Object.keys(seeds[0]).join(","));
for (const m of seeds) {
  n++;
  const who = m.contact_name || m.contact || m.name;
  const url = m.contact_url || m.url;
  const c = (url && byUrl.get(url)) || byName.get(String(who || "").toLowerCase());
  if (!c) { issues.push(`meeting #${n}: contact not found (${who || url})`); continue; }
  const morg = m.organisation || m.org;
  if (morg && c.org && morg.toLowerCase() !== c.org.toLowerCase()) issues.push(`meeting #${n}: org "${morg}" != contact org "${c.org}" (${c.first} ${c.last})`);
  const ag = m.date_agreed, held = m.date_held, fu = m.followup_date;
  if (ag && held && ag > held) issues.push(`meeting #${n} (${c.first} ${c.last}): agreed ${ag} AFTER held ${held}`);
  if (held && fu && fu < held && !/none/i.test(m.followup || "")) issues.push(`meeting #${n} (${c.first} ${c.last}): followup ${fu} BEFORE held ${held}`);
  const o = m.opportunity;
  if (o) {
    const oorg = (o.opportunity_name || "").split(" — ")[0];
    if (oorg && c.org && oorg.toLowerCase() !== c.org.toLowerCase()) issues.push(`meeting #${n}: opp "${o.opportunity_name}" vs contact org "${c.org}" (${c.first} ${c.last})`);
    if (o.est_value != null && !(o.est_value > 0)) issues.push(`meeting #${n}: opp est_value ${o.est_value}`);
    if (o.probability != null && (o.probability < 0 || o.probability > 1)) issues.push(`meeting #${n}: opp probability ${o.probability}`);
  }
  if (m.sentiment && m.meeting_stage && m.meeting_stage !== "Held") issues.push(`meeting #${n}: sentiment on stage ${m.meeting_stage}`);
}
const perContact = new Map();
for (const m of seeds) {
  const key = m.contact_url || m.contact_name || m.contact;
  if (!perContact.has(key)) perContact.set(key, []);
  perContact.get(key).push(m.meeting_no);
}
for (const [k, nos] of perContact) {
  const sorted = [...nos].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) if (sorted[i] !== i + 1) { issues.push(`contact ${k}: meeting_no sequence ${JSON.stringify(nos)}`); break; }
}
const STEP_ORDER = ["meeting","qualify","pursuit","scoping","clearance","proposal_build","proposal_delivery","procurement","contracting","setup","delivery","revenue"];
const byOppName = new Map();
for (const m of seeds) if (m.opportunity) byOppName.set(m.opportunity.opportunity_name, m.opportunity);
const orgWon = new Set();
for (const [name, o] of byOppName) if (!o.lost && STEP_ORDER.indexOf(o.step) >= STEP_ORDER.indexOf("contracting")) orgWon.add(name.split(" — ")[0].toLowerCase());
const orgAll = new Set(contacts.map((c) => (c.org || "").toLowerCase()));
for (const s of extras.sows || []) {
  const org = (s.organisation || "").toLowerCase();
  if (!orgAll.has(org)) issues.push(`sow "${s.engagement_name}": org "${s.organisation}" has NO contacts`);
  else if (!orgWon.has(org)) issues.push(`sow "${s.engagement_name}" (${s.organisation}): org has no WON opportunity`);
}
console.log(`meetings: ${seeds.length} · contacts: ${contacts.length} · sows: ${(extras.sows || []).length}`);
console.log(`ISSUES: ${issues.length}`);
for (const i of issues.slice(0, 40)) console.log(" -", i);
