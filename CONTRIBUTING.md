# Contributing

- Use Node 22 or newer.
- Run `node --test test/*.test.mjs` before opening a pull request.
- Keep the plugin dependency-free and plain ESM; do not add a build step.
- Preserve the provider profiles, subagent block, todo planning, verification
  tracking, and compaction state unless the change explicitly targets them.
- Keep text files UTF-8 with CRLF; the repository enforces this with
  `.gitattributes` and `.editorconfig`.
- Do not add API keys, private server addresses, local usernames, model files,
  or private prompts to tests, fixtures, or documentation.
- Use focused commits with an imperative subject and `-` bullets for details.
