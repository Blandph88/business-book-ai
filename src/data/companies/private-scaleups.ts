// Private scale-ups, unicorns, and large privately-held / family-owned companies (US + Europe)
// that are NOT in the public equity indices covered by the other dictionary files.
// Scope is two-fold: (A) notable late-stage private tech & fintech scale-ups, and (B) large
// private / family-owned enterprises across all sectors. Consumed by ../classify.ts.
import type { CompanyEntry } from "../../config/markets";

export const COMPANIES: CompanyEntry[] = [
  // ───────────────────────── PART A — Scale-ups / unicorns ─────────────────────────

  // ── Fintech & Payments (financial-services) ──
  { name: "Monzo", aliases: ["Monzo Bank", "Monzo Bank Ltd"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Starling Bank", aliases: ["Starling", "Starling Bank Ltd"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Klarna", aliases: ["Klarna Bank", "Klarna AB"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Chime", aliases: ["Chime Financial", "Chime Financial Inc"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Brex", aliases: ["Brex Inc"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Ramp", aliases: ["Ramp Financial", "Ramp Business Corporation"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Plaid", aliases: ["Plaid Inc", "Plaid Technologies"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "GoCardless", aliases: ["Go Cardless", "GoCardless Ltd"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "N26", aliases: ["N26 GmbH", "Number26"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Qonto", aliases: ["Qonto SAS", "Olinda SAS"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "SumUp", aliases: ["SumUp Payments", "SumUp Ltd"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Mollie", aliases: ["Mollie B.V.", "Mollie BV"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Rapyd", aliases: ["Rapyd Financial Network"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Zopa", aliases: ["Zopa Bank", "Zopa Ltd"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "OakNorth", aliases: ["OakNorth Bank", "Oak North"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Tide", aliases: ["Tide Platform", "Tide Platform Ltd"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Pleo", aliases: ["Pleo Technologies", "Pleo ApS"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Trade Republic", aliases: ["Trade Republic Bank", "Trade Republic Bank GmbH"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Scalable Capital", aliases: ["Scalable", "Scalable Capital GmbH"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "eToro", aliases: ["eToro Group", "e-Toro"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Marqeta", aliases: ["Marqeta Inc"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Melio", aliases: ["Melio Payments"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Bolt", aliases: ["Bolt Financial", "Bolt Financial Inc"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Thought Machine", aliases: ["ThoughtMachine", "Thought Machine Group"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Form3", aliases: ["Form3 Financial Cloud"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "ComplyAdvantage", aliases: ["Comply Advantage"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },
  { name: "Sift", aliases: ["Sift Science"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Chainalysis", aliases: ["Chainalysis Inc"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Stripe", aliases: ["Stripe Inc", "Stripe Payments"], industry: "financial-services", sub: "Fintech & Payments", regions: ["north-america"] },
  { name: "Sorare", aliases: ["Sorare SAS"], industry: "financial-services", sub: "Fintech & Payments", regions: ["europe"] },

  // ── Software & SaaS (technology) ──
  { name: "Canva", aliases: ["Canva Pty Ltd"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Notion", aliases: ["Notion Labs", "Notion Labs Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Figma", aliases: ["Figma Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Miro", aliases: ["RealtimeBoard", "Miro Ltd"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Airtable", aliases: ["Airtable Inc", "Formagrid"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Linear", aliases: ["Linear Orbit", "Linear Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Vercel", aliases: ["Vercel Inc", "ZEIT"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Retool", aliases: ["Retool Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Zapier", aliases: ["Zapier Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Calendly", aliases: ["Calendly LLC"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Grammarly", aliases: ["Grammarly Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Gusto", aliases: ["Gusto Inc", "ZenPayroll"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Rippling", aliases: ["Rippling People Center"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Deel", aliases: ["Deel Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Remote", aliases: ["Remote.com", "Remote Technology"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Personio", aliases: ["Personio GmbH", "Personio SE"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Celonis", aliases: ["Celonis SE", "Celonis GmbH"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "UiPath", aliases: ["UiPath Inc"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Wiz", aliases: ["Wiz Inc", "Wiz Cloud Security"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Snyk", aliases: ["Snyk Ltd"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "1Password", aliases: ["AgileBits", "1Password Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Postman", aliases: ["Postman Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "GitLab", aliases: ["GitLab Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Pipedrive", aliases: ["Pipedrive OU", "Pipedrive Inc"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Hotjar", aliases: ["Hotjar Ltd"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Typeform", aliases: ["Typeform SL"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "ContentSquare", aliases: ["Content Square", "Contentsquare SAS"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Dataiku", aliases: ["Dataiku SAS", "Dataiku Inc"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Darktrace", aliases: ["Darktrace plc"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Onfido", aliases: ["Onfido Ltd"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Improbable", aliases: ["Improbable Worlds", "Improbable Worlds Ltd"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },

  // ── AI / ML (technology) ──
  { name: "OpenAI", aliases: ["OpenAI Inc", "OpenAI LP"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Anthropic", aliases: ["Anthropic PBC"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Databricks", aliases: ["Databricks Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Hugging Face", aliases: ["HuggingFace", "Hugging Face Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Mistral AI", aliases: ["Mistral", "Mistral AI SAS"], industry: "technology", sub: "Software & SaaS", regions: ["europe"] },
  { name: "Cohere", aliases: ["Cohere Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Scale AI", aliases: ["Scale", "Scale AI Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },

  // ── Internet & Platforms (technology) ──
  { name: "Discord", aliases: ["Discord Inc"], industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Substack", aliases: ["Substack Inc"], industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Patreon", aliases: ["Patreon Inc"], industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Instacart", aliases: ["Maplebear", "Instacart Inc"], industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Gopuff", aliases: ["GoPuff", "goPuff", "GoBrands"], industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Getir", aliases: ["Getir Perakende"], industry: "technology", sub: "Internet & Platforms", regions: ["europe"] },
  { name: "Gorillas", aliases: ["Gorillas Technologies"], industry: "technology", sub: "Internet & Platforms", regions: ["europe"] },
  { name: "Glovo", aliases: ["Glovoapp", "Glovoapp23"], industry: "technology", sub: "Internet & Platforms", regions: ["europe"] },
  { name: "Bolt Mobility", aliases: ["Bolt Technology", "Bolt Technology OU", "Taxify"], industry: "technology", sub: "Internet & Platforms", regions: ["europe"] },
  { name: "Epic Games", aliases: ["Epic Games Inc", "Fortnite", "Unreal Engine"], industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },
  { name: "Valve", aliases: ["Valve Corporation", "Steam"], industry: "technology", sub: "Internet & Platforms", regions: ["north-america"] },

  // ── Hardware & Semiconductors (technology) ──
  { name: "SpaceX", aliases: ["Space Exploration Technologies", "Starlink"], industry: "technology", sub: "Hardware & Semiconductors", regions: ["north-america"] },
  { name: "Graphcore", aliases: ["Graphcore Ltd"], industry: "technology", sub: "Hardware & Semiconductors", regions: ["europe"] },

  // ───────────────────────── PART B — Large private / family-owned ─────────────────────────

  // ── US private — Retail / Food (consumer-retail) ──
  { name: "H-E-B", aliases: ["HEB", "H E B", "HEB Grocery"], industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },
  { name: "Meijer", aliases: ["Meijer Inc"], industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },
  { name: "Wegmans", aliases: ["Wegmans Food Markets"], industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },
  { name: "QuikTrip", aliases: ["Quik Trip", "QT"], industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },
  { name: "Sheetz", aliases: ["Sheetz Inc"], industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },
  { name: "Hobby Lobby", aliases: ["Hobby Lobby Stores"], industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },
  { name: "Menards", aliases: ["Menard Inc"], industry: "consumer-retail", sub: "Retail", regions: ["north-america"] },

  // ── US private — Software / Tech (technology) ──
  { name: "SAS Institute", aliases: ["SAS", "SAS Inc"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Epic Systems", aliases: ["Epic", "Epic Systems Corporation"], industry: "technology", sub: "Software & SaaS", regions: ["north-america"] },
  { name: "Cox Communications", aliases: ["Cox", "Cox Enterprises"], industry: "technology", sub: "Telecom", regions: ["north-america"] },

  // ── US private — Consumer Goods / Services (consumer-retail) ──
  { name: "Mars Petcare", aliases: ["Mars Petcare US"], industry: "consumer-retail", sub: "Consumer Goods", regions: ["north-america"] },
  { name: "Enterprise Holdings", aliases: ["Enterprise Rent-A-Car", "Enterprise Rent A Car", "Enterprise Mobility"], industry: "consumer-retail", sub: "Automotive", regions: ["north-america"] },

  // ── Europe private — Retail / Grocery (consumer-retail) ──
  { name: "Auchan", aliases: ["Auchan Retail", "Auchan Holding"], industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "E.Leclerc", aliases: ["Leclerc", "E Leclerc", "Centres E.Leclerc"], industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "Intermarché", aliases: ["Intermarche", "Les Mousquetaires"], industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "Edeka", aliases: ["Edeka Group", "Edeka Zentrale"], industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "Rewe Group", aliases: ["REWE", "Rewe", "Rewe Zentral"], industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "Decathlon", aliases: ["Decathlon SA", "Decathlon Group"], industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "Aldi Süd", aliases: ["Aldi Sud", "Aldi South"], industry: "consumer-retail", sub: "Retail", regions: ["europe"] },
  { name: "Boots", aliases: ["Boots UK", "Boots Pharmacy"], industry: "consumer-retail", sub: "Retail", regions: ["europe"] },

  // ── Europe private — Consumer Goods / Luxury (consumer-retail) ──
  { name: "Rolex", aliases: ["Rolex SA", "Montres Rolex"], industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },
  { name: "Patek Philippe", aliases: ["Patek Philippe SA", "Patek"], industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },
  { name: "Miele", aliases: ["Miele & Cie", "Miele Group"], industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },
  { name: "Swarovski", aliases: ["Swarovski AG", "D. Swarovski"], industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },
  { name: "Vorwerk", aliases: ["Vorwerk Group", "Thermomix"], industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },
  { name: "Dyson", aliases: ["Dyson Ltd", "Dyson Technology"], industry: "consumer-retail", sub: "Consumer Goods", regions: ["europe"] },

  // ── Europe private — Food & Beverage (consumer-retail) ──
  { name: "Bonduelle", aliases: ["Bonduelle SA", "Bonduelle Group"], industry: "consumer-retail", sub: "Food & Beverage", regions: ["europe"] },
  { name: "Lactalis", aliases: ["Groupe Lactalis", "Lactalis Group"], industry: "consumer-retail", sub: "Food & Beverage", regions: ["europe"] },
  { name: "Bel Group", aliases: ["Fromageries Bel", "Bel"], industry: "consumer-retail", sub: "Food & Beverage", regions: ["europe"] },
  { name: "Barilla", aliases: ["Barilla Group", "Barilla G. e R. Fratelli"], industry: "consumer-retail", sub: "Food & Beverage", regions: ["europe"] },

  // ── Europe private — Hospitality / Travel (consumer-retail) ──
  { name: "Greene King", aliases: ["Greene King plc", "Greene King Brewery"], industry: "consumer-retail", sub: "Hospitality & Travel", regions: ["europe"] },
  { name: "Pret A Manger", aliases: ["Pret", "Pret a Manger"], industry: "consumer-retail", sub: "Hospitality & Travel", regions: ["europe"] },

  // ── Europe private — Industrial / Manufacturing (energy-industrial) ──
  { name: "Würth", aliases: ["Wurth", "Würth Group", "Adolf Würth"], industry: "energy-industrial", sub: "Manufacturing", regions: ["europe"] },
  { name: "Trumpf", aliases: ["TRUMPF", "Trumpf GmbH", "Trumpf Group"], industry: "energy-industrial", sub: "Manufacturing", regions: ["europe"] },
  { name: "Liebherr", aliases: ["Liebherr Group", "Liebherr International"], industry: "energy-industrial", sub: "Manufacturing", regions: ["europe"] },
  { name: "Claas", aliases: ["CLAAS", "Claas KGaA"], industry: "energy-industrial", sub: "Manufacturing", regions: ["europe"] },
  { name: "Heraeus", aliases: ["Heraeus Holding", "Heraeus Group"], industry: "energy-industrial", sub: "Manufacturing", regions: ["europe"] },
  { name: "Knauf", aliases: ["Knauf Group", "Knauf Gips"], industry: "energy-industrial", sub: "Manufacturing", regions: ["europe"] },

  // ── Gambling / Media (consumer-retail) ──
  { name: "Bet365", aliases: ["Bet 365", "Hillside Group"], industry: "consumer-retail", sub: "Media & Entertainment", regions: ["europe"] },
];
