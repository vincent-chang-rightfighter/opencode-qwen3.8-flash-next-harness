import test from "node:test";
import assert from "node:assert/strict";
import strataReasoning from "../index.js";
import {
  classifyTask,
  editedPathsFromTool,
  isVerificationCommand,
  resolveOptions,
  shouldPlanTask,
} from "../lib.js";

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

test("planning is triggered for multi-step work but not lookups", () => {
  const local = resolveOptions({ autoTodo: true });
  assert.equal(shouldPlanTask(classifyTask("Update src/a.ts", local), local), true);
  assert.equal(shouldPlanTask(classifyTask("Compare the architecture tradeoffs", local), local), true);
  assert.equal(shouldPlanTask(classifyTask("What is the capital of France?", local), local), false);
  assert.equal(shouldPlanTask(classifyTask("hello", local), local), false);
  assert.equal(shouldPlanTask(classifyTask("- alpha\n- beta\n- gamma", local), local), true);

  const off = resolveOptions({});
  assert.equal(shouldPlanTask(classifyTask("Update src/a.ts", off), off), false);
});

test("verification commands and edited paths are recognized", () => {
  assert.equal(isVerificationCommand("npm test"), true);
  assert.equal(isVerificationCommand("npm run build"), true);
  assert.equal(isVerificationCommand("npm install"), false);
  assert.equal(isVerificationCommand("cargo check"), true);
  assert.equal(isVerificationCommand("python -m pytest -q"), true);
  assert.equal(isVerificationCommand("git status"), false);
  assert.deepEqual(
    editedPathsFromTool("apply_patch", {
      patchText: "*** Update File: src/a.ts\n*** Add File: src/b.ts\n",
    }),
    ["src/a.ts", "src/b.ts"],
  );
  assert.deepEqual(editedPathsFromTool("edit", { filePath: "src/c.ts" }), ["src/c.ts"]);
});

test("system prompt asks for todowrite on planned tasks only", async () => {
  const hooks = await strataReasoning(
    {},
    { modelIncludes: ["qwen3.8-flash-next"], autoTodo: true },
  );
  const message = (text) => ({
    sessionID: "plan-session",
    agent: "build",
    message: { parts: [{ text }] },
    parts: [{ text }],
  });

  await hooks["chat.message"]({ sessionID: "plan-session" }, message("Update src/a.ts and src/b.ts"));
  const planned = { system: [] };
  await hooks["experimental.chat.system.transform"](
    {
      sessionID: "plan-session",
      model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
    },
    planned,
  );
  const plannedText = planned.system.join("\n");
  assert.equal(plannedText.includes("todowrite"), true);
  assert.equal(plannedText.includes("detailed plan"), true);
  assert.equal(plannedText.includes("reason for each"), true);

  await hooks["tool.execute.after"](
    {
      tool: "todowrite",
      sessionID: "plan-session",
      callID: "todo-1",
      args: { todos: [{ content: "step one", status: "pending", priority: "high" }] },
    },
    { title: "", output: "", metadata: {} },
  );
  const active = { system: [] };
  await hooks["experimental.chat.system.transform"](
    {
      sessionID: "plan-session",
      model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
    },
    active,
  );
  assert.equal(active.system.some((line) => line.includes("Keep the active todo list current")), true);

  await hooks["chat.message"]({ sessionID: "simple-session" }, message("hello"));
  const simple = { system: [] };
  await hooks["experimental.chat.system.transform"](
    {
      sessionID: "simple-session",
      model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
    },
    simple,
  );
  assert.equal(simple.system.length, 0);
});

test("verification reminders and compaction context track edits", async () => {
  const hooks = await strataReasoning(
    {},
    { modelIncludes: ["qwen3.8-flash-next"], autoVerify: true },
  );
  const model = { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" };
  const system = async () => {
    const output = { system: [] };
    await hooks["experimental.chat.system.transform"](
      { sessionID: "verify-session", model },
      output,
    );
    return output.system.join("\n");
  };

  await hooks["tool.execute.after"](
    {
      tool: "edit",
      sessionID: "verify-session",
      callID: "edit-1",
      args: { filePath: "src/a.ts" },
    },
    { title: "", output: "", metadata: {} },
  );
  assert.match(await system(), /changed files/);

  await hooks["tool.execute.after"](
    {
      tool: "bash",
      sessionID: "verify-session",
      callID: "test-1",
      args: { command: "npm test" },
    },
    { title: "", output: "all tests passed", metadata: { exitCode: 0 } },
  );
  assert.doesNotMatch(await system(), /changed files/);

  await hooks["tool.execute.after"](
    {
      tool: "edit",
      sessionID: "verify-session",
      callID: "edit-2",
      args: { filePath: "src/a.ts" },
    },
    { title: "", output: "", metadata: {} },
  );
  await hooks["tool.execute.after"](
    {
      tool: "bash",
      sessionID: "verify-session",
      callID: "test-2",
      args: { command: "npm test" },
    },
    { title: "", output: "1 test failed", metadata: { exitCode: 1 } },
  );
  assert.match(await system(), /last verification command failed/i);

  const compacted = { context: [] };
  await hooks["experimental.session.compacting"](
    { sessionID: "verify-session" },
    compacted,
  );
  const context = compacted.context.join("\n");
  assert.match(context, /Harness state/);
  assert.match(context, /src\/a.ts/);
  assert.match(context, /Verification: failed/);
});

test("task tool is blocked for the targeted local model family", async () => {
  const raw = {
    modelIncludes: ["qwen3.8-flash-next"],
    disableSubagents: true,
  };
  const hooks = await strataReasoning({}, raw);
  const chat = (modelID) => ({
    sessionID: "session-1",
    agent: "build",
    model: { id: modelID, providerID: "strata" },
    provider: { info: { id: "strata" } },
    message: { parts: [{ text: "hello" }] },
  });
  const output = () => ({ options: {}, temperature: 1 });

  await hooks["chat.params"](chat("qwen3.8-flash-next-iq3_s"), output());
  await assert.rejects(
    () =>
      hooks["tool.execute.before"](
        { tool: "task", sessionID: "session-1", callID: "call-1" },
        {},
      ),
    /Subagents are disabled/,
  );

  const system = { system: [] };
  await hooks["experimental.chat.system.transform"](
    {
      sessionID: "session-1",
      model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
    },
    system,
  );
  assert.equal(system.system.length, 1);

  const coder = await strataReasoning({}, raw);
  await coder["chat.params"](chat("Qwen3.8-Flash-Next-Coder"), output());
  await assert.rejects(
    () =>
      coder["tool.execute.before"](
        { tool: "task", sessionID: "session-1", callID: "call-2" },
        {},
      ),
    /Subagents are disabled/,
  );

  const other = await strataReasoning({}, raw);
  await other["chat.params"](chat("DeepSeek-V4.1-Flash"), output());
  await other["tool.execute.before"](
    { tool: "task", sessionID: "session-1", callID: "call-3" },
    {},
  );
});
