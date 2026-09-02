// verify-editor.mjs — drives the Encore cut-room editor to verify the 8-part
// change set (empty-state upload canvas, New-project upload, cuts empty text,
// rename, aspect ratio, timeline scrub, take/cut tracks, shrink/expand).
//
//   node verify-editor.mjs
//
// Requires the dev server on :3000 and the bundled Chromium.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const OUT = "C:/Users/USER/Documents/Encore/ui-review";
const BASE = "http://localhost:3000";

mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const num = (n) => (typeof n === "number" ? n.toFixed(0) : String(n));

// Prefer a system browser (Edge ships on Win11, no download) and fall back to
// Chrome, then to Playwright's bundled Chromium if one was installed.
async function launchBrowser() {
  const attempts = [{ channel: "msedge" }, { channel: "chrome" }, {}];
  let lastErr;
  for (const opt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opt });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
const browser = await launchBrowser();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 950 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(60000);

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") {
    const loc = m.location?.();
    consoleErrors.push(m.text() + (loc?.url ? ` @ ${loc.url}` : ""));
  }
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const badResponses = [];
page.on("response", (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
});
page.on("requestfailed", (req) => {
  badResponses.push(`FAILED ${req.url()} (${req.failure()?.errorText ?? "?"})`);
});

// Seed the gate, then open the editor.
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.setItem(
    "encore.user",
    JSON.stringify({ name: "Verifier", email: "v@example.com", picture: "" }),
  );
});
await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".cutroom", { timeout: 45000 });

// ---------- (A) empty-state upload canvas before upload ----------
// No video frame yet, and the monitor shows the click/drop upload canvas
// (the skill's empty state) rather than a bare black stage.
const frameBefore = await page.$(".cut__frame");
const emptyCanvas = await page.$(".cut__empty");
const emptyCopy = await page
  .$eval(".cut__empty-hit", (el) => el.textContent.trim())
  .catch(() => "");
check("A: no video frame before upload", frameBefore === null);
check("A: empty-state upload canvas rendered", emptyCanvas !== null);
check(
  "A: empty state invites upload",
  /click to upload/i.test(emptyCopy),
  `text="${emptyCopy}"`,
);
await page.screenshot({ path: `${OUT}/editor-01-blank.png` });

// ---------- (B) New project button ----------
const newprojStrong = await page
  .$eval(".cut__newproj strong", (el) => el.textContent.trim())
  .catch(() => null);
const newprojPlus = await page
  .$eval(".cut__newproj-plus", (el) => el.textContent.trim())
  .catch(() => null);
check("B: bold 'New project' label", newprojStrong === "New project", `got "${newprojStrong}"`);
check("B: plus glyph present", newprojPlus === "+", `got "${newprojPlus}"`);

// ---------- (C) Cuts empty-state text ----------
const cutsTool = page.locator(".cut__tool", { hasText: /cuts/i }).first();
if (await cutsTool.count()) await cutsTool.click();
const hint = await page
  .$eval(".cut__hint", (el) => el.textContent.trim())
  .catch(() => null);
check("C: cuts empty hint", hint === "Nothing to show yet", `got "${hint}"`);

// ---------- (D) rename (pre-upload) ----------
await page.click(".cut__project");
await page.fill(".cut__project-input", "Draft One");
await page.press(".cut__project-input", "Enter");
const projName1 = await page
  .$eval(".cut__project", (el) => el.textContent.trim())
  .catch(() => null);
check("D: rename commits (pre-upload)", projName1 === "Draft One", `got "${projName1}"`);

// ---------- upload a stand-in file ----------
// return to the Take tab — the upload input only exists there
const takeTool = page.locator(".cut__tool", { hasText: /take/i }).first();
if (await takeTool.count()) await takeTool.click();
await page.waitForSelector(".cut__file", { state: "attached", timeout: 8000 });
const buf = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
await page.setInputFiles(".cut__file", {
  name: "my-long-take.mp4",
  mimeType: "video/mp4",
  buffer: buf,
});
await page.waitForSelector(".cut__frame", { timeout: 8000 }).catch(() => {});
await page.waitForSelector(".cut__block--take", { timeout: 10000 }).catch(() => {});
// clips are cut ~1.4s after upload (busy period) — wait for them so (G) is stable
await page.waitForSelector(".cut__block--clip", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);

const frameAfter = await page.$(".cut__frame");
check("A/E: frame present after upload", frameAfter !== null);

// ---------- (E) aspect ratio + no collapse ----------
async function frameBox() {
  return page.$eval(".cut__frame", (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
}
async function assertRatio(id, target, label) {
  await page.selectOption(".cut__aspect select", id);
  await page.waitForTimeout(180);
  const b = await frameBox();
  const ar = b.h > 0 ? b.w / b.h : 0;
  check(
    `E: frame not collapsed (${label})`,
    b.w > 40 && b.h > 40,
    `w=${num(b.w)} h=${num(b.h)}`,
  );
  check(
    `E: ratio ≈ ${label}`,
    Math.abs(ar - target) < 0.12,
    `ar=${ar.toFixed(3)} target=${target.toFixed(3)}`,
  );
}
await assertRatio("16:9", 16 / 9, "16:9");
await page.screenshot({ path: `${OUT}/editor-02-16x9.png` });
await assertRatio("9:16", 9 / 16, "9:16");
await page.screenshot({ path: `${OUT}/editor-03-9x16.png` });
await assertRatio("4:3", 4 / 3, "4:3");
await assertRatio("21:9", 21 / 9, "21:9");
await page.selectOption(".cut__aspect select", "16:9");
await page.waitForTimeout(150);

// ---------- (D/G) rename after upload updates the take block ----------
await page.click(".cut__project");
await page.fill(".cut__project-input", "Final Cut");
await page.press(".cut__project-input", "Enter");
const projName2 = await page
  .$eval(".cut__project", (el) => el.textContent.trim())
  .catch(() => null);
check("D: rename commits (post-upload)", projName2 === "Final Cut", `got "${projName2}"`);
const takeLabel = await page
  .$eval(".cut__block--take", (el) => el.textContent.trim())
  .catch(() => null);
check("G/D: take block shows project name", takeLabel === "Final Cut", `got "${takeLabel}"`);

// ---------- (G) take = full width; cuts = actual cuts ----------
const innerW = await page.$eval(".cut__timeline-inner", (el) => el.getBoundingClientRect().width);
const takeW = await page.$eval(".cut__block--take", (el) => el.getBoundingClientRect().width);
check("G: take block spans full timeline", Math.abs(takeW - innerW) < 6, `take=${num(takeW)} inner=${num(innerW)}`);
const clipCount = await page.$$eval(".cut__block--clip", (els) => els.length);
check("G: cut blocks present", clipCount > 0, `clips=${clipCount}`);

// ---------- (F) keyboard seek ----------
const valueNow = () => page.$eval(".cut__ruler", (el) => Number(el.getAttribute("aria-valuenow")));
await page.focus(".cut__ruler");
await page.press(".cut__ruler", "Home");
check("F(kbd): Home → 0", (await valueNow()) === 0, `got ${await valueNow()}`);
await page.press(".cut__ruler", "ArrowRight");
check("F(kbd): ArrowRight → +1", (await valueNow()) === 1);
await page.press(".cut__ruler", "PageUp");
check("F(kbd): PageUp → +5", (await valueNow()) === 6, `got ${await valueNow()}`);
await page.press(".cut__ruler", "End");
const vEnd = await valueNow();
check("F(kbd): End → duration", vEnd >= 180, `got ${vEnd}`);
await page.press(".cut__ruler", "Home");
await page.waitForTimeout(120);

// ---------- (F) pointer seek on the ruler ----------
const innerBox = await page.$eval(".cut__timeline-inner", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, width: r.width };
});
const rulerBox = await page.$eval(".cut__ruler", (el) => {
  const r = el.getBoundingClientRect();
  return { y: r.y, h: r.height };
});
const pps = innerBox.width / 184;
const clickPx = 240;
await page.mouse.click(innerBox.x + clickPx, rulerBox.y + rulerBox.h / 2);
await page.waitForTimeout(120);
const vClick = await valueNow();
check("F(ruler): click seeks", Math.abs(vClick - clickPx / pps) < 3, `got ${vClick} expected≈${(clickPx / pps).toFixed(1)}`);

// ---------- (F) drag the playhead KNOB (the fix) ----------
await page.press(".cut__ruler", "Home");
await page.waitForTimeout(120);
const knob = await page.$(".cut__playhead-knob");
let knobPass = false;
if (knob) {
  const kb = await knob.boundingBox();
  const before = await valueNow();
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  await page.mouse.move(kb.x + 300, kb.y + kb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await valueNow();
  knobPass = after > before + 10;
  check("F(knob): dragging playhead knob scrubs", knobPass, `before=${before} after=${after}`);
} else {
  check("F(knob): knob element present", false, "no .cut__playhead-knob");
}

// ---------- (H) zoom in/out changes timeline width ----------
const w0 = await page.$eval(".cut__timeline-inner", (el) => el.getBoundingClientRect().width);
await page.click('button[aria-label="Zoom in"]');
await page.waitForTimeout(150);
const w1 = await page.$eval(".cut__timeline-inner", (el) => el.getBoundingClientRect().width);
check("H: zoom-in widens timeline", w1 > w0 + 5, `${num(w0)}→${num(w1)}`);
await page.click('button[aria-label="Zoom out"]');
await page.waitForTimeout(150);
const w2 = await page.$eval(".cut__timeline-inner", (el) => el.getBoundingClientRect().width);
check("H: zoom-out narrows timeline", w2 < w1 - 5, `${num(w1)}→${num(w2)}`);

// ---------- (H) shrink/expand toggle button ----------
const h0 = await page.$eval(".cut__timeline", (el) => el.getBoundingClientRect().height);
const toggle = page.locator('button[aria-label="Shrink timeline"], button[aria-label="Expand timeline"]').first();
await toggle.click();
await page.waitForTimeout(180);
const h1 = await page.$eval(".cut__timeline", (el) => el.getBoundingClientRect().height);
check("H: shrink/expand button changes height", Math.abs(h1 - h0) > 20, `${num(h0)}→${num(h1)}`);
// restore, then test the grip drag direction (the fix)
await page.locator('button[aria-label="Shrink timeline"], button[aria-label="Expand timeline"]').first().click();
await page.waitForTimeout(180);

// ---------- (H) grip drag: up must grow (the fix) ----------
// Dump the layout boxes first — the grip's box can run wider than its column,
// so we need to know where the side panel starts to grab a visible point.
const geo = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return `${sel}: (none)`;
    const r = el.getBoundingClientRect();
    return `${sel}: x=${r.x.toFixed(0)} w=${r.width.toFixed(0)} right=${r.right.toFixed(0)}`;
  };
  return [".cutroom", ".cut__stage", ".cut__timeline", ".cut__timeline-scroll", ".cut__timeline-inner", ".cut__side"]
    .map(pick)
    .join("\n    ");
});
console.log("  GEO:\n    " + geo);

const grip = await page.$(".cut__timeline-grip");
if (grip) {
  const gb = await grip.boundingBox();
  await page.evaluate(() => {
    const g = document.querySelector(".cut__timeline-grip");
    window.__gripDown = 0;
    window.__gripMove = 0;
    g.addEventListener("pointerdown", () => { window.__gripDown++; });
    g.addEventListener("pointermove", () => { window.__gripMove++; });
  });
  const gh0 = await page.$eval(".cut__timeline", (el) => el.getBoundingClientRect().height);
  // Grab the grip where it is actually visible — left of the side panel, as a
  // real user would. The box center can fall under the side panel overlay.
  const sideLeft = await page
    .$eval(".cut__side", (el) => el.getBoundingClientRect().left)
    .catch(() => Infinity);
  const rightBound = (Number.isFinite(sideLeft) ? sideLeft : gb.x + gb.width) - 16;
  const cx = Math.min(gb.x + gb.width / 2, rightBound);
  const cy = gb.y + gb.height / 2;
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return "none";
    const cls = typeof el.className === "string" ? el.className : "";
    return `${el.tagName}.${cls}`;
  }, { x: cx, y: cy });
  console.log(`  elementFromPoint(${num(cx)},${num(cy)}) = ${hit}`);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // discrete upward steps, letting React commit the height between moves
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(cx, cy - i * 18, { steps: 2 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const gh1 = await page.$eval(".cut__timeline", (el) => el.getBoundingClientRect().height);
  const counts = await page.evaluate(() => ({ down: window.__gripDown, move: window.__gripMove }));
  console.log(`  grip box x=${num(gb.x)} y=${num(gb.y)} w=${num(gb.width)} h=${gb.height.toFixed(1)} | grab x=${num(cx)} | pointerdown=${counts.down} pointermove=${counts.move}`);
  check("H(grip): drag up grows timeline", gh1 > gh0 + 10, `up: ${num(gh0)}→${num(gh1)}`);
} else {
  check("H(grip): grip present", false, "no .cut__timeline-grip");
}

await page.screenshot({ path: `${OUT}/editor-04-final.png`, fullPage: false });

// ---------- console cleanliness ----------
// A missing /favicon.ico is a browser-chrome request, not an app resource, and
// is not one of the change-set requirements — don't count it as an app error.
const appErrors = consoleErrors.filter((e) => !e.includes("/favicon.ico"));
check("No console/page errors", appErrors.length === 0, appErrors.slice(0, 4).join(" | "));
if (badResponses.length) console.log("BAD RESPONSES:\n  " + badResponses.join("\n  "));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ""}`);
}
await browser.close();
process.exit(failed.length ? 1 : 0);
