# opencode-qwen3.8-flash-next-harness

**English** | [繁體中文](README.zh-TW.md)

[![tests](https://github.com/vincent-chang-rightfighter/opencode-qwen3.8-flash-next-harness/actions/workflows/tests.yml/badge.svg)](https://github.com/vincent-chang-rightfighter/opencode-qwen3.8-flash-next-harness/actions/workflows/tests.yml)

Automatic per-request reasoning-effort and temperature routing for local or
self-hosted Qwen3.8 Flash Next models in [opencode](https://opencode.ai). It
targets known local provider ids and providers whose configured base URL is a
local address, as long as the model id matches `qwen3.8-flash-next`.

The plugin classifies each model request with fast heuristics and sets the
reasoning field supported by the provider profile:

- tool-result turns -> low effort
- code prompts, file paths, stack traces -> high effort, lower temperature
- `ultrathink` / `think harder` -> xhigh
- short greetings and trivial edits -> low
- everything else -> medium
- optionally disable the `task`/subagent tool for targeted models; local Qwen3.8 Flash Next subagents are weaker and slower than doing the work directly
- optionally ask the model to create a priority-ordered todo list for work that needs planning
- track edited files and remind the model to verify changes with tests/lint/build

It does not change the model or restart the server. It only adds per-request
parameters, so it works with a model already configured in opencode.

## Harness layers

The full local harness has three layers:

- `~/.config/opencode/AGENTS.md` and project `AGENTS.md` files define the
  working contract: inspect, plan, edit, verify, report.
- `opencode.jsonc` manages context and safety: `tool_output`, auto compaction,
  snapshots, and approval rules for destructive commands.
- this plugin supplies model-specific behavior: reasoning effort, todo
  planning, verification tracking, compaction state, and the `task` block.

## Requirements

- opencode with plugin support (`@opencode-ai/plugin` >= 1.14.24; this
  repository was developed against opencode 1.19.4).
- A local or self-hosted OpenAI-compatible endpoint serving
  `qwen3.8-flash-next`.
- No `strata` provider id is required. The default targets known local provider
  ids (`strata`, `ollama`, `llamacpp`, `vllm`, `lmstudio`, ...) and any provider
  whose configured `baseURL` is localhost, a private network, or Tailscale.
- Cloud providers are excluded by default because they are not in the local
  allowlist; `excludeProviders` is only an optional explicit deny list.
- Reasoning routing depends on the provider profile: Strata uses
  `chat_template_kwargs`; Ollama, llama.cpp, and vLLM use top-level
  `reasoning_effort`; unknown local providers default to no reasoning field
  unless configured in `providerProfiles`.

## Installation guide

### 1. Clone the repository

```bash
git clone https://github.com/vincent-chang-rightfighter/opencode-qwen3.8-flash-next-harness.git
cd opencode-qwen3.8-flash-next-harness
```

Use the absolute path of this checkout in the next step. On Windows it will
look like `C:/path/to/opencode-qwen3.8-flash-next-harness/index.js`; on Linux or
macOS use the matching absolute path.

### 2. Add the plugin

Add the plugin to the `plugin` array in `~/.config/opencode/opencode.jsonc`
or `.opencode/opencode.json`:

```json
{
  "plugin": [
    [
      "file:///C:/path/to/opencode-qwen3.8-flash-next-harness/index.js",
      {
        "providers": [],
        "modelIncludes": ["qwen3.8-flash-next"],
        "defaultEffort": "medium",
        "codeEffort": "high",
        "toolEffort": "low",
        "disableSubagents": true,
        "autoTodo": true,
        "autoVerify": true,
        "verificationGate": true,
        "debug": true
      }
    ]
  ]
}
```

opencode 1.19.x uses the singular `plugin` key. The plural `plugins` key is a
V2 setting; 1.19.x warns that it cannot be represented and omits it. Use `plugin`
unless you are running a V2 build. Set `debug` to `false` after troubleshooting.

### 3. Configure the local provider

If your provider is already configured, skip this step. A minimal Strata-style
provider looks like this; replace the base URL, key, and model id with your
deployment:

```json
{
  "provider": {
    "strata": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local Strata",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "apiKey": "replace-with-your-key"
      },
      "models": {
        "qwen3.8-flash-next-iq3_s": {
          "name": "Qwen3.8 Flash Next (IQ3_S)",
          "attachment": false,
          "reasoning": true,
          "tool_call": true,
          "limit": { "context": 131072, "output": 32768 }
        }
      }
    }
  },
  "model": "strata/qwen3.8-flash-next-iq3_s",
  "small_model": "strata/qwen3.8-flash-next-iq3_s"
}
```

The provider may be `ollama`, `llamacpp`, `vllm`, another known local id, or any
provider whose `baseURL` is local. The plugin chooses the reasoning field from
the provider profile automatically.

### 4. Restart opencode

Quit and restart opencode. Plugin and config changes are not hot-reloaded.

### 5. Verify

```bash
opencode models
npm run smoke:opencode
```

`opencode models` should list the configured model. `smoke:opencode` starts a
headless opencode server and a mock provider; it requires the plugin to be
active. Use `SMOKE_PROVIDER=ollama`, `llamacpp`, or `vllm` to test another
profile.

### 6. Uninstall

Remove the plugin tuple from `plugin`, or set `"enabled": false`, then restart
opencode.

## Options

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Turn the plugin off without removing it. |
| `providers` | `[]` | Optional explicit provider-id allowlist. Empty = use the local-provider rules. |
| `localProviders` | `LOCAL_PROVIDERS` | Known local provider ids; detected local `baseURL`s are added automatically. |
| `excludeProviders` | `[]` | Optional explicit deny list for a local id you do not want targeted. |
| `providerProfiles` | `{}` | Per-provider reasoning adapter overrides, keyed by provider id. |
| `modelIncludes` | `[]` | Substrings to match against the model id. Empty = all. |
| `defaultEffort` | `"medium"` | Effort for ordinary prompts. |
| `codeEffort` | `"high"` | Implement/code prompts. |
| `debugEffort` | `"high"` | Debugging, errors, stack traces, root-cause work. |
| `designEffort` | `"high"` | Architecture, design, review, tradeoffs. |
| `searchEffort` | `"medium"` | Find, locate, explain, summarize. |
| `mechanicalEffort` | `"low"` | Rename, typo, formatting, lint, one-line changes. |
| `toolEffort` | `"low"` | Successful tool-result turns. Use `"none"` to disable thinking. |
| `toolFailureEffort` | `"high"` | First failed tool result. |
| `toolFailureEscalatedEffort` | `"xhigh"` | Two or more failed tool results in the same task. |
| `highEffort` | `"high"` | Minimum effort for `highKeywords`. |
| `ultraEffort` | `"xhigh"` | `ultrathink` and similar keywords. |
| `simpleEffort` | `"low"` | Greetings and trivial questions. |
| `riskMinimumEffort` | `"high"` | Minimum effort when risk keywords are present. |
| `riskBumpSteps` | `1` | Extra effort levels for production/security/destructive work. |
| `multiFileBump` | `1` | Bump for multi-file prompts below high. |
| `longPromptThreshold` | `4000` | Character count that counts as a long prompt. |
| `longPromptBump` | `1` | Bump for long prompts below high. |
| `defaultTemperature` | `1.0` | Temperature for ordinary prompts. |
| `codeTemperature` | `0.6` | Temperature for code/debug prompts. |
| `toolTemperature` | `0.6` | Temperature for tool-result turns. |
| `highTemperature` | `1.0` | Temperature for design/high-keyword prompts. |
| `ultraTemperature` | `1.0` | Temperature for ultra keywords. |
| `simpleTemperature` | `1.0` | Temperature for simple/mechanical prompts. |
| `nonThinkingTemperature` | `0.7` | Temperature when effort is `none`. |
| `thinkingTopP` | `0.95` | `top_p` for thinking requests. |
| `thinkingTopK` | `20` | `top_k` for thinking requests. |
| `thinkingMinP` | `0` | `min_p` for thinking requests. |
| `thinkingPresencePenalty` | `0` | `presence_penalty` for thinking requests. |
| `thinkingRepetitionPenalty` | `1` | `repetition_penalty` for thinking requests. |
| `nonThinkingTopP` | `0.8` | `top_p` when effort is `none`. |
| `nonThinkingTopK` | `20` | `top_k` when effort is `none`. |
| `nonThinkingMinP` | `0` | `min_p` when effort is `none`. |
| `nonThinkingPresencePenalty` | `1.5` | `presence_penalty` when effort is `none`. |
| `nonThinkingRepetitionPenalty` | `1` | `repetition_penalty` when effort is `none`. |
| `overrideSampling` | `true` | Apply the sampling values above. |
| `codeAgents` | `["code","coder","engineer","debug"]` | Agent names treated as code. |
| `planAgents` | `["plan","architect","design"]` | Agent names treated as design. |
| `searchAgents` | `["explore","search","recon"]` | Agent names treated as search/recon. |
| `ignoreAgents` | `["title","summary","compaction"]` | Auxiliary agents that are never routed. |
| `disableSubagents` | `false` | Block the `task` tool and add a no-subagent system instruction for all local/targeted models. |
| `autoTodo` | `false` | Add `todowrite` planning guidance and an active-list reminder for multi-step/code/design/debug/risky work. |
| `autoVerify` | `false` | Track edited files and test/lint commands, remind the model to verify, and preserve the state through compaction. |
| `verificationGate` | `false` | Block another code-file edit until a check runs, but only when a project check is detected or `verificationCommands` is set. |
| `verificationCommands` | `[]` | Extra command substrings that count as verification. |
| `respectExplicitEffort` | `true` | Do not override an existing `reasoning_effort` or `enable_thinking` in model options. |
| `overrideTemperature` | `true` | Set the temperature values above. |
| `debug` | `false` | Log each decision to stderr and `client.app.log` under `qwen-harness`. |
| `ultraKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `highKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `debugKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `designKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `mechanicalKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `searchKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `implementKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `riskKeywords` | see `lib.js` | Case-insensitive keyword list. |

Effort values are `none`, `low`, `medium`, `high`, `xhigh`. For the
`chat_template_kwargs` profile, `none` sends `enable_thinking: false`; for the
`reasoning_effort` profile it sends `reasoning_effort: "none"`; the `none`
profile sends no reasoning field at all.

### Sampling defaults

The plugin follows the Qwen3.8-Flash-Next model-card sampler values unless
`overrideSampling` is false:

| Mode | temperature | top_p | top_k | min_p | presence | repetition |
|---|---:|---:|---:|---:|---:|---:|
| Thinking | per classification | 0.95 | 20 | 0 | 0 | 1.0 |
| Non-thinking (`effort: none`) | 0.7 | 0.80 | 20 | 0 | 1.5 | 1.0 |

The existing per-kind temperatures remain in effect; for example code and tool
turns use 0.6 rather than the model-card thinking temperature of 1.0. Those are
deliberate coding/tool stability choices and should be A/B tested.

### Provider selection

A request is handled by the harness only when both filters pass:

1. The model id contains `qwen3.8-flash-next`.
2. The provider is local:
   - its id is in `localProviders` (defaults include `strata`, `ollama`,
     `llamacpp`, `vllm`, `lmstudio`, ...), or
   - its configured `baseURL` is local, which is detected automatically for
     localhost, private IPv4, Tailscale/CGNAT, `*.local`, and Docker host names.

`excludeProviders` is then applied as an optional explicit deny list. If
`providers` is non-empty, it is an exact allowlist and replaces the local-provider
rule; otherwise the local rules above decide.

Examples:

| Provider | How it is treated |
|---|---|
| `strata` at `http://100.64.0.10:8080/v1` | selected: known id + Tailscale address |
| `ollama` at `http://localhost:11434/v1` | selected: known id + localhost |
| `vllm` at `http://192.168.1.20:8000/v1` | selected: known id + private address |
| `my-server` at `http://192.168.1.20:9000/v1` | selected by baseURL; add `localProviders` if detection is unavailable |
| `my-server` at `https://llm.example.com/v1` | not selected unless `my-server` is in `localProviders` |
| `opencode` at `https://opencode.ai` | not selected: not local |
| `openai` at `https://api.openai.com/v1` | not selected: not local |

A provider profile only chooses the reasoning field. It does **not** make a
provider local. If a provider is selected but its profile is `none`, the todo,
verification, subagent, and compaction features still run; only reasoning
routing is skipped.

### Reasoning profiles

The built-in profiles are:

| Provider id | Reasoning field |
|---|---|
| `strata` | `chat_template_kwargs` (`reasoning_effort` + `enable_thinking`) |
| `ollama` | top-level `reasoning_effort` |
| `llamacpp`, `llama-cpp`, `llama.cpp`, `llama-server` | top-level `reasoning_effort` |
| `vllm` | top-level `reasoning_effort` (vLLM maps it to `enable_thinking`) |
| `lmstudio`, `lm-studio` | none by default; its OpenAI-compatible endpoint does not reliably forward reasoning controls |
| any other local provider | none by default |

Add or override a server without editing code:

```json
"localProviders": ["my-local-server", "my-strata-fork"],
"providerProfiles": {
  "my-local-server": "reasoning_effort",
  "my-strata-fork": { "reasoning": "chat_template_kwargs", "temperature": true }
}
```

Valid reasoning values are `chat_template_kwargs`, `reasoning_effort`, and
`none`. A profile can set `temperature: false` if the server does not accept
temperature. A custom provider id also needs to be added to `localProviders`
unless its configured `baseURL` is already detected as local; a profile alone
does not make the provider a target.

## Disabling subagents

This project targets local or self-hosted Qwen3.8 Flash Next, including IQ3_S,
on known local provider ids or providers detected from a local `baseURL`. Its
`modelIncludes` is `qwen3.8-flash-next`, so every variant in that family is
covered. For this deployment, subagents are weaker and much slower than doing
the work directly, so the config sets `disableSubagents: true`.

The plugin:

- adds the instruction "Subagents are disabled for this model..." to the
  system prompt for every targeted request;
- marks the session as subagent-disabled in `chat.params`;
- throws before a `task` tool call in that session, with an error that tells
  the model to use direct tools.

`disableSubagents` applies to every model selected by the local-provider rules,
`providers`, and `modelIncludes`. Keep `modelIncludes` narrow if other models
must keep their subagents.

This stops the model from spawning subagents. It does not stop a user from
manually selecting an `explore` or `general` agent in opencode; that is an
opencode UI action, not a model `task` call. The plugin also blocks nested
`task` calls made inside such a manually started subagent session.

## Planning with todos

With `autoTodo: true`, the plugin adds a system instruction for targeted
requests that need planning: 3 or more distinct steps or deliverables,
implementation, debugging, design, ultra effort, risky work, two or more files,
or a long prompt. It tells the model to show a detailed plan in the reply before
the first edit: the goal, ordered steps with a one-line reason for each, key
risks or tradeoffs, files or areas to inspect, and how verification will work.
Only then does it call `todowrite` with a concise, prioritized list. The model
must keep exactly one item `in_progress`, mark completed items immediately, and
add follow-ups or blockers even when the user did not ask for a plan. Simple
questions, searches, mechanical edits, and tool-result turns are left alone.

After a `todowrite` call with pending or `in_progress` items, later requests get
a shorter "keep the active list current" reminder instead of the full creation
instruction. The reminder also asks for a brief explanation when scope or order
changes. The `tool.execute.after` hook tracks that state per session.

### Read-only plan command

The global opencode config can expose a `/plan` command that routes to the
built-in read-only `plan` agent:

```json
"command": {
  "plan": {
    "description": "Create a detailed read-only plan for the current request",
    "agent": "plan",
    "template": "Create a detailed implementation plan for: $ARGUMENTS\n\nDo not edit files or run commands that change the workspace. Include the goal, ordered steps with a one-line reason for each, key risks or tradeoffs, files or areas to inspect, and the verification strategy. End with a concise todo-ready summary."
  }
}
```

Use `/plan <request>` for ambiguous or multi-file work, review the plan, then
switch back to build mode. This is the opencode plan-agent path; the plugin's
todo planning remains useful for the build turn.

The plugin cannot invoke `todowrite` itself; this is system-prompt guidance, so
a model can still skip it. The wording and state rules follow opencode's own
[`todowrite` guidance](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/todowrite.txt),
the [v2 missing-guidance issue](https://github.com/anomalyco/opencode/issues/59259),
and the active-list reminder pattern used by
[opencode-todolist](https://www.opendock.net/plugins/opencode-todolist/) and
[Subagent Todo](https://www.opendock.net/plugins/opencode-subagent-todo/).

## Verification and compaction

With `autoVerify: true`, the plugin watches `edit`, `write`, and `apply_patch`,
then adds a short "you changed files since the last check" reminder. When a later
`bash` command looks like a test, lint, typecheck, or build, the plugin records
success or failure. A successful check clears the reminder; a failed check keeps
a stronger "fix and rerun" reminder active until a check passes.

With `verificationGate: true`, the next code-file `edit`, `write`, or
`apply_patch` is blocked while the current change is unchecked. Docs-only edits
are not gated. After a failed check, the model may make one corrective edit; the
gate then requires another check. This is intentionally strict: projects without
a recognized test/lint/build command should leave the gate off or add a real
check. Add project-specific commands with `verificationCommands: ["pnpm verify"]`.

The `experimental.session.compacting` hook appends a harness-state block to the
compaction context: current request, planning/todo state, edited files,
verification status, and the tail of the last failed check. This keeps the
task anchored across long sessions, following the Focus Chain and auto-compact
patterns used by Cline, the structured condenser used by OpenHands, and the
plan/permission/compaction model documented by Claude Code.

The command detector is heuristic. Custom or obscure verification commands may
not be recognized, so the reminder itself is advisory; `verificationGate` is the
hard block, and it only works when the project has a recognized check.

## Classification signals

The classifier follows the task-facts approach used by
[`opencode-model-router`](https://github.com/marco-jardim/opencode-model-router)
(classes, risk, scope), the effort descriptions used by
[`@reasoning-router`](https://github.com/robertn702/reasoning-router), and the
keyword tiers used by Claude Code. It is still a fast heuristic, not a model
call.

- Tool-result turn, no failure -> `toolEffort` (`low`).
- Tool-result turn with an error -> `toolFailureEffort` (`high`).
- Two or more failed tool results in the same task ->
  `toolFailureEscalatedEffort` (`xhigh`). This is the “escalate after repeated
  failures” rule that tiered routers use for heavy debugging.
- Debug/error/stack-trace/root-cause signals -> `debugEffort` (`high`).
- Architecture/design/review/tradeoff signals -> `designEffort` (`high`).
- Code, file paths, or implement verbs -> `codeEffort` (`high`).
- Rename/typo/format/lint/one-line -> `mechanicalEffort` (`low`).
- Find/locate/explain/summarize -> `searchEffort` (`medium`).
- Greeting or trivial question -> `simpleEffort` (`low`).
- Otherwise -> `defaultEffort` (`medium`).

Risk keywords (production, deploy, migration, secrets, destructive changes)
enforce `riskMinimumEffort` and then bump by `riskBumpSteps`. Multi-file and
long prompts bump an effort that is still below `high`, so ordinary two-file
code changes stay at `high` rather than escalating to `xhigh`. `ultrathink`
and `highKeywords` are applied last.

The tool-result signals are the per-turn budget idea used by TAB/Ares-style
agent routers: a successful tool step is cheap, a failed one needs
deliberation, and repeated failures need the most deliberation. The design is
inspired by those systems, not copied from them.

## How it works

The plugin registers these hooks:

- `config` scans configured provider `baseURL`s and adds local endpoints to the
  local-provider set.
- `chat.message` records the latest user prompt per session, decides whether it
  needs planning, and resets the tool-failure counter.
- `experimental.chat.messages.transform` marks tool-result turns, including
  assistant messages whose `tool` part has a completed/error state, inspects
  the tool error, and counts repeated failures.
- `chat.params` classifies the prompt, tracks which model the session uses,
  appends the harness instructions to the current message's system field, and
  writes the provider-specific reasoning options:

```json
{
  "chat_template_kwargs": {
    "reasoning_effort": "high",
    "enable_thinking": true
  }
}
```

- `experimental.chat.system.transform` is a fallback for builds that invoke it;
  it appends the no-subagent and `todowrite` instructions. The tested opencode
  1.19.4 path is `chat.params` plus the message system field.
- `tool.execute.before` throws for a `task` tool call in a session marked as
  subagent-disabled.
- `tool.execute.after` watches `todowrite`, edits, and verification commands;
  it switches later planning prompts to the short active-list reminder and
  tracks whether edited files still need a check.
- `experimental.session.compacting` injects the current request, todo/plan
  state, edited files, and verification status into the compaction context.

`@ai-sdk/openai-compatible` spreads unknown provider options into the request
body, so the local server receives the field. If your provider strips unknown
options, the reasoning part will have no effect; enable `debug: true` and check
the opencode logs. The todo, subagent, and verification features still work
because they run in opencode, not in the inference server.

## Limits

- This is a heuristic router, not a trained classifier.
- Tool-result detection depends on opencode's message parts and tool `state`
  shape, plus the experimental `experimental.chat.messages.transform` hook.
  It was tested with opencode 1.19.4; later versions can change the part shape.
- The local server must support the reasoning field selected by its provider
  profile. Strata must accept per-request `chat_template_kwargs`; Ollama,
  llama.cpp, and vLLM must accept top-level `reasoning_effort`. LM Studio's
  OpenAI-compatible endpoint currently does not reliably forward reasoning
  controls, so its default profile is `none`.
- Unknown local providers get no reasoning field until a profile is added. The
  harness features still work; only reasoning routing is skipped.
- `disableSubagents` blocks the built-in `task` tool, not a manually selected
  agent, and assumes the tool is still named `task`.
- `autoTodo` is prompt-level guidance; the model can still skip the todo list.
- `autoVerify` detects common test/lint/build commands; custom scripts may not
  be recognized. `verificationGate` is hard, so use it only where a recognized
  check exists.
- The plugin does not choose models; it only adjusts a targeted model's
  reasoning effort and temperature, optionally blocks its `task` tool, asks it
  to plan with todos, and tracks verification state.

## Development

The plugin is plain ESM JavaScript; there is no build step.

```bash
node --test test/*.test.mjs
npm run smoke:opencode
```
smoke:opencode requires opencode and this plugin to be installed in the active opencode config; it starts a headless server and a mock local provider.

## Quality evaluation

This is a **simple sanity check** that the model receives the intended sampling
and harness settings. It is not a comprehensive model-quality benchmark, and a
single 22-case run is not statistical evidence.

The real-model set has 18 cases in `eval/quality-cases.json` (exact answers,
multi-step arithmetic, logic, instruction following, and executable JavaScript)
and 4 long-context cases in `eval/long-cases.json` (needle, buried instruction,
multi-hop, and incident summarization).

```bash
$env:STRATA_UPSTREAM = "http://127.0.0.1:8080/v1"
$env:STRATA_API_KEY = "your-key"
npm run eval:quality
npm run eval:tools
```

`eval:quality` compares thinking at 1.0, thinking at 0.6, and non-thinking at
0.7. `EVAL_IDS=id1,id2` runs a subset. `eval:tools` uses real opencode with the
real Strata provider and checks read, bash, todowrite, and task blocking.

Initial results: the full 22-case run scored 21/22 for thinking 1.0 and 0.6 (one
code output hit the 512-token limit) and 21/22 for non-thinking (weekday
reasoning). After raising code output to 2,048 tokens, all 7 code cases pass in
all three arms; the 4 long-context cases pass in all arms. The known quality
failure is non-thinking on the weekday case. Tool evaluation passed 4/4.

This measures answer quality; it is separate from the deterministic request
contract tests and the opencode smoke test.

## License

MIT
