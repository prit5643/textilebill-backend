# GitHub Copilot Instructions

This repository uses a shared engineering standards skill:

- [AGENTS.md](../AGENTS.md)
- [Engineering Guardrails Skill](../docs/skills/engineering-guardrails/SKILL.md)

Copilot should:

1. Avoid assumptions and ask for clarification when ambiguous.
2. Avoid hallucinated APIs, files, and symbols.
3. Prefer root-cause fixes over workaround-only changes.
4. Never hard-code secrets, credentials, or tokens.
5. Keep functions small and maintainable.
6. Avoid `any`; use explicit types.
7. Prefer production-safe code with validation and error handling.

