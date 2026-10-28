# Security

Report security issues privately through GitHub Security Advisories:

https://github.com/vincent-chang-rightfighter/opencode-qwen3.8-flash-next-harness/security/advisories/new

Do not open a public issue for a vulnerability or include API keys, local server
addresses, model files, or private prompts in a report.

The plugin runs inside opencode and only changes request parameters, system
instructions, and tool gating. It does not include an inference server or model
weights. If you find a way to bypass the `task` block or the verification gate,
include the opencode version, plugin version, provider profile, and a minimal
reproduction.
