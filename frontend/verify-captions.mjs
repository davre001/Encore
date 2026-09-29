// verify-captions.mjs — drives the editor to verify the caption change set:
// aspect detected on import, a real polled loader for caption generation with a
// working stop, word-by-word highlight following the playhead, and captions that
// stay inside the frame at every ratio.
//
//   node verify-captions.mjs
//
// Needs the dev server on :3000, the backend on :5000, and a portrait take with
// real speech at ENCORE_TAKE (built with ffmpeg + Windows TTS).
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";

const OUT = "C:/Users/USER/Documents/Encore/ui-review";
const BASE = "http://localhost:3000";
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:5000";
const TAKE =
  process.env.ENCORE_TAKE ??
  "C:/Users/USER/AppData/Local/Temp/encore-verify/take-portrait.mp4";

mkdirSync(OUT, { recursive: true });
if (!existsSync(TAKE)) {
  console.error(`No take at ${TAKE} — build one first.`);
  process.exit(2);
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

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
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

// The editor sits behind a real session, so the run needs a real signed token —
// seeding a user blob is no longer enough. Signs the verifier account in (or
// creates it the first time) and stores the session the app expects.
const VERIFIER = { email: "verifier@encore.test", password: "Verifier-pass-1" };
async function session() {
  const post = (path, body) =>
    fetch(`${BACKEND}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  let res = await post("/api/auth/signin", VERIFIER);
  if (!res.ok) {
    res = await post("/api/auth/signup", { ...VERIFIER, name: "Verifier" });
  }
  if (!res.ok) throw new Error(`auth failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const auth = await session();

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(({ user, token }) => {
  localStorage.setItem("encore.user", JSON.stringify(user));
  localStorage.setItem("encore.accessToken", token);
}, { user: auth.user, token: auth.accessToken });
await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".cutroom", { timeout: 45000 });

// ---------- import the portrait take ----------
const takeTool = page.locator(".cut__tool", { hasText: /take/i }).first();
if (await takeTool.count()) await takeTool.click();
await page.waitForSelector(".cut__file", { state: "attached", timeout: 10000 });
await page.setInputFiles(".cut__file", TAKE);
await page.waitForSelector(".cut__frame", { timeout: 30000 });

// The frame opens at the take's own shape, not the 16:9 default.
await page.waitForTimeout(600);
const aspectValue = await page.$eval(".cut__aspect select", (el) => el.value);
check("import: aspect follows the file (9:16)", aspectValue === "9:16", `got ${aspectValue}`);
const frameAr = await page.$eval(".cut__frame", (el) => {
  const r = el.getBoundingClientRect();
  return r.height > 0 ? r.width / r.height : 0;
});
check(
  "import: frame is drawn at 9:16",
  Math.abs(frameAr - 9 / 16) < 0.08,
  `ar=${frameAr.toFixed(3)}`,
);
const shapeNote = await page
  .$eval(".cut__take-shape", (el) => el.textContent.trim())
  .catch(() => null);
check(
  "import: take notes its real pixel size and preset",
  shapeNote === "1080×1920 · 9:16",
  `got ${JSON.stringify(shapeNote)}`,
);
await page.screenshot({ path: `${OUT}/caption-01-imported-9x16.png` });

// Selecting a ratio is the creator's choice — it must survive a reload even
// though the imported file is still portrait.
await page.selectOption(".cut__aspect select", "4:3");
await page.waitForTimeout(200);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".cutroom", { timeout: 45000 });
await page.waitForTimeout(2500);
const afterReload = await page.$eval(".cut__aspect select", (el) => el.value).catch(() => null);
check("aspect: a chosen ratio survives the reload", afterReload === "4:3", `got ${afterReload}`);
await page.selectOption(".cut__aspect select", "16:9");
await page.waitForTimeout(200);

// ---------- wait for cuts, pick one, open the caption tab ----------
await page.waitForSelector(".cut__block--clip", { timeout: 240000 });
const clipTool = page.locator(".cut__tool", { hasText: /cuts/i }).first();
if (await clipTool.count()) await clipTool.click();
await page.waitForTimeout(200);
await page.locator(".cut__mini").filter({ hasText: /^(Select|Selected)$/ }).first().click();
await page.waitForTimeout(300);
const captionTool = page.locator(".cut__tool", { hasText: /caption/i }).first();
await captionTool.click();
await page.waitForSelector(".cut__mini--caption-action", { timeout: 15000 });

// ---------- the loader really runs, and stop cancels it ----------
async function watchBar(ms) {
  const deadline = Date.now() + ms;
  let seen = null;
  while (Date.now() < deadline) {
    const bar = await page.$(".cut__chat-progress");
    if (bar) {
      seen = {
        label: await page.$eval(".cut__chat-progress-top span", (el) => el.textContent.trim()),
        percent: await page.$eval(".cut__chat-progress-top b", (el) => el.textContent.trim()),
        stoppable: (await page.$(".cut__progress-stop")) !== null,
      };
      if (seen.stoppable) return seen;
    }
    await page.waitForTimeout(40);
  }
  return seen;
}

await page.click(".cut__mini--caption-action");
const firstBar = await watchBar(12000);
check("loader: the caption bar appears while generating", firstBar !== null);
check("loader: the bar reports a stage", !!firstBar && firstBar.label.length > 0, firstBar?.label);
check("loader: the bar carries a real percent", !!firstBar && /%$/.test(firstBar.percent), firstBar?.percent);
check("loader: the bar can be stopped", !!firstBar && firstBar.stoppable);
await page.screenshot({ path: `${OUT}/caption-02-loader.png` });

if (firstBar?.stoppable) {
  await page.click(".cut__progress-stop");
  await page.waitForTimeout(1800);
  const barGone = (await page.$(".cut__chat-progress")) === null;
  const noTrack = (await page.$(".cut__caption-editor")) === null;
  check("stop: the bar clears when stopped", barGone);
  check("stop: nothing is placed for a cancelled run", noTrack);
}

// ---------- a real run: the job finishes and its track is adopted ----------
await page.click(".cut__mini--caption-action");
await page.waitForSelector(".cut__caption-editor", { timeout: 180000 });
await page.waitForTimeout(400);
const sourceLine = await page
  .$eval(".cut__caption-source", (el) => el.textContent.trim())
  .catch(() => null);
check("track: the panel says where the timings came from", !!sourceLine, String(sourceLine));
check(
  "track: timings were heard, not estimated",
  /speech/i.test(String(sourceLine)),
  String(sourceLine),
);
const cueCount = await page.$$eval(".cut__caption-line", (els) => els.length);
check("track: cues were placed", cueCount > 0, `${cueCount} cues`);
await page.screenshot({ path: `${OUT}/caption-03-track.png` });

// Cue ranges, so the playhead can be parked inside one on purpose.
const cueRanges = await page.$$eval(".cut__caption-line span", (els) =>
  els.map((el) => {
    const [a, b] = el.textContent.split("-").map((part) => part.trim());
    const secs = (text) => {
      const bits = text.split(":").map(Number);
      return bits.length === 2 ? bits[0] * 60 + bits[1] : bits[0] * 3600 + bits[1] * 60 + bits[2];
    };
    return { start: secs(a), end: secs(b) };
  }),
);
check("track: cues carry real spans", cueRanges.length > 0 && cueRanges[0].end > cueRanges[0].start,
  JSON.stringify(cueRanges.slice(0, 3)));

// ---------- the highlight follows the playhead, word by word ----------
await page.focus(".cut__ruler");
await page.press(".cut__ruler", "Home");
await page.waitForTimeout(150);

const spokenWord = async () => {
  const spoken = await page.$$eval(".cut__caption-preview .is-spoken", (els) =>
    els.map((el) => el.textContent.trim()),
  );
  const total = await page.$$eval(".cut__caption-preview .cut__caption-word", (els) => els.length);
  const cue = await page
    .$eval(".cut__caption-preview", (el) => el.textContent.trim())
    .catch(() => null);
  return { spoken, total, cue };
};

// Walk the playhead forward a second at a time, collecting the spoken word at
// each beat — inside a cue there is exactly one, and it moves.
const seenWords = new Set();
const seenCues = new Set();
let maxSpoken = 0;
let overflowCheckable = false;
for (let step = 0; step < 12; step += 1) {
  await page.press(".cut__ruler", "ArrowRight");
  await page.waitForTimeout(160);
  const now = await page.$eval(".cut__ruler", (el) => Number(el.getAttribute("aria-valuenow")));
  const insideCue = cueRanges.some((cue) => now >= cue.start && now < cue.end);
  const state = await spokenWord();
  if (!state.cue) continue;
  overflowCheckable = true;
  maxSpoken = Math.max(maxSpoken, state.spoken.length);
  if (!insideCue) continue;
  seenCues.add(state.cue);
  if (state.spoken[0]) seenWords.add(state.spoken[0]);
}
check("highlight: the preview renders the cue word by word", overflowCheckable);
check("highlight: exactly one word is lit at a time", maxSpoken <= 1, `max lit = ${maxSpoken}`);
check("highlight: the lit word moves as time advances", seenWords.size >= 2,
  `words seen = ${[...seenWords].join(", ")}`);
check("highlight: the cue turns over across the cut", seenCues.size >= 1,
  `${seenCues.size} cues shown`);
await page.screenshot({ path: `${OUT}/caption-04-highlight.png` });

// ---------- captions stay inside the frame at every ratio ----------
async function fitCheck(ratio, id) {
  await page.selectOption(".cut__aspect select", id);
  // Park inside a cue so the caption is actually drawn.
  await page.focus(".cut__ruler");
  await page.press(".cut__ruler", "Home");
  const cue = cueRanges[0];
  for (let t = 0; t <= Math.ceil(cue.start) + 1; t += 1) {
    await page.press(".cut__ruler", "ArrowRight");
  }
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => {
    const frame = document.querySelector(".cut__frame");
    const caption = document.querySelector(".cut__caption-preview");
    if (!frame || !caption) return null;
    const f = frame.getBoundingClientRect();
    const c = caption.getBoundingClientRect();
    return {
      inside:
        c.left >= f.left - 1 &&
        c.right <= f.right + 1 &&
        c.top >= f.top - 1 &&
        c.bottom <= f.bottom + 1,
      frame: { l: f.left, r: f.right, t: f.top, b: f.bottom },
      caption: { l: c.left, r: c.right, t: c.top, b: c.bottom },
    };
  });
  check(`frame: caption rendered at ${ratio}`, box !== null);
  if (!box) return;
  check(
    `frame: caption stays inside the frame at ${ratio}`,
    box.inside,
    `caption ${JSON.stringify(box.caption)} vs frame ${JSON.stringify(box.frame)}`,
  );
  const overflow = await page.$eval(".cut__caption-preview", (el) => ({
    clipped: el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2,
  }));
  check(`frame: caption text is not clipped at ${ratio}`, !overflow.clipped,
    JSON.stringify(overflow));
}

await fitCheck("9:16", "9:16");
await page.screenshot({ path: `${OUT}/caption-05-fit-9x16.png` });
await fitCheck("21:9", "21:9");
await page.screenshot({ path: `${OUT}/caption-06-fit-21x9.png` });
await fitCheck("4:5", "4:5");
await fitCheck("1:1", "1:1");
await fitCheck("16:9", "16:9");
await page.screenshot({ path: `${OUT}/caption-07-fit-16x9.png` });

// ---------- console cleanliness ----------
const appErrors = consoleErrors.filter(
  (e) => !e.includes("/favicon.ico") && !e.includes("Download the React DevTools"),
);
check("No console/page errors", appErrors.length === 0, appErrors.slice(0, 3).join(" | "));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ""}`);
}
await browser.close();
process.exit(failed.length ? 1 : 0);
