import test from "node:test";
import assert from "node:assert/strict";
import { classifyTask, resolveOptions } from "../lib.js";

const options = resolveOptions({});

test("code prompt gets high effort and lower temperature", () => {
  const result = classifyTask("Please refactor src/app.ts to use a helper", options);
  assert.equal(result.kind, "implement");
  assert.equal(result.effort, "high");
  assert.equal(result.temperature, 0.6);
});

test("successful tool-result turn gets low effort", () => {
  const result = classifyTask("", options, { toolTurn: true, toolFailed: false });
  assert.equal(result.kind, "tool-success");
  assert.equal(result.effort, "low");
  assert.equal(result.temperature, 0.6);
});

test("failed tool-result turn gets high effort", () => {
  const result = classifyTask("", options, {
    toolTurn: true,
    toolFailed: true,
    failures: 1,
  });
  assert.equal(result.kind, "tool-failure");
  assert.equal(result.effort, "high");
});

test("repeated tool failures escalate to xhigh", () => {
  const result = classifyTask("", options, {
    toolTurn: true,
    toolFailed: true,
    failures: 2,
  });
  assert.equal(result.kind, "tool-failure-repeat");
  assert.equal(result.effort, "xhigh");
});

test("ultra keyword gets xhigh", () => {
  const result = classifyTask("ultrathink: compare these two migrations", options);
  assert.equal(result.kind, "ultra");
  assert.equal(result.effort, "xhigh");
});

test("simple greeting gets low effort", () => {
  const result = classifyTask("hello", options);
  assert.equal(result.kind, "simple");
  assert.equal(result.effort, "low");
});

test("debug signals get high effort", () => {
  const result = classifyTask("The test fails with a traceback in the worker", options);
  assert.equal(result.kind, "debug");
  assert.equal(result.effort, "high");
});

test("design signals get high effort", () => {
  const result = classifyTask("Compare the architecture tradeoffs for this service", options);
  assert.equal(result.kind, "design");
  assert.equal(result.effort, "high");
});

test("risky work is bumped to at least high", () => {
  const result = classifyTask("deploy this to production", options);
  assert.ok(result.effort === "high" || result.effort === "xhigh");
});

test("search question gets medium effort", () => {
  const result = classifyTask("What is the capital of France?", options);
  assert.equal(result.kind, "search");
  assert.equal(result.effort, "medium");
  assert.equal(result.temperature, 1.0);
});

test("code agent gets high effort", () => {
  const result = classifyTask("Please implement the endpoint", options, { agent: "code" });
  assert.equal(result.kind, "implement");
  assert.equal(result.effort, "high");
});

test("multi-file code stays high, not xhigh", () => {
  const result = classifyTask("Update src/a.ts and src/b.ts", options);
  assert.equal(result.kind, "implement");
  assert.equal(result.effort, "high");
});
