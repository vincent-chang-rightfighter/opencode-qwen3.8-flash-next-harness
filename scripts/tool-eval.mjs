import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

const upstream = new URL(process.env.STRATA_UPSTREAM || "http://127.0.0.1:8080/v1");
const apiKey = process.env.STRATA_API_KEY;
const opencodeBin = process.env.OPENCODE_BIN || "opencode";
if (!apiKey) throw new Error("STRATA_API_KEY is required");
const cases = JSON.parse(await readFile(path.resolve("eval/tool-cases.json"), "utf8"));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function freePort() {
  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  return port;
}

async function waitForHealth(baseURL, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error("opencode serve exited");
    try {
      const response = await fetch(`${baseURL}/global/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("opencode serve did not become healthy");
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method || "GET"} ${url} -> ${response.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

function toolNames(parts) {
  return parts.filter((part) => part?.type === "tool").map((part) => part.tool);
}

function toolErrors(parts) {
  return parts
    .filter((part) => part?.type === "tool" && part.state?.status === "error")
    .map((part) => part.state?.error ?? part.state?.output ?? "");
}

function textOf(parts) {
  return parts
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("");
}

let tempRoot;
let child;
const results = [];
try {
  tempRoot = await mkdtemp(path.join(tmpdir(), "qwen-tool-eval-"));
  const project = path.join(tempRoot, "project");
  await mkdir(project, { recursive: true });
  for (const caseDef of cases) {
    for (const [name, content] of Object.entries(caseDef.setupFiles ?? {})) {
      await writeFile(path.join(project, name), content);
    }
  }

  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: { freecad: { enabled: false } },
    provider: {
      strata: {
        npm: "@ai-sdk/openai-compatible",
        name: "Strata real",
        options: { baseURL: upstream.href, apiKey },
        models: {
          "qwen3.8-flash-next-iq3_s": {
            name: "Qwen3.8 Flash Next (IQ3_S)",
            attachment: false,
            reasoning: true,
            tool_call: true,
            limit: { context: 32768, output: 4096 },
          },
        },
      },
    },
    model: "strata/qwen3.8-flash-next-iq3_s",
    small_model: "strata/qwen3.8-flash-next-iq3_s",
  };
  await writeFile(path.join(project, "opencode.json"), JSON.stringify(config, null, 2));

  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  child = spawn(opencodeBin, [
    "serve",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
    "--print-logs",
    "--log-level",
    "ERROR",
  ], { cwd: project, env: { ...process.env }, windowsHide: true });
  await waitForHealth(baseURL, child);

  for (const caseDef of cases) {
    const session = await jsonRequest(`${baseURL}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: caseDef.id }),
    });
    const reply = await jsonRequest(`${baseURL}/session/${session.id}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text: caseDef.prompt }] }),
    });
    const history = await jsonRequest(`${baseURL}/session/${session.id}/message`);
    const historyParts = Array.isArray(history)
      ? history.flatMap((item) => item.parts ?? [])
      : [];
    const parts = [...historyParts, ...(reply?.parts ?? [])];
    const tools = toolNames(parts);
    const errors = toolErrors(parts);
    const text = textOf(reply?.parts ?? []);
    const toolOk = caseDef.expectTool ? tools.includes(caseDef.expectTool) : true;
    const textOk = caseDef.expectText ? text.includes(caseDef.expectText) : true;
    const errorOk = caseDef.expectError
      ? errors.some((error) => String(error).includes(caseDef.expectError))
      : true;
    results.push({
      id: caseDef.id,
      pass: toolOk && textOk && errorOk,
      tools,
      text: text.slice(0, 300),
      errors: errors.map((error) => String(error).slice(0, 300)),
      checks: { toolOk, textOk, errorOk },
    });
  }
} finally {
  child?.kill();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}

console.log(JSON.stringify({
  passed: results.filter((result) => result.pass).length,
  total: results.length,
  results,
}, null, 2));
