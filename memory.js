import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const PRIVATE_BLOCK_RE = /<private\b[^>]*>[\s\S]*?<\/private>/gi;
const PRIVATE_TAG_RE = /<\/?private\b[^>]*>/gi;
const SECRET_RE = /\b(?:sk|pk|ghp|gho|ghu|ghs|ghr|github_pat|xox[baprs]|AKIA)[-_A-Za-z0-9]{8,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const ASSIGNMENT_RE =
  /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
]);

export function defaultDataDir() {
  return path.join(homedir(), ".local", "share", "opencode-qwen-harness");
}

export function sanitizeMemoryText(value, maxLength = 1200, redactSecrets = true) {
  let text = String(value ?? "");
  text = text.replace(PRIVATE_BLOCK_RE, " ").replace(PRIVATE_TAG_RE, " ");
  if (redactSecrets) {
    text = text.replace(SECRET_RE, "[redacted]");
    text = text.replace(BEARER_RE, "Bearer [redacted]");
    text = text.replace(ASSIGNMENT_RE, "$1[redacted]");
  }
  text = text.replace(/\u0000/g, "").trim();
  return text.slice(0, maxLength);
}

export function oneLine(value, maxLength = 240, redactSecrets = true) {
  const text = sanitizeMemoryText(value, maxLength * 4, redactSecrets)
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

export function projectKey(root) {
  return createHash("sha256")
    .update(path.resolve(String(root || process.cwd())))
    .digest("hex")
    .slice(0, 16);
}

export function sessionKey(sessionID) {
  return createHash("sha256").update(String(sessionID ?? "")).digest("hex").slice(0, 24);
}

function observationID() {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function asStringArray(value, maxLength, maxItems = 20, redactSecrets = true) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => sanitizeMemoryText(item, maxLength, redactSecrets))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

export function normalizeObservation(value, redactSecrets = true) {
  if (!value || typeof value !== "object") return null;
  const summary = oneLine(value.summary, 300, redactSecrets);
  if (!summary) return null;
  const kind = ["request", "edit", "verification", "error", "todo", "note"].includes(value.kind)
    ? value.kind
    : "note";
  const parsed = typeof value.ts === "number" ? value.ts : Date.parse(value.ts);
  const ts = Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
  return {
    id: typeof value.id === "string" && value.id ? value.id : observationID(),
    ts,
    sessionID: String(value.sessionID ?? "").slice(0, 160),
    kind,
    summary,
    files: asStringArray(value.files, 200, 20, redactSecrets),
    command:
      typeof value.command === "string"
        ? sanitizeMemoryText(value.command, 300, redactSecrets)
        : undefined,
    status:
      typeof value.status === "string"
        ? sanitizeMemoryText(value.status, 40, redactSecrets)
        : undefined,
    tags: asStringArray(value.tags, 40, 20, redactSecrets),
  };
}

function parseObservation(line, redactSecrets = true) {
  try {
    return normalizeObservation(JSON.parse(line), redactSecrets);
  } catch {
    return null;
  }
}

function recencyScore(ts, now) {
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, now - time) / 86400000;
  return Math.exp(-ageDays / 30);
}

function queryTerms(query) {
  const terms = new Set();
  const lower = String(query ?? "").toLowerCase();
  for (const match of lower.matchAll(/[a-z0-9_.\/-]{2,}/g)) {
    const term = match[0].replace(/^[./-]+|[./-]+$/g, "");
    if (term && !STOP_WORDS.has(term)) terms.add(term);
  }
  for (const match of lower.matchAll(/\p{Script=Han}/gu)) terms.add(match[0]);
  return [...terms].slice(0, 48);
}

function observationText(observation) {
  return [
    observation.summary,
    observation.command,
    observation.status,
    ...(observation.files ?? []),
    ...(observation.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function rankObservations(entries, query, now = Date.now(), limit = 6) {
  const terms = queryTerms(query);
  const scored = entries.map((observation) => {
    const text = observationText(observation);
    let hits = 0;
    for (const term of terms) {
      if (text.includes(term)) hits += 1;
    }
    const match = terms.length > 0 ? hits / terms.length : 0;
    const kindBonus =
      observation.kind === "verification" || observation.kind === "error"
        ? 0.4
        : observation.kind === "edit"
          ? 0.3
          : observation.kind === "request"
            ? 0.2
            : 0;
    return {
      observation,
      score: match * 4 + recencyScore(observation.ts, now) * 2 + kindBonus,
    };
  });
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Date.parse(right.observation.ts) - Date.parse(left.observation.ts);
  });
  return scored.slice(0, limit).map((item) => item.observation);
}

export function buildMemoryBlock(entries, maxChars = 3000) {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  const lines = [
    "## Project memory",
    "Local notes from earlier sessions; they may be stale. Verify before relying on them.",
  ];
  for (const observation of entries) {
    const date = observation.ts.slice(0, 10);
    const files =
      Array.isArray(observation.files) && observation.files.length > 0
        ? ` (files: ${observation.files.slice(0, 4).join(", ")})`
        : "";
    const status = observation.status ? ` [${observation.status}]` : "";
    const line = `- ${date} [${observation.kind}]${status} ${observation.summary}${files}`;
    if (lines.join("\n").length + line.length + 1 > maxChars) break;
    lines.push(line);
  }
  return lines.length > 2 ? lines.join("\n") : "";
}

function normalizeLimit(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

export function createMemoryStore(options = {}) {
  const dataDir = path.resolve(options.dataDir || defaultDataDir());
  const projectRoot = options.projectRoot || process.cwd();
  const dir = path.join(dataDir, "projects", projectKey(projectRoot));
  const file = path.join(dir, "observations.jsonl");
  const maxEntries = normalizeLimit(options.maxEntries, 500);
  const maxAgeDays = normalizeLimit(options.maxAgeDays, 90);
  const redactSecrets = options.redactSecrets !== false;
  let cache = null;
  let queue = Promise.resolve();

  const writeCache = async () => {
    if (!cache) return;
    await mkdir(dir, { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${cache.map((item) => JSON.stringify(item)).join("\n")}\n`, {
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
  };

  const loadUnlocked = async () => {
    if (cache) return cache;
    let raw = "";
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const minTime = Date.now() - maxAgeDays * 86400000;
    const parsed = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => parseObservation(line, redactSecrets))
      .filter(Boolean)
      .filter((observation) => Date.parse(observation.ts) >= minTime)
      .slice(-maxEntries * 2);
    cache = parsed.length > maxEntries ? parsed.slice(-maxEntries) : parsed;
    if (parsed.length > maxEntries) await writeCache();
    return cache;
  };

  const run = (fn) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  const load = () => run(loadUnlocked);

  const append = (value) =>
    run(async () => {
      const observation = normalizeObservation(value, redactSecrets);
      if (!observation) return null;
      const entries = await loadUnlocked();
      entries.push(observation);
      if (entries.length > maxEntries) {
        cache = entries.slice(-maxEntries);
        await writeCache();
      } else {
        await mkdir(dir, { recursive: true });
        await appendFile(file, `${JSON.stringify(observation)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      return observation;
    });

  return {
    file,
    load,
    append,
    captureRequest({ sessionID, text, kind }) {
      return append({
        sessionID,
        kind: "request",
        summary: oneLine(text, 220, redactSecrets),
        tags: kind ? [kind] : [],
      });
    },
    captureEdit({ sessionID, tool, files }) {
      const paths = asStringArray(files, 200, 20, redactSecrets);
      return append({
        sessionID,
        kind: "edit",
        summary: paths.length > 0 ? `Edited ${paths.join(", ")}` : `Used ${tool} to change files`,
        files: paths,
        tags: [tool],
      });
    },
    captureVerification({ sessionID, command, failed, output }) {
      const detail = failed ? oneLine(output, 300, redactSecrets) : "";
      return append({
        sessionID,
        kind: "verification",
        summary: `Verification ${failed ? "failed" : "passed"}: ${oneLine(command, 180, redactSecrets)}${detail ? ` — ${detail}` : ""}`,
        command,
        status: failed ? "failed" : "passed",
      });
    },
    captureError({ sessionID, command, output }) {
      return append({
        sessionID,
        kind: "error",
        summary: `Command failed: ${oneLine(command, 180, redactSecrets)} — ${oneLine(output, 300, redactSecrets)}`,
        command,
        status: "failed",
      });
    },
    captureTodo({ sessionID, active, count }) {
      return append({
        sessionID,
        kind: "todo",
        summary: `Todo list ${active ? "active" : "cleared"}${count ? ` (${count} items)` : ""}`,
        status: active ? "active" : "cleared",
      });
    },
    async recall({ query, sessionID, limit = 6, maxChars = 3000 } = {}) {
      const entries = (await load()).filter(
        (observation) => observation.sessionID !== String(sessionID ?? ""),
      );
      return buildMemoryBlock(rankObservations(entries, query, Date.now(), limit), maxChars);
    },
  };
}
