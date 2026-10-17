import assert from "node:assert/strict";
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

async function uploadScenario(parallelChunks, retry = false, downlink) {
  let active = 0;
  let maximumActive = 0;
  const accepted = new Set();
  const attempts = new Map();
  const progress = [];
  const storage = { getItem: () => "token" };
  const exports = {};
  const context = vm.createContext({
    exports, process: { env: {} }, URLSearchParams, AbortController, DOMException,
    navigator: downlink ? { connection: { downlink } } : {},
    window: { setTimeout, clearTimeout, setInterval, clearInterval }, localStorage: storage, sessionStorage: storage,
    async fetch(input, init) {
      const url = new URL(input, "http://test");
      if (url.pathname.endsWith("/start")) {
        assert.equal(url.searchParams.get("size"), String(9 * 1024 * 1024));
        return Response.json({ uploadId: "test", parallelChunks });
      }
      if (url.pathname.endsWith("/chunk")) {
        const index = Number(url.searchParams.get("index"));
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        attempts.set(index, (attempts.get(index) || 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, (3 - index) * 10)));
        active -= 1;
        if (retry && index === 1 && attempts.get(index) === 1) {
          return Response.json({ detail: "Temporary failure" }, { status: 503 });
        }
        accepted.add(index);
        return Response.json({ ok: true });
      }
      assert.equal(accepted.size, downlink < 2 ? 18 : downlink >= 5 ? 3 : 9, "Finish must wait for every chunk");
      assert.equal(active, 0);
      return Response.json({ id: "vid_test" });
    },
  });
  vm.runInContext(compiled, context);
  const result = await exports.uploadVideo(
    new File([new Uint8Array(9 * 1024 * 1024)], "test.mp4"),
    (value) => progress.push(value),
  );
  assert.equal(result.id, "vid_test");
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
  return { maximumActive, attempts };
}

test("upload sends three chunks concurrently and retries temporary failures", async () => {
  const result = await uploadScenario(true, true);
  assert.equal(result.maximumActive, 3);
  assert.equal(result.attempts.get(1), 2);
});

test("older backend uses sequential upload safely", async () => {
  const result = await uploadScenario(false);
  assert.equal(result.maximumActive, 1);
});

test("slow connections use smaller chunks and only two parallel transfers", async () => {
  assert.equal((await uploadScenario(true, false, 1)).maximumActive, 2);
});

test("fast connections retain large chunks to reduce round trips", async () => {
  assert.equal((await uploadScenario(true, false, 10)).maximumActive, 3);
});

test("network failures wait one minute, warn, then show connection error after two minutes and recover", async () => {
  let now = 0;
  let monitor;
  let attempts = 0;
  const notices = [];
  const exports = {};
  const context = vm.createContext({
    exports, process: { env: {} }, TypeError, DOMException,
    Date: { now: () => now },
    window: {
      setInterval: (callback) => { monitor = callback; return 1; },
      clearInterval: () => {},
      setTimeout: (callback) => { queueMicrotask(callback); return 1; },
    },
  });
  vm.runInContext(compiled, context);
  const value = await exports.withNetworkRecovery(async () => {
    attempts += 1;
    if (attempts === 1) {
      assert.deepEqual(notices, []);
      throw new TypeError("Failed to fetch");
    }
    now = attempts === 2 ? 60_000 : 120_000;
    monitor();
    if (attempts === 2) throw new TypeError("Failed to fetch");
    return "recovered";
  }, { onNotice: (notice) => notices.push(notice) });
  assert.equal(value, "recovered");
  assert.deepEqual(notices, ["This is taking longer than usual.", "Connection error, check your network.", null]);
});

test("reconnecting publication polls the same backend job instead of uploading twice", async () => {
  const calls = [];
  let dropped = false;
  const exports = {};
  const context = vm.createContext({
    exports, process: { env: {} }, URLSearchParams, AbortController, DOMException, TypeError,
    window: { setTimeout: (callback) => { queueMicrotask(callback); return 0; }, clearTimeout: () => {}, setInterval, clearInterval },
    localStorage: { getItem: () => "token" }, sessionStorage: { getItem: () => null },
    async fetch(input, init) {
      calls.push(init.method);
      if (init.method === "POST") return Response.json({ stage: "uploading", done: false, message: "Uploading.", progress: 40 });
      if (!dropped) { dropped = true; throw new TypeError("Failed to fetch"); }
      return Response.json({ stage: "complete", done: true, message: "Published.", postId: "yt_test", postUrl: "https://youtube.com/shorts/yt_test" });
    },
  });
  vm.runInContext(compiled, context);
  const result = await exports.postClip("clip_test");
  assert.equal(result.postId, "yt_test");
  assert.deepEqual(calls, ["POST", "GET", "GET"]);
});
