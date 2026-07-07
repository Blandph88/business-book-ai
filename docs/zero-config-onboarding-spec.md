# Zero-config onboarding + deterministic-first — build spec

## Priya resolution scorecard (single source of truth)

The full Priya review, mapped to status. ✅ done · 🟡 partial · 🔴 open.

| # | Priya's turn-off | Status | Where |
|---|---|---|---|
| BB-YourDay | Brief renders nothing until AI is set up | ✅ | commit d305354 — deterministic brief |
| BB-datateloss | Scan remount nukes open forms; opp re-spot clobbers | ✅ | 7d372bd |
| BB-stale/currency/SoW/funnel | YourDay stale cache; currency reload; SoW dangling link; Met/Agreed inversion | ✅ | 45ee8ba |
| BB-copilot | Concurrent gen; companion/crisis gate bypass; bad tool args | ✅ | f788718 |
| BB-emptygraphs | **Opportunity / engagement / held-meeting graphs + zero KPIs look broken on a sparse import** (contacts + meeting seeds ARE populated) | 🔴 | **B5 below** |
| BB-warmth | Barren/slow first-run ranking (top-N cap, AI-blocked) | 🔴 | B2 |
| BB-redaction | Cloud-scan redaction is opt-in on a confidentiality product | 🔴 | B3 — broker provides the OPT-IN redaction mechanism + user override; apps declare per call (BB opts in for the scan, not for drafting). NOT a forced floor — PII-dependent apps keep PII |
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
   - **Primary one-click:** "Turn on the private assistant" → downloads the **most capable in-browser model the device can run** (7–8B via WebGPU — Qwen2.5-7B / Llama-3.1-8B, **not** Nano), warms in the background with progress. ~10s of clicks, no install.
   - **Secondary "Set it up properly →":** reveals the full tiers — Chrome built-in (instant/basic), local runtime (Ollama/LM Studio, 70B+), BYOK cloud (own key).
   - Device-aware picker: WebGPU present → best-fitting model by RAM (step down 7B→3B→1.5B); no WebGPU but Nano → offer Nano labelled "basic/fast"; else guide to desktop Chrome/Edge.
   - Shown **once**; afterwards AI config lives in Settings, never re-gated.
3. **Upgrade ladder (kills the ceiling risk permanently).** Generalise the existing `offerUpgradeIfOnNano` nudge into a tier ladder: honest in-product tier label ("Built-in model — fast, fully private, good for most tasks") + a gentle non-nagging nudge to a local 70B or own key for sharper output. Reaching the higher ceiling is *her choice* — on-brand for "you control your AI."

## Part B — Business Book app: deterministic-first (already mostly there)

The dashboard/metrics/funnel/rankings already render with **no AI** (no `aiReady` gate). Remaining gaps:

- **B1. `YourDay` deterministic brief.** Today it hides entirely without AI (`if (!aiReady) return null`). It already receives every signal as props (agenda / hotOpps / stale / aging / owed / latent). Render those as a **structured, readable brief** with AI off; when AI is ready, the prose narration enhances it (shown instantly as the base, swapped when the model returns — no empty spinner). Reconnect *list* is deterministic; the per-item *Draft* button stays AI-gated (points to AI settings when off). **← THIS COMMIT.**
- **B2. Instant, uncapped deterministic warmth ranking.** Rank *everyone* immediately by the deterministic funnel-stage + recency signal (`warmth()` in compute.ts — already model-free), no top-N cap. The AI *sentiment* pass then enriches scores in the background (the warmth banner already streams progressive updates). Initial ranking must never block the view; the slow per-message pass prioritises warmest/most-recent first.
- **B3. Redaction is OPT-IN, app-declared per call — a FREEHOLD BROKER mechanism, NOT a forced floor.** Egress physically happens in the broker (`byok.ts` does the `fetch`); BB is sealed and can't send or pick the tier (`AiBackendPref`). The broker already owns egress policy (`AiConsentModal` consent; `capabilityPrefs` sealed-vs-byok). BUT redaction must **not** be default-on-everything: many apps legitimately NEED PII to be useful (a letter-writer needs the name; a contract app needs the parties). Whether PII is needed is **task-specific, and only the app knows** — so the app opts in per call:
  - **B3-platform (Freehold broker):** provide the **redaction/tokenize mechanism in `byok.ts`** (detokenize the response locally). Each `freehold.request("ai", …)` carries a redaction directive + optional entity dictionary; the broker redacts only when asked. Plus a **user-level override** in prefs: *"Let apps decide"* (default — follow each call's directive) vs *"Always redact identifiers before cloud"* (the cautious risk-partner setting — forces redaction even where the app wanted PII, accepting that some features degrade). The broker **surfaces per call** what happened ("names redacted before send" vs "sent as-is — this feature needs them"). NOT a floor the platform imposes; a control the app requests and the user can tighten.
  - **B3-app (BB):** opt IN to redaction on the **warmth/sentiment scan** (it scores message tone — names are incidental; "Hi [NAME]…" scores identically), supplying its **entity dictionary** (contacts/orgs). Do NOT redact **reconnect-drafting** (needs the real name). So it's per-capability even within BB. Also pass a **prefer-on-device hint** for bulk scans → default on-device = zero egress; only if the user chose cloud does the (opted-in) scan redaction apply. This satisfies Priya's "confidential by default" for the scan WITHOUT breaking any PII-dependent feature or app.
  - Headline still holds, honestly: *"even on your own key, apps can have the broker scrub identifiers first — and you can force it for everything."*
- **B4. Graceful generative degradation** — every AI feature off-state points to Freehold AI settings and states "everything else here works without it" (CopilotBar already does; audit InsightsTab / AiFill / forms for parity).
- **B5. Empty-VISUAL states (sparse import) — strictly count-driven, no category assumptions.**
  - **What an import actually populates (important — don't assume):** a contacts **+ messages** import populates contacts, the outreach funnel (messaged / responded / agreed-to-meet, derived from messages; `met` stays false), AND the **Meetings tab** — `buildMeetingRows` synthesises a *virtual seed* meeting for every `agreed_to_meet` contact ("Agreed — not scheduled"). So contacts-derived views (funnel stages, sector/seniority/function breakdowns, warmth, key contacts) AND the meetings list are alive on import. What's typically empty until the owner acts: **held meetings, opportunities, revenue/engagements** (opportunity *signals* also need the opt-in message scan).
  - **The gap:** category-dependent GRAPHS + zero-value KPIs render a bare/broken-looking shell — the opportunity pipeline funnel + opportunity breakdowns on the landing (MetricsTab), the revenue/engagement visuals (RevenueTab + the "Recognised" KPI), zero KPIs (Weighted pipeline $0, Win rate —), and any meeting metric that reads *held* count (0 while agreed/scheduled exist).
  - **Rule: each visual independently checks the EXACT dataset it renders and shows a guiding empty-state only when its own data is empty** — never a category-level guess ("meetings are empty") that's often false. Extend the dashboard's existing pattern (it already gates AI KPIs `repliesOwed > 0 &&` / `oppSignals > 0 &&` and gives lists an empty message): **keep the card shell, replace the empty chart / interactive filters / zero stats with a one-line guiding empty-state + a CTA to the tab that creates that record** ("No opportunities yet — log one from a meeting or the Opportunities tab and your pipeline funnel appears here →"). Never render a zero-height funnel, a phase-filter over nothing, a NaN%, or a stark $0 KPI with no guidance.
  - **Turn emptiness into onboarding:** the empty-states double as first-run guidance ("Log your first opportunity →"), so a sparse book reads as "rich network + clear next steps", not "broken".
  - **Scope to audit (gate each on ITS OWN count, verified against the data — not assumed):** MetricsTab (opp pipeline funnel + opp breakdowns → `opps.length`; any held-meeting metric → held count, NOT total meetings), RevenueTab (engagement charts → SoW count), DashboardTab (Progress activity bars + the three always-on KPIs → their own values). Contacts- and meeting-seed-derived visuals stay always-on (populated on import).

## Sequencing (full Priya resolution)

1. ~~**B1** YourDay deterministic brief~~ ✅ done (d305354).
2. **B5** empty-category states — small/medium, removes the "looks broken" first impression on a contacts-only import. Highest delight-per-effort left in BB. ← next
3. **B2** instant uncapped warmth ranking + **B3** redaction-on-by-default — medium; "alive rankings" + "confidential by default" (a sales headline).
4. **B4** generative-degradation parity audit (InsightsTab / AiFill / forms) — quick.
5. **Part A** platform activation flow (one-click capable model + "set up properly" + tier ladder + demo high-anchor) — the bigger build; retires FH-aiwall + X-onramp.
6. **Freehold listing polish** — FH-compat (pre-buy browser check), FH-price (who-this-is-for + £499→£9,999 credit + reframe "all sales final"), FH-jargon (plain-English copy + trust line).

After 2–4, every 🔴 BB item is closed; after 5–6, the Freehold items. That's the full Priya resolution.
