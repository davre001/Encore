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

async function uploadScenario(parallelChunks, retry = false) {
  let active = 0;
  let maximumActive = 0;
  const accepted = new Set();
  const attempts = new Map();
  const progress = [];
  const storage = { getItem: () => "token" };
  const exports = {};
  const context = vm.createContext({
    exports, process: { env: {} }, URLSearchParams, AbortController, DOMException,
    window: { setTimeout, clearTimeout }, localStorage: storage, sessionStorage: storage,
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
        await new Promise((resolve) => setTimeout(resolve, (3 - index) * 10));
        active -= 1;
        if (retry && index === 1 && attempts.get(index) === 1) {
          return Response.json({ detail: "Temporary failure" }, { status: 503 });
        }
        accepted.add(index);
        return Response.json({ ok: true });
      }
      assert.equal(accepted.size, 3, "Finish must wait for every chunk");
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
