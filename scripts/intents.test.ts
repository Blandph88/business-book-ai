// Validate the intent-routing dictionary over a long fixture of real-world utterances + edge cases.
import { routeIntent } from "../src/ai/intents";

let pass = 0, fail = 0;
function check(text: string, kind: string, entity?: string, opts?: { hasDoc?: boolean }) {
  const r = routeIntent(text, opts);
  const ok = r.kind === kind && (entity === undefined || r.entity === entity);
  ok ? pass++ : fail++;
  console.log(`${ok ? "✓" : `✗ FAIL [${r.kind}${r.entity ? "/" + r.entity : ""}]`}  ${text}`);
}

// capture / create meeting
check("I just had a meeting with Jane from EY", "create", "meeting");
check("met with Sam today", "create", "meeting");
check("log a call with Acme Corp", "create", "meeting");
check("I'm meeting John next Tuesday", "create", "meeting");
check("set up a meeting with Priya", "create", "meeting");
check("record my conversation with the CFO at Shell", "create", "meeting");
check("here is the transcript", "create", "meeting", { hasDoc: true });

// update meeting
check("add notes to my meeting with Jane", "update", "meeting");
check("mark the EY meeting as held", "update", "meeting");
check("set the follow-up for my meeting with Sam", "update", "meeting");

// create opportunity
check("there's an opportunity at Microsoft", "create", "opportunity");
check("raise an opportunity for Acme worth 200k", "create", "opportunity");
check("Acme is interested in a strategy project", "create", "opportunity");
check("spotted a deal with Barclays", "create", "opportunity");

// update opportunity
check("move the EY deal to proposal", "update", "opportunity");
check("mark the Acme deal as won", "update", "opportunity");
check("set the value of the EY deal to 150k", "update", "opportunity");
check("add Deloitte as a competitor", "update", "opportunity");

// update contact
check("Jane is a champion now", "update", "contact");
check("mark Sam as high priority", "update", "contact");
check("add a note to Jane", "update", "contact");
check("remind me to send the proposal", "update", "contact");
check("Priya is based in Dubai", "update", "contact");

// create contact (someone not on LinkedIn) — explicit phrasings, must NOT clash with "I met X" → meeting
check("add a new contact Jane Doe, CFO at Acme", "create", "contact");
check("create a contact called Tom Smith at EY", "create", "contact");
check("log a new contact: Priya Patel, Head of Risk at HSBC", "create", "contact");
check("add Sara Lee to my contacts", "create", "contact");
check("save Mike Brown as a new contact", "create", "contact");
check("I just had a meeting with Ethan Rossi", "create", "meeting"); // still a meeting, not a contact

// contract
check("we signed Acme", "create", "contract");
check("create a SoW for the EY deal", "create", "contract");
check("mark the Acme contract completed", "update", "contract");

// draft
check("draft a follow-up to Jane", "draft");
check("write a reconnect message to Sam", "draft");
check("prep a briefing for my meeting with Priya", "draft");

// workflow
check("what should I do this week", "workflow");
check("walk me through this week", "workflow");
check("help me close my loose ends", "workflow");
check("who should I reconnect with", "workflow");

// web
check("latest news on JPMorgan", "web");
check("who is Satya Nadella", "web");
check("look up Palantir", "web");

// query (about own book)
check("how's my pipeline", "query");
check("do they have active opportunities", "query");
check("which companies are my best contacts in", "query");
check("what do you know about me", "query");

// search / help
check("find Jane Doe", "search");
check("Microsoft", "search");
check("what can you do", "help");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
