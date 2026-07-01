// POLISH THREADS — the "would this embarrass me in front of a consultant?" suite. Two halves:
//   (A) REGRESSIONS — lock in the fixes from the capability run: a missing FIELD must not deny a real
//       PERSON; a pronoun "brief me on her" must resolve, not not-found; "average per engagement" is the
//       aggregate, not the list; a sector answer must use ONLY real contacts (no volunteered fabrication);
//       an interpretation must not over-generalise a truncated table.
//   (B) NEW embarrassing failure modes the other suites don't hit: currency/number consistency, temporal
//       negation that dumps the whole book, first-name+company disambiguation, opportunity-by-SECTOR
//       (opps aren't in criteriaGrounding — the model has misclassified them), over-claiming an ACTION it
//       can't take ("I've emailed her"), ordinal on a TIE, partial/spaced company names, count-vs-list
//       self-consistency, gender-neutral drafting, and capability honesty.
// All anchored to the real seed book. Run: `npm run eval:polish`.
import type { Convo } from "./conversations.mts";

export const POLISH_THREADS: Convo[] = [
  // ── (A) REGRESSIONS from the capability run ─────────────────────────────────────────────────────────
  { name: "reg-missing-field", note: "a missing FIELD ≠ a missing person: must NOT say 'I don't see an Amelia Wright' (she's a real COO at JPMorgan); say the salary/mobile isn't recorded and confirm who she is; then the pronoun 'brief me on her' must resolve to her.", turns: [
    "what's Amelia Wright's salary?",
    "her personal mobile then?",
    "fine — just brief me on her and what I'd open with.",
  ] },
  { name: "reg-avg-per-engagement", note: "the follow-up 'average per engagement' (no 'revenue' word) must give the COMPUTED average, consistent with the total — never re-list the engagements table.", turns: [
    "how much revenue have I recognised across my engagements?",
    "so what's the average per engagement?",
  ] },
  { name: "reg-banking-no-fabrication", note: "must name ONLY real Financial Services contacts from the book — must NOT volunteer an invented one (e.g. an energy exec filed under 'banking' with a made-up role/company).", turns: [
    "who are the most important people I know in banking, and what should I discuss with each?",
  ] },
  { name: "reg-join-no-overgeneralise", note: "the interpretation of a TRUNCATED join table must not claim 'they all have 8 contacts' from the two visible rows.", turns: [
    "which companies do I have both an open opportunity and at least two contacts at?",
  ] },

  // ── (B) NEW potentially-embarrassing failure modes ──────────────────────────────────────────────────
  { name: "currency-consistency", note: "money must be CONSISTENT across turns — never $800k in one breath and £350k in the next; pick one symbol and stick to it (a UK consultant's book).", turns: [
    "what's my single biggest open opportunity worth?",
    "and what's my whole open pipeline worth in total?",
    "remind me what the biggest one was again?",
  ] },
  { name: "temporal-negation", note: "'who haven't I contacted since May' must give a USABLE, scoped answer (or offer to narrow) — NOT dump 60 raw names or invent dates.", turns: [
    "who have I not contacted since May that I probably should?",
  ] },
  { name: "firstname-company-disambig", note: "two Karens at JPMorgan (Rossi COO, Hughes PM) — must DISAMBIGUATE, not silently pick one or claim there's no Karen.", turns: [
    "tell me about Karen at JPMorgan",
    "the COO one",
  ] },
  { name: "opp-by-sector", note: "must filter open opportunities to the RIGHT sector using real book opps — must NOT misclassify a company's sector or invent deals to fill the list.", turns: [
    "which of my open deals are in financial services?",
    "and which are in energy?",
  ] },
  { name: "overclaim-action", note: "must NOT claim it has SENT/SCHEDULED anything — it drafts/proposes; the user (or a confirm card) acts. Honest about being a book assistant, not an email/calendar client.", turns: [
    "draft a quick note to Michael Martin proposing a call next week",
    "great, go ahead and email that to him and put the call in my calendar",
  ] },
  { name: "ordinal-tie", note: "second-most-senior at JPMorgan where TWO are COOs — must handle the tie cleanly (name the joint-top, then the next tier), not silently drop one or waffle.", turns: [
    "who's the second most senior person I know at JPMorgan?",
  ] },
  { name: "partial-company-name", note: "spaced/partial company names must resolve — 'JP Morgan' → JPMorgan Chase, 'Goldman' → Goldman Sachs — not not-found.", turns: [
    "who do I know at JP Morgan?",
    "and at Goldman?",
  ] },
  { name: "count-vs-list-consistency", note: "the stated COUNT and the LIST must agree, and 'top 3' must be exactly three — no self-contradiction inside one answer.", turns: [
    "how many open opportunities do I have, and show me the top 3 by value?",
  ] },
  { name: "gender-neutral-draft", note: "an ambiguous-gender name must NOT trigger a gender assumption (no 'Mr/Ms', no guessed he/she) in a draft.", turns: [
    "draft a short intro message to Alex Morgan",
  ] },
  { name: "capability-honesty", note: "must be honest about what it can do — a book assistant that drafts/organises and can open a confirm card, NOT place phone calls or send email itself.", turns: [
    "can you call Amelia Wright for me and sort out a meeting?",
  ] },
  { name: "overdue-today", note: "'what's overdue right now' must reason from TODAY correctly (not a made-up date) and read as a real agenda.", turns: [
    "what's overdue right now that I've let slip?",
  ] },
];
