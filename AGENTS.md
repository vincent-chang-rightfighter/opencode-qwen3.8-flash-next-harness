# AGENTS.md

## Project

This repository is an opencode plugin for the local or self-hosted Qwen3.8
Flash Next family, including IQ3_S. It routes reasoning effort and temperature
per request using a provider profile, asks the model to plan with todos when
needed, and blocks model-spawned subagents for this deployment.

- Provider target: known local provider ids, plus providers whose configured
  `baseURL` is local/private/Tailscale; cloud providers are not targeted
- Model target: `qwen3.8-flash-next` (all variants)
- Reasoning profile: `strata` = `chat_template_kwargs`; Ollama/llama.cpp/vLLM =
  `reasoning_effort`; unknown local providers = no reasoning field
- Config: `disableSubagents: true`, `autoTodo: true`, `autoVerify: true`, and `verificationGate: true`
- Subagents are disabled because local Qwen3.8 Flash Next subagents are weaker
  and much slower than doing the work directly.
- Verification state is tracked per session and preserved through compaction.

## Non-negotiable behavior

- Keep `disableSubagents: true` in the user configuration.
- Block the `task` tool for every targeted session; do not weaken this to a
  warning or a prompt-only instruction.
- Keep `autoTodo: true`; add the `todowrite` planning instruction for tasks that
  need planning (implementation, debugging, design, risk, multi-file, long
  prompt, or 3+ explicit steps). The instruction must ask for a detailed plan
  explanation (goal, ordered steps with reasons, risks, files, verification)
  before the tool call, plus priority ordering and status updates, even when the
  user did not ask for a plan.
- After `todowrite` has pending or in-progress items, use the shorter
  active-list reminder instead of repeating the full creation instruction.
- Keep `autoVerify: true`; track edited files and common test/lint/build
  commands, remind the model to verify, and keep failures active until a later
  check passes.
- Keep `verificationGate: true`; block the next edit until a check runs, and
  allow exactly one corrective edit after a failed check.
- Preserve the harness-state block in compaction.
- Do not require todo planning for simple lookups or mechanical edits; skip
  those.
- Keep the scope on local/self-hosted Qwen3.8 Flash Next. Target known local
  provider ids or local `baseURL`s; use `excludeProviders` only as an explicit
  deny list. Do not add unrelated models to `modelIncludes`.
- Keep provider-specific reasoning in `providerProfiles`: `chat_template_kwargs`
  for Strata, `reasoning_effort` for Ollama/llama.cpp/vLLM, `none` for unknown
  or unreliable OpenAI-compatible endpoints.
- Do not restore per-model subagent exceptions unless explicitly requested.
- Keep the README options, implementation, and tests in sync.

## File writing

- Write every text file as UTF-8 with CRLF (`\r\n`) line endings.
- Do not create LF-only files. If an editor or tool writes LF, convert the file
  to CRLF before finishing.
- Keep the final newline.
- `.gitattributes` sets `* text=auto eol=crlf`; do not change it to LF.
- `.editorconfig` sets `end_of_line = crlf`; keep it.

## Code

- Plain ESM JavaScript; no build step and no runtime dependencies.
- Follow the existing style: 2-space indentation, double quotes, semicolons.
- Do not add comments unless they explain something non-obvious.
- Preserve the config hook and these seven hooks: `chat.message`,
  `experimental.chat.messages.transform`, `chat.params`,
  `experimental.chat.system.transform`, `tool.execute.before`,
  `tool.execute.after`, and `experimental.session.compacting`.
- `config` adds providers with local `baseURL`s; `chat.message` sets the
  planning flag; `chat.params` marks the session; `tool.execute.before` throws
  for `task` in a marked session and for an unchecked edit when the gate is on;
  the system transform adds the no-subagent, planning, and verification
  instructions; `tool.execute.after` tracks todos, edited files, and checks;
  the compaction hook preserves the harness state.

## Tests

- Run `node --test test/*.test.mjs` (Node 22 or newer).
- Tests are dependency-free. Do not add a test framework or build tooling.
- Add or update a test when changing classification, option handling, todo
  planning, verification tracking, compaction state, or subagent blocking.
- Use `git diff --check` before finishing.

## Git

- Do not commit unless the user explicitly asks.
- Do not amend, force-push, or create empty commits.
- Use an imperative commit subject, for example
  `Block subagents for Qwen3.8 Flash Next`.
- Keep the user's global opencode config and local inference server
  configuration out of commits in this repository.
