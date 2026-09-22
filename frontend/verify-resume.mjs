/**
 * Drives the real /editor view in a browser with every /api call stubbed, and
 * checks that "resume" actually resumes.
 *
 * The point of stubbing rather than using the live backend is the middle of the
 * run: the whole bug is that an interrupted job must pick up from the server's
 * recorded state, so the check has to be able to hand the editor a half-finished
 * job and watch which moments it touches next.
 *
 * Run: node verify-resume.mjs   (needs a `npm run dev` server on :3000)
 */

import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const LABELS = [
  "The 2 a.m. spiral",
  "Clicking a suspicious link",
  "Catching a phishing site",
];

// A real single-frame 32x32 MP4, because an empty body makes the <video> element
// fire onError — and the editor answers that with a "Couldn't load the saved
// take" line in the thread, which would look like the AI talking unasked when it
// is really just this stub failing to be a video.
const STUB_MP4 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMNbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAGwbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABW21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAARtzdGJsAAAAt3N0c2QAAAAAAAAAAQAAAKdhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAALWF2Y0MBQsAK/+EAFmdCwAraJbARAAADAAEAAAMAAg8SJqABAARozg/IAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAEzgAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAEAAEAAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAAmcAAAABAAAAFHN0Y28AAAAAAAAAAQAAAz0AAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAxAAAACGZyZWUAAAJvbWRhdAAAAlMGBf//T9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjMgMDQ4MGNiMCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0xIGRlYmxvY2s9MDowOjAgYW5hbHlzZT0wOjAgbWU9ZGlhIHN1Ym1lPTAgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MCBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTAgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9MCB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD0wIGludHJhX3JlZnJlc2g9MCByYz1jcmYgbWJ0cmVlPTAgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MACAAAAADGWIhDomKAAJAsnXXg==";

const moment = (i, status) => ({
  id: `mom_${i}`,
  videoId: "vid_test",
  start: (i - 1) * 10,
  end: (i - 1) * 10 + 9,
  label: LABELS[i - 1] ?? `Moment ${i}`,
  reason: "Stands alone as a hook.",
  status,
  score: 100 - i * 10,
});

const clip = (momentId, id, posted = false) => ({
  id,
  momentId,
  videoId: "vid_test",
  title: `Cut from ${momentId}`,
  caption: "caption",
  hashtags: ["#hook"],
  tags: ["hook"],
  start: 0,
  end: 9,
  posted,
  ...(posted ? { postUrl: `https://youtube.com/shorts/${id}`, postId: `post_${id}` } : {}),
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function scenario({
  title,
  mode,
  moments,
  clips,
  text = "resume",
  projectId = "proj_test",
  videoId = "vid_test",
  threads = {},
  steps = null,
}) {
  console.log(`\n${title}`);

  const state = {
    moments: moments.map((m) => ({ ...m })),
    clips: clips.map((c) => ({ ...c })),
    // One array per chat thread, keyed by project — the isolation the editor is
    // supposed to guarantee, modelled so a leak shows up as rows in the wrong
    // list rather than as a subtle UI difference.
    threads: JSON.parse(JSON.stringify(threads)),
    projects: [],
    uploads: [],
    decides: [],
    posts: [],
    patches: [],
    llm: [],
    requests: [],
  };

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();

  // Capture every label the progress loader shows, in order, along with which
  // panel was open at the time. Polling would miss the short-lived stages, so
  // watch the DOM instead.
  await page.addInitScript(() => {
    window.__loader = [];
    const record = () => {
      const el = document.querySelector(".cut__chat-progress-top span");
      const label = el && el.textContent ? el.textContent.trim() : null;
      const panel = document.querySelector("section.cut__panel");
      const entry = label ? { label, panel: panel ? panel.getAttribute("aria-label") : null } : null;
      const last = window.__loader[window.__loader.length - 1];
      if (entry && (!last || last.label !== entry.label || last.panel !== entry.panel)) {
        window.__loader.push(entry);
      }
    };
    const observer = new MutationObserver(record);
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  });

  // The editor restores its session straight from localStorage — no auth call.
  await page.addInitScript(() => {
    localStorage.setItem(
      "encore.user",
      JSON.stringify({ id: "u_test", name: "Verifier", email: "verify@example.com" }),
    );
    localStorage.setItem("encore.accessToken", "test-token");
  });

  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  /** Append a row to the thread it names, and hand it back as the response. */
  const record = (threadId, role, text) => {
    const rows = (state.threads[threadId] ??= []);
    const row = {
      id: `msg_${threadId}_${rows.length}`,
      role,
      text,
      createdAt: Date.now(),
    };
    rows.push(row);
    return row;
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    state.requests.push(`${method} ${path}`);

    // --- the half-finished job the editor is handed -------------------------
    if (path === `/api/moments/${videoId}`) return json(route, state.moments);
    if (path.endsWith("/decide") && path.startsWith("/api/moments/")) {
      const id = decodeURIComponent(path.split("/")[3]);
      state.decides.push(id);
      const found = state.moments.find((m) => m.id === id);
      const decision = request.postDataJSON().decision;
      if (found) found.status = decision === "accept" ? "accepted" : "rejected";
      const created = clip(id, `clip_${id}`);
      if (decision === "accept" && !state.clips.some((c) => c.id === created.id)) state.clips.push(created);
      return json(route, found ?? {});
    }
    if (path === `/api/clips/${videoId}` && method === "GET") return json(route, state.clips);
    if (path === "/api/clips" && method === "POST") {
      const body = request.postDataJSON();
      const created = { ...clip(body.momentId ?? "mom_x", `clip_new_${state.clips.length}`), ...body, id: `clip_new_${state.clips.length}` };
      state.clips.push(created);
      return json(route, created);
    }
    if (path.startsWith("/api/clips/") && method === "PATCH") {
      const id = decodeURIComponent(path.split("/")[3]);
      state.patches.push(id);
      return json(route, state.clips.find((c) => c.id === id) ?? {});
    }

    // --- publishing --------------------------------------------------------
    if (path.endsWith("/check") && path.startsWith("/api/posts/")) {
      return json(route, {
        postId: "post_x",
        clipId: "clip_x",
        views: 0,
        median: 4100,
        verdict: "pending",
        note: "Live for less than a minute.",
      });
    }
    if (path.startsWith("/api/posts/") && method === "POST") {
      const id = decodeURIComponent(path.split("/")[3]);
      state.posts.push(id);
      const found = state.clips.find((c) => c.id === id);
      if (found) Object.assign(found, { posted: true, postId: "post_x", postUrl: "https://youtube.com/shorts/x" });
      return json(route, { postId: "post_x", postUrl: "https://youtube.com/shorts/x" });
    }

    // --- the LLM: resume must never reach this -----------------------------
    // Both message routes write into the thread the caller named, so a row that
    // ends up in the wrong project's list is a real leak rather than a fixture.
    if (path === "/api/messages" && method === "POST") {
      const body = request.postDataJSON();
      state.llm.push(body);
      return json(route, record(body.threadId, "mind", "stub reply"));
    }
    if (path === "/api/messages/events") {
      const body = request.postDataJSON();
      return json(route, record(body.threadId, body.role ?? "mind", body.text));
    }
    if (path.startsWith("/api/messages/") && method === "GET") {
      const id = decodeURIComponent(path.split("/")[3]);
      return json(route, state.threads[id] ?? []);
    }

    // --- upload (chunked straight to the backend, not through the proxy) ----
    if (path === "/api/videos/chunked/start") return json(route, { uploadId: "up_1" });
    if (path.includes("/chunked/") && path.endsWith("/chunk")) return json(route, { ok: true });
    if (path.includes("/chunked/") && path.endsWith("/finish")) {
      state.uploads.push("up_1");
      return json(route, { id: "vid_new", name: "fresh.mp4", duration: 4, createdAt: Date.now() });
    }
    if (path === "/api/videos" && method === "POST") {
      state.uploads.push("direct");
      return json(route, { id: "vid_new", name: "fresh.mp4", duration: 4, createdAt: Date.now() });
    }

    // --- ambient state -----------------------------------------------------
    if (path === "/api/projects" && method === "POST") {
      // The real route mints an id when the payload carries none, and updates in
      // place when it does — mirroring that here is what makes "did the editor
      // create one project or two?" a question the fixture can answer.
      const body = request.postDataJSON();
      const id = body.id ?? `proj_new_${state.projects.length + 1}`;
      if (!state.projects.includes(id)) state.projects.push(id);
      return json(route, { ...body, id, createdAt: Date.now(), updatedAt: Date.now() });
    }
    if (path === `/api/projects/${projectId}`) {
      return json(route, {
        id: projectId,
        name: "Test take",
        videoId,
        mediaUrl: null,
        status: "draft",
        takeIn: 0,
        takeOut: 60,
        takeSegments: [],
        clips: [],
        effects: { rotate: 0, flip: false, aspect: "16:9", aiOn: true, aiPermissionMode: mode, compareOn: false, captionTracks: [] },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        playhead: 0,
      });
    }
    if (path.startsWith("/api/projects")) return json(route, { id: "proj_test", ok: true });
    if (path === "/api/settings/ai") return json(route, { aiPermissionMode: mode, updatedAt: Date.now() });
    if (path === "/api/youtube/status") return json(route, { connected: true, oauthReady: true, channelTitle: "Test Channel" });
    // Video *metadata* only: four path segments and no more. `/api/videos/{id}/file`
    // is the media itself and must fall through to the mp4 below — answering it
    // with JSON makes the <video> fail, and the editor then reports that failure
    // in the thread, which looks like the AI talking unasked.
    if (path.startsWith("/api/videos/") && path.split("/").length === 4 && method === "GET") {
      const id = decodeURIComponent(path.split("/")[3]);
      return json(route, { id, name: "take", duration: 60, createdAt: Date.now() });
    }
    if (path.endsWith("/file")) {
      return route.fulfill({
        status: 200,
        contentType: "video/mp4",
        body: Buffer.from(STUB_MP4, "base64"),
      });
    }
    if (path.startsWith("/api/analysis")) return json(route, { videoId, stage: "complete", message: "Done.", updatedAt: Date.now(), done: true });
    // Any video with no fixture moments: a take that turned up nothing is one of
    // the states a fresh project can be in.
    if (path.startsWith("/api/moments/") && method === "GET") return json(route, []);
    return json(route, {});
  });

  await page.goto(projectId ? `${BASE}/editor?project=${projectId}` : `${BASE}/editor`, {
    waitUntil: "domcontentloaded",
  });

  /** Wait until nothing is in flight and the progress loader is gone. */
  const settle = async () => {
    let seen = -1;
    let quietSince = Date.now();
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (state.requests.length !== seen) {
        seen = state.requests.length;
        quietSince = Date.now();
      }
      const loaderUp = await page.evaluate(() => !!document.querySelector(".cut__chat-progress"));
      if (!loaderUp && Date.now() - quietSince > 1200) break;
      await page.waitForTimeout(150);
    }
  };

  /** Open the thread the way a creator would, and read what is in it. */
  const readThread = async () => {
    await page.click('button[title="Talk to Encore"]').catch(() => {});
    await page.waitForTimeout(400);
    return {
      chat: await page.evaluate(() => document.body.innerText),
      mind: await page.evaluate(() => document.querySelectorAll(".cut__bubble--mind").length),
      you: await page.evaluate(() => document.querySelectorAll(".cut__bubble--you").length),
    };
  };

  // The composer lives on the Mind tab, which is where a creator types — and the
  // panel the editor navigates away from once it starts cutting or publishing.
  await page.click('button[title="Talk to Encore"]');
  await page.waitForSelector('input[aria-label="Ask Encore"]', { timeout: 45000 });
  if (text) {
    await page.fill('input[aria-label="Ask Encore"]', text);
    await page.click('button[aria-label="Send"]');
  }

  // A scenario may drive the editor itself — Clear take, an import — before the
  // run is allowed to settle. It gets `readThread`/`settle` so it can look at the
  // thread on both sides of whatever it does.
  if (steps) await steps({ page, state, settle, readThread });

  await settle();
  const loader = await page.evaluate(() => window.__loader);
  const { chat, mind: mindBubbles, you: youBubbles } = await readThread();
  await browser.close();

  return { state, loader, chat, mindBubbles, youBubbles };
}

// ---------------------------------------------------------------------------

// Nothing may be said until the creator says something. These two load the same
// half-finished job and simply never type: whatever lands in the thread would be
// the editor talking to itself.
const silentPending = await scenario({
  title: "no prompt — moments sitting undecided",
  mode: "auto",
  moments: [moment(1, "pending"), moment(2, "pending")],
  clips: [],
  text: null,
});
check("thread is empty when nothing was asked", silentPending.mindBubbles === 0, `${silentPending.mindBubbles} AI bubble(s)`);
check("no greeting was appended on load", !/ENCORE/.test(silentPending.chat));
check("load said nothing but still read its state", silentPending.state.requests.some((r) => r.includes("/api/moments/vid_test")));

const silentDone = await scenario({
  title: "no prompt — work finished and posted",
  mode: "auto",
  moments: [moment(1, "accepted")],
  clips: [clip("mom_1", "clip_mom_1", true)],
  text: null,
});
check("a finished job does not announce itself", silentDone.mindBubbles === 0, `${silentDone.mindBubbles} AI bubble(s)`);
check("no verdict was volunteered", !/views\. (Flop|Hit|Mid)/.test(silentDone.chat));

const auto = await scenario({
  title: "auto mode, interrupted mid-accept (2 of 3 moments undecided, 1 cut already made)",
  mode: "auto",
  moments: [moment(1, "accepted"), moment(2, "pending"), moment(3, "pending")],
  clips: [clip("mom_1", "clip_mom_1")],
});
check("resumes only the moments that were still undecided", JSON.stringify(auto.state.decides) === '["mom_2","mom_3"]', `decided ${JSON.stringify(auto.state.decides)}`);
check("does not re-decide the moment that was already accepted", !auto.state.decides.includes("mom_1"));
check("publishes the best cut", auto.state.posts.length === 1, `posted ${JSON.stringify(auto.state.posts)}`);
check("never falls through to the LLM", auto.state.llm.length === 0, `${auto.state.llm.length} LLM call(s)`);
const autoLabels = auto.loader.map((l) => l.label);
check(
  "loader tracked the stages",
  autoLabels.some((l) => /Cutting/.test(l)) && autoLabels.some((l) => /Publishing/.test(l)),
  JSON.stringify(autoLabels),
);
check(
  "loader stayed on screen after the panel left Mind",
  auto.loader.some((l) => l.panel && l.panel !== "Mind panel"),
  JSON.stringify(auto.loader.map((l) => `${l.panel}: ${l.label}`)),
);
check("chat carries the published link", /Watch it here: https/.test(auto.chat));

const done = await scenario({
  title: "auto mode, nothing left in flight (all decided, cut already on YouTube)",
  mode: "auto",
  moments: [moment(1, "accepted"), moment(2, "accepted"), moment(3, "rejected")],
  clips: [clip("mom_1", "clip_mom_1", true)],
});
check("reports that nothing was in flight", /Nothing was left mid-flight/.test(done.chat));
check("publishes nothing twice", done.state.posts.length === 0, `posted ${JSON.stringify(done.state.posts)}`);
check("does not invent work for the LLM", done.state.llm.length === 0);
check("still showed the loader", done.loader.some((l) => /Checking where/.test(l.label)), JSON.stringify(done.loader.map((l) => l.label)));

const ask = await scenario({
  title: "ask mode, moments still undecided (auto approve off)",
  mode: "ask",
  moments: [moment(1, "pending"), moment(2, "pending")],
  clips: [],
});
check("stops at the decision the creator owes", ask.state.decides.length === 0, `decided ${JSON.stringify(ask.state.decides)}`);
check("publishes nothing without approval", ask.state.posts.length === 0);
check("does not reach the LLM", ask.state.llm.length === 0);
check("names how many moments are waiting", /2 moments are/.test(ask.chat));

const askDraft = await scenario({
  title: "ask mode, a cut is ready but unpublished",
  mode: "ask",
  moments: [moment(1, "accepted")],
  clips: [clip("mom_1", "clip_mom_1")],
  text: "continue",
});
check("recognises \"continue\" as a resume", /is cut and ready/.test(askDraft.chat));
check("offers the post instead of publishing it", askDraft.state.posts.length === 0);
check("does not reach the LLM", askDraft.state.llm.length === 0);

// ---------------------------------------------------------------------------

// A chat belongs to the project it was typed in. The thread used to be keyed by
// "video or project, whichever exists" and every load was merged into whatever
// was already on screen, so a second project in the same session read the first
// one's conversation. Clear take + a fresh import is exactly that move, and it
// is the only one a creator can make without leaving the editor: History and
// Home navigate, which remounts the view and starts it empty anyway.
const switched = await scenario({
  title: "Clear take, then import a new take (a second project in one session)",
  mode: "auto",
  projectId: "proj_a",
  videoId: "vid_a",
  threads: {
    proj_a: [
      { id: "a1", role: "mind", text: "PREVIOUS-PROJECT-LINE", createdAt: 1 },
      { id: "a2", role: "you", text: "previous question", createdAt: 2 },
    ],
  },
  moments: [],
  clips: [],
  text: null,
  steps: async ({ page, state, settle, readThread }) => {
    state.opened = await readThread();

    await page.click('button[title="The long take"]');
    await page.click('button:has-text("Clear take")');
    await page.waitForTimeout(400);
    state.cleared = await readThread();

    // The import is what creates the second project, and with it the new thread.
    await page.setInputFiles("input.cut__empty-file", {
      name: "fresh.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from(STUB_MP4, "base64"),
    });
    await settle();
  },
});

check("a project's own chat loads with the project", /PREVIOUS-PROJECT-LINE/.test(switched.state.opened.chat));
check(
  "Clear take empties the thread on screen",
  switched.state.cleared.mind === 0 && switched.state.cleared.you === 0,
  `${switched.state.cleared.mind} AI / ${switched.state.cleared.you} you`,
);
check(
  "the new project opens on an empty thread",
  switched.mindBubbles === 0 && switched.youBubbles === 0,
  `${switched.mindBubbles} AI / ${switched.youBubbles} you`,
);
check("no line followed the take into the new project", !/PREVIOUS-PROJECT-LINE/.test(switched.chat));
check(
  "the import created the new project",
  switched.state.projects.length > 0,
  `created ${JSON.stringify(switched.state.projects)}`,
);
check(
  "the old project's thread is untouched",
  (switched.state.threads.proj_a ?? []).length === 2,
  `${(switched.state.threads.proj_a ?? []).length} rows`,
);
check(
  "the new project's thread has nothing in it",
  (switched.state.threads.proj_new_1 ?? []).length === 0,
  `${(switched.state.threads.proj_new_1 ?? []).length} rows`,
);
check(
  "nothing was filed under the pre-project thread",
  !switched.state.requests.some((r) => r.includes("/api/messages/notebook")) &&
    !switched.state.threads.notebook,
);
check("the import was not narrated in the chat", !/Uploaded /.test(switched.chat));

// Cold entry: /editor with no project at all, the way the nav and the "New
// project" button open it. There is no thread yet, so nothing may be read back
// — loading the pre-project thread here is what put someone else's conversation
// in front of a brand-new project.
const cold = await scenario({
  title: "cold /editor with no project (nothing to read yet)",
  mode: "auto",
  projectId: null,
  videoId: "vid_none",
  moments: [],
  clips: [],
  text: null,
});

check("a cold editor reads no thread at all", !cold.state.requests.some((r) => r.startsWith("GET /api/messages/")), JSON.stringify(cold.state.requests.filter((r) => r.includes("/api/messages"))));
check("a cold editor shows an empty thread", cold.mindBubbles === 0 && cold.youBubbles === 0, `${cold.mindBubbles} AI / ${cold.youBubbles} you`);
check("nothing is said on arrival", !/ENCORE/.test(cold.chat));

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
