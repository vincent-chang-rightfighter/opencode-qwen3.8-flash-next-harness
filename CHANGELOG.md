# Changelog

## 0.8.4

- Send top-level `reasoning_effort` through the OpenAI-compatible
  `reasoningEffort` option.
- Inject subagent, planning, and verification instructions through the actual
  `chat.params` message system field.
- Keep `experimental.chat.system.transform` as a compatibility fallback.
- Extend the real opencode smoke test to Strata, Ollama, llama.cpp, and vLLM
  reasoning profiles.
- Verify that the no-subagent instruction reaches the provider request.

## 0.8.3

- Make the verification gate code-file-only.
- Allow one corrective edit after a failed check.
- Add custom `verificationCommands`.
- Add CI, CodeQL, Dependabot, SECURITY, and CONTRIBUTING.
- Add the `/plan` command documentation.

## 0.8.2

- Add a real headless opencode smoke test with a mock provider.
- Include the smoke script in the package.

## 0.8.1

- Restrict the verification gate scope and update CI actions.

## 0.8.0

- Add provider-aware local routing and provider profiles.

## 0.6.0

- Add todo planning, verification tracking, compaction state, and subagent
  blocking.
