# Global Agent Instructions

All coding agents in this repository must follow:

- [Engineering Guardrails Skill](./docs/skills/engineering-guardrails/SKILL.md)

## Mandatory Policy

1. Ask when requirements are ambiguous; do not guess.
2. Do not hallucinate files, APIs, or behavior.
3. Prefer root-cause fixes over workarounds.
4. Produce production-grade code with clear error handling.
5. Never hard-code secrets.
6. Keep function complexity low.
7. Avoid `any`; if unavoidable, justify and isolate.
8. Do not take unsafe shortcuts that weaken correctness or security.
9. Validate changes with lint/type/tests when possible.

