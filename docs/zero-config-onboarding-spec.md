# Zero-config onboarding + deterministic-first — build spec

## Priya resolution scorecard (single source of truth)

The full Priya review, mapped to status. ✅ done · 🟡 partial · 🔴 open.

| # | Priya's turn-off | Status | Where |
|---|---|---|---|
| BB-YourDay | Brief renders nothing until AI is set up | ✅ | commit d305354 — deterministic brief |
| BB-datateloss | Scan remount nukes open forms; opp re-spot clobbers | ✅ | 7d372bd |
| BB-stale/currency/SoW/funnel | YourDay stale cache; currency reload; SoW dangling link; Met/Agreed inversion | ✅ | 45ee8ba |
| BB-copilot | Concurrent gen; companion/crisis gate bypass; bad tool args | ✅ | f788718 |
| BB-emptygraphs | Opportunity funnel/breakdowns looked broken on a sparse import | ✅ | 9a4fec0 — CardEmpty gates the opp funnel + hides filter-tabs when `opps.length===0`. RevenueTab already had an empty-state; DashboardTab $0 KPIs are legitimate |
| BB-warmth | Barren/slow first-run ranking (top-N cap, AI-blocked) | ✅ | Verified already handled: `warmth()` is deterministic (renders pre-scan); temperature chart self-gates (`if(!scored.length) return null`); Warmth column shows a clean "—"; InsightsTab/WarmthBanner frame the scan as enrichment + explain the on-device cap. No change needed |
| BB-redaction | Cloud-scan redaction is opt-in on a confidentiality product | ✅ | **Already built + already default-ON** (`scanRedactEnabled()` defaults on; `redactPII` scrubs email/link/phone/names, NOT company; cloud-only; toggle in InsightsTab). Priya's finding was stale. Only polish left (postal address regex; surface toggle in AI settings). B3-platform (generic floor for OTHER apps) = separate Freehold primitive |
| FH-aiwall | AI-setup wall for AI-*required* apps | 🟡 | Part A (BB already AI-optional) |
| FH-compat | Desktop-Chrome-only discovered late | 🔴 | Part A / listing pre-check |
| FH-price | £9,999 "all sales final", no "who is this for" | 🔴 | seq #6 |
| FH-jargon | "sealed / capability / BYOK" | 🔴 | seq #6 |
| X-onramp | AI on-ramp asked too early (both) | 🟡 | Part A + deterministic-first (YourDay ✅, dashboard already model-free) |

Note: the versioning-delivery + checkout/grant security fixes (76896d6, d8c69ef) aren't Priya-delight items, but a versioning feature that couldn't ship a patch *would* have disappointed her later — now closed.



**Goal (Priya-delight):** the product is fully alive the instant her data lands, with **no AI setup asked up front**. AI setup becomes a **one-time guided "activation"** she reaches *after* she's seen value — the teaching moment for "your AI runs on your device, you control it." A modest local model never defines the perceived quality ceiling (the demo anchors that high), and there's a visible upgrade ladder she climbs at her own pace.

Two halves, clean split (already reflected in the code):

- **Freehold platform** owns AI setup (the account/library-level "⚙ AI settings" per app). The one-time *activation* flow lives here.
- **Business Book app** must render maximum value with AI **off**, and degrade generative features gracefully, pointing to the Freehold AI settings.

---

## Part A — Freehold platform: the one-time "Activate your assistant" flow

Lives at the library/account level (host broker), shown **once** per app until AI is configured; never a hard wall over the app.

1. **Demo sets a HIGH quality anchor (gate-free).** The demo showcases the assistant at its best via *pre-generated example outputs* labelled "this is what a capable model you set up in one click produces" — so the ceiling is anchored to *good* before any local model runs. Neutralises the "weak-model = perceived ceiling" risk.
2. **Activation moment (after demo / on first owned launch), reframed from a menu into a guided choice:**
   - Headline teaches: *"Your assistant runs on your computer, not ours. Your data never leaves this device."*
   - **Primary one-click:** "Turn on the private assistant" → downloads the most capable in-browser model **the device can actually run**, warms in the background with progress. ~10s of clicks, no install. ⚠️ **RISK — validate before building:** a 7–8B WebGPU model is a 4–5 GB download needing serious VRAM; on a typical laptop it may be slow or OOM. The current `AiSetupCard` ships ~1.9 GB (a 3B). Defaulting too heavy makes first-run WORSE (hangs/crash). Needs conservative device-capability detection (RAM/VRAM) + real-hardware testing; the "most capable" default is the single riskiest assumption in this spec.
   - **Secondary "Set it up properly →":** reveals the full tiers — Chrome built-in (instant/basic), local runtime (Ollama/LM Studio, 70B+), BYOK cloud (own key).
   - Device-aware picker: WebGPU present → best-fitting model by RAM (step down 7B→3B→1.5B); no WebGPU but Nano → offer Nano labelled "basic/fast"; else guide to desktop Chrome/Edge.
   - Shown **once**; afterwards AI config lives in Settings, never re-gated.
3. **Upgrade ladder (kills the ceiling risk permanently).** Generalise the existing `offerUpgradeIfOnNano` nudge into a tier ladder: honest in-product tier label ("Built-in model — fast, fully private, good for most tasks") + a gentle non-nagging nudge to a local 70B or own key for sharper output. Reaching the higher ceiling is *her choice* — on-brand for "you control your AI."

## Part B — Business Book app: deterministic-first (already mostly there)

The dashboard/metrics/funnel/rankings already render with **no AI** (no `aiReady` gate). Remaining gaps:

- **B1. `YourDay` deterministic brief.** Today it hides entirely without AI (`if (!aiReady) return null`). It already receives every signal as props (agenda / hotOpps / stale / aging / owed / latent). Render those as a **structured, readable brief** with AI off; when AI is ready, the prose narration enhances it (shown instantly as the base, swapped when the model returns — no empty spinner). Reconnect *list* is deterministic; the per-item *Draft* button stays AI-gated (points to AI settings when off). **← THIS COMMIT.**
- **B2. Warmth ranking — RESCOPED after code check.** `warmth()` (compute.ts:59) is ALREADY fully deterministic (funnel stage + recency + thread reciprocity; the AI sentiment score is an *optional additive*), so a complete, instant ranking of everyone already works with no scan. The `300` cap is **on-device only** (`ONDEVICE_CAP`; fast backends are already uncapped) — it protects a slow WebGPU from grinding thousands of per-message calls; **do NOT remove it.** So B2 is NOT an algorithm change and NOT "uncap". Real scope = **UX**: (1) verify the ranking tables render pre-scan (not gated on scan-completion); (2) make clear the ranking is already complete on import and the sentiment pass is optional background enrichment (progressive scores, "getting sharper" not "loading/empty").
- **B3. Redaction = a BUYER TOGGLE + platform-executed redaction. NOT per-feature dev code** (unenforceable — the guarantee would only be as good as the laziest developer). Egress happens in the broker (`byok.ts`); BB is sealed and can't send or pick the tier. So the control + mechanism live in Freehold; the dev's only job is a *declaration*.
  - **B3-platform (Freehold broker) — the control + the mechanism:**
    - **Buyer toggle** in the app's AI settings (next to BYOK/tier prefs): *"Redact identifiers before sending to your cloud AI — more confidential; some features that rely on names may be less specific."* **Off by default** (opt-in), prominently offered. When on, applies to ALL that app's BYOK egress.
    - **Scope = PERSONAL identifiers only** (PII): person names, personal phone, personal email, postal/home address. **Explicitly NOT company/org names, job titles, or sector** — those are business/professional data, not PII, and BB's sector classification *needs* the company. (Conflating the two would silently break analytics.)
    - **Redaction runs in the broker** (tokenize before the `fetch`, detokenize the response locally): (a) **generic detection always** — emails / phones / postal addresses (regex) + person names (light on-device pass) — the enforceable floor even if the dev declared nothing; (b) **app personal-identifier dictionary** — the app hands the broker the user's own PEOPLE (contact names + personal contact details it holds locally) for exact string-replace. Company/org names are deliberately excluded.
    - **Consequence — the toggle is ~free for analytics:** BB's warmth scan (scores tone, not names) and sector scan (uses company, which isn't redacted) are NOT degraded with redaction on; only name-dependent features (reconnect drafting) degrade. Honest note surfaced; the user's sovereign choice.
    - **Optional separate max-paranoia layer (NOT default, NOT "PII"):** a distinct toggle *"also mask client/company names — reduces sector/industry analysis"* for a consultant who treats their client list as commercially sensitive. Off by default; kept separate from PII so it never silently breaks the scan.
  - **B3-creator-spec — the dev's ONLY job is a DECLARATION, not code:** in `freehold.json` the creator declares their **personal-identifier** fields (e.g. `identifiers: [contact.name, contact.phone, contact.email]`) or a one-line hook returning the person dictionary — NOT company/org fields. No per-call redaction logic, no "build it like BB." Declaring nothing → the generic floor still applies when the toggle is on. **Enforceable (platform executes) + accurate (app declared what's sensitive) + low burden.** ← update the creator spec / build guide.
  - **B3-app (BB):** implement the person-dictionary hook (contact names + personal details, NOT orgs) so redaction is exact when the buyer enables the toggle; pass a **prefer-on-device hint** for bulk scans (default on-device = zero egress). Because company/sector stay intact, the analytical scans keep working with the toggle on.
  - **Optional polish:** an app may mark a specific call "needs PII to function" so the broker can warn "this feature works better with redaction off" — a nicety, not required for the guarantee.
  - Headline (honest): *"even on your own cloud key, one toggle masks every identifier before it leaves — for any app."*
- **B4. Graceful generative degradation** — every AI feature off-state points to Freehold AI settings and states "everything else here works without it" (CopilotBar already does; audit InsightsTab / AiFill / forms for parity).
- **B5. Empty-VISUAL states (sparse import) — strictly count-driven, no category assumptions.**
  - **What an import actually populates (important — don't assume):** a contacts **+ messages** import populates contacts, the outreach funnel (messaged / responded / agreed-to-meet, derived from messages; `met` stays false), AND the **Meetings tab** — `buildMeetingRows` synthesises a *virtual seed* meeting for every `agreed_to_meet` contact ("Agreed — not scheduled"). So contacts-derived views (funnel stages, sector/seniority/function breakdowns, warmth, key contacts) AND the meetings list are alive on import. What's typically empty until the owner acts: **held meetings, opportunities, revenue/engagements** (opportunity *signals* also need the opt-in message scan).
  - **The gap:** category-dependent GRAPHS + zero-value KPIs render a bare/broken-looking shell — the opportunity pipeline funnel + opportunity breakdowns on the landing (MetricsTab), the revenue/engagement visuals (RevenueTab + the "Recognised" KPI), zero KPIs (Weighted pipeline $0, Win rate —), and any meeting metric that reads *held* count (0 while agreed/scheduled exist).
  - **Rule: each visual independently checks the EXACT dataset it renders and shows a guiding empty-state only when its own data is empty** — never a category-level guess ("meetings are empty") that's often false. Extend the dashboard's existing pattern (it already gates AI KPIs `repliesOwed > 0 &&` / `oppSignals > 0 &&` and gives lists an empty message): **keep the card shell, replace the empty chart / interactive filters / zero stats with a one-line guiding empty-state + a CTA to the tab that creates that record** ("No opportunities yet — log one from a meeting or the Opportunities tab and your pipeline funnel appears here →"). Never render a zero-height funnel, a phase-filter over nothing, a NaN%, or a stark $0 KPI with no guidance.
  - **Turn emptiness into onboarding:** the empty-states double as first-run guidance ("Log your first opportunity →"), so a sparse book reads as "rich network + clear next steps", not "broken".
  - **Scope to audit (gate each on ITS OWN count, verified against the data — not assumed):** MetricsTab (opp pipeline funnel + opp breakdowns → `opps.length`; any held-meeting metric → held count, NOT total meetings), RevenueTab (engagement charts → SoW count), DashboardTab (Progress activity bars + the three always-on KPIs → their own values). Contacts- and meeting-seed-derived visuals stay always-on (populated on import).

## Sequencing (revised after full-spec code reassessment)

Pre-flight code check found: **B3 already built + default-on** (Priya's finding was stale), **B2's "uncap" premise was wrong** (already deterministic; cap is on-device-only). Real remaining BB work is smaller than it looked.

**BB is DONE** — after code-verification, the only real gap was B5. The rest were already handled:
1. ~~**B1** YourDay deterministic brief~~ ✅ d305354.
2. ~~**B3** redaction~~ ✅ already built + default-on (name/email/phone, not company). Postal-address regex deliberately skipped (fragile, high over-redaction risk, rare in LinkedIn DMs — not worth degrading the scan).
3. ~~**B5** empty-visual states~~ ✅ 9a4fec0 (opp funnel + breakdowns on MetricsTab).
4. ~~**B2** warmth ranking~~ ✅ already deterministic + gated + framed; no change.
5. ~~**B4** generative degradation~~ ✅ AiFill hides cleanly; CopilotBar/InsightsTab/YourDay point to AI settings.

**Remaining = Freehold only (separate repo, needs decisions/validation before building):**
6. **Part A** platform activation flow — bigger build, HIGH blast radius, ⚠️ hardware-validate the model default first; own design pass + fresh-model review.
7. **Freehold polish** — FH-compat (browser pre-check), FH-price (⚠️ £499→£9,999 credit is a commerce/entitlement change, not copy — plus who-this-is-for + reframe), FH-jargon (copy).

**Meta-rule (learned the hard way):** every Priya finding + every "this is empty/needs X" assumption must be code-verified before building — the review over-/mis-stated redaction, warmth, and dashboard emptiness, and B2/B3/B4 turned out already-done. Verifying first saved building ~4 redundant items.
