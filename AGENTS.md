# AGENTS.md

## Project

This repository is an opencode plugin for the local Strata Qwen3.8 Flash Next
family, including IQ3_S. It routes reasoning effort and temperature per request
and blocks model-spawned subagents for this deployment.

- Provider target: `strata`
- Model target: `qwen3.8-flash-next` (all variants)
- Config: `disableSubagents: true`
- Subagents are disabled because local Qwen3.8 Flash Next subagents are weaker
  and much slower than doing the work directly.

## Non-negotiable behavior

- Keep `disableSubagents: true` in the user configuration.
- Block the `task` tool for every targeted session; do not weaken this to a
  warning or a prompt-only instruction.
- Keep the scope on local Strata Qwen3.8 Flash Next. Do not add unrelated
  providers or models to `providers`/`modelIncludes`.
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
- Preserve the five hooks: `chat.message`,
  `experimental.chat.messages.transform`, `chat.params`,
  `experimental.chat.system.transform`, and `tool.execute.before`.
- `chat.params` marks the session; `tool.execute.before` throws for `task` in a
  marked session; the system transform adds the no-subagent instruction.

## Tests

- Run `node --test test/*.test.mjs` (Node 22 or newer).
- Tests are dependency-free. Do not add a test framework or build tooling.
- Add or update a test when changing classification, option handling, or
  subagent blocking.
- Use `git diff --check` before finishing.

## Git

- Do not commit unless the user explicitly asks.
- Do not amend, force-push, or create empty commits.
- Use an imperative commit subject, for example
  `Block subagents for Qwen3.8 Flash Next`.
- Keep the user's global opencode config and the Strata server configuration out
  of commits in this repository.
