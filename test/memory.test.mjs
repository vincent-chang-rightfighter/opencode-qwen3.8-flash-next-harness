import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import strataReasoning from "../index.js";
import {
  buildMemoryBlock,
  createMemoryStore,
  normalizeObservation,
  projectKey,
  rankObservations,
  sanitizeMemoryText,
} from "../memory.js";
import { createStateStore } from "../state.js";

const model = { id: "qwen3.8-flash-next-iq3_s", providerID: "strata" };
const provider = { info: { id: "strata" } };

function request(sessionID, text) {
  return {
    sessionID,
    agent: "build",
    model,
    provider,
    message: { parts: [{ text }] },
  };
}

async function tempDir(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

test("memory text strips private blocks and common secrets", () => {
  const text = sanitizeMemoryText(
    "keep <private>top secret</private> api_key=abc123 password: hunter2 Bearer token123",
  );
  assert.doesNotMatch(text, /top secret/);
  assert.doesNotMatch(text, /abc123/);
  assert.doesNotMatch(text, /hunter2/);
  assert.doesNotMatch(text, /token123/);
  assert.match(text, /redacted/);
});

test("secret redaction is optional but private blocks are always removed", () => {
  const text = "api_key=abc123 <private>top secret</private>";
  const redacted = sanitizeMemoryText(text, 1200, true);
  assert.doesNotMatch(redacted, /abc123/);
  assert.doesNotMatch(redacted, /top secret/);

  const unredacted = sanitizeMemoryText(text, 1200, false);
  assert.match(unredacted, /abc123/);
  assert.doesNotMatch(unredacted, /top secret/);
});

test("project keys are stable and project-scoped", () => {
  const root = path.join(tmpdir(), "memory-project");
  assert.equal(projectKey(root), projectKey(root));
  assert.notEqual(projectKey(root), projectKey(`${root}-other`));
});

test("observations rank by query terms and recency", () => {
  const entries = [
    normalizeObservation({
      sessionID: "old",
      kind: "verification",
      summary: "Verification passed: npm test",
      ts: "2026-01-01T00:00:00.000Z",
    }),
    normalizeObservation({
      sessionID: "new",
      kind: "edit",
      summary: "Edited src/auth.ts",
      files: ["src/auth.ts"],
      ts: "2026-10-30T00:00:00.000Z",
    }),
  ];
  const ranked = rankObservations(entries, "fix src/auth.ts", Date.parse("2026-10-31T00:00:00.000Z"), 1);
  assert.equal(ranked[0].summary, "Edited src/auth.ts");
  const block = buildMemoryBlock(ranked, 500);
  assert.match(block, /Project memory/);
  assert.match(block, /src\/auth\.ts/);
});

test("memory store captures and recalls project observations", async () => {
  const dataDir = await tempDir("qwen-memory-data-");
  const projectRoot = await tempDir("qwen-memory-project-");
  try {
    const store = createMemoryStore({ dataDir, projectRoot });
    await store.captureRequest({
      sessionID: "session-a",
      text: "Implement src/a.ts and run npm test",
      kind: "implement",
    });
    await store.captureEdit({
      sessionID: "session-a",
      tool: "edit",
      files: ["src/a.ts"],
    });
    await store.captureVerification({
      sessionID: "session-a",
      command: "npm test",
      failed: false,
      output: "all tests passed",
    });

    const block = await store.recall({
      query: "update src/a.ts and verify",
      sessionID: "session-b",
      limit: 6,
      maxChars: 1200,
    });
    assert.match(block, /Project memory/);
    assert.match(block, /src\/a\.ts/);
    assert.match(block, /Verification passed/);
    assert.equal(await store.recall({ query: "src/a.ts", sessionID: "session-a" }), "");

    const other = createMemoryStore({
      dataDir,
      projectRoot: `${projectRoot}-other`,
    });
    assert.equal(await other.recall({ query: "src/a.ts", sessionID: "session-b" }), "");

    const raw = await readFile(store.file, "utf8");
    assert.match(raw, /session-a/);
    assert.doesNotMatch(raw, /private/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("memory store can disable secret redaction while keeping private filtering", async () => {
  const dataDir = await tempDir("qwen-memory-raw-data-");
  const projectRoot = await tempDir("qwen-memory-raw-project-");
  try {
    const store = createMemoryStore({ dataDir, projectRoot, redactSecrets: false });
    await store.captureRequest({
      sessionID: "session-raw",
      text: "api_key=abc123 <private>hidden</private>",
      kind: "implement",
    });
    const raw = await readFile(store.file, "utf8");
    assert.match(raw, /abc123/);
    assert.doesNotMatch(raw, /hidden/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("state store persists verification state without private text", async () => {
  const dataDir = await tempDir("qwen-state-data-");
  try {
    const store = createStateStore({ dataDir });
    await store.save("session-a", {
      targeted: true,
      verificationPending: true,
      verificationStale: true,
      gateRequired: true,
      editedFiles: ["src/a.ts"],
      text: "fix <private>secret</private>",
    });
    const loaded = await store.load("session-a");
    assert.equal(loaded.verificationPending, true);
    assert.deepEqual(loaded.editedFiles, ["src/a.ts"]);
    assert.doesNotMatch(loaded.text, /secret/);

    const raw = await readFile(store.fileFor("session-a"), "utf8");
    assert.doesNotMatch(raw, /secret/);
    await store.delete("session-a");
    assert.equal(await store.load("session-a"), null);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("state store can disable secret redaction while keeping private filtering", async () => {
  const dataDir = await tempDir("qwen-state-raw-data-");
  try {
    const store = createStateStore({ dataDir, redactSecrets: false });
    await store.save("session-raw", {
      targeted: true,
      text: "api_key=abc123 <private>hidden</private>",
    });
    const raw = await readFile(store.fileFor("session-raw"), "utf8");
    assert.match(raw, /abc123/);
    assert.doesNotMatch(raw, /hidden/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("plugin injects project memory once for a later session", async () => {
  const dataDir = await tempDir("qwen-plugin-memory-data-");
  const projectRoot = await tempDir("qwen-plugin-memory-project-");
  try {
    const hooks = await strataReasoning(
      { directory: projectRoot },
      {
        providers: ["strata"],
        modelIncludes: ["qwen3.8-flash-next"],
        autoMemory: true,
        memoryDir: dataDir,
      },
    );

    await hooks["chat.message"](
      { sessionID: "session-a", agent: "build" },
      { message: { model, parts: [{ text: "Implement src/a.ts" }] }, parts: [{ text: "Implement src/a.ts" }] },
    );
    await hooks["chat.params"](request("session-a", "Implement src/a.ts"), {
      options: {},
      temperature: 1,
    });
    await hooks["tool.execute.after"](
      { tool: "edit", sessionID: "session-a", callID: "edit-1", args: { filePath: "src/a.ts" } },
      { title: "", output: "", metadata: {} },
    );

    const first = request("session-b", "Update src/a.ts");
    await hooks["chat.message"](
      { sessionID: "session-b", agent: "build" },
      { message: { model, parts: [{ text: "Update src/a.ts" }] }, parts: [{ text: "Update src/a.ts" }] },
    );
    await hooks["chat.params"](first, { options: {}, temperature: 1 });
    assert.match(first.message.system, /Project memory/);
    assert.match(first.message.system, /src\/a\.ts/);

    const second = request("session-b", "Update src/a.ts");
    await hooks["chat.params"](second, { options: {}, temperature: 1 });
    assert.equal(second.message.system, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("chat.params captures a request when chat.message did not", async () => {
  const dataDir = await tempDir("qwen-plugin-fallback-data-");
  const projectRoot = await tempDir("qwen-plugin-fallback-project-");
  try {
    const hooks = await strataReasoning(
      { directory: projectRoot },
      {
        providers: ["strata"],
        modelIncludes: ["qwen3.8-flash-next"],
        autoMemory: true,
        memoryDir: dataDir,
      },
    );

    await hooks["chat.params"](request("fallback-a", "Implement src/f.ts"), {
      options: {},
      temperature: 1,
    });
    const later = request("fallback-b", "Update src/f.ts");
    await hooks["chat.params"](later, { options: {}, temperature: 1 });
    assert.match(later.message.system, /Project memory/);
    assert.match(later.message.system, /src\/f\.ts/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("persistent state hydrates the verification gate after restart", async () => {
  const dataDir = await tempDir("qwen-plugin-state-data-");
  const projectRoot = await tempDir("qwen-plugin-state-project-");
  try {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" } }),
    );
    const raw = {
      providers: ["strata"],
      modelIncludes: ["qwen3.8-flash-next"],
      autoVerify: true,
      verificationGate: true,
      persistentState: true,
      memoryDir: dataDir,
    };
    const first = await strataReasoning({ directory: projectRoot }, raw);
    await first["chat.params"](request("persist-session", "implement src/a.ts"), {
      options: {},
      temperature: 1,
    });
    await first["tool.execute.after"](
      {
        tool: "edit",
        sessionID: "persist-session",
        callID: "edit-1",
        args: { filePath: "src/a.ts" },
      },
      { title: "", output: "", metadata: {} },
    );

    const restarted = await strataReasoning({ directory: projectRoot }, raw);
    await assert.rejects(
      () =>
        restarted["tool.execute.before"](
          { tool: "edit", sessionID: "persist-session", callID: "edit-2" },
          {},
        ),
      /Verification required/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
