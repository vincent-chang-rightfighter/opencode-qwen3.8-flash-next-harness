import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const opencodeBin = process.env.OPENCODE_BIN || "opencode";
const requests = [];

const mock = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (request.url?.endsWith("/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [] }));
    return;
  }
  if (!request.url?.includes("/chat/completions")) {
    response.writeHead(404);
    response.end();
    return;
  }

  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {}
  requests.push(body);

  const id = "chatcmpl-opencode-smoke";
  const created = Math.floor(Date.now() / 1000);
  if (body.stream) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: body.model,
        choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
      })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [
        { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
});

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address().port));
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

function startOpencode(cwd, port) {
  const child = spawn(
    opencodeBin,
    [
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
      "--print-logs",
      "--log-level",
      "ERROR",
    ],
    {
      cwd,
      env: { ...process.env },
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return {
    child,
    logs: () => ({ stdout, stderr }),
    stop: () => {
      child.kill();
    },
  };
}

async function waitForHealth(baseURL, server) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.child.exitCode !== null) {
      const { stdout, stderr } = server.logs();
      throw new Error(`opencode serve exited\n${stderr}\n${stdout}`);
    }
    try {
      const response = await fetch(`${baseURL}/global/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const { stdout, stderr } = server.logs();
  throw new Error(`opencode serve did not become healthy\n${stderr}\n${stdout}`);
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${url} -> ${response.status}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

let tempRoot;
let opencode;
try {
  const mockPort = await listen(mock);
  const opencodePort = await freePort();
  const baseURL = `http://127.0.0.1:${opencodePort}`;
  tempRoot = await mkdtemp(path.join(tmpdir(), "qwen-harness-smoke-"));
  const project = path.join(tempRoot, "project");
  await mkdir(project, { recursive: true });

  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: { freecad: { enabled: false } },
    provider: {
      strata: {
        npm: "@ai-sdk/openai-compatible",
        name: "Mock local Qwen",
        options: {
          baseURL: `http://127.0.0.1:${mockPort}/v1`,
          apiKey: "smoke-test",
        },
        models: {
          "qwen3.8-flash-next-iq3_s": {
            name: "Mock Qwen3.8 Flash Next",
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
  opencode = startOpencode(project, opencodePort);
  await waitForHealth(baseURL, opencode);

  const session = await jsonRequest(`${baseURL}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "harness smoke" }),
  });

  await jsonRequest(`${baseURL}/session/${session.id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
  });
} finally {
  opencode?.stop();
  await close(mock);
  if (tempRoot) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch (error) {
      console.error(`smoke cleanup skipped: ${error.message}`);
    }
  }
}

const request = requests.find((body) => body?.chat_template_kwargs?.reasoning_effort);
if (!request) {
  console.error("opencode smoke failed: no request carried chat_template_kwargs");
  console.error(
    JSON.stringify(
      requests.map((body) => ({
        model: body?.model,
        hasChatTemplateKwargs: Boolean(body?.chat_template_kwargs),
        hasReasoningEffort: Boolean(body?.reasoning_effort),
      })),
      null,
      2,
    ),
  );
  console.error("Install this plugin in the active opencode config before running the smoke test.");
  process.exit(1);
}

console.log(
  `opencode smoke ok: ${requests.length} request(s), reasoning_effort=${request.chat_template_kwargs.reasoning_effort}`,
);
