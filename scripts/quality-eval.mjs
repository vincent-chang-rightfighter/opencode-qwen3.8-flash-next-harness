import { readFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";

const upstream = new URL(process.env.STRATA_UPSTREAM || "http://127.0.0.1:8080/v1");
const apiKey = process.env.STRATA_API_KEY;
const model = process.env.STRATA_MODEL || "qwen3.8-flash-next-iq3_s";
const repeats = Number(process.env.EVAL_REPEATS || "1");
if (!apiKey) throw new Error("STRATA_API_KEY is required");

const base = upstream.href.endsWith("/") ? upstream.href : `${upstream.href}/`;
const quality = JSON.parse(
  await readFile(path.resolve("eval/quality-cases.json"), "utf8"),
);
const long = JSON.parse(
  await readFile(path.resolve("eval/long-cases.json"), "utf8"),
);
const ids = process.env.EVAL_IDS
  ? process.env.EVAL_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  : null;
const cases = [...quality, ...long].filter(
  (caseDef) => !ids || ids.includes(caseDef.id),
);

const arms = [
  {
    id: "thinking-1.0",
    sampling: {
      temperature: 1.0,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      presence_penalty: 0,
      repetition_penalty: 1,
    },
    chatTemplate: { enable_thinking: true, reasoning_effort: "xhigh" },
  },
  {
    id: "thinking-0.6",
    sampling: {
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      presence_penalty: 0,
      repetition_penalty: 1,
    },
    chatTemplate: { enable_thinking: true, reasoning_effort: "xhigh" },
  },
  {
    id: "non-thinking",
    sampling: {
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      min_p: 0,
      presence_penalty: 1.5,
      repetition_penalty: 1,
    },
    chatTemplate: { enable_thinking: false },
  },
];

function normalize(text) {
  return String(text ?? "")
    .replace(/```[a-zA-Z0-9_-]*/g, "")
    .replace(/```/g, "")
    .replace(/\s+/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .toLowerCase();
}

function check(caseDef, content) {
  if (caseDef.check === "regex") {
    return new RegExp(caseDef.expected, "i").test(content);
  }
  if (caseDef.check === "js") {
    const source = String(content ?? "")
      .replace(/```[a-zA-Z0-9_-]*/g, "")
      .replace(/```/g, "")
      .trim();
    const start = source.indexOf(`function ${caseDef.function}`);
    if (start < 0) return false;
    const code = source.slice(start);
    for (const test of caseDef.tests) {
      try {
        const sandbox = {};
        vm.runInNewContext(
          `${code}\nresult = ${caseDef.function}(...${JSON.stringify(test.args)});`,
          sandbox,
          { timeout: 1000 },
        );
        if (JSON.stringify(sandbox.result) !== JSON.stringify(test.expected)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  return normalize(content) === normalize(caseDef.expected);
}

function buildPrompt(caseDef) {
  if (caseDef.promptBuilder !== "long-context") return caseDef.prompt;
  const lines = [];
  const count = caseDef.fillerLines ?? 700;
  for (let index = 0; index < count; index += 1) {
    lines.push(`Routine maintenance log entry ${index}: no action required.`);
  }
  for (const fact of caseDef.facts ?? []) {
    if (fact.at >= 0 && fact.at < lines.length) lines[fact.at] = fact.text;
    else lines.push(fact.text);
  }
  lines.push(caseDef.question ?? "");
  return lines.join("\n");
}

async function runCase(arm, caseDef) {
  const started = Date.now();
  const response = await fetch(new URL("chat/completions", base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildPrompt(caseDef) }],
      max_tokens: caseDef.maxTokens ?? 512,
      stream: false,
      ...arm.sampling,
      chat_template_kwargs: arm.chatTemplate,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      id: caseDef.id,
      pass: false,
      latency: Date.now() - started,
      content: "",
      error: `HTTP ${response.status}: ${text.slice(0, 300)}`,
    };
  }
  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content ?? "";
  return {
    id: caseDef.id,
    pass: check(caseDef, content),
    latency: Date.now() - started,
    content,
    error: null,
  };
}

const report = [];
for (const arm of arms) {
  const results = [];
  for (const caseDef of cases) {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      try {
        results.push(await runCase(arm, caseDef));
      } catch (error) {
        results.push({
          id: caseDef.id,
          pass: false,
          latency: 0,
          content: "",
          error: error.message,
        });
      }
    }
  }
  const passed = results.filter((result) => result.pass).length;
  report.push({
    arm: arm.id,
    passed,
    total: results.length,
    rate: results.length ? passed / results.length : 0,
    averageLatencyMs: Math.round(
      results.reduce((sum, result) => sum + (result.latency || 0), 0) /
        Math.max(1, results.length),
    ),
    failures: results
      .filter((result) => !result.pass)
      .map((result) => ({
        id: result.id,
        error: result.error,
        content: result.content.slice(0, 200),
      })),
  });
}

console.log(JSON.stringify(report, null, 2));
