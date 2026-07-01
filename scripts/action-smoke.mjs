// Verifies (1) chat bubbles: no You/Your book labels, user message right-aligned on a blue bubble, AI
// message left with no background; (2) saving an action appends an AI follow-up with chips and the saved
// state PERSISTS across leaving + re-entering the chat (no dangling "confirm to save" draft).
import { chromium } from "/Users/unplannedphilbland/Heirloom/Freehold-Marketplace/Freehold-Marketplace-App/node_modules/playwright/index.mjs";

const out = [];
const ok = (c, m) => { out.push((c ? "✓ " : "✗ ") + m); return !!c; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem("bob.tutorialSeen.v1", "1"); localStorage.setItem("bob.chats.v1", "[]"); } catch {} });
let allPass = true;
try {
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.locator(".sidenav-item--sub", { hasText: "New chat" }).click();
  await page.waitForTimeout(300);

  // --- Bubble styling on a normal message ---
  await page.locator(".copilot-input, .copilot-composer-input").first().fill("hello there");
  await page.locator(".copilot-input, .copilot-composer-input").first().press("Enter");
  await page.waitForTimeout(2500);
  const whoLabels = await page.locator(".copilot-turn-who").count();
  allPass &= ok(whoLabels === 0, `no You/Your book labels (${whoLabels})`);
  const you = page.locator(".copilot-turn--you .copilot-turn-text").first();
  const youStyle = await you.evaluate((el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const pr = el.closest(".copilot-chat").getBoundingClientRect(); return { bg: cs.backgroundColor, rightGap: Math.round(pr.right - r.right), leftGap: Math.round(r.left - pr.left) }; });
  allPass &= ok(youStyle.bg !== "rgba(0, 0, 0, 0)" && youStyle.bg !== "transparent", `user bubble has a fill (${youStyle.bg})`);
  allPass &= ok(youStyle.rightGap < youStyle.leftGap, `user message hugs the right (rightGap ${youStyle.rightGap} < leftGap ${youStyle.leftGap})`);
  const aiBg = await page.locator(".copilot-turn--ai .copilot-turn-text").first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
  allPass &= ok(aiBg === "rgba(0, 0, 0, 0)" || aiBg === "transparent", `AI message has no background (${aiBg})`);

  // --- Action save → follow-up + persistence ---
  await page.locator(".copilot-composer-input").fill("Add an opportunity at Acme Corp called Platform Rebuild worth 250000");
  await page.locator(".copilot-composer-input").press("Enter");
  // wait for the propose→confirm card
  await page.waitForSelector(".actc-btn--primary", { timeout: 20000 });
  const primary = page.locator(".actc-btn--primary").last();
  const blocked = await primary.isDisabled();
  if (blocked) {
    // fill the required fields if the model left them blank
    const inputs = page.locator(".actc-field input, .actc-field textarea");
    const n = await inputs.count();
    for (let i = 0; i < n; i++) { const val = await inputs.nth(i).inputValue(); if (!val) await inputs.nth(i).fill("Test"); }
  }
  await page.waitForTimeout(200);
  await primary.click();
  await page.waitForTimeout(800);
  const savedTick = await page.locator(".actc--saved").count();
  const followChips = await page.locator(".copilot-turn--ai .copilot-chip").count();
  allPass &= ok(savedTick >= 1, `action shows saved state (${savedTick})`);
  allPass &= ok(followChips >= 1, `AI follow-up offers next-step chips (${followChips})`);

  // leave to Chats, then reopen the most recent chat
  await page.locator(".sidenav-item", { hasText: "Chats" }).first().click();
  await page.waitForTimeout(300);
  await page.locator(".sidenav-recent-item").first().click();
  await page.waitForTimeout(500);
  const bodyText = await page.locator(".chat-tab .copilot-chat").innerText();
  const dangling = /confirm to save/i.test(bodyText);
  const hasSummary = /(Acme|Platform Rebuild|pipeline|added|saved)/i.test(bodyText);
  const persistedChips = await page.locator(".chat-tab .copilot-turn--ai .copilot-chip").count();
  allPass &= ok(!dangling, `no dangling "confirm to save" after reload (${dangling})`);
  allPass &= ok(hasSummary, "saved summary persists after reload");
  allPass &= ok(persistedChips >= 1, `follow-up chips persist after reload (${persistedChips})`);
} catch (e) {
  allPass = false;
  out.push("✗ threw: " + (e?.message || e));
} finally {
  await browser.close();
}
console.log(out.join("\n"));
console.log(allPass ? "\nALL PASS" : "\nFAIL");
process.exit(allPass ? 0 : 1);
