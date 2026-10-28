export const EFFORTS = ["none", "low", "medium", "high", "xhigh"];

export const SUBAGENT_DISABLED_INSTRUCTION =
  "Subagents are disabled for this model. Do not call the task tool; complete the work directly with the available tools.";

export const DEFAULTS = {
  enabled: true,
  providers: ["strata"],
  modelIncludes: [],
  defaultEffort: "medium",
  codeEffort: "high",
  toolEffort: "low",
  toolFailureEffort: "high",
  toolFailureEscalatedEffort: "xhigh",
  debugEffort: "high",
  designEffort: "high",
  searchEffort: "medium",
  mechanicalEffort: "low",
  highEffort: "high",
  ultraEffort: "xhigh",
  simpleEffort: "low",
  riskMinimumEffort: "high",
  defaultTemperature: 1.0,
  codeTemperature: 0.6,
  toolTemperature: 0.6,
  highTemperature: 1.0,
  ultraTemperature: 1.0,
  simpleTemperature: 1.0,
  codeAgents: ["code", "coder", "engineer", "debug"],
  planAgents: ["plan", "architect", "design"],
  searchAgents: ["explore", "search", "recon"],
  ignoreAgents: ["title", "summary", "compaction"],
  disableSubagents: false,
  riskBumpSteps: 1,
  multiFileBump: 1,
  longPromptThreshold: 4000,
  longPromptBump: 1,
  respectExplicitEffort: true,
  overrideTemperature: true,
  debug: false,
  ultraKeywords: [
    "ultrathink",
    "think harder",
    "think really hard",
    "think very hard",
    "think super hard",
    "think intensely",
    "think longer",
    "megathink",
  ],
  highKeywords: [
    "think hard",
    "think deeply",
    "think more",
    "architecture",
    "race condition",
    "deadlock",
    "concurrency",
    "security",
    "migration",
    "refactor",
    "debug",
    "stack trace",
    "traceback",
    "failing test",
    "performance",
    "optimi",
    "algorithm",
  ],
  debugKeywords: [
    "error",
    "exception",
    "traceback",
    "stack trace",
    "failing test",
    "test failed",
    "tests failed",
    "failure",
    "crash",
    "panic",
    "segfault",
    "segmentation fault",
    "hang",
    "deadlock",
    "race condition",
    "regression",
    "root cause",
    "investigate",
    "bug",
    "broken",
    "timeout",
    "timed out",
    "not working",
    "why does",
    "why is",
  ],
  designKeywords: [
    "architecture",
    "design",
    "tradeoff",
    "trade-off",
    "compare",
    "plan",
    "strategy",
    "approach",
    "review",
    "audit",
    "security",
    "performance",
    "optimi",
    "migration",
    "migrate",
    "scalability",
  ],
  mechanicalKeywords: [
    "rename",
    "typo",
    "format",
    "formatting",
    "lint",
    "comment",
    "docstring",
    "whitespace",
    "indentation",
    "one-line",
    "one line",
    "boilerplate",
    "bump version",
    "update changelog",
  ],
  searchKeywords: [
    "find",
    "locate",
    "list",
    "where is",
    "where are",
    "what is",
    "what are",
    "explain",
    "summarize",
    "show me",
    "search",
    "grep",
    "read file",
    "how many",
    "which file",
  ],
  implementKeywords: [
    "implement",
    "add ",
    "create ",
    "write ",
    "build ",
    "refactor",
    "fix ",
    "patch",
    "update ",
    "change ",
    "modify ",
    "migrate",
    "test ",
    "unit test",
    "endpoint",
    "function",
    "class",
    "component",
    "api ",
  ],
  riskKeywords: [
    "production",
    "deploy",
    "deployment",
    "release",
    "migration",
    "migrate",
    "schema change",
    "delete",
    "drop table",
    "truncate",
    "rm -rf",
    "destructive",
    "force push",
    "credentials",
    "secret",
    "secrets",
    "api key",
    "password",
    "payment",
    "billing",
    "security",
    "permissions",
    "authentication",
    "auth ",
    "data loss",
    "irreversible",
    "rollback",
    "backup",
  ],
  simplePatterns: [
    /^\s*(hi|hello|hey|thanks|thank you|ok|okay)\b/i,
    /\b(rename|typo|one[- ]line|quick fix|simple change)\b/i,
  ],
};

const CODE_EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|kts|c|cc|cpp|cxx|h|hpp|cs|php|rb|sh|bash|zsh|ps1|sql|json|ya?ml|toml|ini|md|html|css|scss|vue|svelte|ex|exs|erl|hrl|lua|swift|dart";

const CODE_FILE_RE = new RegExp(
  `(?:^|[\\s("'\`])(?:[\\w.-]+[\\\\/])*[\\w.-]+\\.(?:${CODE_EXTENSIONS})\\b`,
  "i",
);

const FILE_PATH_RE = new RegExp(
  `(?:[\\w.-]+[\\\\/])*[\\w.-]+\\.(?:${CODE_EXTENSIONS})\\b`,
  "gi",
);

const CODE_KEYWORDS = [
  "function ",
  "def ",
  "class ",
  "import ",
  "export ",
  "const ",
  "let ",
  "var ",
  "return ",
  "async ",
  "await ",
  "public ",
  "private ",
  "interface ",
  "struct ",
  "select ",
  "insert into",
  "create table",
  "dockerfile",
  "docker compose",
  "git diff",
  "merge conflict",
  "unit test",
  "pytest",
  "jest",
  "vitest",
  "compile",
  "syntax error",
  "stack trace",
  "traceback",
  "exception",
  "npm ",
  "pnpm ",
  "yarn ",
  "pip ",
  "cargo ",
  "go build",
  "cmake",
  "make ",
];

const TOOL_FAILURE_RE =
  /(?:^|\n)\s*(?:error|fatal|panic|traceback|exception)\b|command not found|permission denied|no such file|exit (?:code|status) [1-9]|tests? failed|assertion failed|segmentation fault|timed out|timeout after|\bFAILED\b/i;

function asStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  return value.filter((item) => typeof item === "string" && item.length > 0);
}

function asEffort(value, fallback) {
  return typeof value === "string" && EFFORTS.includes(value) ? value : fallback;
}

function asNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function effortIndex(effort) {
  const index = EFFORTS.indexOf(effort);
  return index < 0 ? 2 : index;
}

function bumpEffort(effort, steps) {
  const amount = typeof steps === "number" && Number.isFinite(steps) ? Math.max(0, steps) : 0;
  const index = Math.min(EFFORTS.length - 1, effortIndex(effort) + Math.round(amount));
  return EFFORTS[index];
}

function maxEffort(left, right) {
  return effortIndex(left) >= effortIndex(right) ? left : right;
}

export function resolveOptions(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    enabled: asBoolean(input.enabled, DEFAULTS.enabled),
    providers: asStringArray(input.providers, DEFAULTS.providers),
    modelIncludes: asStringArray(input.modelIncludes, DEFAULTS.modelIncludes),
    defaultEffort: asEffort(input.defaultEffort, DEFAULTS.defaultEffort),
    codeEffort: asEffort(input.codeEffort, DEFAULTS.codeEffort),
    toolEffort: asEffort(input.toolEffort, DEFAULTS.toolEffort),
    toolFailureEffort: asEffort(input.toolFailureEffort, DEFAULTS.toolFailureEffort),
    toolFailureEscalatedEffort: asEffort(
      input.toolFailureEscalatedEffort,
      DEFAULTS.toolFailureEscalatedEffort,
    ),
    debugEffort: asEffort(input.debugEffort, DEFAULTS.debugEffort),
    designEffort: asEffort(input.designEffort, DEFAULTS.designEffort),
    searchEffort: asEffort(input.searchEffort, DEFAULTS.searchEffort),
    mechanicalEffort: asEffort(input.mechanicalEffort, DEFAULTS.mechanicalEffort),
    highEffort: asEffort(input.highEffort, DEFAULTS.highEffort),
    ultraEffort: asEffort(input.ultraEffort, DEFAULTS.ultraEffort),
    simpleEffort: asEffort(input.simpleEffort, DEFAULTS.simpleEffort),
    riskMinimumEffort: asEffort(input.riskMinimumEffort, DEFAULTS.riskMinimumEffort),
    defaultTemperature: asNumber(input.defaultTemperature, DEFAULTS.defaultTemperature),
    codeTemperature: asNumber(input.codeTemperature, DEFAULTS.codeTemperature),
    toolTemperature: asNumber(input.toolTemperature, DEFAULTS.toolTemperature),
    highTemperature: asNumber(input.highTemperature, DEFAULTS.highTemperature),
    ultraTemperature: asNumber(input.ultraTemperature, DEFAULTS.ultraTemperature),
    simpleTemperature: asNumber(input.simpleTemperature, DEFAULTS.simpleTemperature),
    codeAgents: asStringArray(input.codeAgents, DEFAULTS.codeAgents).map((agent) =>
      agent.toLowerCase(),
    ),
    planAgents: asStringArray(input.planAgents, DEFAULTS.planAgents).map((agent) =>
      agent.toLowerCase(),
    ),
    searchAgents: asStringArray(input.searchAgents, DEFAULTS.searchAgents).map((agent) =>
      agent.toLowerCase(),
    ),
    ignoreAgents: asStringArray(input.ignoreAgents, DEFAULTS.ignoreAgents).map((agent) =>
      agent.toLowerCase(),
    ),
    disableSubagents: asBoolean(input.disableSubagents, DEFAULTS.disableSubagents),
    riskBumpSteps: asNumber(input.riskBumpSteps, DEFAULTS.riskBumpSteps),
    multiFileBump: asNumber(input.multiFileBump, DEFAULTS.multiFileBump),
    longPromptThreshold: asNumber(input.longPromptThreshold, DEFAULTS.longPromptThreshold),
    longPromptBump: asNumber(input.longPromptBump, DEFAULTS.longPromptBump),
    respectExplicitEffort: asBoolean(
      input.respectExplicitEffort,
      DEFAULTS.respectExplicitEffort,
    ),
    overrideTemperature: asBoolean(input.overrideTemperature, DEFAULTS.overrideTemperature),
    debug: asBoolean(input.debug, DEFAULTS.debug),
    ultraKeywords: asStringArray(input.ultraKeywords, DEFAULTS.ultraKeywords).map((keyword) =>
      keyword.toLowerCase(),
    ),
    highKeywords: asStringArray(input.highKeywords, DEFAULTS.highKeywords).map((keyword) =>
      keyword.toLowerCase(),
    ),
    debugKeywords: asStringArray(input.debugKeywords, DEFAULTS.debugKeywords).map((keyword) =>
      keyword.toLowerCase(),
    ),
    designKeywords: asStringArray(input.designKeywords, DEFAULTS.designKeywords).map((keyword) =>
      keyword.toLowerCase(),
    ),
    mechanicalKeywords: asStringArray(
      input.mechanicalKeywords,
      DEFAULTS.mechanicalKeywords,
    ).map((keyword) => keyword.toLowerCase()),
    searchKeywords: asStringArray(input.searchKeywords, DEFAULTS.searchKeywords).map(
      (keyword) => keyword.toLowerCase(),
    ),
    implementKeywords: asStringArray(input.implementKeywords, DEFAULTS.implementKeywords).map(
      (keyword) => keyword.toLowerCase(),
    ),
    riskKeywords: asStringArray(input.riskKeywords, DEFAULTS.riskKeywords).map((keyword) =>
      keyword.toLowerCase(),
    ),
    simplePatterns: DEFAULTS.simplePatterns,
  };
}

export function partsText(parts) {
  if (!Array.isArray(parts)) return "";
  const text = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (typeof part.text === "string") {
      text.push(part.text);
    } else if (
      part.type === "tool" ||
      part.type === "tool_result" ||
      part.type === "tool-result"
    ) {
      try {
        text.push(JSON.stringify(part.state ?? part).slice(0, 4000));
      } catch {
        text.push(String(part.type));
      }
    }
  }
  return text.join("\n").slice(0, 20000);
}

export function messageText(message) {
  if (!message || typeof message !== "object") return "";
  const direct = partsText(message.parts);
  if (direct) return direct;
  if (typeof message.content === "string") return message.content.slice(0, 20000);
  return partsText(message.info?.parts);
}

export function looksLikeCode(text) {
  if (typeof text !== "string" || !text) return false;
  if (text.includes("```")) return true;
  if (CODE_FILE_RE.test(text)) return true;
  const lower = text.toLowerCase();
  return CODE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function looksLikeToolFailure(text) {
  if (typeof text !== "string" || !text) return false;
  return TOOL_FAILURE_RE.test(text);
}

export function toolPartsFailed(parts) {
  if (!Array.isArray(parts)) return false;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const state = part.state;
    if (state && typeof state === "object") {
      if (state.status === "error" || state.error || state.isError) return true;
    }
    if (
      part.type === "tool" ||
      part.type === "tool_result" ||
      part.type === "tool-result"
    ) {
      const output = state?.output ?? part.output;
      const text = typeof output === "string" ? output : output ? JSON.stringify(output) : "";
      if (looksLikeToolFailure(text)) return true;
    }
  }
  return false;
}

function countFilePaths(text) {
  if (typeof text !== "string" || !text) return 0;
  const matches = text.match(FILE_PATH_RE);
  if (!matches) return 0;
  return new Set(matches.map((match) => match.toLowerCase())).size;
}

function isSimple(text, options) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 160 || looksLikeCode(trimmed)) return false;
  return options.simplePatterns.some((pattern) => pattern.test(trimmed));
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function temperatureFor(kind, options) {
  if (kind === "tool-failure" || kind === "tool-failure-repeat" || kind === "tool-success") {
    return options.toolTemperature;
  }
  if (kind === "implement" || kind === "debug") return options.codeTemperature;
  if (kind === "design") return options.highTemperature;
  if (kind === "mechanical" || kind === "simple") return options.simpleTemperature;
  if (kind === "ultra") return options.ultraTemperature;
  return options.defaultTemperature;
}

export function classifyTask(text, options, context = {}) {
  const source = typeof text === "string" ? text : "";
  const lower = source.toLowerCase();
  const agent = typeof context.agent === "string" ? context.agent.toLowerCase() : "";
  const failures =
    typeof context.failures === "number" && Number.isFinite(context.failures)
      ? Math.max(0, context.failures)
      : 0;

  if (context.toolTurn) {
    if (context.toolFailed) {
      const escalated = failures >= 2;
      const kind = escalated ? "tool-failure-repeat" : "tool-failure";
      return {
        kind,
        effort: escalated
          ? options.toolFailureEscalatedEffort
          : options.toolFailureEffort,
        temperature: options.toolTemperature,
        reason: escalated
          ? `tool failure x${failures}`
          : "tool failure",
        signals: { toolFailed: true, failures },
      };
    }
    return {
      kind: "tool-success",
      effort: options.toolEffort,
      temperature: options.toolTemperature,
      reason: "tool result ok",
      signals: { toolFailed: false, failures },
    };
  }

  const signals = {
    code: looksLikeCode(source),
    implement: hasAny(lower, options.implementKeywords),
    debug: hasAny(lower, options.debugKeywords),
    design: hasAny(lower, options.designKeywords),
    mechanical: hasAny(lower, options.mechanicalKeywords),
    search: hasAny(lower, options.searchKeywords),
    risk: hasAny(lower, options.riskKeywords),
    fileCount: countFilePaths(source),
    agentCode: Boolean(agent) && options.codeAgents.includes(agent),
    agentPlan: Boolean(agent) && options.planAgents.includes(agent),
    agentSearch: Boolean(agent) && options.searchAgents.includes(agent),
    longPrompt: source.length > options.longPromptThreshold,
  };

  if (hasAny(lower, options.ultraKeywords)) {
    return {
      kind: "ultra",
      effort: options.ultraEffort,
      temperature: options.ultraTemperature,
      reason: "ultra keyword",
      signals,
    };
  }

  let kind;
  let effort;
  const reasons = [];

  if (signals.debug) {
    kind = "debug";
    effort = options.debugEffort;
    reasons.push("debug signals");
  } else if (signals.design || signals.agentPlan) {
    kind = "design";
    effort = options.designEffort;
    reasons.push(signals.agentPlan ? `plan agent ${agent}` : "design signals");
  } else if (signals.code || signals.implement || signals.agentCode) {
    kind = "implement";
    effort = options.codeEffort;
    reasons.push(
      signals.code ? "code-like prompt" : signals.agentCode ? `code agent ${agent}` : "implement verb",
    );
  } else if (signals.mechanical) {
    kind = "mechanical";
    effort = options.mechanicalEffort;
    reasons.push("mechanical change");
  } else if (signals.search || signals.agentSearch) {
    kind = "search";
    effort = options.searchEffort;
    reasons.push(signals.agentSearch ? `search agent ${agent}` : "search/recon prompt");
  } else if (isSimple(source, options) && !signals.risk) {
    kind = "simple";
    effort = options.simpleEffort;
    reasons.push("simple prompt");
  } else {
    kind = "default";
    effort = options.defaultEffort;
    reasons.push("default");
  }

  if (signals.risk) {
    effort = bumpEffort(effort, options.riskBumpSteps);
    effort = maxEffort(effort, options.riskMinimumEffort);
    reasons.push("risk bump");
  }

  if (signals.fileCount >= 2 && effortIndex(effort) < effortIndex("high")) {
    effort = bumpEffort(effort, options.multiFileBump);
    reasons.push(`scope ${signals.fileCount} files`);
  }

  if (signals.longPrompt && effortIndex(effort) < effortIndex("high")) {
    effort = bumpEffort(effort, options.longPromptBump);
    reasons.push("long prompt");
  }

  if (hasAny(lower, options.highKeywords)) {
    effort = maxEffort(effort, options.highEffort);
    reasons.push("high-effort keyword");
  }

  return {
    kind,
    effort,
    temperature: temperatureFor(kind, options),
    reason: reasons.join("; "),
    signals,
  };
}

export function matchesTarget(input, options) {
  const providerID = String(
    input?.provider?.info?.id ?? input?.provider?.id ?? input?.model?.providerID ?? "",
  ).toLowerCase();
  if (
    options.providers.length > 0 &&
    !options.providers.some((provider) => providerID === provider.toLowerCase())
  ) {
    return false;
  }

  const modelID = String(
    input?.model?.id ?? input?.model?.modelID ?? input?.model?.name ?? "",
  ).toLowerCase();
  if (
    options.modelIncludes.length > 0 &&
    !options.modelIncludes.some((model) => modelID.includes(model.toLowerCase()))
  ) {
    return false;
  }

  return true;
}

export function remember(sessions, sessionID, value) {
  sessions.delete(sessionID);
  sessions.set(sessionID, value);
  while (sessions.size > 500) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function hasExplicitEffort(chatTemplateKwargs) {
  return (
    chatTemplateKwargs &&
    typeof chatTemplateKwargs === "object" &&
    !Array.isArray(chatTemplateKwargs) &&
    (Object.prototype.hasOwnProperty.call(chatTemplateKwargs, "reasoning_effort") ||
      Object.prototype.hasOwnProperty.call(chatTemplateKwargs, "enable_thinking"))
  );
}

export function buildChatTemplateKwargs(existing, effort) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : {};
  if (effort === "none") {
    delete base.reasoning_effort;
    base.enable_thinking = false;
  } else {
    base.reasoning_effort = effort;
    base.enable_thinking = true;
  }
  return base;
}
