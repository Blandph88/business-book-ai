// The classification engine — the in-browser replacement for the personal tool's Python
// pipeline. Given a contact's { company, title }, it derives seniority, function and sector
// (industry + sub-sector). Runs identically for the demo generator and the live LinkedIn
// import, with zero dependencies beyond the market config.
//
//  - SENIORITY  is industry-agnostic → ported almost verbatim from pipeline.py get_seniority.
//  - FUNCTION   is generalised to cross-industry buckets (the personal tool's were FS-only).
//  - SECTOR     is company → (industry, sub-sector) via the dictionary, then keyword
//               heuristics, then "Other Industries" for the long tail (user can override).

import {
  COMPANY_DICTIONARY,
  COMPANY_KEYWORD_RULES,
  INDUSTRY_LABEL,
  OTHER_INDUSTRY_LABEL,
  INDEPENDENT_LABEL,
} from "../config/markets";

export type SeniorityLabel =
  | "Executive Leadership"
  | "Head of / Director"
  | "VP / SM"
  | "Manager"
  | "Associate / Analyst";

const lower = (s: string | undefined | null) => (s ?? "").toString().toLowerCase();
// Whole-word test (mirrors the Python `\bword\b` guards that stop short tokens firing on
// substrings, e.g. "vp" inside "develop", "lead" inside "leader").
const word = (t: string, w: string) => new RegExp(`\\b${w}\\b`).test(t);

// ── TITLE → SENIORITY (ported from pipeline.py get_seniority) ─────────────────────────────
export function classifySeniority(title: string | undefined): SeniorityLabel {
  const t = lower(title);
  if (!t) return "Associate / Analyst";

  const isPartner = () => {
    // "business/people/HR/talent <…> partner" are HR/relationship roles, not equity partners.
    if (/\b(business|people|hr|talent acquisition|talent)\s+partner\b/.test(t)) return false;
    return word(t, "partner");
  };

  // 1) Executive Leadership — org top. C-suite abbreviations are WHOLE-WORD matched — a plain
  //    substring "cto"/"coo" would wrongly fire on dire-cto-r, do-cto-r, coo-rdinator,
  //    contra-cto-r, fa-cto-ry, etc. (which had badly inflated this band).
  if (
    word(t, "chief") || word(t, "ceo") || word(t, "cfo") || word(t, "coo") || word(t, "cio") ||
    word(t, "cto") || word(t, "cmo") || word(t, "cco") || word(t, "chro") || word(t, "ciso") ||
    word(t, "cdo") || word(t, "clo") ||
    t.includes("managing director") || t.includes("executive director") || t.includes("managing principal") ||
    t.includes("founder") || t.includes("fondateur") || t.includes("fondatrice") ||
    t.includes("chair") || word(t, "owner") || t.includes("proprietor") || t.includes("entrepreneur") ||
    t.includes("managing member") || t.includes("geschäftsführer") || t.includes("geschaftsfuhrer") ||
    word(t, "governor") || isPartner() ||
    t.includes("board member") || t.includes("board of director") || t.includes("board of trustee") ||
    t.includes("supervisory board") || word(t, "trustee") ||
    t.includes("non-executive director") || t.includes("non executive director") || t.includes("independent director") ||
    t.includes("corporate vice president") || t.includes("executive vice president") || word(t, "evp")
  ) {
    return "Executive Leadership";
  }

  // 2) Vice-President family — resolve the whole ladder here.
  const isVp = t.includes("vice president") || word(t, "vp") || word(t, "avp") || word(t, "svp");
  if (isVp) {
    if (t.includes("regional") || t.includes("country") || t.includes("head")) return "Head of / Director";
    if (t.includes("senior vice president") || word(t, "svp")) return "Head of / Director";
    return "VP / SM"; // incl. plain VP, Assistant/Associate VP (AVP) — a VP-family grade
  }

  // 3) President & Directors. (Managing/Executive/Board directors already → Executive above.)
  if (t.includes("president")) return "Executive Leadership";
  if (t.includes("associate director") || t.includes("assistant director")) return "VP / SM";
  if (word(t, "director")) {
    // Service-line / Big-4 (sub-Partner) directors sit below; every other director —
    //   function head OR bare — is "Head of / Director".
    if (/\b(advisory|consulting|transaction|deals|transfer pricing|m&a)\b/.test(t)) return "VP / SM";
    return "Head of / Director";
  }

  // 4) Heads of function / general managers / country & regional heads / company secretary.
  if (t.includes("head") || t.includes("general manager") || t.includes("country manager") || t.includes("regional manager") || t.includes("company secretary")) return "Head of / Director";

  // 5) Senior managers (incl. "Senior <X> Manager") and Principals sit in the VP / SM band.
  if (t.includes("senior") && t.includes("manager")) return "VP / SM";
  if (word(t, "principal")) return "VP / SM";

  // 6) Junior "assistant/deputy/acting/associate <X> manager" → IC level.
  if ((t.includes("assistant") || t.includes("deputy") || t.includes("acting") || t.includes("associate")) && t.includes("manager")) return "Associate / Analyst";

  // 7) Specialists are ICs. Controllers run the finance/accounting function (senior), except
  //    "credit controller" (junior AR/collections).
  if (t.includes("specialist")) return "Associate / Analyst";
  if (t.includes("controller")) {
    if (t.includes("credit controller")) return "Associate / Analyst";
    if (t.includes("assistant")) return "Manager";
    if (t.includes("financial controller") || t.includes("finance controller") || /\bgroup controller\b/.test(t)) return "Head of / Director";
    return "Manager";
  }

  // 8) Line managers / team & delivery leads. ("Lead <IC role>" stays an IC → falls through.)
  if (t.includes("manager") || t.includes("team lead") || t.includes("team leader") || t.includes("tech lead") || t.includes("technical lead") || t.includes("delivery lead") || t.includes("project lead")) return "Manager";

  return "Associate / Analyst";
}

// ── TITLE → FUNCTION (generalised, cross-industry) ────────────────────────────────────────
// The catch-all "Other Functions" must stay de-emphasised on the dashboard (it's sorted last
// there regardless of size), so keep it as the final fallback.
export const OTHER_FUNCTIONS = "Other Functions";

// `kw` are regex fragments (lowercase). They are matched as WHOLE WORDS/PHRASES — each rule
// compiles to /\b(frag1|frag2|…)\b/ — so "nurse" can't hit "nursery", "data" can't hit
// "database", "editor" can't hit "creditor". Use `\w*` for safe stems (consult\w* →
// consultant/consulting/consultancy). ORDER MATTERS: the first rule that matches wins, so
// specific/industry roles come BEFORE generic leadership, and disambiguating phrases come
// before the buckets they'd otherwise leak into (e.g. Data before Tech so "data engineer" →
// Data; Clinical before Consulting so "consultant cardiologist" → Clinical, not Consulting).
type FnRule = { fn: string; kw: string[] };
const FUNCTION_RULES: FnRule[] = [
  { fn: "Legal & Compliance", kw: ["legal", "lawyer", "attorney", "solicitor", "barrister", "advocate", "paralegal", "counsel", "litigat\\w*", "company secretary", "corporate secretary", "board secretary", "conveyanc\\w*", "notary", "patent attorney", "trademark attorney", "magistrate", "prosecutor", "regulatory affairs", "data protection officer", "privacy officer", "articled \\w+", "trainee solicitor"] },
  { fn: "Risk, Audit & Actuarial", kw: ["risk", "audit\\w*", "compliance", "internal control\\w*", "aml", "anti.?money laundering", "financial crime", "forensic\\w*", "governance", "grc", "actuar\\w*", "fraud", "sanctions", "kyc", "(?<!quality )assurance"] },
  { fn: "Finance & Accounting", kw: ["accountant", "accountancy", "accounting", "accounts payable", "accounts receivable", "accounts assistant", "accounts clerk", "accounts manager", "chartered accountant", "management accountant", "bookkeep\\w*", "payroll", "controller", "comptroller", "treasur\\w*", "tax", "taxation", "transfer pricing", "vat", "indirect tax\\w*", "fp&a", "financial planning and analysis", "financial reporting", "group reporting", "external reporting", "corporate reporting", "statutory report\\w*", "finance manager", "finance director", "head of finance", "finance business partner", "cfo", "chief financial officer", "transaction services", "deal advisory", "deals advisory", "due diligence", "valuation\\w*", "restructuring", "insolvency", "investor relations", "credit controller", "fund accountant", "fund control\\w*", "finance", "financial", "reporting"] },
  { fn: "Investments & Capital Markets", kw: ["investment\\w*", "investor\\w*", "investing", "portfolio manag\\w*", "portfolio analyst", "wealth", "fund manager", "fund management", "hedge fund", "private equity", "private credit", "private markets", "venture capital", "venture partner", "capital markets", "equity capital", "debt capital", "securities", "equities", "equity research", "fixed income", "trader", "trading", "quant", "quantitative analyst", "asset manag\\w*", "underwrit\\w*", "banker", "banking", "stockbroker", "broker dealer", "paraplanner", "financial advisor", "financial adviser", "financial planner", "mortgage\\w*", "chief investment officer"] },
  { fn: "Human Resources", kw: ["human resource\\w*", "hr", "people operations", "people partner", "people manager", "head of people", "people and culture", "talent acquisition", "talent management", "talent partner", "head of talent", "recruit\\w*", "headhunt\\w*", "sourcer", "resourcing", "learning and development", "l&d", "training manager", "training specialist", "organisational development", "organizational development", "employee experience", "employee engagement", "employee relations", "global mobility", "reward\\w*", "compensation", "benefits manager", "chro", "chief people officer", "diversity", "hris", "personnel"] },
  { fn: "Sales & Marketing", kw: ["sales", "salesperson", "presales", "pre.?sales", "account executive", "key account", "national account", "marketing", "marketeer", "brand", "branding", "digital market\\w*", "product marketing", "content marketing", "performance marketing", "growth market\\w*", "seo", "sem", "ppc", "paid media", "paid search", "social media", "community manager", "influencer", "copywrit\\w*", "campaign", "crm manager", "crm specialist", "email marketing", "demand generation", "demand gen", "lead generation", "business development", "business developer", "biz dev", "growth", "commercial", "chief commercial", "chief revenue", "chief marketing", "cmo", "cco", "communications", "public relations", "media relations", "press officer", "corporate affairs", "corporate communications", "go.?to.?market", "gtm", "revenue operations", "revops", "partnerships", "partner manager", "channel partner", "channel sales", "alliances", "merchandis\\w*", "category manager", "trade marketing", "ecommerce", "e.?commerce", "market research", "market analyst", "pricing manager", "fundrais\\w*", "membership advisor", "membership manager", "events? manager", "telesales", "telemarketing", "relationship manager", "advertising", "media buyer", "media planner"] },
  { fn: "Customer & Support", kw: ["customer success", "customer service", "customer experience", "customer care", "customer support", "customer operations", "client success", "client service\\w*", "client experience", "client care", "client support", "client manager", "client relations", "client onboarding", "account manager", "account management", "service delivery manager", "support", "support engineer", "support specialist", "technical support", "support analyst", "helpdesk", "help desk", "service desk", "call cent\\w*", "contact cent\\w*", "member services", "patient services", "guest services", "onboarding specialist", "renewals manager", "retention manager", "complaints", "case manager", "csm"] },
  { fn: "Data & Analytics", kw: ["data scien\\w*", "data analy\\w*", "data engineer\\w*", "data architect", "analytics", "machine learning", "ml engineer", "deep learning", "ai engineer", "ai scien\\w*", "artificial intelligence", "business intelligence", "bi developer", "bi analyst", "insights analyst", "insight\\w* manager", "consumer insights", "customer insights", "statistician", "biostatistician", "quantitative research\\w*", "data lead", "head of data", "chief data officer", "data govern\\w*", "data quality", "data visuali\\w*", "data warehouse", "big data", "data platform", "decision scien\\w*", "data steward", "data model\\w*", "analytics engineer", "data"] },
  { fn: "Product & Design", kw: ["product manager", "product owner", "product management", "product lead", "head of product", "chief product officer", "group product manager", "product designer", "product design", "ux designer", "ui designer", "ux/ui", "ui/ux", "ux research\\w*", "user experience", "user interface", "interaction designer", "visual designer", "graphic designer", "design lead", "design director", "head of design", "design manager", "industrial designer", "service designer", "experience designer", "product specialist"] },
  { fn: "Project & Programme Management", kw: ["project manager", "project lead", "project leader", "project director", "project coordinator", "project officer", "project management", "programme manager", "program manager", "programme director", "program director", "programme lead", "program lead", "technical program\\w* manager", "delivery manager", "delivery lead", "delivery director", "delivery consultant", "service delivery manager", "head of delivery", "pmo", "scrum master", "agile coach", "agile delivery", "release manager", "implementation manager", "implementation consultant", "implementation lead", "rollout manager", "deployment manager", "engagement manager", "engagement lead", "change manager"] },
  { fn: "Technology & Engineering", kw: ["software", "developer", "devops", "site reliability", "sre", "platform engineer\\w*", "infrastructure", "cloud engineer\\w*", "cloud architect", "solutions? architect", "enterprise architect", "systems architect", "technical architect", "systems engineer", "systems administrator", "system administrator", "sysadmin", "network engineer", "network administrator", "it", "information technology", "it support", "it manager", "it director", "head of it", "it consultant", "it technician", "technical lead", "tech lead", "technical consultant", "technical manager", "technical specialist", "head of technology", "technology consultant", "technolog\\w*", "cto", "cio", "cyber\\w*", "security engineer", "security architect", "security analyst", "information security", "infosec", "ciso", "soc analyst", "penetration tester", "ethical hacker", "qa engineer", "test engineer", "software tester", "automation engineer", "database administrator", "dba", "programmer", "full.?stack", "front.?end", "back.?end", "engineer\\w*", "business analyst", "systems? analyst", "robotics", "embedded"] },
  { fn: "Operations & Supply Chain", kw: ["operations", "operating officer", "coo", "supply chain", "supply plan\\w*", "demand plan\\w*", "procurement", "purchasing", "buyer", "sourcing", "vendor manag\\w*", "supplier manag\\w*", "logistics", "transport\\w* manager", "distribution", "fleet manager", "freight", "shipping", "manufacturing", "production manager", "production planner", "production supervisor", "plant manager", "plant director", "factory manager", "warehouse", "fulfil\\w*", "inventory", "stock controller", "materials manager", "quality assurance", "quality control", "quality manager", "qa manager", "qc manager", "process improvement", "continuous improvement", "lean", "six sigma", "facilities", "facility manager", "maintenance manager", "operational excellence", "order management"] },
  { fn: "Education & Training", kw: ["teacher", "schoolteacher", "lecturer", "professor", "tutor", "instructor", "educator", "faculty", "teaching assistant", "headteacher", "head teacher", "headmaster", "headmistress", "school principal", "dean", "provost", "academic", "trainer", "training", "curriculum", "preschool", "kindergarten", "montessori", "professeur", "enseignant", "education manager", "education coordinator"] },
  { fn: "Research & Development", kw: ["research\\w*", "r&d", "research and development", "scientist", "scientific", "laboratory", "lab technician", "lab manager", "principal investigator", "innovation", "chief scientist", "economist", "econometric\\w*", "biologist", "chemist", "physicist", "microbiologist", "biochemist", "geologist", "geophysicist", "statistician", "epidemiologist", "postdoctoral", "postdoc", "clinical research", "research nurse"] },
  { fn: "Clinical & Healthcare", kw: ["doctor", "physician", "surgeon", "nurse", "nursing", "midwife", "midwifery", "dentist", "dental", "orthodontist", "pharmacist", "pharmacy", "physiotherap\\w*", "physical therapist", "occupational therapist", "speech therapist", "therapist", "psychotherap\\w*", "psychologist", "psychiatrist", "clinician", "clinical", "chief medical officer", "medical officer", "medical director", "radiograph\\w*", "radiologist", "sonographer", "paramedic", "emt", "general practitioner", "gp", "cardiologist", "oncologist", "neurologist", "anaesth\\w*", "anesth\\w*", "pathologist", "dermatologist", "paediatric\\w*", "pediatric\\w*", "obstetric\\w*", "ophthalmolog\\w*", "optometrist", "podiatrist", "chiropractor", "osteopath", "audiologist", "dietit\\w*", "diet[ic]ian", "nutritionist", "phlebotomist", "care worker", "carer", "caregiver", "healthcare assistant", "health care assistant", "veterinar\\w*", "vet surgeon"] },
  { fn: "Strategy & Corporate Development", kw: ["strategy", "strategic", "strategist", "corporate development", "corp dev", "m&a", "mergers", "acquisitions", "transformation", "strategic planning", "corporate planning", "chief of staff", "chief strategy", "head of strategy", "venture builder"] },
  { fn: "Consulting & Advisory", kw: ["consult\\w*", "advisory", "advisor", "adviser", "trusted advisor", "subject matter expert", "executive coach", "business coach", "leadership coach", "coach", "mentor", "advisory board", "advisory council"] },
  { fn: "Creative, Content & Media", kw: ["content creator", "content writer", "content manager", "content strateg\\w*", "content lead", "head of content", "editor", "editorial", "editor.in.chief", "copy editor", "video editor", "writer", "author", "copywrit\\w*", "screenwriter", "scriptwriter", "blogger", "columnist", "journalist", "reporter", "correspondent", "broadcaster", "broadcast", "presenter", "producer", "creative director", "creative lead", "art director", "artistic director", "illustrator", "photographer", "videographer", "cinematographer", "animator", "filmmaker", "podcast", "podcaster", "voice actor", "voiceover", "publisher", "publishing"] },
  { fn: "Real Estate & Property", kw: ["real estate", "realtor", "estate agent", "letting agent", "lettings", "property", "property manag\\w*", "property consultant", "property developer", "land agent", "leasing", "surveyor", "quantity surveyor", "chartered surveyor", "valuer", "appraiser", "town planner", "planning consultant"] },
  { fn: "Skilled Trades & Field Operations", kw: ["technician", "electrician", "mechanic", "plumber", "welder", "fitter", "pipefitter", "machinist", "driver", "machine operator", "plant operator", "equipment operator", "crane operator", "forklift operator", "installer", "foreman", "field service", "field engineer", "field operations", "maintenance technician", "construction manager", "construction supervisor", "site manager", "site supervisor", "site engineer", "carpenter", "joiner", "fabricator", "bricklayer", "mason", "roofer", "painter", "plasterer", "tiler", "glazier", "scaffolder", "rigger", "labourer", "laborer", "hvac", "millwright", "toolmaker", "boilermaker", "lineman", "linesman", "tradesman", "handyman", "landscaper", "groundskeeper", "locksmith", "warehouse operative", "production operative", "assembler"] },
  { fn: "Hospitality & Service", kw: ["chef", "sous chef", "pastry chef", "cook", "line cook", "barista", "bartender", "barman", "mixologist", "server", "waiter", "waitress", "waiting staff", "host", "hostess", "concierge", "housekeep\\w*", "front of house", "food and beverage", "f&b", "steward", "guest relations", "restaurant manager", "hotel manager", "catering", "caterer", "sommelier", "valet", "banquet", "flight attendant", "cabin crew"] },
  { fn: "Administration & Support", kw: ["executive assistant", "personal assistant", "administrative assistant", "admin assistant", "administrator", "office manager", "office administrator", "office coordinator", "secretary", "executive secretary", "receptionist", "virtual assistant", "clerk", "office clerk", "data entry", "administrative officer", "admin officer", "administrative coordinator", "office assistant", "clerical", "typist", "pa to", "ea to", "team assistant", "mailroom"] },
  { fn: "Student & Early Career", kw: ["student", "intern", "internship", "apprentice\\w*", "graduate trainee", "graduate scheme", "graduate programme", "graduate program", "trainee", "management trainee", "mba candidate", "mba student", "phd candidate", "phd student", "doctoral candidate", "early careers?", "undergraduate", "placement student", "work placement", "co.?op student", "summer associate", "summer intern"] },
  { fn: "Founder, Owner & Partner", kw: ["founder", "co.?founder", "cofounder", "founding partner", "founding member", "founding team", "owner", "co.?owner", "business owner", "company owner", "proprietor", "entrepreneur", "partner", "managing partner", "equity partner", "general partner", "managing member", "self.?employed", "sole trader", "fondateur"] },
  { fn: "General Management", kw: ["ceo", "chief executive", "managing director", "md", "president", "vice president", "general manager", "country manager", "country director", "regional manager", "regional director", "executive director", "managing principal", "geschäftsführer", "geschaftsfuhrer", "chair", "chairman", "chairperson", "chairwoman", "co.?chair", "board member", "board director", "non.?executive director", "ned", "trustee", "governor", "business head", "branch manager", "area manager", "division manager"] },
];

// Compile each rule once: whole-word/phrase match over the lowercased title.
const FUNCTION_RE: { fn: string; re: RegExp }[] = FUNCTION_RULES.map((r) => ({
  fn: r.fn,
  re: new RegExp("\\b(" + r.kw.join("|") + ")\\b"),
}));

export function classifyFunction(title: string | undefined): string {
  const t = lower(title);
  if (!t) return OTHER_FUNCTIONS;
  for (const r of FUNCTION_RE) if (r.re.test(t)) return r.fn;
  return OTHER_FUNCTIONS;
}

// ── COMPANY → SECTOR (industry + sub-sector + entity) ─────────────────────────────────────
// `entity` is the canonical company name for the detailed matrix's per-company rows: the
// dictionary's name when we matched one (so "J.P. Morgan"/"JPMorgan Chase" consolidate), or ""
// when we only matched a keyword/nothing (the caller then falls back to the raw company string).
export type SectorResult = { sectorGroup: string; subGroup: string; entity: string };

// Normalise a company string for matching: lowercase, drop common legal suffixes + punctuation.
function normCompany(name: string): string {
  return lower(name)
    // Strip diacritics so "Mondelēz" == "Mondelez", "Nestlé" == "Nestle" (keeps non-Latin
    // scripts like Arabic intact — those are handled by the raw keyword regex rules).
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|group|holdings|holding|sa|ag|gmbh|nv|the)\b/g, " ")
    // Drop punctuation AND symbols/quotes (®, ™, smart-quotes) so "Early Warning®" and
    // 'NUPCO "quoted"' tokenise cleanly.
    .replace(/[.,&/\\()\-"'’“”®™!?:;|@#*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Lookup tables, built once from the dictionary ─────────────────────────────────────────
type Hit = { group: string; sub: string; entity: string };

// EXACT map: normalised name AND every normalised alias → its company. A key is nulled out ONLY on
// a genuine SECTOR ambiguity — two entries that classify DIFFERENTLY claiming the same key (an
// ambiguous alias/ticker). Two entries for the SAME firm (e.g. the marquee "BCG" and the alias
// "BCG" on "Boston Consulting Group") classify identically, so they must NOT collide — otherwise a
// well-known acronym silently falls through to "Other".
// FUZZY list: canonical names only (deduped), for "<name> + extra words" company strings.
const EXACT = new Map<string, Hit | null>();
const FUZZY: { norm: string; hit: Hit }[] = [];
{
  const seenName = new Set<string>();
  for (const e of COMPANY_DICTIONARY) {
    const hit: Hit = { group: INDUSTRY_LABEL[e.industry], sub: e.sub, entity: e.name };
    const nameNorm = normCompany(e.name);
    if (nameNorm && !seenName.has(nameNorm)) {
      seenName.add(nameNorm);
      FUZZY.push({ norm: nameNorm, hit });
    }
    for (const raw of [e.name, ...(e.aliases ?? [])]) {
      const k = normCompany(raw);
      if (!k) continue;
      if (EXACT.has(k)) {
        const cur = EXACT.get(k);
        // Only a TRUE ambiguity (same key → DIFFERENT sector) nulls the key. Same-sector duplicates
        // (the same firm listed twice / via an alias) keep the first hit.
        if (cur && (cur.group !== hit.group || cur.sub !== hit.sub)) EXACT.set(k, null);
      } else {
        EXACT.set(k, hit);
      }
    }
  }
}

// Self-employed / freelance / retired etc. — not a real employer; consolidated into one entity.
const INDEPENDENT_RE = /\b(self[\s-]?employed|freelanc|sole trader|independent (contractor|consultant)|stealth (startup|mode)|retired|career break|unemployed|open to work|upwork|fiverr|toptal)\b/;
const INDEPENDENT_EXACT = new Set(["none", "n a", "self", "independent", "freelance"]);
// Undisclosed/placeholder "employers" — not a real company. Checked AFTER the industry keyword
// rules (so "Confidential Government" still lands in Public Sector) but before the Other fallback.
// NB: "confidential" intentionally NOT here — the final-cleanup keyword rules route it (and
// its misspellings) to Public Sector (user decision 2026-06-23), which runs before this step.
const PLACEHOLDER_RE = /^(various|stealth|undisclosed|private|global|none|unknown|misc|other|tbc|n\/?a)\b|various companies|undisclosed|to be confirmed/;

export function classifySector(company: string | undefined): SectorResult {
  const raw = lower(company).trim();
  if (!raw) return { sectorGroup: OTHER_INDUSTRY_LABEL, subGroup: "", entity: "" };
  const norm = normCompany(company!);

  // 0) Independent / self-employed — surfaced in its own band (not "Other Industries" = unknown co).
  if (INDEPENDENT_RE.test(raw) || INDEPENDENT_EXACT.has(norm)) {
    return { sectorGroup: INDEPENDENT_LABEL, subGroup: "", entity: INDEPENDENT_LABEL };
  }

  // 1) Exact name/alias match (handles tickers, short names, suffix-stripped legal names).
  const exact = EXACT.get(norm);
  if (exact) return { sectorGroup: exact.group, subGroup: exact.sub, entity: exact.entity };

  // 2) Fuzzy: the company string CONTAINS a known canonical name as WHOLE WORD(S) (e.g.
  //    "KPMG UK", "Microsoft Azure", "Aker BP"). Token-aligned (space-padded) so a short
  //    name can't match mid-word — "Aker" must not hit "bakery", "Lear" not "learning".
  //    Both ≥4 chars so short strings don't over-match.
  if (norm.length >= 4) {
    const padded = ` ${norm} `;
    for (const f of FUZZY) {
      if (f.norm.length >= 4 && padded.includes(` ${f.norm} `)) {
        return { sectorGroup: f.hit.group, subGroup: f.hit.sub, entity: f.hit.entity };
      }
    }
  }

  // 3) Keyword / regex heuristics on the raw name (no canonical entity — caller uses the raw company).
  for (const rule of COMPANY_KEYWORD_RULES) {
    if ((rule.kw && rule.kw.some((k) => raw.includes(k))) || (rule.re && rule.re.test(raw))) {
      return { sectorGroup: INDUSTRY_LABEL[rule.industry], subGroup: rule.sub, entity: "" };
    }
  }

  // 3.5) Placeholder / undisclosed "employer" (not self-employed, not any industry) → Independent
  //      band, NOT "Other Industries" (which means an unknown real company).
  if (PLACEHOLDER_RE.test(raw)) {
    return { sectorGroup: INDEPENDENT_LABEL, subGroup: "", entity: INDEPENDENT_LABEL };
  }

  // 4) Long tail — the user sets the sector themselves (owner-maintained override).
  return { sectorGroup: OTHER_INDUSTRY_LABEL, subGroup: "", entity: "" };
}

// ── Full contact enrichment ───────────────────────────────────────────────────────────────
export type RawContact = { first?: string; last?: string; company?: string; title?: string; url?: string };
export type Enriched = {
  first: string;
  last: string;
  organisation: string;
  position: string;
  sector_detail: string;
  sector_group: string;
  sub_group: string;
  seniority: string;
  function: string;
  url: string;
};

export function classifyContact(c: RawContact): Enriched {
  const sector = classifySector(c.company);
  const org = (c.company ?? "").trim();
  return {
    first: (c.first ?? "").trim(),
    last: (c.last ?? "").trim(),
    organisation: org,
    position: (c.title ?? "").trim(),
    // The detailed matrix rows on sector_detail = the company entity (canonical dictionary name
    // when matched, else the raw company), so the drill-down is company-by-company, not sector-level.
    sector_detail: sector.entity || org || sector.subGroup || sector.sectorGroup,
    sector_group: sector.sectorGroup,
    sub_group: sector.subGroup,
    seniority: classifySeniority(c.title),
    function: classifyFunction(c.title),
    url: (c.url ?? "").trim(),
  };
}
