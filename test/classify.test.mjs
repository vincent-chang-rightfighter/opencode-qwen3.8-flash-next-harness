import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import strataReasoning from "../index.js";
import {
  classifyTask,
  editedPathsFromTool,
  isCodePath,
  isLocalEndpoint,
  isVerificationCommand,
  matchesTarget,
  resolveOptions,
  resolveProviderProfile,
  shouldPlanTask,
} from "../lib.js";

const options = resolveOptions({});

test("targets local providers but not cloud providers", () => {
  const local = resolveOptions({ modelIncludes: ["qwen3.8-flash-next"] });
  const target = (providerID, modelID = "qwen3.8-flash-next-iq3_s") =>
    matchesTarget(
      { provider: { info: { id: providerID } }, model: { id: modelID } },
      local,
    );

  assert.equal(target("strata"), true);
  assert.equal(target("ollama"), true);
  assert.equal(target("lmstudio"), true);
  assert.equal(target("opencode"), false);
  assert.equal(target("openai"), false);
  assert.equal(target("anthropic"), false);
  assert.equal(target("openai-compatible"), false);
  assert.equal(target("ollama", "some-other-model"), false);

  const custom = resolveOptions({
    modelIncludes: ["qwen3.8-flash-next"],
    localProviders: ["openai-compatible"],
  });
  assert.equal(
    matchesTarget(
      {
        provider: { info: { id: "openai-compatible" } },
        model: { id: "qwen3.8-flash-next-iq3_s" },
      },
      custom,
    ),
    true,
  );
});

test("detects local endpoints", () => {
  assert.equal(isLocalEndpoint("http://localhost:11434/v1"), true);
  assert.equal(isLocalEndpoint("http://127.0.0.1:8080/v1"), true);
  assert.equal(isLocalEndpoint("http://100.64.0.10:8080/v1"), true);
  assert.equal(isLocalEndpoint("http://192.168.1.5:8000/v1"), true);
  assert.equal(isLocalEndpoint("https://opencode.ai/v1"), false);
  assert.equal(isLocalEndpoint("https://api.openai.com/v1"), false);
});

test("config hook registers a provider with a local baseURL", async () => {
  const hooks = await strataReasoning(
    {},
    { modelIncludes: ["qwen3.8-flash-next"], localProviders: [] },
  );
  await hooks.config({
    provider: {
      "my-local": { options: { baseURL: "http://192.168.1.50:8000/v1" } },
    },
  });
  const output = { options: {}, temperature: 0.7 };
  await hooks["chat.params"](
    {
      sessionID: "config-session",
      agent: "build",
      model: { id: "qwen3.8-flash-next-iq3_s", providerID: "my-local" },
      provider: { info: { id: "my-local" } },
      message: { parts: [{ text: "hello" }] },
    },
    output,
  );
  assert.equal(output.temperature, 1.0);
});

test("provider profiles select the reasoning field", () => {
  const local = resolveOptions({ modelIncludes: ["qwen3.8-flash-next"] });
  assert.equal(resolveProviderProfile("strata", local).reasoning, "chat_template_kwargs");
  assert.equal(resolveProviderProfile("ollama", local).reasoning, "reasoning_effort");
  assert.equal(resolveProviderProfile("llamacpp", local).reasoning, "reasoning_effort");
  assert.equal(resolveProviderProfile("vllm", local).reasoning, "reasoning_effort");
  assert.equal(resolveProviderProfile("lmstudio", local).reasoning, "none");
  assert.equal(resolveProviderProfile("unknown-local", local).reasoning, "none");

  const custom = resolveOptions({
    modelIncludes: ["qwen3.8-flash-next"],
    providerProfiles: { "my-local": "chat_template_kwargs" },
  });
  assert.equal(resolveProviderProfile("my-local", custom).reasoning, "chat_template_kwargs");
});

test("chat.params writes the provider-specific reasoning field", async () => {
  const hooks = await strataReasoning(
    {},
    { modelIncludes: ["qwen3.8-flash-next"] },
  );
  const chat = (providerID, sessionID) => ({
    sessionID,
    agent: "build",
    model: { id: "qwen3.8-flash-next-iq3_s", providerID },
    provider: { info: { id: providerID } },
    message: { parts: [{ text: "Please implement src/a.ts" }] },
  });
  const output = () => ({ options: {}, temperature: 1 });

  const ollama = output();
  await hooks["chat.params"](chat("ollama", "ollama-session"), ollama);
  assert.equal(ollama.options.reasoningEffort, "high");
  assert.equal(ollama.options.chat_template_kwargs, undefined);

  const strata = output();
  await hooks["chat.params"](chat("strata", "strata-session"), strata);
  assert.equal(strata.options.chat_template_kwargs.reasoning_effort, "high");
  assert.equal(strata.options.reasoningEffort, undefined);

  const lmstudio = output();
  await hooks["chat.params"](chat("lmstudio", "lmstudio-session"), lmstudio);
  assert.equal(lmstudio.options.reasoningEffort, undefined);
  assert.equal(lmstudio.options.chat_template_kwargs, undefined);
  assert.equal(lmstudio.temperature, 0.6);
});

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

test("sampling follows thinking and non-thinking model-card sets", async () => {
  const chat = (text, sessionID) => ({
    sessionID,
    agent: "build",
    model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
    provider: { info: { id: "strata" } },
    message: { parts: [{ text }] },
  });
  const thinking = await strataReasoning(
    {},
    { modelIncludes: ["qwen3.8-flash-next"] },
  );
  const code = { options: {}, temperature: 1 };
  await thinking["chat.params"](chat("implement src/a.ts", "sampling-thinking"), code);
  assert.equal(code.topP, 0.95);
  assert.equal(code.options.top_k, 20);
  assert.equal(code.options.min_p, 0);
  assert.equal(code.options.presence_penalty, 0);
  assert.equal(code.options.repetition_penalty, 1);
  assert.equal(code.temperature, 0.6);

  const nonThinking = await strataReasoning(
    {},
    { modelIncludes: ["qwen3.8-flash-next"], simpleEffort: "none" },
  );
  const simple = { options: {}, temperature: 1 };
  await nonThinking["chat.params"](chat("hello", "sampling-simple"), simple);
  assert.equal(simple.topP, 0.8);
  assert.equal(simple.options.top_k, 20);
  assert.equal(simple.options.min_p, 0);
  assert.equal(simple.options.presence_penalty, 1.5);
  assert.equal(simple.options.repetition_penalty, 1);
  assert.equal(simple.temperature, 0.7);
  assert.equal(simple.options.chat_template_kwargs.enable_thinking, false);
});

test("verification commands and edited paths are recognized", () => {
  assert.equal(isCodePath("src/a.ts"), true);
  assert.equal(isCodePath("Dockerfile"), true);
  assert.equal(isCodePath("README.md"), false);
  assert.equal(isCodePath("package.json"), false);
  assert.equal(isVerificationCommand("npm test"), true);
  assert.equal(isVerificationCommand("npm run build"), true);
  assert.equal(isVerificationCommand("npm install"), false);
  assert.equal(isVerificationCommand("cargo check"), true);
  assert.equal(isVerificationCommand("python -m pytest -q"), true);
  assert.equal(isVerificationCommand("git status"), false);
  assert.equal(isVerificationCommand("pnpm verify", ["pnpm verify"]), true);
  assert.equal(isVerificationCommand("pnpm verify"), false);
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
    model: { providerID: "strata", modelID: "qwen3.8-flash-next-iq3_s" },
    message: {
      model: { providerID: "strata", modelID: "qwen3.8-flash-next-iq3_s" },
      parts: [{ text }],
    },
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

test("verification gate blocks another edit until a check runs", async () => {
  const hooks = await strataReasoning(
    {},
    {
      modelIncludes: ["qwen3.8-flash-next"],
      autoVerify: true,
      verificationGate: true,
      verificationCommands: ["npm test"],
    },
  );
  const sessionID = "gate-session";
  await hooks["chat.params"](
    {
      sessionID,
      agent: "build",
      model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
      provider: { info: { id: "strata" } },
      message: { parts: [{ text: "implement src/a.ts" }] },
    },
    { options: {}, temperature: 1 },
  );

  await hooks["tool.execute.after"](
    { tool: "edit", sessionID, callID: "edit-1", args: { filePath: "src/a.ts" } },
    { title: "", output: "", metadata: {} },
  );
  await assert.rejects(
    () =>
      hooks["tool.execute.before"](
        { tool: "edit", sessionID, callID: "edit-2" },
        {},
      ),
    /Verification required/,
  );

  await hooks["tool.execute.after"](
    {
      tool: "bash",
      sessionID,
      callID: "test-1",
      args: { command: "npm test" },
    },
    { title: "", output: "all tests passed", metadata: { exitCode: 0 } },
  );
  await hooks["tool.execute.before"](
    { tool: "edit", sessionID, callID: "edit-3" },
    {},
  );

  await hooks["tool.execute.after"](
    { tool: "edit", sessionID, callID: "edit-4", args: { filePath: "src/a.ts" } },
    { title: "", output: "", metadata: {} },
  );
  await hooks["tool.execute.after"](
    {
      tool: "bash",
      sessionID,
      callID: "test-2",
      args: { command: "npm test" },
    },
    { title: "", output: "1 test failed", metadata: { exitCode: 1 } },
  );
  await hooks["tool.execute.before"](
    { tool: "edit", sessionID, callID: "edit-5" },
    {},
  );
  await hooks["tool.execute.after"](
    { tool: "edit", sessionID, callID: "edit-6", args: { filePath: "src/a.ts" } },
    { title: "", output: "", metadata: {} },
  );
  await assert.rejects(
    () =>
      hooks["tool.execute.before"](
        { tool: "edit", sessionID, callID: "edit-7" },
        {},
      ),
    /Verification required/,
  );
});

test("verification gate ignores docs-only edits", async () => {
  const hooks = await strataReasoning(
    {},
    {
      modelIncludes: ["qwen3.8-flash-next"],
      autoVerify: true,
      verificationGate: true,
      verificationCommands: ["npm test"],
    },
  );
  const sessionID = "docs-gate-session";
  await hooks["chat.params"](
    {
      sessionID,
      agent: "build",
      model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
      provider: { info: { id: "strata" } },
      message: { parts: [{ text: "update the readme" }] },
    },
    { options: {}, temperature: 1 },
  );
  await hooks["tool.execute.after"](
    { tool: "edit", sessionID, callID: "doc-1", args: { filePath: "README.md" } },
    { title: "", output: "", metadata: {} },
  );
  await hooks["tool.execute.before"](
    { tool: "edit", sessionID, callID: "doc-2" },
    {},
  );
});

test("verification gate is advisory when no project check exists", async () => {
  const hooks = await strataReasoning(
    {},
    {
      modelIncludes: ["qwen3.8-flash-next"],
      autoVerify: true,
      verificationGate: true,
    },
  );
  const sessionID = "no-check-gate";
  await hooks["chat.params"](
    {
      sessionID,
      agent: "build",
      model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
      provider: { info: { id: "strata" } },
      message: { parts: [{ text: "implement src/a.ts" }] },
    },
    { options: {}, temperature: 1 },
  );
  await hooks["tool.execute.after"](
    { tool: "edit", sessionID, callID: "edit-1", args: { filePath: "src/a.ts" } },
    { title: "", output: "", metadata: {} },
  );
  await hooks["tool.execute.before"](
    { tool: "edit", sessionID, callID: "edit-2" },
    {},
  );
});

test("a discovered package check enables the verification gate", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "qwen-harness-gate-"));
  try {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" } }),
    );
    const hooks = await strataReasoning(
      { directory },
      {
        modelIncludes: ["qwen3.8-flash-next"],
        autoVerify: true,
        verificationGate: true,
      },
    );
    const sessionID = "detected-check-gate";
    await hooks["chat.params"](
      {
        sessionID,
        agent: "build",
        model: { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" },
        provider: { info: { id: "strata" } },
        message: { parts: [{ text: "implement src/a.ts" }] },
      },
      { options: {}, temperature: 1 },
    );
    await hooks["tool.execute.after"](
      { tool: "edit", sessionID, callID: "edit-1", args: { filePath: "src/a.ts" } },
      { title: "", output: "", metadata: {} },
    );
    await assert.rejects(
      () =>
        hooks["tool.execute.before"](
          { tool: "edit", sessionID, callID: "edit-2" },
          {},
        ),
      /Verification required/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
