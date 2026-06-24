// Market configuration for Business Book — the GENERIC replacement for the personal
// tool's Saudi-FS-only taxonomy. The user picks a Region + (optionally) a primary Industry
// on first run; that selection seeds the demo, sets the default service-line vocabulary,
// and biases the classifier toward their main hunting ground. But classification itself
// spans ALL industries (a consultant's network is cross-sector), so nothing here constrains
// what a contact can be classified as — it only prioritises and seeds.
//
// This file is pure data + types. The matching logic that consumes it lives in
// ../data/classify.ts, and is exercised both by the demo generator and (later) the live
// LinkedIn-import flow.

import { SLICE_COMPANIES } from "../data/companies";

export type RegionId = "north-america" | "europe";
export type IndustryId =
  | "financial-services"
  | "technology"
  | "healthcare"
  | "energy-industrial"
  | "consumer-retail"
  | "public-sector"
  | "professional-services"
  | "real-estate";

export type Region = { id: RegionId; label: string; countries: string[] };

export const REGIONS: Region[] = [
  { id: "north-america", label: "North America", countries: ["United States", "Canada"] },
  { id: "europe", label: "Europe", countries: ["United Kingdom", "Germany", "France", "Netherlands", "Switzerland", "Nordics", "Ireland", "Spain", "Italy"] },
];

// The top-level sector axis on the dashboard = these industries (stable, so every breakdown
// reconciles). The finer band is the sub-sector. "Other Industries" is the catch-all for
// anything unmatched — it plays the de-emphasised catch-all role the old "General Corporates"
// did, and is appended in vocab.ts SECTOR_GROUPS.
export type Industry = { id: IndustryId; label: string; subSectors: string[] };

export const INDUSTRIES: Industry[] = [
  {
    id: "financial-services",
    label: "Financial Services",
    subSectors: ["Banks", "Insurance", "Asset & Wealth Management", "Private Equity & VC", "Fintech & Payments", "Capital Markets"],
  },
  {
    id: "technology",
    label: "Technology",
    subSectors: ["Software & SaaS", "Internet & Platforms", "Hardware & Semiconductors", "IT Services", "Telecom"],
  },
  {
    id: "healthcare",
    label: "Healthcare & Pharma",
    subSectors: ["Pharma & Biotech", "Medical Devices", "Providers & Hospitals", "Payers & Health Insurance", "Digital Health"],
  },
  {
    id: "energy-industrial",
    label: "Energy & Industrial",
    subSectors: ["Oil & Gas", "Utilities & Power", "Renewables", "Manufacturing", "Aerospace & Defense", "Chemicals", "Logistics & Transport"],
  },
  {
    id: "consumer-retail",
    label: "Consumer & Retail",
    subSectors: ["Retail", "Consumer Goods", "Food & Beverage", "Hospitality & Travel", "Media & Entertainment", "Automotive", "Sports & Recreation", "Health & Wellness"],
  },
  {
    id: "public-sector",
    label: "Public Sector",
    subSectors: ["Government", "Education", "Public Healthcare", "Nonprofit & NGO", "Transport & Infrastructure"],
  },
  {
    // Kept as a CLASSIFICATION industry (a consultant's network is consulting/audit-heavy, so you
    // want to see it) even though it's not usually a sell-TO target — targeting is handled at the
    // opportunity level, not here.
    id: "professional-services",
    label: "Professional Services",
    subSectors: ["Consulting & Strategy", "Audit & Accounting", "Legal", "Recruitment", "Outsourcing & GBS"],
  },
  {
    id: "real-estate",
    label: "Real Estate",
    subSectors: ["Commercial Real Estate Services", "REITs & Property Investment", "Homebuilders & Developers", "Property Management"],
  },
];

export const OTHER_INDUSTRY_LABEL = "Other / Smaller firms";
// People with no real employer org (Self-employed / Freelance / Retired / Stealth). Surfaced as
// its own band so it doesn't pollute "Other Industries" (which means "unknown company").
export const INDEPENDENT_LABEL = "Independent / Self-employed";

export const INDUSTRY_LABEL: Record<IndustryId, string> = Object.fromEntries(
  INDUSTRIES.map((i) => [i.id, i.label]),
) as Record<IndustryId, string>;

// ── Company dictionary ───────────────────────────────────────────────────────────────────
// A STARTER set of well-known companies → (industry, sub-sector, regions). Deliberately not
// exhaustive — the classifier falls back to keyword heuristics (see classify.ts) for the long
// tail, and anything still unmatched becomes "Other Industries" for the user to set. Expand
// this list over time (it's the cheapest accuracy lever). `regions` is used by the demo
// generator to seed region-appropriate names; classification ignores region.
export type CompanyEntry = { name: string; aliases?: string[]; industry: IndustryId; sub: string; regions: RegionId[] };

export const COMPANY_DICTIONARY: CompanyEntry[] = [
  // ── Financial Services ──
  { name: "JPMorgan Chase", industry: "financial-services", sub: "Banks", regions: ["north-america"] },
  { name: "Bank of America", industry: "financial-services", sub: "Banks", regions: ["north-america"] },
  { name: "Wells Fargo", industry: "financial-services", sub: "Banks", regions: ["north-america"] },
  { name: "Citi", industry: "financial-services", sub: "Banks", regions: ["north-america"] },
  { name: "Goldman Sachs", industry: "financial-services", sub: "Capital Markets", regions: ["north-america"] },
  { name: "Morgan Stanley", industry: "financial-services", sub: "Capital Markets", regions: ["north-america"] },
  { name: "HSBC", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "Barclays", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "Lloyds Banking Group", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "NatWest", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "Deutsche Bank", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "BNP Paribas", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "UBS", industry: "financial-services", sub: "Asset & Wealth Management", regions: ["europe"] },
  { name: "Allianz", industry: "financial-services", sub: "Insurance", regions: ["europe"] },
  { name: "AXA", industry: "financial-services", sub: "Insurance", regions: ["europe"] },
  { name: "Aviva", industry: "financial-services", sub: "Insurance", regions: ["europe"] },
  { name: "MetLife", industry: "financial-services", sub: "Insurance", regions: ["north-america"] },
  { name: "BlackRock", industry: "financial-services", sub: "Asset & Wealth Management", regions: ["north-america"] },
  { name: "Fidelity Investments", industry: "financial-services", sub: "Asset & Wealth Management", regions: ["north-america"] },
  { name: "Blackstone", industry: "financial-services", sub: "Private Equity & VC", regions: ["north-america"] },
  { name: "KKR", industry: "financial-services", sub: "Private Equity & VC", regions: ["north-america"] },
  { name: "Stripe", industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "PayPal", industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Revolut", industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Visa", industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },

  // ── Technology ──
  { name: "Microsoft", industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Google", industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Amazon", industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Apple", industry: "technology", sub: "Hardware & Semiconductors", regions: ["north-america"] },
  { name: "Meta", industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Salesforce", industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Oracle", industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "SAP", industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "IBM", industry: "technology", sub: "IT Services", regions: ["north-america"] },
  { name: "Accenture", industry: "technology", sub: "IT Services", regions: ["europe"] },
  { name: "NVIDIA", industry: "technology", sub: "Hardware & Semiconductors", regions: ["north-america"] },
  { name: "Intel", industry: "technology", sub: "Hardware & Semiconductors", regions: ["north-america"] },
  { name: "Spotify", industry: "technology", sub: "Internet & Platforms", regions: ["europe"] },
  { name: "Vodafone", industry: "technology", sub: "Telecom", regions: ["europe"] },
  { name: "Verizon", industry: "technology", sub: "Telecom", regions: ["north-america"] },
  { name: "Ericsson", industry: "technology", sub: "Telecom", regions: ["europe"] },

  // ── Healthcare & Pharma ──
  { name: "Pfizer", industry: "healthcare", sub: "Pharma & Biotech", regions: ["north-america"] },
  { name: "Johnson & Johnson", industry: "healthcare", sub: "Pharma & Biotech", regions: ["north-america"] },
  { name: "Merck", industry: "healthcare", sub: "Pharma & Biotech", regions: ["north-america"] },
  { name: "Roche", industry: "healthcare", sub: "Pharma & Biotech", regions: ["europe"] },
  { name: "Novartis", industry: "healthcare", sub: "Pharma & Biotech", regions: ["europe"] },
  { name: "AstraZeneca", industry: "healthcare", sub: "Pharma & Biotech", regions: ["europe"] },
  { name: "GSK", industry: "healthcare", sub: "Pharma & Biotech", regions: ["europe"] },
  { name: "Medtronic", industry: "healthcare", sub: "Medical Devices", regions: ["north-america"] },
  { name: "UnitedHealth Group", industry: "healthcare", sub: "Payers & Health Insurance", regions: ["north-america"] },
  { name: "HCA Healthcare", industry: "healthcare", sub: "Providers & Hospitals", regions: ["north-america"] },
  { name: "NHS", industry: "healthcare", sub: "Providers & Hospitals", regions: ["europe"] },

  // ── Energy & Industrial ──
  { name: "ExxonMobil", industry: "energy-industrial", sub: "Oil & Gas", regions: ["north-america"] },
  { name: "Chevron", industry: "energy-industrial", sub: "Oil & Gas", regions: ["north-america"] },
  { name: "Shell", industry: "energy-industrial", sub: "Oil & Gas", regions: ["europe"] },
  { name: "BP", industry: "energy-industrial", sub: "Oil & Gas", regions: ["europe"] },
  { name: "TotalEnergies", industry: "energy-industrial", sub: "Oil & Gas", regions: ["europe"] },
  { name: "Siemens", industry: "energy-industrial", sub: "Manufacturing", regions: ["europe"] },
  { name: "General Electric", industry: "energy-industrial", sub: "Manufacturing", regions: ["north-america"] },
  { name: "Boeing", industry: "energy-industrial", sub: "Aerospace & Defense", regions: ["north-america"] },
  { name: "Airbus", industry: "energy-industrial", sub: "Aerospace & Defense", regions: ["europe"] },
  { name: "BASF", industry: "energy-industrial", sub: "Chemicals", regions: ["europe"] },
  { name: "Iberdrola", industry: "energy-industrial", sub: "Utilities & Power", regions: ["europe"] },
  { name: "NextEra Energy", industry: "energy-industrial", sub: "Utilities & Power", regions: ["north-america"] },

  // ── Consumer & Retail ──
  { name: "Walmart", industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },
  { name: "Target", industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },
  { name: "Tesco", industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "Procter & Gamble", industry: "consumer-retail", sub: "Consumer Goods", regions: ["north-america"] },
  { name: "Unilever", industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },
  { name: "Nestlé", industry: "consumer-retail", sub: "Food & Beverage", regions: ["europe"] },
  { name: "Coca-Cola", industry: "consumer-retail", sub: "Food & Beverage", regions: ["north-america"] },
  { name: "PepsiCo", industry: "consumer-retail", sub: "Food & Beverage", regions: ["north-america"] },
  { name: "LVMH", industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },
  { name: "Marriott", industry: "consumer-retail", sub: "Hospitality & Travel", regions: ["north-america"] },
  { name: "Disney", industry: "consumer-retail", sub: "Media & Entertainment", regions: ["north-america"] },
  { name: "Volkswagen", industry: "consumer-retail", sub: "Automotive", regions: ["europe"] },
  { name: "Ford", industry: "consumer-retail", sub: "Automotive", regions: ["north-america"] },

  // ── Public Sector ──
  { name: "Department of Defense", industry: "public-sector", sub: "Government", regions: ["north-america"] },
  { name: "UK Civil Service", industry: "public-sector", sub: "Government", regions: ["europe"] },
  { name: "European Commission", industry: "public-sector", sub: "Government", regions: ["europe"] },
  { name: "World Bank", industry: "public-sector", sub: "Nonprofit & NGO", regions: ["north-america"] },
  { name: "United Nations", industry: "public-sector", sub: "Nonprofit & NGO", regions: ["north-america"] },
  { name: "Harvard University", industry: "public-sector", sub: "Education", regions: ["north-america"] },
  { name: "University of Oxford", industry: "public-sector", sub: "Education", regions: ["europe"] },
  { name: "Transport for London", industry: "public-sector", sub: "Transport & Infrastructure", regions: ["europe"] },

  // ── Professional Services (canonical firm names → variants like "KPMG UK"/"KPMG US"
  //    consolidate into one entity row; mined from the real network's top companies) ──
  { name: "KPMG", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Deloitte", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "PwC", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "EY", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Ernst & Young", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "McKinsey & Company", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Bain & Company", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "BCG", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Oliver Wyman", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Alvarez & Marsal", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "AlixPartners", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Kroll", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Teneo", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Baringa", industry: "professional-services", sub: "Consulting & Strategy", regions: ["europe"] },
  { name: "Capco", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Interpath", industry: "professional-services", sub: "Consulting & Strategy", regions: ["europe"] },
  { name: "Vialto Partners", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Protiviti", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Gartner", industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america", "europe"] },
  { name: "Korn Ferry", industry: "professional-services", sub: "Recruitment", regions: ["north-america", "europe"] },
  { name: "BDO", industry: "professional-services", sub: "Audit & Accounting", regions: ["north-america", "europe"] },
  { name: "RSM", industry: "professional-services", sub: "Audit & Accounting", regions: ["north-america", "europe"] },
  { name: "Grant Thornton", industry: "professional-services", sub: "Audit & Accounting", regions: ["north-america", "europe"] },
  { name: "Forvis Mazars", industry: "professional-services", sub: "Audit & Accounting", regions: ["europe"] },
  { name: "Crowe", industry: "professional-services", sub: "Audit & Accounting", regions: ["north-america", "europe"] },
  { name: "IQ-EQ", industry: "professional-services", sub: "Outsourcing & GBS", regions: ["europe"] },
  { name: "Vistra", industry: "professional-services", sub: "Outsourcing & GBS", regions: ["north-america", "europe"] },
  { name: "Apex Group", industry: "professional-services", sub: "Outsourcing & GBS", regions: ["europe"] },
  { name: "Citco", industry: "professional-services", sub: "Outsourcing & GBS", regions: ["north-america", "europe"] },

  // ── Financial Services — short/ambiguous names (exact-match only) + global brands ──
  { name: "American Express", industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Mastercard", industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Standard Chartered", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "Macquarie Group", industry: "financial-services", sub: "Capital Markets", regions: ["north-america", "europe"] },
  { name: "Nomura", industry: "financial-services", sub: "Capital Markets", regions: ["north-america", "europe"] },
  { name: "Schroders", industry: "financial-services", sub: "Asset & Wealth Management", regions: ["europe"] },
  { name: "State Street", industry: "financial-services", sub: "Asset & Wealth Management", regions: ["north-america"] },
  { name: "Capital One", industry: "financial-services", sub: "Banks", regions: ["north-america"] },
  { name: "Wise", industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "ING", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "RBC", industry: "financial-services", sub: "Banks", regions: ["north-america"] },
  { name: "Apollo Global Management", industry: "financial-services", sub: "Private Equity & VC", regions: ["north-america"] },

  // Gulf entities (region-untagged so they classify on real imports but never seed the US/Europe demo).
  { name: "Saudi Aramco", industry: "energy-industrial", sub: "Oil & Gas", regions: [] },
  { name: "Public Investment Fund", industry: "financial-services", sub: "Asset & Wealth Management", regions: [] },
  { name: "Emirates NBD", industry: "financial-services", sub: "Banks", regions: [] },
  { name: "SAB", industry: "financial-services", sub: "Banks", regions: [] },
  { name: "BSF", industry: "financial-services", sub: "Banks", regions: [] },

  // More recognisable US/Europe brands from the mined network.
  { name: "TD", industry: "financial-services", sub: "Banks", regions: ["north-america"] },
  { name: "AIB", industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "FIS", industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "S&P Global", industry: "financial-services", sub: "Capital Markets", regions: ["north-america"] },
  { name: "WPP", industry: "consumer-retail", sub: "Media & Entertainment", regions: ["europe"] },
  { name: "Sky", industry: "consumer-retail", sub: "Media & Entertainment", regions: ["europe"] },
  { name: "BBC", industry: "consumer-retail", sub: "Media & Entertainment", regions: ["europe"] },
  { name: "Sainsbury's", industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "Reckitt", industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },
  { name: "Diageo", industry: "consumer-retail", sub: "Food & Beverage", regions: ["europe"] },
  { name: "Philip Morris International", industry: "consumer-retail", sub: "Consumer Goods", regions: ["north-america"] },
  { name: "BAE Systems", industry: "energy-industrial", sub: "Aerospace & Defense", regions: ["europe"] },
  { name: "Anglo American", industry: "energy-industrial", sub: "Chemicals", regions: ["europe"] },
  { name: "SSE", industry: "energy-industrial", sub: "Utilities & Power", regions: ["europe"] },
  { name: "Thermo Fisher Scientific", industry: "healthcare", sub: "Medical Devices", regions: ["north-america"] },
  { name: "Databricks", industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "EPAM Systems", industry: "technology", sub: "IT Services", regions: ["north-america"] },

  // Specific high-frequency firms from the real "Other" long tail (2026-06-23 analysis).
  { name: "TD Bank Group", aliases: ["TD"], industry: "financial-services", sub: "Banks", regions: ["north-america"] },
  { name: "ING", aliases: ["ING Group", "ING Bank", "ING Hubs"], industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "SABB", aliases: ["Saudi British Bank", "Saudi Awwal Bank"], industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "Saudi Real Estate Refinance Company", aliases: ["SRC"], industry: "financial-services", sub: "Banks", regions: ["europe"] },
  { name: "DWS Group", aliases: ["DWS"], industry: "financial-services", sub: "Asset & Wealth Management", regions: ["europe"] },
  { name: "Sun Life", industry: "financial-services", sub: "Insurance", regions: ["north-america"] },
  { name: "Canada Life", industry: "financial-services", sub: "Insurance", regions: ["north-america"] },
  { name: "Royal London", industry: "financial-services", sub: "Insurance", regions: ["europe"] },
  { name: "Liberty Specialty Markets", industry: "financial-services", sub: "Insurance", regions: ["europe"] },
  { name: "Ripple", industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Abound", industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Quantexa", industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "LTIMindtree", industry: "technology", sub: "IT Services", regions: ["north-america"] },
  { name: "UST", aliases: ["UST Global"], industry: "technology", sub: "IT Services", regions: ["north-america"] },
  { name: "Turner & Townsend", industry: "professional-services", sub: "Consulting & Strategy", regions: ["europe"] },
  { name: "ERM", aliases: ["Environmental Resources Management"], industry: "professional-services", sub: "Consulting & Strategy", regions: ["europe"] },
  { name: "NielsenIQ", aliases: ["NIQ"], industry: "professional-services", sub: "Consulting & Strategy", regions: ["north-america"] },
  { name: "Forensic Risk Alliance", industry: "professional-services", sub: "Consulting & Strategy", regions: ["europe"] },
  { name: "Xeinadin", industry: "professional-services", sub: "Audit & Accounting", regions: ["europe"] },
  { name: "Alexander Mann Solutions", aliases: ["AMS"], industry: "professional-services", sub: "Recruitment", regions: ["europe"] },
  { name: "D&V Philippines", industry: "professional-services", sub: "Outsourcing & GBS", regions: ["north-america"] },
  { name: "Edrington", industry: "consumer-retail", sub: "Food & Beverage", regions: ["europe"] },
  { name: "William Grant & Sons", industry: "consumer-retail", sub: "Food & Beverage", regions: ["europe"] },

  // ── Real Estate — marquee firms first (the other industries lead with their giants; RE had no
  //    such block, so the demo's RE clusters were landing on obscure names). These also exist in
  //    SLICE_COMPANIES; listing them here (deduped first-wins) makes them the prominent RE entries. ──
  { name: "CBRE", aliases: ["CBRE Group", "CB Richard Ellis"], industry: "real-estate", sub: "Commercial Real Estate Services", regions: ["north-america", "europe"] },
  { name: "JLL", aliases: ["Jones Lang LaSalle", "LaSalle Investment Management"], industry: "real-estate", sub: "Commercial Real Estate Services", regions: ["north-america", "europe"] },
  { name: "Cushman & Wakefield", aliases: ["Cushman and Wakefield", "C&W"], industry: "real-estate", sub: "Commercial Real Estate Services", regions: ["north-america", "europe"] },
  { name: "Knight Frank", aliases: ["Knight Frank LLP"], industry: "real-estate", sub: "Commercial Real Estate Services", regions: ["europe", "north-america"] },
  { name: "Savills", aliases: ["Savills plc"], industry: "real-estate", sub: "Commercial Real Estate Services", regions: ["europe", "north-america"] },
  { name: "Brookfield", aliases: ["Brookfield Asset Management", "Brookfield Properties"], industry: "real-estate", sub: "REITs & Property Investment", regions: ["north-america", "europe"] },
  { name: "Prologis", aliases: ["Prologis Inc"], industry: "real-estate", sub: "REITs & Property Investment", regions: ["north-america", "europe"] },
  { name: "Segro", aliases: ["SEGRO plc"], industry: "real-estate", sub: "REITs & Property Investment", regions: ["europe"] },
  { name: "Simon Property Group", aliases: ["Simon Property", "SPG"], industry: "real-estate", sub: "REITs & Property Investment", regions: ["north-america"] },
  { name: "Lendlease", aliases: ["Lend Lease"], industry: "real-estate", sub: "Homebuilders & Developers", regions: ["north-america", "europe"] },
  { name: "Related Companies", industry: "real-estate", sub: "Homebuilders & Developers", regions: ["north-america"] },
  { name: "Hines", aliases: ["Hines Group"], industry: "real-estate", sub: "Homebuilders & Developers", regions: ["north-america", "europe"] },

  // The big mined dictionary (~1,800 companies across NA + Europe, with aliases). Deduped against
  // the curated seed above in classify.ts when the lookup tables are built.
  ...SLICE_COMPANIES,
];

// ── Keyword heuristics (the long-tail fallback) ──────────────────────────────────────────
// When a company isn't in the dictionary, match keywords in its name to a (industry, sub).
// Ordered most-specific first; the classifier returns the first hit. Lowercased substring
// match unless noted. These are intentionally high-precision to avoid mislabelling.
export type KeywordRule = { kw?: string[]; re?: RegExp; industry: IndustryId; sub: string };

export const COMPANY_KEYWORD_RULES: KeywordRule[] = [
  // ══ HIGHEST PRIORITY: unambiguous public-sector bodies. Runs before the industry rules so the
  //    industry word inside a public body's name doesn't mis-route it — "Ministry of Energy" is
  //    Public not Oil&Gas, "University of Petroleum" is Education, "Digital Government Authority"
  //    is Public not Tech, "Electricity Regulatory Authority" is Public not Utilities. (Central
  //    banks still hit "bank"→FS below; "monetary authority" still hits the FS regex later.) ══
  { re: /\bnhs\b|\buniversity hospital|\bteaching hospital|\bhospitals?\s+(nhs|trust|foundation)/, industry: "public-sector", sub: "Public Healthcare" },
  { re: /\bministr(y|ies)\b|\bgovernment\b|\bmunicipalit(y|ies)\b|\broyal commission\b|\bauthorit(y|ies)\b|\bcommission\b|\bcivil service\b|\barmed forces\b|\bcity for science\b|\bgovernorate\b|\bparliament\b|\bembassy\b/, industry: "public-sector", sub: "Government" },
  { re: /\buniversit(y|ies)\b|\bcollege\b|\bfaculty of\b/, industry: "public-sector", sub: "Education" },

  // ── Professional Services (HIGH PRIORITY — a consultant's network is dominated by these; one
  //    rule catches every geographic variant, e.g. "KPMG UK"/"KPMG US"/"KPMG Saudi Arabia"). ──
  { kw: ["kpmg", "deloitte", "pwc", "pricewaterhouse", "ernst & young", "ernst and young", "ey-parthenon", "parthenon", "mckinsey", "bain & company", "boston consulting", "oliver wyman", "kearney", "roland berger", "strategy&", "booz allen", "arthur d", "alvarez & marsal", "alixpartners", "kroll", "teneo", "baringa", "capco", "alpha fmc", "frp advisory", "interpath", "ankura", "slalom", "l.e.k", "lek consulting", "north highland", "publicis sapient", "advisory", "consulting"], industry: "professional-services", sub: "Consulting & Strategy" },
  { kw: ["bdo", "grant thornton", "mazars", "forvis", "crowe", "moore global", "pkf", " mha", "azets", "buzzacott", "cooper parry", "johnston carmichael", "saffery", "haysmac", "menzies", "cfgi", "smith & williamson", " aab", "scrubbed", "sgv", "vialto", "isio", "accountant", "rsm", "s&w"], industry: "professional-services", sub: "Audit & Accounting" },
  { kw: ["pinsent", "brodies", "clifford chance", "linklaters", "allen & overy", "freshfields", "slaughter and may", "dentons", "dla piper", "norton rose", "herbert smith", "eversheds", "baker mckenzie", "law firm", "solicitors", "llp law"], industry: "professional-services", sub: "Legal" },
  { kw: ["korn ferry", "robert half", "michael page", "pagegroup", "randstad", "adecco", "robert walters", "recruitment", "heidrick", "spencer stuart", "russell reynolds", "egon zehnder", "hays plc", "employment", "resourcing", "hiring", "recruit"], industry: "professional-services", sub: "Recruitment" },
  { kw: ["genpact", "iq-eq", "ig-eq", "vistra", "alter domus", "apex group", "citco", "intertrust", "tmf group", "ocorian", "aztec group", "trident trust", "sanne"], industry: "professional-services", sub: "Outsourcing & GBS" },
  // ── Financial Services ──
  { kw: ["jpmorgan", "j.p. morgan", "jp morgan", "mufg", "mitsubishi ufj", "standard chartered", "emirates nbd", "macquarie", "nomura", "smbc", "mizuho", "capital one", "truist", "usaa", "bny", "bank of new york", "royal bank of canada", "rbc ", "nationwide building society", "santander", "bbva", "unicredit", "intesa", "commerzbank", "credit agricole", "societe generale", "raymond james", "arbuthnot", "bank", "banque", "bancorp", "credit union", "savings"], industry: "financial-services", sub: "Banks" },
  { kw: ["aon", "marsh", "gallagher", "willis towers", "wtw", "chubb", "swiss re", "munich re", "zurich", "legal & general", "manulife", "howden", "hiscox", "lloyd's", "insurance", "assurance", "reinsurance", "underwrit", "tawuniya"], industry: "financial-services", sub: "Insurance" },
  { kw: ["schroders", "m&g", "abrdn", "invesco", "pimco", "vanguard", "t. rowe", "baillie gifford", "jupiter", "man group", "janus henderson", "asset management", "wealth", "investments", "capital management", "fund management"], industry: "financial-services", sub: "Asset & Wealth Management" },
  // "X Trust" that is FINANCE (investment/unit trusts, pension trustees, trust banks) — must run
  //   BEFORE the generic charity \btrust\b rule below so those don't fall into Nonprofit.
  { re: /\binvestment trust\b|\bunit trust\b|\bpensions?\b|\bsuperannuation\b|\btrustees\b|\btrust (company|corporation|bank)\b|\bfiduciary\b/, industry: "financial-services", sub: "Asset & Wealth Management" },
  { kw: ["apollo", "carlyle", "cvc", " eqt", "ardian", "permira", "advent international", "tpg", "warburg", "brookfield", "partners group", "private equity", "venture", "ventures", "growth equity"], industry: "financial-services", sub: "Private Equity & VC" },
  { kw: ["mastercard", "american express", "amex", "checkout.com", "coinbase", "monzo", "starling", "adyen", "klarna", "fiserv", "fis ", "gocardless", "sumup", "chime", "gcash", "payments", "fintech", "wallet", "neobank"], industry: "financial-services", sub: "Fintech & Payments" },
  { kw: ["rothschild", "lazard", "moelis", "evercore", "houlihan", "jefferies", "securities", "brokerage", "exchange", "trading"], industry: "financial-services", sub: "Capital Markets" },
  // ── Technology ──
  { kw: ["tiktok", "uber", "adobe", "servicenow", "linkedin", "celonis", "netsuite", "booking.com", "skyscanner", "datadog", "snowflake", "atlassian", "workday", "software", "saas", "cloud", "digital", "platform"], industry: "technology", sub: "Software & SaaS" },
  { kw: ["semiconductor", "chips", "electronics", "devices", "hardware"], industry: "technology", sub: "Hardware & Semiconductors" },
  { kw: ["telecom", "wireless", "broadband", "bt group", " stc", "barq", "communications"], industry: "technology", sub: "Telecom" },
  { kw: ["capgemini", "cognizant", "tata consultancy", " tcs", "infosys", "wipro", "ibm", "dxc", "ntt data", "atos", "sopra steria", "thoughtworks", "it services", "technologies"], industry: "technology", sub: "IT Services" },
  // Healthcare
  { kw: ["pharma", "biotech", "biosciences", "therapeutics", "life sciences"], industry: "healthcare", sub: "Pharma & Biotech" },
  { kw: ["medical device", "medtech", "diagnostics"], industry: "healthcare", sub: "Medical Devices" },
  { re: /\bhospitals?\b|\bhealth system\b|\bclinics?\b|\bhealthcare\b|\bcare\b|\bcaregiv\w*|\bcare home/, industry: "healthcare", sub: "Providers & Hospitals" },
  { kw: ["health insurance", "health plan", "payer"], industry: "healthcare", sub: "Payers & Health Insurance" },
  // Energy & Industrial
  { kw: ["oil", "gas", "petroleum", "energy", "drilling"], industry: "energy-industrial", sub: "Oil & Gas" },
  { re: /\butilit\w*|\bpower\b|\belectric\w*|\bgrid\b/, industry: "energy-industrial", sub: "Utilities & Power" },
  { kw: ["renewable", "solar", "wind", "clean energy"], industry: "energy-industrial", sub: "Renewables" },
  { kw: ["manufactur", "industries", "industrial", "machinery", "steel"], industry: "energy-industrial", sub: "Manufacturing" },
  { kw: ["aerospace", "defense", "defence", "aviation"], industry: "energy-industrial", sub: "Aerospace & Defense" },
  { kw: ["chemical", "materials"], industry: "energy-industrial", sub: "Chemicals" },
  // Consumer & Retail
  { kw: ["retail", "stores", "supermarket", "grocery"], industry: "consumer-retail", sub: "Retail" },
  { kw: ["consumer goods", "cpg", "household"], industry: "consumer-retail", sub: "Consumer Goods" },
  { kw: ["food", "beverage", "drinks", "brewing", "foods"], industry: "consumer-retail", sub: "Food & Beverage" },
  { kw: ["hotel", "hospitality", "travel", "airline", "resorts", "leisure"], industry: "consumer-retail", sub: "Hospitality & Travel" },
  { kw: ["media", "entertainment", "studios", "broadcasting", "publishing"], industry: "consumer-retail", sub: "Media & Entertainment" },
  { kw: ["automotive", "motors", "automobile", "vehicles"], industry: "consumer-retail", sub: "Automotive" },
  // Public Sector
  { kw: ["ministry", "department of", "government", "council", "authority", "municipal", "federal", "hm revenue", "hmrc", "civil service", "county council", "local authority", "armed forces", "police"], industry: "public-sector", sub: "Government" },
  { kw: ["nhs", "national health", "public health"], industry: "public-sector", sub: "Public Healthcare" },
  { kw: ["university", "college", "school", "education", "academy"], industry: "public-sector", sub: "Education" },
  // `\btrust\b` (word-boundary) keeps "Wildlife Trust"/"X Trust" charities but no longer hits
  //   "trustees"/"Trustpilot"/"entrust"; finance trusts are routed to FS by the rule above.
  { kw: ["nonprofit", "non-profit", "ngo", "foundation", "charity"], re: /\btrust\b/, industry: "public-sector", sub: "Nonprofit & NGO" },
  { kw: ["transport", "transit", "railway", "infrastructure", "airport"], industry: "public-sector", sub: "Transport & Infrastructure" },

  // ── Catch-all naming conventions (2026-06-23, derived from the real "Other" long tail). These
  //    run AFTER everything above, so they only catch fall-through — FS fintech / Healthcare biotech
  //    are already routed by the specific rules. `re` = regex (word-boundaries / AND / Arabic). ──
  // Short-acronym brands that collide in the exact map (aliases <4 chars get nulled) or show up as
  //   "BRAND Country" (AXA Philippines, ING Hubs, NBK Egypt). Word-boundaries keep them from matching
  //   inside longer words. Real exact/fuzzy dict hits (e.g. TD SYNNEX) already resolved at steps 1–2.
  { re: /\b(td|rbc|ing|qnb|nbk|gib|dib|uob|sabb|aub)\b/, industry: "financial-services", sub: "Banks" },
  { re: /\baxa\b/, industry: "financial-services", sub: "Insurance" },
  { re: /\bstc\b/, industry: "technology", sub: "Telecom" },
  { re: /\be&\b|etisalat/, industry: "technology", sub: "Telecom" },
  { re: /\baab\b/, industry: "professional-services", sub: "Audit & Accounting" },
  { re: /\bams\b/, industry: "professional-services", sub: "Recruitment" },
  { re: /\bzs\b/, industry: "professional-services", sub: "Consulting & Strategy" },
  { re: /\bion\b/, industry: "technology", sub: "Software & SaaS" },
  { re: /\bnwc\b|national water/, industry: "energy-industrial", sub: "Utilities & Power" },
  // Arabic government & funds (a Gulf network is heavy with these).
  { re: /وزارة|هيئة|أمانة|بلدية|الحكوم|ديوان|سلطة/, industry: "public-sector", sub: "Government" },
  { re: /صندوق/, industry: "financial-services", sub: "Asset & Wealth Management" },
  // Central banks / monetary authorities → FS (before generic public sector / fund).
  { re: /\bcentral bank\b|monetary authority|reserve bank|\bbangko sentral\b|\bsama\b/, industry: "financial-services", sub: "Banks" },
  // Funds, credit bureaus, capital partners → Financial Services.
  { re: /\bfund(s)?\b/, industry: "financial-services", sub: "Asset & Wealth Management" },
  { re: /\bcredit bureau\b|credit information|\bsimah\b/, industry: "financial-services", sub: "Banks" },
  { re: /\b(capital|equity)\s+partners\b/, industry: "financial-services", sub: "Private Equity & VC" },
  // Public sector: national centres/audit offices, courts of audit, statistics authorities.
  { re: /\bnational\b.*\bcent(er|re)\b|commission on audit|national audit|court of audit(ors)?|comptroller|statistics (office|authority)|\bgastat\b/, industry: "public-sector", sub: "Government" },
  // Professional services: EY variants, accountancy bodies, LLPs & partnerships.
  { re: /\b(ernst\s*&?\s*young|ey)\b/, industry: "professional-services", sub: "Audit & Accounting" },
  { re: /\bchartered accountants?\b|accountancy|bookkeeping|\bicas\b|\bicaew\b|\bacca\b/, industry: "professional-services", sub: "Audit & Accounting" },
  { re: /\bllp\b|\b(partners|associates)\b/, industry: "professional-services", sub: "Consulting & Strategy" },
  // Technology (broad — fintech/biotech already routed to FS/Healthcare above).
  { re: /\btechnolog(y|ies)\b|\btech\b|software|\bsaas\b|\bsystems?\b|\bcyber\w*|\bcloud\b|\bdigital\b|computing|robotics|\bdata\b|\biot\b|\bplatform\b|semiconduct|\bml\b|\bai\b/, industry: "technology", sub: "Software & SaaS" },
  // Insurance / life — LATE fallback (after tech/healthcare/consumer, so "Life Technologies" wins first).
  { re: /\b(life|assurance|takaful|mutual)\b/, industry: "financial-services", sub: "Insurance" },

  // ════════════════════════════════════════════════════════════════════════════════════
  // FINAL CLEANUP (2026-06-23, user-directed). Runs LAST in the keyword pass, so it ONLY
  // catches names still unmatched by every rule above — a tidy-up of the "Other" tail by
  // generic words in the org name. Word-boundaries (`\b`) stop substring false-hits — e.g.
  // \bsearch\b must NOT fire on "research", \binvestor\b not on "divestor". First match wins,
  // so the order below resolves names that contain more than one of these words.
  // ════════════════════════════════════════════════════════════════════════════════════
  // Named US mortgage GSEs.
  { re: /freddie mac|fannie mae/, industry: "financial-services", sub: "Banks" },
  // Public sector: municipalities ("City of …"), royal commissions, and "Confidential" (+ misspellings).
  { re: /\bcity of\b/, industry: "public-sector", sub: "Government" },
  { re: /royal commission/, industry: "public-sector", sub: "Government" },
  { re: /confid|cofid|confd|konfid/, industry: "public-sector", sub: "Government" },
  // Financial services.
  { re: /\bbuilding society\b|\bfinanc(e|es|ial|ials|ing)\b|\bcash\b/, industry: "financial-services", sub: "Banks" },
  { re: /\binvestors?\b/, industry: "financial-services", sub: "Asset & Wealth Management" },
  // Real estate.
  { re: /\bproperty\b|commercial property/, industry: "real-estate", sub: "Commercial Real Estate Services" },
  // Energy & industrial (logistics folds in here — no separate top-level industry needed).
  { re: /\bhydro\w*/, industry: "energy-industrial", sub: "Renewables" },
  { re: /\bwater\b/, industry: "energy-industrial", sub: "Utilities & Power" },
  { re: /\blogistics\b|\bfreight\b|\bsupply chain\b/, industry: "energy-industrial", sub: "Logistics & Transport" },
  // Healthcare & pharma: clinics / dental / medical / wellness (health SERVICES, per user) +
  //   labs & therapies. (Reversed the prior pass that had sent these to Consumer.)
  { re: /\bdental\b|\bdentist\w*|\bmedical\b|\bhealth\b|\bwellness\b|\bclinics?\b|\bmed\b/, industry: "healthcare", sub: "Providers & Hospitals" },
  { re: /\blaborator(y|ies)\b|\btherap(y|ies)\b|\btherapeutics?\b/, industry: "healthcare", sub: "Pharma & Biotech" },
  // Consumer & retail: sports clubs, gyms, boxing.
  { re: /\bfootball\b|\brugby\b|\bcricket\b|\btennis\b|\bgolf club\b|\bathletic\b|\bsporting\b|\bbasketball\b|\bnetball\b|\bsports\b|\bafc\b|\bf\.?c\.?\b|\bgym\b|\bfitness\b|\bboxing\b/, industry: "consumer-retail", sub: "Sports & Recreation" },
  // Recruitment.
  { re: /\bsearch\b|\btalent/, industry: "professional-services", sub: "Recruitment" },
  // Technology.
  { re: /\btechnolog(y|ies)\b|\bai\b/, industry: "technology", sub: "Software & SaaS" },
  // Professional services (broadest — last).
  { re: /\btax\b|\baccounting\b|\bbookkeep\w*/, industry: "professional-services", sub: "Audit & Accounting" },
  { re: /\bconsult\w*|\bsolutions\b|\bdesign\w*/, industry: "professional-services", sub: "Consulting & Strategy" },

  // ── FINAL CLEANUP round 2 (2026-06-23, user-directed). Same "last-resort" placement. ──
  // Financial services.
  { re: /\bfamily office\b|\binvesting\b/, industry: "financial-services", sub: "Asset & Wealth Management" },
  { re: /\bmortgages?\b|\bmoney\b/, industry: "financial-services", sub: "Banks" },
  { re: /\bsecuriti[sz]ation\b/, industry: "financial-services", sub: "Capital Markets" },
  // Real estate.
  { re: /\bhomes\b/, industry: "real-estate", sub: "Homebuilders & Developers" },
  { re: /\bproperties\b|\bhousing society\b/, industry: "real-estate", sub: "Commercial Real Estate Services" },
  { re: /\baccommodation\b|\bco-?living\b/, industry: "real-estate", sub: "Property Management" },
  // Recruitment (incl. the named firm Eden Rose).
  { re: /\bresourcing\b|\bemployment\b|\bhir(e|ing)\b|eden rose/, industry: "professional-services", sub: "Recruitment" },
  // Public sector regulators (FSA = Financial Services / Food Standards Authority).
  { re: /\bfsa\b/, industry: "public-sector", sub: "Government" },
  // Professional services (advertising / advice / analytics / analysis / ecommerce / business services).
  { re: /\badvertising\b|\bbusiness services\b|\badvice\b|\banalytics\b|\banalysis\b|\becommerce\b|\be-commerce\b/, industry: "professional-services", sub: "Consulting & Strategy" },

  // ── FINAL CLEANUP round 3 (2026-06-23, user-directed). ──
  // Financial services. NB `invest` is matched ANYWHERE (user instruction), not word-bounded.
  { re: /invest/, industry: "financial-services", sub: "Asset & Wealth Management" },
  { re: /\blend\w*/, industry: "financial-services", sub: "Banks" },
  { re: /\binsur\w*/, industry: "financial-services", sub: "Insurance" },
  // Energy & industrial (fuels, engineering).
  { re: /\bfuels?\b/, industry: "energy-industrial", sub: "Oil & Gas" },
  { re: /\bengineering\b|\bengineers\b/, industry: "energy-industrial", sub: "Manufacturing" },
  // Real estate (living, estate agents/realty/realtor, land).
  { re: /\bestate agents?\b|\brealty\b|\brealtor\b|\breal estate\b/, industry: "real-estate", sub: "Commercial Real Estate Services" },
  { re: /\bliving\b/, industry: "real-estate", sub: "Property Management" },
  { re: /\bland\b/, industry: "real-estate", sub: "Homebuilders & Developers" },
  // Professional services (law / legal / PR).
  { re: /\blaw\b|\blegal\b/, industry: "professional-services", sub: "Legal" },
  { re: /\bpr\b/, industry: "professional-services", sub: "Consulting & Strategy" },
  // Education (teachers — user confirmed Public Sector, not Consumer).
  { re: /\bteachers?\b/, industry: "public-sector", sub: "Education" },
  // Packaging → industrial manufacturing (user decision).
  { re: /\bpackaging\b/, industry: "energy-industrial", sub: "Manufacturing" },
  // "X Capital" = investment / asset-management houses (very common in a Gulf finance network,
  // and previously mis-hit "Capita" the outsourcer). "Human capital" is HR → route that first.
  { re: /\bhuman capital\b/, industry: "professional-services", sub: "Recruitment" },
  { re: /\bcapital\b/, industry: "financial-services", sub: "Capital Markets" },

  // ── FINAL CLEANUP round 4 (2026-06-24, from the deep "Other" token/firm research). ──
  // Public sector (audit offices guard BEFORE generic audit→ProServices; gov bodies; education).
  { re: /\bauditor[ -]general\b|\baudit office\b|\bnational audit\b/, industry: "public-sector", sub: "Government" },
  { re: /\bchamber of commerce\b|\bconstabulary\b|\bair force\b|\bnavy\b|\bborough\b/, industry: "public-sector", sub: "Government" },
  { re: /\buniversit(y|ies)\b|universit(ä|é|a)|universidad/, industry: "public-sector", sub: "Education" },
  { re: /\bred cross\b|\brelief\b|\bappeal\b|\bhospice\b/, industry: "public-sector", sub: "Nonprofit & NGO" },
  // Professional services.
  { re: /\bmarketing\b|\badvertising\b/, industry: "professional-services", sub: "Consulting & Strategy" },
  { re: /\badvis(o|e)rs?\b|\bcoaching\b|\bleadership\b|\bmarket research\b/, industry: "professional-services", sub: "Consulting & Strategy" },
  { re: /\bstaffing\b|\brpo\b/, industry: "professional-services", sub: "Recruitment" },
  { re: /\bcpas?\b|\bauditors?\b|\baudit\b|\bbookkeep\w*/, industry: "professional-services", sub: "Audit & Accounting" },
  { re: /\bbpo\b|\bshared services\b|\bsupport services\b/, industry: "professional-services", sub: "Outsourcing & GBS" },
  // Technology.
  { re: /\binfotech\b/, industry: "technology", sub: "IT Services" },
  // Financial services.
  { re: /\bpensions?\b/, industry: "financial-services", sub: "Asset & Wealth Management" },
  { re: /\breinsurance\b/, industry: "financial-services", sub: "Insurance" },
  { re: /\bmicrofinance\b/, industry: "financial-services", sub: "Banks" },
  { re: /\bfunding\b/, industry: "financial-services", sub: "Fintech & Payments" },
  // Consumer & retail.
  { re: /\bevents\b|\bstudios?\b/, industry: "consumer-retail", sub: "Media & Entertainment" },
  { re: /\bbrands\b|\bcosmetics\b|\bbeauty\b/, industry: "consumer-retail", sub: "Consumer Goods" },
  { re: /\bdistiller\w*|\bbrewer\w*|\bbreweries\b|\bwinery\b|\bvineyard\w*/, industry: "consumer-retail", sub: "Food & Beverage" },
  { re: /\bcruises?\b|\bholidays?\b/, industry: "consumer-retail", sub: "Hospitality & Travel" },
  // Energy & industrial.
  { re: /\bmarine\b|\bmaritime\b|\bshipping\b|\bports?\b/, industry: "energy-industrial", sub: "Logistics & Transport" },
  { re: /\bcement\b|\bmining\b/, industry: "energy-industrial", sub: "Manufacturing" },
  // Real estate.
  { re: /\bhousing association\b/, industry: "real-estate", sub: "Property Management" },
  // "X Agency" left over after the specific rules above (creative/SEO/PR/digital agencies) →
  //   Professional Services, NOT Government (removed bare "agency" from the gov rule).
  { re: /\bagenc(y|ies)\b/, industry: "professional-services", sub: "Consulting & Strategy" },
];
