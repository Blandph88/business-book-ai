// IA smoke for the chat redesign: left sidebar, Chats/New chat/Recent chats, full-page Chat surface,
// self-contained starters (no Find/Ask/Do labels), history search, centred quick-palette modal, and the
// top-bar search changes (placeholder text, no Chats button, no ⌘K hint, "+" add-context circle).
import { chromium } from "/Users/unplannedphilbland/Heirloom/Freehold-Marketplace/Freehold-Marketplace-App/node_modules/playwright/index.mjs";

const URL = "http://localhost:5173";
const out = [];
const ok = (c, m) => { out.push((c ? "✓ " : "✗ ") + m); return !!c; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem("bob.tutorialSeen.v1", "1"); } catch {} });
let allPass = true;
try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // 1. Sidebar is on the LEFT and open by default.
  const box = await page.locator(".sidenav").boundingBox();
  allPass &= ok(box && box.x < 5, `sidebar docked left (x=${box ? Math.round(box.x) : "?"})`);

  // 2. Nav line icons render.
  const icons = await page.locator(".sidenav-item-icon svg").count();
  allPass &= ok(icons >= 6, `nav line icons render (${icons} svgs)`);

  // 3. Chats + New chat + Recent chats present.
  const hasChats = await page.locator(".sidenav-item", { hasText: "Chats" }).count();
  const hasNew = await page.locator(".sidenav-item--sub", { hasText: "New chat" }).count();
  const hasRecent = await page.locator(".sidenav-recent-head", { hasText: "Recent chats" }).count();
  allPass &= ok(hasChats === 1 && hasNew === 1 && hasRecent === 1, `Chats / New chat / Recent chats present (${hasChats}/${hasNew}/${hasRecent})`);

  // 4. New chat → full-page Chat surface with self-contained starters (no Find/Ask/Do labels).
  await page.locator(".sidenav-item--sub", { hasText: "New chat" }).click();
  await page.waitForTimeout(300);
  const chatTab = await page.locator(".chat-tab .copilot--fullpage.copilot-backdrop--inline, .chat-tab .copilot--fullpage").count();
  const starters = await page.locator(".copilot-starter").count();
  const groupLabels = await page.locator(".copilot-starter-group").count();
  const labels = await page.locator(".copilot-starter-label").allInnerTexts();
  const noEllipsis = labels.every((l) => !l.trim().endsWith("…") && !l.trim().endsWith("..."));
  allPass &= ok(chatTab >= 1, `full-page Chat surface mounts (${chatTab})`);
  allPass &= ok(starters === 6, `6 self-contained starters (${starters})`);
  allPass &= ok(groupLabels === 0, `no Find/Ask/Do labels on starters (${groupLabels})`);
  allPass &= ok(noEllipsis, "starters have no trailing …");

  // 5. Hero empty-state: logo + "What shall we work on?" + a plain "+" (no circle) with the tooltip.
  const heroTitle = (await page.locator(".copilot-hero-title").innerText().catch(() => "")).trim();
  const heroLogo = await page.locator(".copilot-hero-head .bb-logo").count();
  allPass &= ok(heroTitle === "What shall we work on?", `hero title ("${heroTitle}")`);
  allPass &= ok(heroLogo === 1, `hero shows the Business Book logo (${heroLogo})`);
  const plus = page.locator(".copilot-plus").first();
  const plusText = (await plus.innerText()).trim();
  const plusTip = await plus.getAttribute("title");
  allPass &= ok(plusText === "+", `add-context shows a plain "+" (got "${plusText}")`);
  allPass &= ok(/Add meeting notes/.test(plusTip || ""), `tooltip set ("${plusTip}")`);

  // 5b. The read-only AI-tier label is detected and shown in the field's bottom-right (no switcher).
  const tier = await page.locator(".copilot-field-foot .copilot-tier").count();
  const tierText = await page.locator(".copilot-field-foot .copilot-tier").innerText().catch(() => "");
  allPass &= ok(tier === 1 && tierText.trim().length > 0, `field tier label shows "${tierText.trim()}"`);

  // 6. Chats → history view with a search box.
  await page.locator(".sidenav-item", { hasText: "Chats" }).first().click();
  await page.waitForTimeout(300);
  const histSearch = await page.locator(".copilot-histsearch-input").count();
  allPass &= ok(histSearch === 1, `chats list has a search box (${histSearch})`);

  // 7. Top bar: placeholder text, no Chats button, no ⌘K hint.
  const searchText = (await page.locator(".topbar-search-text").innerText()).trim();
  const chatsBtn = await page.locator(".topbar-chats").count();
  const kbd = await page.locator(".topbar-search-kbd").count();
  allPass &= ok(searchText === "How can I help you today?", `top-bar placeholder text ("${searchText}")`);
  allPass &= ok(chatsBtn === 0, `top-bar Chats button removed (${chatsBtn})`);
  allPass &= ok(kbd === 0, `⌘K hint removed (${kbd})`);

  // 8. ⌘K opens a centred quick-palette modal (not inline).
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(200);
  const modal = page.locator(".copilot-backdrop:not(.copilot-backdrop--inline)");
  const justify = await modal.evaluate((el) => getComputedStyle(el).justifyContent).catch(() => "");
  allPass &= ok((await modal.count()) === 1 && justify === "center", `⌘K palette centred (count ${await modal.count()}, justify ${justify})`);
  // Modal: the old inline → send arrow is gone; clear-X present when there's a draft.
  await page.locator(".copilot-field-input").fill("test draft");
  await page.waitForTimeout(100);
  const oldArrow = await page.locator(".copilot-send").count();
  const clearX = await page.locator(".copilot-clear").count();
  allPass &= ok(oldArrow === 0 && clearX >= 1, `old → arrow gone, clear-X present (old ${oldArrow}, clear ${clearX})`);

  // 9. Enter in the modal escalates the draft into the full Chat surface (modal closes, conversation
  // appears on the Chat tab seeded with the draft).
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
  const modalGone = await page.locator(".copilot-backdrop:not(.copilot-backdrop--inline)").count();
  const onChatTab = await page.locator(".chat-tab .copilot-turn--you", { hasText: "test draft" }).count();
  allPass &= ok(modalGone === 0 && onChatTab >= 1, `Enter escalates draft into Chat surface (modal ${modalGone}, seeded turn ${onChatTab})`);
} catch (e) {
  allPass = false;
  out.push("✗ threw: " + (e?.message || e));
} finally {
  await browser.close();
}
console.log(out.join("\n"));
console.log(allPass ? "\nALL PASS" : "\nFAIL");
process.exit(allPass ? 0 : 1);
