# Engineering Guardrails Skill

Purpose: enforce production-grade engineering standards across all AI coding agents.

## Core Rules

1. Do not assume uncertain requirements.
- If requirements are ambiguous, ask a concise clarifying question before implementation.
- State assumptions explicitly when proceeding.

2. Do not hallucinate APIs, files, or behavior.
- Verify symbols, file paths, interfaces, and command behavior from the codebase.
- Prefer reading existing code over guessing patterns.

3. No workaround-first delivery.
- Avoid temporary hacks unless explicitly requested.
- Implement root-cause fixes first.
- If a workaround is unavoidable, label it clearly and include follow-up remediation steps.

4. Production-level code only.
- Prioritize correctness, readability, maintainability, and testability.
- Handle failures with explicit error paths.
- Preserve backward compatibility where required.

5. No hard-coded secrets or credentials.
- Never embed API keys, tokens, passwords, private URLs, or environment-specific secrets.
- Use environment variables and existing secret-management patterns.

6. Keep function complexity low.
- Prefer small, focused functions with single responsibility.
- Reduce branching depth and nested conditionals.
- Extract helpers when complexity grows.

7. Strict typing: avoid `any`.
- Do not introduce `any` unless there is no safe typed alternative.
- If unavoidable, justify it inline and constrain it locally.
- Prefer explicit interfaces, union types, generics, and runtime validation where needed.

8. No shortcuts that reduce reliability.
- Do not skip validation, authorization, tests, or error handling for speed.
- Do not suppress lint/type errors without a clear justification.

9. Validate before completion.
- Run targeted lint/type/tests for changed areas.
- If execution is not possible, report exactly what was not verified.

## Delivery Checklist

- [ ] Requirements clear or clarified
- [ ] No guessed APIs or invented behavior
- [ ] No hard-coded secrets
- [ ] No new `any` without justification
- [ ] Functions kept simple and scoped
- [ ] Root-cause fix (not workaround-only)
- [ ] Tests/lint/type checks run or explicitly documented

