# Where to find more company lists (for expanding the dictionary)

The current dictionary (`src/data/companies/*.ts`, ~1,900 entries) was authored from model + research-agent
**training knowledge** — accurate for *classifying* major firms into industries, but it is **not** a live-scraped
current index membership, and tickers/aliases should be spot-checked before relying on them commercially. Below is
how to make it authoritative and far larger, cheaply.

## Best free, structured sources (bulk + aliases)

| Source | What you get | Why it's good |
|---|---|---|
| **SEC EDGAR company tickers** — `https://www.sec.gov/files/company_tickers.json` (+ `company_tickers_exchange.json`) | ~10,000 US public companies: CIK, **ticker**, legal name | Free, no key. Instant ticker→name aliases. Each filer also has an **SIC code** → map to our buckets. |
| **GLEIF LEI "Golden Copy"** — gleif.org | Every legally-registered entity worldwide: legal name + **"other names"/trade names** (aliases), HQ country | Global, includes **private** entities; the best alias source. Free bulk download. |
| **Wikidata** (query.wikidata.org, SPARQL) | Companies with **industry (P452)**, ticker (P249), country, parent/subsidiary, **former names & aliases** | Queryable: "all companies listed on an exchange + their industry." Free. |
| **Companies House (UK)** — free bulk data | All UK registered companies + **SIC codes** | Best for the UK long tail. |
| **Index constituent tables (Wikipedia "List of … constituents")** | S&P 500 / 400 / 600, Russell 1000/2000/3000; FTSE 100/250/350; DAX/MDAX/SDAX, CAC 40, AEX, SMI, IBEX 35, FTSE MIB, OMX Nordic, STOXX Europe 600 | Clean tables with company **+ GICS sector** already attached → maps straight to our industries. |
| **Forbes / Fortune lists** | Fortune 500 / Global 500, Forbes Global 2000, **Forbes "America's Largest Private Companies"**, Deloitte/Sunday Times private-company lists, FT 1000 | The Forbes private list is the key one for big **private** firms the indices miss. |

## Industry-classification standards (to bucket at scale)

- **GICS** (S&P/MSCI) — maps to our 7 industries cleanly; it's already in the Wikipedia index tables.
- **SIC / NAICS** (US gov) — SEC filers carry SIC; map SIC ranges → our buckets.
- **ICB** (FTSE) — used across FTSE/European indices.

## The "Big 4 clients" angle

The Big 4 (KPMG/Deloitte/PwC/EY) don't publish client lists, but **every public company discloses its auditor** in its
annual report / proxy. Practically, **the major indices ≈ the Big 4 client base** — almost every large listed company is
a Big 4 audit client — so covering S&P 500 + FTSE 350 + the European indices already covers the overwhelming majority of
their clients. Index coverage *is* client coverage.

## Recommended way to scale the dictionary

1. **SEC `company_tickers.json`** → ~10k US public companies + tickers in one script; bucket via SIC.
2. **Wikipedia constituent tables** for FTSE 350 + the continental-European indices (GICS sector included).
3. **GLEIF** for aliases/trade names; **Forbes private list** for big private firms.
4. Keep the keyword fallback (`COMPANY_KEYWORD_RULES`) for the rest, and rely on the per-contact **owner override** for the
   genuine long tail (tiny/local firms a buyer will recognise themselves).

A good target: get the dictionary to ~5,000 well-classified entries with aliases, which should push real-network coverage
from today's ~63% toward ~80%+. The remaining tail is one-person LLCs, "Confidential", and non-US/Europe firms — not worth
chasing in the dictionary; the override handles them.
