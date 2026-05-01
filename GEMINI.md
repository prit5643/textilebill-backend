# Gemini Instructions (Backend)

Follow:

- [AGENTS.md](./AGENTS.md)
- [Engineering Guardrails Skill](./docs/skills/engineering-guardrails/SKILL.md)
- [./.cursorrules](./.cursorrules)

Backend-specific priorities:
- No assumptions about schema/controllers/services; verify before edits.
- Keep authz/authn changes production-safe and test-backed.
- No workaround-first fixes when root-cause fixes are feasible.
- No hard-coded secrets; use env/config patterns.
- Keep function complexity low and types strict.

