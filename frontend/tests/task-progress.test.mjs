import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/ui/task-progress.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsxRuntime = await import("react/jsx-runtime");

test("tracker retains success and error results, resets for new work, and clears cancellation", () => {
  let snapshot = null;
  let cursor = 0;
  const refs = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return {
        useState: () => [snapshot, (next) => { snapshot = typeof next === "function" ? next(snapshot) : next; }],
        useRef(value) { const index = cursor++; return refs[index] ??= { current: value }; },
        useEffect(effect) { effect(); },
      };
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "lucide-react") return {};
      if (name.endsWith(".css")) return { default: {} };
      throw new Error(name);
    },
  });
  const base = { active: true, stopped: false, analysisRunning: true, message: "Watching", onStop() {} };
  function update(props) { cursor = 0; exports.TaskProgressTracker({ ...base, ...props }); }
  update({});
  assert.equal(snapshot.status, "running");
  update({ active: false, analysisRunning: false });
  assert.equal(snapshot.status, "success");
  const previousId = snapshot.id;
  update({});
  assert.notEqual(snapshot.id, previousId);
  update({ active: false, analysisRunning: false, analysisError: "API error" });
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.message, "API error");
  update({ analysisRunning: false });
  update({ active: false, analysisRunning: false, error: "Publish failed" });
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.message, "Publish failed");
  update({ stopped: true });
  assert.equal(snapshot, null);
});

// Exercise the rendered controls while retaining the component's state across updates.
function harness() {
  let hidden = false;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return { useId: () => "task", useState: () => [hidden, (next) => { hidden = next; }] };
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "lucide-react") return {};
      if (name.endsWith(".css")) return { default: {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return (props) => exports.default(props);
}

function find(node, predicate) {
  if (!React.isValidElement(node)) return undefined;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

test("opens automatically, hides, updates in sidebar, and reopens with latest progress", () => {
  const render = harness();
  const props = { message: "Watching video", percent: 42, onStop() {} };
  let tree = render(props);
  assert.equal(tree.props.role, "dialog");
  find(tree, (n) => n.props["aria-label"] === "Hide progress in sidebar").props.onClick();
  tree = render({ ...props, message: "Generating moments", percent: 86 });
  assert.equal(tree.type, "button");
  assert.match(tree.props["aria-label"], /Generating moments, 86%/);
  tree.props.onClick();
  tree = render({ ...props, percent: 86 });
  assert.equal(find(tree, (n) => n.props.role === "progressbar").props["aria-valuenow"], 86);
});

test("clamps progress and uses an indeterminate bar when progress is unknown", () => {
  const render = harness();
  for (const [input, expected] of [[-10, 0], [150, 100], [42.6, 43], [undefined, undefined], [NaN, undefined]]) {
    const tree = render({ message: "Working", percent: input, onStop() {} });
    assert.equal(find(tree, (n) => n.props.role === "progressbar").props["aria-valuenow"], expected);
  }
});

test("Escape minimizes without cancelling; only Stop invokes cancellation", () => {
  const render = harness();
  let stopped = 0;
  const props = { message: "Working", onStop: () => { stopped++; } };
  let tree = render(props);
  tree.props.onKeyDown({ key: "Escape", stopPropagation() {} });
  assert.equal(stopped, 0);
  tree = render(props);
  assert.equal(tree.type, "button");
  tree.props.onClick();
  tree = render(props);
  find(tree, (n) => n.type === "button" && n.props.onClick === props.onStop).props.onClick();
  assert.equal(stopped, 1);
});

for (const status of ["success", "error"]) {
  test(`${status} displays a terminal icon and dismiss control in popup and sidebar`, () => {
    const render = harness();
    let dismissed = 0;
    const props = { message: status === "error" ? "Generation failed" : "Moments ready", status,
      onStop() { assert.fail("Finished tasks cannot be stopped"); }, onDismiss() { dismissed++; } };
    let tree = render(props);
    assert.equal(tree.props["data-status"], status);
    assert.equal(find(tree, (n) => n.props.role === "progressbar"), undefined);
    assert.ok(find(tree, (n) => n.type === "h2" && n.props.children === (status === "success" ? "Task completed" : "Something went wrong")));
    find(tree, (n) => n.type === "button" && n.props.children === "Dismiss").props.onClick();
    assert.equal(dismissed, 1);
    find(tree, (n) => n.props["aria-label"] === "Hide progress in sidebar").props.onClick();
    tree = render(props);
    assert.equal(tree.props["data-status"], status);
    assert.ok(find(tree, (n) => n.type === "span" && n.props.children === (status === "success" ? "Completed" : "Failed")));
  });
}
