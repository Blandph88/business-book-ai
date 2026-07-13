// The 50-prompt smoke set (2026-07-12) — targets the router changes + Phase-0 context/memory work.
// Grouped: 1 oblique routing · 2 known-bug repros · 3 compound instructions · 4 multi-turn entity carry
// · 5 memory/cross-chat · 6 long-chat retention · 7 faithfulness. Entities use the real seed
// (Priya OConnor / Thomas Hunt @ ExxonMobil; opps at ExxonMobil/JPMorgan/Pfizer; sectors Banks/Pharma/
// Oil & Gas/Retail). Run: `EVAL_SET=fifty npx tsx scripts/eval/run.mts` (routing-only, no key needed).

export const FIFTY_THREADS = [
  // ── Group 1 — oblique routing (should hit the right tool, not free-hand a number) ──
  { name: "g1-cold", note: "who's gone quiet → owed-replies / cold-at-active", turns: ["Who's gone cold that I should probably nudge?"] },
  { name: "g1-leak", note: "where deals leak → funnel breakdown", turns: ["Where am I leaking deals?"] },
  { name: "g1-hour", note: "one hour → weekly focus / rank contacts", turns: ["If I only had an hour this week, who do I call?"] },
  { name: "g1-talk", note: "all talk no meeting → opps-without-meeting", turns: ["Which accounts are all talk and no meeting?"] },
  { name: "g1-money", note: "contracted vs hoped → revenue vs pipeline", turns: ["What's actually contracted versus just hoped for?"] },
  { name: "g1-met-nothing", note: "met but nothing → meetings-without-opp", turns: ["Who have I met but never turned into anything?"] },
  { name: "g1-health", note: "healthiest/weakest → funnel/pipeline stats", turns: ["Show me the healthiest and weakest parts of my pipeline."] },
  { name: "g1-bigfish", note: "big fish ignored → rank by value", turns: ["Any big fish I'm ignoring?"] },
  { name: "g1-most", note: "talked to most → meetings/contacts-met", turns: ["Who did I talk to most this quarter?"] },
  { name: "g1-close", note: "ready to close → rank opps late-stage", turns: ["What's ready to close?"] },

  // ── Group 2 — known-bug repros ──
  { name: "g2-next-do", note: "'do next' must NOT latch onto the company Next", turns: ["What should I do next?"] },
  { name: "g2-next-co", note: "'at Next' SHOULD treat Next as the company", turns: ["Who do I know at Next?"] },
  { name: "g2-sector-clause", note: "don't swallow 'in the oil and gas sector' as the org name", turns: ["Find my contacts at ExxonMobil in the oil and gas sector"] },
  { name: "g2-eng-rank", note: "highest-value engagement → deterministic max, not a guess", turns: ["Which engagement is my highest value?"] },
  { name: "g2-multi-hijack", note: "3-part instruction must NOT be short-circuited into one table (HIJACK check)", turns: ["Summarise my pipeline, then tell me who to chase, then draft a note to the top one"] },
  { name: "g2-banking-rank", note: "sector list + rank by warmth — both parts", turns: ["List everyone in banking then rank them by warmth"] },
  { name: "g2-next-phrase", note: "'next steps' mid-phrase shouldn't trigger company Next", turns: ["next steps for the Pfizer deal"] },
  { name: "g2-jpm", note: "clean company lookup, no clause tail", turns: ["who's at JPMorgan Chase"] },
  { name: "g2-filter-met", note: "org + sector + met filter, don't mis-parse", turns: ["contacts at ExxonMobil in oil and gas who I've met"] },
  { name: "g2-two-tools", note: "two different tools (contact rank + engagement rank)", turns: ["my highest value contact and my highest value engagement"] },

  // ── Group 3 — compound instructions (address every part) ──
  { name: "g3-counts", note: "3 counts", turns: ["How many contacts do I have, how many are warm, and which sector is biggest?"] },
  { name: "g3-winrate", note: "two metrics", turns: ["What's my win rate and what's stuck at proposal?"] },
  { name: "g3-warm-brief", note: "warmest + brief", turns: ["Who's my warmest lead, and what do I know about them?"] },
  { name: "g3-compare", note: "two sector aggregates", turns: ["Compare my Banks and Pharma pipelines."] },
  { name: "g3-week", note: "past + weekly focus", turns: ["What did I do last week and what should I do this week?"] },
  { name: "g3-three", note: "rank + reasons", turns: ["Give me three contacts to reconnect with and why each."] },
  { name: "g3-compound-filter", note: "no meeting AND no recent contact", turns: ["Which opportunities have no meeting and no recent contact?"] },
  { name: "g3-eng-list", note: "list + total + flag ending", turns: ["List my engagements, total the contracted revenue, and flag any ending soon."] },

  // ── Group 4 — multi-turn entity carry (Phase-0 history) ──
  { name: "g4-entity-carry", note: "pronoun/subject must carry across turns; draft edits same draft; then switch subject", turns: [
    "Tell me about Priya OConnor.",
    "What's the latest with them?",
    "Draft a check-in email to them.",
    "Make it more formal.",
    "Now do the same for Thomas Hunt.",
    "Which of the two is warmer?",
  ] },
  { name: "g4-company-carry", note: "carries JPMorgan Chase across the follow-up", turns: [
    "Who works at JPMorgan Chase?",
    "Which of them have I met?",
  ] },
  { name: "g4-opp-chain", note: "opp → its contact → draft to them (chained)", turns: [
    "What's my biggest opportunity?",
    "Who's the contact on it?",
    "Draft them a short note.",
  ] },
  { name: "g4-long-back", note: "recall a subject named >8 turns ago (tests budgeted history vs the old 8-turn clip)", turns: [
    "Tell me about Priya OConnor.",
    "How's my pipeline overall?",
    "What's my win rate?",
    "Who's my warmest lead?",
    "How many meetings did I have this month?",
    "What's stuck at proposal?",
    "Which sector is biggest?",
    "What's my average deal size?",
    "Any opportunities with no meeting?",
    "Going back to Priya OConnor — what did we say I should do?",
  ] },

  // ── Group 5 — memory / cross-chat (distillation is capable-tier only; recall needs the memory set/live app) ──
  { name: "g5-remember", note: "states a durable focus — should acknowledge (distils to memory on a capable tier in-app)", turns: ["Remember I'm focusing on pharma clients this quarter."] },
  { name: "g5-decision", note: "a decision to remember", turns: ["I've decided to drop the retail sector for now."] },
  { name: "g5-priorities", note: "summarise remembered priorities, no fabrication", turns: ["What do you remember about my priorities?"] },

  // ── Group 6 — long-chat retention (single-model; model-SWITCH is a live-only test) ──
  { name: "g6-long", note: "after many turns, recall an instruction from early in the thread", turns: [
    "Let's plan my week. First, who should I prioritise?",
    "How many warm contacts do I have?",
    "What's my biggest opportunity?",
    "Which engagements are active?",
    "What's my win rate?",
    "Who have I not contacted in a while?",
    "Which sector should I push?",
    "How many opportunities are at proposal?",
    "What's contracted this quarter?",
    "Remind me who we said to prioritise at the start.",
  ] },

  // ── Group 7 — faithfulness (the trust-killers) ──
  { name: "g7-count", note: "exact opportunity count (the old bug said 'single opportunity' when there were many)", turns: ["How many opportunities are in my book?"] },
  { name: "g7-avg", note: "correct average deal size, not a vibe", turns: ["What's my average deal size?"] },
  { name: "g7-missing", note: "a company NOT in the book → say so + offer to add; must NOT invent a name", turns: ["Who's my contact at Netflix?"] },
];
