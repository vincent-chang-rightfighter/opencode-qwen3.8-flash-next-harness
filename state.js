import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultDataDir, sanitizeMemoryText, sessionKey } from "./memory.js";

const BOOLEAN_FIELDS = [
  "targeted",
  "planning",
  "todosActive",
  "toolTurn",
  "toolFailed",
  "verificationPending",
  "verificationFailed",
  "verificationStale",
  "verificationSeen",
  "gateRequired",
  "subagentsDisabled",
  "memoryInjected",
  "requestCaptured",
];

function normalizeTextArray(value, maxItems = 20) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => sanitizeMemoryText(item, 300))
        .filter(Boolean),
    ),
  ].slice(-maxItems);
}

export function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = { version: 1 };
  for (const field of BOOLEAN_FIELDS) {
    if (typeof value[field] === "boolean") state[field] = value[field];
  }
  const failures = Number(value.failures);
  if (Number.isFinite(failures)) state.failures = Math.max(0, Math.min(3, Math.floor(failures)));
  const updatedAt = Number(value.updatedAt);
  state.updatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  if (typeof value.text === "string") state.text = sanitizeMemoryText(value.text, 1200);
  if (typeof value.modelID === "string") state.modelID = sanitizeMemoryText(value.modelID, 200);
  if (typeof value.lastToolKey === "string") {
    state.lastToolKey = sanitizeMemoryText(value.lastToolKey, 200);
  }
  state.editedFiles = normalizeTextArray(value.editedFiles);
  if (typeof value.lastVerification === "string") {
    state.lastVerification = sanitizeMemoryText(value.lastVerification, 300);
  }
  if (typeof value.lastVerificationOutput === "string") {
    state.lastVerificationOutput = sanitizeMemoryText(value.lastVerificationOutput, 1200);
  }
  return state;
}

export function createStateStore(options = {}) {
  const dataDir = path.resolve(options.dataDir || defaultDataDir());
  const maxAgeDays =
    typeof options.maxAgeDays === "number" && Number.isFinite(options.maxAgeDays)
      ? Math.max(1, options.maxAgeDays)
      : 30;
  const dir = path.join(dataDir, "sessions");
  let queue = Promise.resolve();

  const fileFor = (sessionID) => path.join(dir, `${sessionKey(sessionID)}.json`);

  const run = (fn) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  return {
    fileFor,
    load(sessionID) {
      return run(async () => {
        const file = fileFor(sessionID);
        let raw;
        try {
          raw = await readFile(file, "utf8");
        } catch (error) {
          if (error?.code === "ENOENT") return null;
          throw error;
        }
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return null;
        }
        const state = normalizeState(parsed);
        if (!state) return null;
        if (Date.now() - state.updatedAt > maxAgeDays * 86400000) return null;
        return state;
      });
    },
    save(sessionID, value) {
      return run(async () => {
        const state = normalizeState({ ...value, updatedAt: Date.now() });
        if (!state) return;
        await mkdir(dir, { recursive: true });
        const file = fileFor(sessionID);
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, `${JSON.stringify(state)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        try {
          await rename(temp, file);
        } catch (error) {
          if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
          await unlink(file).catch(() => {});
          await rename(temp, file);
        }
      });
    },
    delete(sessionID) {
      return run(async () => {
        await unlink(fileFor(sessionID)).catch(() => {});
      });
    },
  };
}
