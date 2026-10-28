# opencode-strata-reasoning

Automatic per-request reasoning-effort and temperature routing for
[Strata](https://github.com/Niko1221/Strata) models in
[opencode](https://opencode.ai). This project is configured for the local
Strata Qwen3.8 Flash Next family, including IQ3_S.

The plugin classifies each model request with fast heuristics and sets
`chat_template_kwargs` on the Strata OpenAI-compatible request:

- tool-result turns -> low effort
- code prompts, file paths, stack traces -> high effort, lower temperature
- `ultrathink` / `think harder` -> xhigh
- short greetings and trivial edits -> low
- everything else -> medium
- optionally disable the `task`/subagent tool for targeted models; local Qwen3.8 Flash Next subagents are weaker and slower than doing the work directly

It does not change the Strata model or restart the server. It only adds
per-request parameters, so it works with a model already configured in
opencode.

## Requirements

- opencode with plugin support (`@opencode-ai/plugin` >= 1.14.24; this
  repository was developed against opencode 1.19.4).
- A Strata server whose OpenAI-compatible endpoint accepts
  `chat_template_kwargs` (tested with Strata engine 0.1.50 and 0.1.52 /
  Qwen3.8).
- Provider id `strata` in `opencode.json`, unless you override `providers`.

## Install

Add the plugin to the `plugin` array in `~/.config/opencode/opencode.jsonc`
or `.opencode/opencode.json`:

```json
{
  "plugin": [
    [
      "file:///C:/path/to/opencode-strata-reasoning/index.js",
      {
        "providers": ["strata"],
        "modelIncludes": ["qwen3.8-flash-next"],
        "defaultEffort": "medium",
        "codeEffort": "high",
        "toolEffort": "low",
        "disableSubagents": true,
        "debug": true
      }
    ]
  ]
}
```

opencode 1.19.x uses the singular `plugin` key. The plural `plugins` key is a
V2 setting; 1.19.x warns that it cannot be represented and omits it. Use `plugin`
unless you are running a V2 build. Restart opencode after editing the config;
plugin and config changes are not hot-reloaded.

## Options

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Turn the plugin off without removing it. |
| `providers` | `["strata"]` | Provider ids to target. Empty array = all. |
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
| `codeAgents` | `["code","coder","engineer","debug"]` | Agent names treated as code. |
| `planAgents` | `["plan","architect","design"]` | Agent names treated as design. |
| `searchAgents` | `["explore","search","recon"]` | Agent names treated as search/recon. |
| `ignoreAgents` | `["title","summary","compaction"]` | Auxiliary agents that are never routed. |
| `disableSubagents` | `false` | Block the `task` tool and add a no-subagent system instruction for all models targeted by `providers`/`modelIncludes`. |
| `respectExplicitEffort` | `true` | Do not override an existing `reasoning_effort` or `enable_thinking` in model options. |
| `overrideTemperature` | `true` | Set the temperature values above. |
| `debug` | `false` | Log each decision to stderr and `client.app.log` under `strata-reasoning`. |
| `ultraKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `highKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `debugKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `designKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `mechanicalKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `searchKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `implementKeywords` | see `lib.js` | Case-insensitive keyword list. |
| `riskKeywords` | see `lib.js` | Case-insensitive keyword list. |

Effort values are `none`, `low`, `medium`, `high`, `xhigh`. When effort is
`none`, the plugin sends `enable_thinking: false` instead of
`reasoning_effort`.

## Disabling subagents

This project targets local Strata Qwen3.8 Flash Next, including IQ3_S. Its
`modelIncludes` is `qwen3.8-flash-next`, so every variant in that family is
covered. For this deployment, subagents are weaker and much slower than doing
the work directly, so the config sets `disableSubagents: true`.

The plugin:

- adds the instruction "Subagents are disabled for this model..." to the
  system prompt for every targeted request;
- marks the session as subagent-disabled in `chat.params`;
- throws before a `task` tool call in that session, with an error that tells
  the model to use direct tools.

`disableSubagents` applies to every model selected by `providers` and
`modelIncludes`. Keep `modelIncludes` narrow if other models must keep their
subagents.

This stops the model from spawning subagents. It does not stop a user from
manually selecting an `explore` or `general` agent in opencode; that is an
opencode UI action, not a model `task` call. The plugin also blocks nested
`task` calls made inside such a manually started subagent session.

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

The plugin registers five hooks:

- `chat.message` records the latest user prompt per session and resets the
  tool-failure counter.
- `experimental.chat.messages.transform` marks tool-result turns, including
  assistant messages whose `tool` part has a completed/error state, inspects
  the tool error, and counts repeated failures.
- `chat.params` classifies the prompt, tracks which model the session uses, and
  writes:

```json
{
  "chat_template_kwargs": {
    "reasoning_effort": "high",
    "enable_thinking": true
  }
}
```

- `experimental.chat.system.transform` appends the no-subagent instruction
  when `disableSubagents` is on and the request is targeted.
- `tool.execute.before` throws for a `task` tool call in a session marked as
  subagent-disabled.

`@ai-sdk/openai-compatible` spreads unknown provider options into the request
body, so the Strata server receives the field. If your provider strips unknown
options, the plugin will have no effect; enable `debug: true` and check the
opencode logs to see whether the hook runs.

## Limits

- This is a heuristic router, not a trained classifier.
- Tool-result detection depends on opencode's message parts and tool `state`
  shape, plus the experimental `experimental.chat.messages.transform` hook.
  It was tested with opencode 1.19.4; later versions can change the part shape.
- The Strata server must accept per-request `chat_template_kwargs`. A server
  config with `chat_template_kwargs.reasoning_effort` set still allows
  request-level overrides in the tested build.
- `disableSubagents` blocks the built-in `task` tool, not a manually selected
  agent, and assumes the tool is still named `task`.
- The plugin does not choose models; it only adjusts a targeted model's
  reasoning effort and temperature, and optionally blocks its `task` tool.

## Development

The plugin is plain ESM JavaScript; there is no build step.

```bash
node --test test/*.test.mjs
```

## License

MIT
