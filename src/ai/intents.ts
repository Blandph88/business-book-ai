// Intent routing for the copilot — decide what the user wants so we can query, search, take action,
// run a workflow, draft, look up the web, or read a document. Built for SMALL on-device models:
// deterministic first (hard signals + a long pattern dictionary), with a model classifier only as a
// last resort for genuinely ambiguous input. The dictionary is intentionally long and edge-case-aware;
// first matching rule wins. Capture groups pull out the subject (a person/company) where possible.

export type IntentKind = "query" | "search" | "create" | "update" | "workflow" | "draft" | "web" | "document" | "help";
export type Entity = "contact" | "meeting" | "opportunity" | "contract";

export type RoutedIntent = {
  kind: IntentKind;
  entity?: Entity;
  op?: "create" | "update";
  target?: string; // the captured subject (person or company), trimmed
  confidence: "high" | "medium" | "low";
  source: "signal" | "dictionary" | "model" | "default";
};

type Rule = {
  kind: IntentKind;
  entity?: Entity;
  op?: "create" | "update";
  patterns: RegExp[];
  // optional: which capture group holds the subject (defaults to 1)
  targetGroup?: number;
};

// Trim a captured subject: drop trailing clauses ("today", "next week", "about X"), quotes, punctuation.
function cleanTarget(s?: string): string | undefined {
  if (!s) return undefined;
  let t = s.trim().replace(/^["'`]|["'`]$/g, "");
  t = t.replace(/\b(today|yesterday|tomorrow|this (morning|afternoon|week|month)|just now|earlier|recently|next (week|month|tuesday|monday|wednesday|thursday|friday))\b.*$/i, "").trim();
  t = t.replace(/\s+(about|regarding|re|on|to discuss|for)\b.*$/i, "").trim();
  t = t.replace(/[.,;:!?]+$/, "").trim();
  return t || undefined;
}

// The dictionary — ORDER MATTERS (specific/action first; query/search are the fallbacks).
const RULES: Rule[] = [
  // ── DOCUMENT (text usually paired with an upload; see hard signals too) ──
  { kind: "document", patterns: [/\b(summari[sz]e|pull (the )?actions?|extract|what'?s in|read|tl;?dr)\b.*\b(this|the|attached|uploaded|document|doc|file|pdf|transcript|note)\b/i, /\b(this|the attached|uploaded) (document|doc|file|pdf|transcript)\b/i] },

  // ── CAPTURE / CREATE MEETING ──
  { kind: "create", entity: "meeting", patterns: [
    /\bi (?:just )?(?:had|did|finished|wrapped up|came (?:out|back) from)\s+(?:a |an |my )?(?:meeting|call|chat|catch[- ]?up|coffee|lunch|dinner|sync|conversation)\s+(?:with\s+)?(.+)/i,
    /\b(?:just )?(?:met|spoke|talked|chatted|caught up|had coffee|had lunch|had a call)\s+with\s+(.+)/i,
    /\blog (?:a |my )?(?:meeting|call|chat|coffee|catch[- ]?up|conversation)\s+(?:with\s+)?(.+)/i,
    /\b(?:record|capture|note|add)\s+(?:a |my )?(?:meeting|call|conversation)\s+(?:with\s+)?(.+)/i,
    /\b(.+?)\s+and i (?:just )?(?:spoke|met|talked|caught up)\b/i,
    /\bcreate (?:a |an )?(?:new )?meeting\b(?:\s+(?:with|for)\s+(.+))?/i,
    /\b(?:i'?m|i am) (?:meeting|seeing|catching up with|having a call with)\s+(.+)/i, // scheduled (future) — handled as Scheduled
    /\bset up (?:a )?meeting\s+(?:with\s+)?(.+)/i,
    /\bschedule (?:a )?(?:meeting|call)\s+(?:with\s+)?(.+)/i,
  ] },

  // ── UPDATE MEETING ──
  { kind: "update", entity: "meeting", patterns: [
    /\b(?:add|update|edit|change)\s+(?:the )?(?:notes?|write[- ]?up|details?)\s+(?:to|on|for)\s+(?:my )?meeting\s+with\s+(.+)/i,
    /\bmark (?:the |my )?(.+?)\s+meeting\s+(?:as )?(?:held|done|complete|cancelled|no[- ]show)\b/i,
    /\b(?:the |my )?meeting with (.+?)\s+(?:was|went)\b/i,
    /\bset (?:the )?follow[- ]?up\s+(?:for|on)\s+(?:my )?meeting\s+with\s+(.+)/i,
  ] },

  // ── CREATE OPPORTUNITY ──
  { kind: "create", entity: "opportunity", patterns: [
    /\b(?:there'?s|i (?:found|spotted|see)|we have)\s+(?:a |an )?(?:new )?opportunit(?:y|ies)\s+(?:at|with|for)\s+(.+)/i,
    /\b(?:raise|create|add|log|open|start)\s+(?:a |an )?(?:new )?(?:opportunit(?:y|ies)|deal|pipeline item)\s+(?:at|with|for)?\s*(.+)?/i,
    /\b(.+?)\s+(?:is|are|might be|could be|seems?)\s+(?:interested|keen|looking)\s+(?:in|for)\b/i,
    /\b(?:new )?(?:deal|opportunity)\s+(?:from|out of)\s+(?:my )?meeting\s+with\s+(.+)/i,
    /\b(?:spotted|found|identified)\s+(?:a )?(?:deal|opportunity)\s+(?:with|at)\s+(.+)/i,
  ] },

  // ── UPDATE OPPORTUNITY ──
  { kind: "update", entity: "opportunity", patterns: [
    /\b(?:move|advance|progress|push)\s+(?:the )?(.+?)\s+(?:deal|opportunity)\s+(?:to|forward|on|into)\b/i,
    /\b(?:the )?(.+?)\s+(?:deal|opportunity)\s+is\s+(?:now\s+)?(?:at|in|won|lost|dead|stalled|signed)\b/i,
    /\bmark\s+(?:the )?(.+?)\s+(?:deal|opportunity)?\s*(?:as )?(?:won|lost|dead)\b/i,
    /\bset (?:the )?(?:value|amount|size|probability|prob|chance)\s+(?:of|on|for)\s+(?:the )?(.+?)\s+(?:deal|opportunity)\b/i,
    /\b(?:the )?(.+?)\s+(?:deal|opportunity)\s+(?:is worth|value is)\b/i,
    /\badd\s+(.+?)\s+as a competitor\b/i,
    /\bupdate (?:the )?(.+?)\s+(?:deal|opportunity|pipeline)\b/i,
  ] },

  // ── UPDATE CONTACT ──
  { kind: "update", entity: "contact", patterns: [
    /\b(.+?)\s+is (?:now )?(?:a )?(?:champion|warm|strong|cold|high priority|low priority|the decision[- ]maker|a decision maker|an influencer|a gatekeeper)\b/i,
    /\bmark\s+(.+?)\s+as\s+(?:a )?(?:champion|warm|strong|cold|high|low|priority|decision[- ]?maker|influencer|gatekeeper)\b/i,
    /\bset (?:the )?(?:relationship|priority|decision role|next action|next step|reminder)\s+(?:for|on|with)\s+(.+)/i,
    /\b(.+?)\s+is based in\b/i,
    /\badd (?:a )?note\s+(?:to|on|for|about)\s+(.+)/i,
    /\b(?:update|edit|change)\s+(.+?)'?s?\s+(?:relationship|priority|role|phone|notes?|details?)\b/i,
    /\bremind me to\s+(.+)/i,
  ] },

  // ── CREATE / UPDATE CONTRACT (SoW) ──
  { kind: "create", entity: "contract", patterns: [
    /\b(?:we (?:just )?)?signed\s+(.+)/i,
    /\b(?:create|raise|add|draw up|set up|start)\s+(?:a |an )?(?:sow|s\.o\.w\.|statement of work|contract|engagement)\s+(?:for|with|at)?\s*(.+)?/i,
    /\b(?:new )?(?:contract|engagement|sow)\s+(?:for|with)\s+(.+)/i,
  ] },
  { kind: "update", entity: "contract", patterns: [
    /\bmark (?:the )?(.+?)\s+(?:contract|engagement|sow)\s+(?:as )?(?:active|completed|paused|closed|done)\b/i,
    /\b(?:recognis|recogniz)e[d]?\s+.*\bon\s+(?:the )?(.+?)\s+(?:contract|engagement|sow)\b/i,
    /\bupdate (?:the )?(.+?)\s+(?:contract|engagement|sow)\b/i,
  ] },

  // ── DRAFT ──
  { kind: "draft", patterns: [
    /\b(?:draft|write|compose|prepare|prep|put together)\s+(?:me )?(?:a |an )?(?:message|note|email|follow[- ]?up|reply|response|reconnect(?:ion)?|intro(?:duction)?)\b.*\b(?:to|for)\s+(.+)/i,
    /\b(?:draft|write|prep|prepare)\s+(?:me )?(?:a )?(?:brief|briefing|prep note|talking points)\b.*\b(?:for|on|about|before)\s+(.+)/i,
    /\bhelp me (?:write|draft|reply|respond|reach out)\b.*\b(?:to|for)\s+(.+)/i,
    /\b(?:draft|write|prep|prepare)\s+(?:a )?(?:brief|briefing|message|note|talking points)\b/i,
  ] },

  // ── WORKFLOW (guided, multi-item) ──
  { kind: "workflow", patterns: [
    /\bwhat (?:should i|do i need to|have i got to)\s+do\b.*\b(?:this week|today|next)\b/i,
    /\b(?:walk|take|run)\s+me\s+through\b/i,
    /\b(?:work through|go through|clear|close|tidy up|sort out|catch up on)\b.*\b(?:this week|my (?:open|loose|outstanding) (?:items|ends|tasks)|pipeline|follow[- ]?ups?|action items?|to[- ]?dos?)\b/i,
    /\b(?:help me )?(?:close|clear|tidy)\b.*\bloose ends?\b/i,
    /\bwho should i (?:reconnect with|follow up with|chase|reach out to)\b/i,
    /\bmy (?:agenda|to[- ]?do(?:s| list)?|priorities|tasks)\b/i,
  ] },

  // ── WEB (external / current info) ──
  { kind: "web", patterns: [
    /\b(?:latest|recent|current)\s+(?:news|updates?|developments?)\b/i,
    /\b(?:news|happening|going on|announced|in the news)\b.*\b(?:about|on|at|with)\s+(.+)/i,
    /\bwho (?:is|are)\s+(.+)/i,
    /\bwhat (?:is|are|does)\s+(.+?)\b.*\b(?:do|revenue|market cap|headquarters|ceo|founded)\b/i,
    /\blook up\s+(.+)/i,
    /\b(?:search|google|find online|on the web)\b/i,
    /\b(?:revenue|ceo|headquarters|share price|stock|founded|competitors?)\s+of\s+(.+)/i,
  ] },

  // ── HELP / CAPABILITIES ──
  { kind: "help", patterns: [/\bwhat can you (?:do|help)\b/i, /\bhow do i\b/i, /\bwhat (?:are your|can this) (?:capabilities|features)\b/i, /^\s*help\s*$/i] },

  // ── SEARCH (bare lookup) ──
  { kind: "search", patterns: [/^\s*(?:find|show me|open|go to|jump to|pull up)\s+(.+)/i] },
];

// Hard signals first (no model), then the dictionary, then a low-confidence "query" default that the
// caller may escalate to the model classifier.
export function routeIntent(text: string, opts: { hasDoc?: boolean } = {}): RoutedIntent {
  const t = text.trim();

  // A document is attached → it's either a meeting to capture (transcript-like) or a doc to read.
  if (opts.hasDoc) {
    if (/\b(meeting|call|met|spoke|catch[- ]?up|coffee|transcript)\b/i.test(t)) return { kind: "create", entity: "meeting", op: "create", confidence: "high", source: "signal", target: cleanTarget(t.replace(/^.*\bwith\s+/i, "")) };
    return { kind: "document", confidence: "high", source: "signal" };
  }

  for (const rule of RULES) {
    for (const re of rule.patterns) {
      const m = t.match(re);
      if (m) {
        const target = cleanTarget(m[rule.targetGroup ?? 1]);
        return { kind: rule.kind, entity: rule.entity, op: rule.kind === "create" ? "create" : rule.kind === "update" ? "update" : undefined, target, confidence: "high", source: "dictionary" };
      }
    }
  }

  // No match. A short bare proper-noun-ish token (a name/company, no question words) → search;
  // otherwise treat as a question (query), flagged low-confidence so the caller may escalate to the
  // model classifier.
  const hasQuestionWord = /\b(how|what|which|why|who|when|where|do|does|did|is|are|was|were|will|should|can|could|would|my|me|i)\b/i.test(t);
  if (/^[\w .,'&-]{1,40}$/.test(t) && t.split(/\s+/).length <= 4 && !/[?]/.test(t) && !hasQuestionWord) {
    return { kind: "search", target: t, confidence: "low", source: "default" };
  }
  return { kind: "query", confidence: "low", source: "default" };
}

// Does this routed intent take an action (vs just answer/search)?
export function isActionIntent(r: RoutedIntent): boolean {
  return r.kind === "create" || r.kind === "update";
}
