# Zero-config onboarding + deterministic-first — build spec

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
- **B3. Redaction on by default for any cloud/BYOK scan** (confidentiality product) — prefer on-device tiers for the scan so nothing leaves; opting *out* is the deliberate, explained choice. Doubles as a headline: "confidential by default."
- **B4. Graceful generative degradation** — every AI feature off-state points to Freehold AI settings and states "everything else here works without it" (CopilotBar already does; audit InsightsTab / AiFill / forms for parity).

## Sequencing

1. **B1** (YourDay deterministic brief) — smallest, kills the worst first-run impression. ← now
2. **B2** (instant uncapped warmth) + **B3** (redaction default) — medium; the confidentiality + "alive rankings" wins.
3. **Part A** activation flow (platform) — the bigger build; retires "setup wall" + "asked too early" in one move.
4. Freehold listing polish (who-this-is-for, £499→£9,999 credit, plain-English copy, compat pre-check).
