# Claude Instructions (Backend)

Follow:

- [AGENTS.md](./AGENTS.md)
- [Engineering Guardrails Skill](./docs/skills/engineering-guardrails/SKILL.md)
- [./.cursorrules](./.cursorrules)

Backend-specific priorities:
- Preserve strict tenant isolation and company scoping.
- Never hard-code secrets, credentials, or tokens.
- Prefer explicit DTO validation and typed service contracts.
- Avoid `any`; if unavoidable, keep it local and justified.
- If requirements are ambiguous, ask before implementing.

