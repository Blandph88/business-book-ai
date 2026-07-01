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
    // ADJ = a curated adjective run (not \w+, which would swallow "notes to my" and collide with update-notes).
    // Lets "had a GREAT meeting" / "a really productive call" match while keeping the boundaries tight.
    /\bi (?:just )?(?:had|did|finished|wrapped up|came (?:out|back) from)\s+(?:a |an |my )?(?:(?:great|good|quick|brief|nice|really|very|super|long|short|productive|positive|useful|helpful|initial|first|second|final|last|lovely|solid|proper|big|small|early|late|new)\s+){0,3}(?:meeting|call|chat|catch[- ]?up|coffee|lunch|dinner|sync|conversation)\s+(?:with\s+)?(.+)/i,
    /\b(?:just )?(?:met|spoke|talked|chatted|caught up|had coffee|had lunch|had a call)\s+with\s+(.+)/i,
    /\blog (?:a |my )?(?:(?:great|good|quick|brief|nice|really|very|super|long|short|productive|positive|useful|helpful|initial|first|second|final|last|lovely|solid|proper|big|small|early|late|new)\s+){0,3}(?:meeting|call|chat|coffee|catch[- ]?up|conversation)\s+(?:with\s+)?(.+)/i,
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
    // Only an OUTCOME word after was/went (not "was weeks ago", and not inside a hypothetical "if … was …").
    /(?<!\bif\b[^?]{0,60})\b(?:the |my )?meeting with (.+?)\s+(?:was|went)\s+(?:great|well|really|very|good|badly|poorly|positive|negative|productive|tough|hard|fine|ok|okay|terrible|amazing|useful|helpful|brilliant|disappointing|encouraging|a (?:success|disaster|waste))\b/i,
    /\bset (?:the )?follow[- ]?up\s+(?:for|on)\s+(?:my )?meeting\s+with\s+(.+)/i,
  ] },

  // ── CREATE OPPORTUNITY ──
  { kind: "create", entity: "opportunity", patterns: [
    /\b(?:there'?s|i (?:found|spotted|see)|we have)\s+(?:a |an )?(?:new )?opportunit(?:y|ies)\s+(?:at|with|for)\s+(.+)/i,
    /\b(?:raise|create|add|log|start)\s+(?:a |an )?(?:new )?(?:opportunit(?:y|ies)|deal|pipeline item)\s+(?:at|with|for)?\s*(.+)?/i,
    // "open" only with an article ("open a new deal") — never bare "open deal" (that's an ADJECTIVE: "my open deals").
    /\bopen\s+(?:a |an )(?:new )?(?:opportunit(?:y|ies)|deal|pipeline item)\b\s*(?:at|with|for)?\s*(.+)?/i,
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
  // CREATE a brand-new contact (someone met who isn't in the LinkedIn import). Explicit phrasings only,
  // so it never collides with the "I met/called X" → log-a-meeting signal above.
  { kind: "create", entity: "contact", patterns: [
    /\b(?:add|create|save|log|make)\s+(?:a\s+)?(?:new\s+)?contact\b\s*(?:called|named|for|:|-|–)?\s*(.+)?/i,
    /\bnew contact\b\s*[:,-]?\s*(.+)?/i,
    /\badd\s+(.+?)\s+(?:to|into)\s+my\s+(?:contacts|book|network)\b/i,
    /\bsave\s+(.+?)\s+as\s+(?:a\s+)?(?:new\s+)?contact\b/i,
  ] },

  { kind: "update", entity: "contact", patterns: [
    /\b(.+?)\s+is (?:now )?(?:a )?(?:champion|warm|strong|cold|high priority|low priority|the decision[- ]maker|a decision maker|an influencer|a gatekeeper)\b/i,
    /\bmark\s+(.+?)\s+as\s+(?:a )?(?:champion|warm|strong|cold|high|low|priority|decision[- ]?maker|influencer|gatekeeper)\b/i,
    /\bset (?:the )?(?:relationship|priority|decision role|next action|next step|reminder)\s+(?:for|on|with)\s+(.+)/i,
    /\b(.+?)\s+is based in\b/i,
    /\badd (?:a )?note\s+(?:to|on|for|about)\s+(.+)/i,
    // Owner must be a NAME, not a pronoun/article — so "update — my priority has shifted" (a goal statement)
    // isn't read as editing a contact's priority field.
    /\b(?:update|edit|change)\s+(?!(?:my|the|your|his|her|their|our|a|an|this|that)\b)([A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*){0,2})'?s?\s+(?:relationship|priority|role|phone|notes?|details?)\b/i,
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

  // Analytical / reporting requests are ANSWERS, never record writes. Guard up front so "create a sector
  // contact report", "summarise…", "breakdown by sector" can't be mistaken for create/update-contact.
  if (/\b(report|summary|summari[sz]e|breakdown|overview|analys(?:e|is|ze)|chart|graph|dashboard|distribution|weighted|how many|count)\b/i.test(t)) {
    return { kind: "query", confidence: "high", source: "signal" };
  }

  // A NEGATED / absence question ("who haven't I met?", "who haven't I had a meeting with since May?") is a
  // QUERY about a gap — NOT a request to log a meeting. Guard before the "I had a meeting with X" create rule,
  // which otherwise matches the "…I had a meeting with…" substring inside "haven't I had a meeting with…".
  if (/\b(?:haven'?t|hasn'?t|have not|has not|didn'?t|never|not yet)\b[^?]*\b(?:met|meeting|spoke|spoken|called|talked|contacted|reached out|caught up|heard from)\b/i.test(t)) {
    return { kind: "query", confidence: "high", source: "signal" };
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

// ── PERSONAL / EMOTIONAL register ────────────────────────────────────────────────────────────────
// The user has brought something personal (they're low, stressed, venting about their boss or their day)
// rather than asking about their book. When this fires, the copilot drops the BD hat entirely and just
// responds like a warm human — NO records, NO contact names, NO pivot to pipeline (the exact things that
// made "I feel sad" get answered with "want to nudge an opportunity? try Richard Singh"). Deliberately
// broad on feeling-words; a work message that merely mentions stress ("stressful quarter — show my deals")
// is caught by the work routes first at the call site, so this only owns genuinely personal turns.
export function personalRegister(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\bi (?:feel|am feeling|'m feeling|felt|get|got|am|'m)\s+(?:so |really |very |a bit |quite |kind of |kinda |pretty |just )?(sad|down|low|blue|upset|anxious|stressed|overwhelmed|burnt? ?out|burned ?out|exhausted|drained|lonely|depress(?:ed|ing)|miserable|hopeless|worthless|numb|lost|awful|terrible|rubbish|crap|unhappy|angry|frustrated|scared|worried|empty|defeated)\b/.test(t) ||
    /\b(?:i'?m|i am) (?:really |so |just )?struggling\b/.test(t) ||
    /\bi (?:hate|can'?t stand|am sick of|'m sick of|am done with|'m done with|resent|despise)\s+(?:my )?(boss|job|manager|team|colleague|coworker|career|life|work|everything|this|it here)\b/.test(t) ||
    /\bmy (?:personal life|private life|mental health|wellbeing|well-being|marriage|relationship|partner|family|divorce|breakup|break-up|health|home life)\b/.test(t) ||
    /\bi (?:just )?(?:feel|felt) (?:sad|awful|terrible|low|down|empty|like giving up|like crying|like a failure)\b/.test(t) ||
    /\b(?:having|had|it'?s been) a (?:really |very |such a )?(?:hard|rough|tough|bad|terrible|awful|long|shit|shitty|horrible) (?:day|week|time|month|year|one)\b/.test(t) ||
    /\bi (?:can'?t cope|can'?t take (?:it|this)|don'?t know what to do|need to vent|need someone to talk to|want to talk about my|feel like giving up|feel alone|feel so alone|feel invisible)\b/.test(t) ||
    /\b(?:i'?m|i am) (?:so |really |just )?(?:tired|exhausted|done|fed up|burnt out|burned out) (?:of|with)?\b/.test(t) ||
    /\bwant to (?:talk|chat) (?:to you )?about (?:my|something) (?:personal|life|feelings|day)\b/.test(t)
  );
}

// ACUTE crisis ONLY — explicit self-harm / suicidal intent. This is the single case where the copilot
// overrides the model with a deterministic, resource-bearing response (a weak model must never fumble this,
// and the resources must be exact). Deliberately NARROW: sadness, depression, anxiety, being bullied,
// "can't cope" are NOT this — those are heavyDistress (below), which the MODEL answers genuinely with a
// PROPORTIONAL, non-canned suggestion of support. Harm-to-others is intentionally left to the model too
// ("I could kill my boss" is an idiom a keyword floor would mis-fire on). Removed situational "can't go on".
export function crisisSignal(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(kill(?:ing)? myself|end(?:ing)? (?:it all|my life|my own life)|take my (?:own )?life|suicid(?:e|al)|don'?t want to (?:live|be here|wake up|exist)|no longer want to (?:live|be here|be alive)|want to die|wanna die|better off (?:dead|without me)|no reason to (?:live|go on|carry on)|hurt(?:ing)? myself|harm(?:ing)? myself|self[- ]harm|cut(?:ting)? myself)\b/.test(t)
  );
}

// HEAVY distress that is NOT an acute crisis — depression, hopelessness (without self-harm), being ground
// down by bullying, "can't cope". NOT the deterministic floor: the model responds genuinely and, when the
// weight warrants it, gently suggests support — proportional, never canned. This flag mainly helps a SMALL
// model recognise a turn is heavy enough to offer that (a capable model can gauge it itself); it does not
// change routing (these turns go to the warm companion either way).
export function heavyDistress(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(depress(?:ed|ion|ing)|hopeless|despair(?:ing)?|can'?t cope|cannot cope|can'?t go on|falling apart|breaking down|at (?:my|an all[- ]time) lowest|really struggling|struggling (?:so much|a lot|badly|really)|burnt ?out|burned ?out|worthless|hate my life|hate myself|no point (?:in|to|any)|what'?s the point|too much to (?:handle|bear|take)|can'?t take (?:it|this) ?any ?more|drowning|rock bottom|dark place)\b/.test(t) ||
    /\b(bullied|bullying|belittl(?:ed|ing|es)|harass(?:ed|ing|ment)|humiliat(?:ed|ing|es)|torment(?:ed|ing)|picked on)\b/.test(t) ||
    /\bdon'?t know how much (?:more|longer) i can (?:take|cope|do this|keep going)\b/.test(t)
  );
}
