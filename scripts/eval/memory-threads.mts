// MEMORY + SOURCE-OF-TRUTH + MODEL-WEAKNESS THREADS. Three places a "fact" can live, and the assistant must
// pull from the RIGHT one and never confuse or invent them:
//   • DATABASE  — the on-device book (contacts/opps/meetings), surfaced via grounding. Authoritative for records.
//   • CONTEXT   — what was said earlier IN THIS thread. Authoritative for the live conversation; overrides stale memory.
//   • MEMORY    — durable facts distilled from PAST chats (goals, preferences, relationship colour). NOT in the book.
// This suite seeds MEMORY (SEED_MEMORY below — the harness injects it exactly like the app's "Memory from past
// chats" block) and then probes: recall from memory, recall from context, recall from DB, RECONCILE a
// memory/DB conflict, let context OVERRIDE stale memory, DB authority over a user's claim, and — critically —
// DON'T FABRICATE a memory that was never stored (models love to confabulate "you mentioned…").
// Plus classic mid-model weaknesses: negation/absence, temporal filtering, aggregation/arithmetic,
// hypotheticals, consistency-drift over a long thread, similar-entity disambiguation, missing-field honesty,
// over-eager action suppression, in-thread contradiction (last-write-wins), multi-hop lookups, standing instructions.

import type { Convo } from "./conversations.mts";

// Distilled facts "from past chats" — the harness injects these as the Memory block on the memory set only.
// Deliberately things that are NOT in the book, so we can tell whether an answer came from memory vs the DB.
export const SEED_MEMORY: string[] = [
  "The user's main goal this quarter is to land a big banking client.",
  "The user first met Amelia Wright years ago at an industry conference, before she joined JPMorgan — a warm personal connection, though no formal meeting is logged in the book.",
  "The user prefers follow-up emails kept to about three sentences: warm, plain, and free of corporate jargon.",
  "The user is not interested in pursuing public-sector or government clients.",
  "The user's strongest service line is finance transformation.",
  "The user's main competitor on large deals is usually McKinsey.",
  "The user is based in London but travels to New York frequently.",
  "The user wants to reach £1m in signed engagements this year.",
  "The user likes to open outreach with a specific data point or insight, never small talk.",
  "The user regards the Shell relationship as a flagship account and is protective of it.",
  "The user finds cold outreach draining and strongly prefers warm introductions.",
];

export const MEMORY_THREADS: Convo[] = [
  // ── RECALL FROM THE RIGHT SOURCE ────────────────────────────────────────────────────────────────
  { name: "mem-recall-goal", note: "MEMORY recall: the goal is in past-chat memory, NOT the book. Must recall 'big banking client' and not invent; then use it against the DB.", turns: [
    "remind me — what did I say my main goal was this quarter?",
    "good memory. which of my open deals actually move me toward that?",
    "and does my strongest service line line up with those?",
  ] },
  { name: "mem-preference-applied", note: "MEMORY preference applied WITHOUT a reminder: emails ~3 sentences, no jargon. Draft must obey it; then must be able to say WHY it kept it short.", turns: [
    "draft a follow-up email to Michael Martin at JPMorgan",
    "why did you keep it that short and plain?",
  ] },
  { name: "mem-negative-preference", note: "NEGATIVE memory constraint: user avoids public sector. Must flag that chasing UK Civil Service conflicts with the remembered preference, not just cheer it on.", turns: [
    "should I chase the UK Civil Service opportunity that's in my pipeline?",
    "so on balance — pursue it or leave it, given how I work?",
  ] },
  { name: "mem-do-not-fabricate", note: "MEMORY honesty: nothing about a 'pricing strategy' was ever stored. Must say it doesn't have that noted — must NOT confabulate a past discussion.", turns: [
    "what did I tell you last time about my pricing strategy?",
    "ok — so what would you actually need from me to help set one?",
  ] },
  { name: "mem-db-conflict-amelia", note: "MEMORY vs DB conflict: memory says a prior conference connection with Amelia Wright; the book shows 'not contacted'. Must reconcile — no logged meeting, but a warm prior link — not a flat 'never met'.", turns: [
    "have I ever actually met Amelia Wright?",
    "so how should I open with her — as a stranger or not?",
  ] },
  { name: "mem-context-overrides", note: "CONTEXT overrides stale MEMORY: memory says the goal is banking; user updates it IN-CHAT to healthcare. Later turns must use the NEW priority, not the remembered one.", turns: [
    "quick update — my priority has shifted this quarter, it's all about healthcare and pharma now, not banking",
    "so given where my head's at now, which deals should I be pushing?",
    "remind me what my focus is again?",
  ] },
  { name: "mem-source-attribution", note: "SOURCE transparency: after stating facts, must be able to say which came from the book vs from past chats — not blur them.", turns: [
    "what do you know about my relationship with Amelia Wright?",
    "and which of that is actually in my book versus something I told you before?",
  ] },

  // ── DB AUTHORITY vs A USER CLAIM ────────────────────────────────────────────────────────────────
  { name: "db-vs-claim-closed", note: "User asserts a DB-contradicting fact ('I closed Shell'); the book shows it open at Proposal Build. Must not silently accept it as record truth; flag the mismatch, offer to update.", turns: [
    "I closed the Shell deal yesterday — great result",
    "so what's my new win count and open pipeline value?",
  ] },

  // ── CLASSIC MID-MODEL WEAKNESSES ────────────────────────────────────────────────────────────────
  { name: "weak-negation-absence", note: "NEGATION over the DB: who I have NOT contacted. Models flip these — must return the un-contacted, not the contacted.", turns: [
    "who at JPMorgan have I NOT contacted yet?",
    "of that group, who's the most senior?",
    "draft that person a first-touch note",
  ] },
  { name: "weak-temporal", note: "TEMPORAL filtering + reasoning across turns — 'haven't spoken to since', 'this week vs next'.", turns: [
    "who haven't I had a meeting with since May?",
    "and what's actually due this week versus next week?",
  ] },
  { name: "weak-aggregation", note: "AGGREGATION/arithmetic over the book — average, weighted total. Models guess these; must be consistent with the pipeline figures.", turns: [
    "what's the average value of my open opportunities?",
    "and if you weight each by its probability, what's the total worth?",
    "so how big is the gap between the raw and the weighted number?",
  ] },
  { name: "weak-hypothetical", note: "COUNTERFACTUAL arithmetic — must compute the 'if' without corrupting the real current numbers.", turns: [
    "if I win both Merck and Shell, what does that do to my win count and my open pipeline?",
    "and roughly what would my win rate become?",
    "but to be clear — I haven't actually won those yet, right?",
  ] },
  { name: "weak-consistency-drift", note: "CONSISTENCY over a long thread — the same fact asked at turn 1 and turn 6 must match (no drift).", turns: [
    "how many open opportunities do I have right now?",
    "which is the biggest by value?",
    "draft a nudge to someone at that company",
    "make it warmer",
    "actually leave the draft — different question",
    "remind me, how many open opportunities did you say I have?",
  ] },
  { name: "weak-similar-entity", note: "SIMILAR-ENTITY disambiguation — two Karens (Rossi/Hughes) and the 'Karen Hughes' vs org 'Baker Hughes' trap. Must not merge or swap them.", turns: [
    "tell me about Karen at JPMorgan",
    "no, I meant the other Karen — the product manager",
    "has she been messaged or not?",
  ] },
  { name: "weak-missing-field", note: "MISSING-FIELD honesty — the book has no phone/email for her. Must say so, must NOT invent contact details.", turns: [
    "what's Amelia Wright's phone number?",
    "her email then?",
  ] },
  { name: "weak-action-suppression", note: "HYPOTHETICAL should NOT trigger a record write — 'I might reach out at some point' is not 'log a meeting'.", turns: [
    "I might reach out to Amelia Wright at some point, we'll see",
    "no rush — just thinking out loud. who else is in that account?",
  ] },
  { name: "weak-in-thread-contradiction", note: "LAST-WRITE-WINS in context — priority set, then changed; the final recall must reflect the LATEST, not the first.", turns: [
    "for now, Michael Martin is my number one priority at JPMorgan",
    "give me a one-line opener for him",
    "actually, forget Michael — focus everything on Karen Rossi instead",
    "so who's my top priority at JPMorgan again, and why?",
  ] },
  { name: "weak-multihop", note: "MULTI-HOP over the DB — biggest deal → its company → most senior contact there. Chained lookups the router can't do alone.", turns: [
    "which single open deal is my biggest by value?",
    "who's the most senior person I know at that company?",
    "draft them a short note that ties to that deal",
  ] },
  { name: "weak-standing-instruction", note: "STANDING INSTRUCTION held across turns — 'keep every answer to two sentences' must persist beyond the next turn.", turns: [
    "for the rest of this chat, keep every answer to two sentences maximum",
    "how's my pipeline looking?",
    "who should I focus on this week?",
    "and my warmest lead?",
  ] },
];
