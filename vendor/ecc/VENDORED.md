# Vendored from ECC

Source: https://github.com/affaan-m/ECC at commit `8321021c54d670126ce3b2969d5deb880b4b0c2a` (v2.2.1), MIT licence
(copied to `LICENSE` here). Refresh by re-running the vendoring script against a newer
checkout, then reviewing the diff like any other third-party change.

## What is vendored and why

| Item | Where | Used by |
|------|-------|---------|
| agent `typescript-reviewer` | `agents/ecc-typescript-reviewer.md` | conductor, Review phase (per stack) |
| agent `python-reviewer` | `agents/ecc-python-reviewer.md` | conductor, Review phase (per stack) |
| agent `react-reviewer` | `agents/ecc-react-reviewer.md` | conductor, Review phase (per stack) |
| agent `database-reviewer` | `agents/ecc-database-reviewer.md` | conductor, Review phase (per stack) |
| agent `fastapi-reviewer` | `agents/ecc-fastapi-reviewer.md` | conductor, Review phase (per stack) |
| agent `rag-pipeline-reviewer` | `agents/ecc-rag-pipeline-reviewer.md` | conductor, Review phase (per stack) |
| agent `silent-failure-hunter` | `agents/ecc-silent-failure-hunter.md` | conductor, Review phase (per stack) |
| agent `pr-test-analyzer` | `agents/ecc-pr-test-analyzer.md` | conductor, Review phase (per stack) |
| agent `build-error-resolver` | `agents/ecc-build-error-resolver.md` | conductor, Verify fix loop (build/type errors) |
| rules `common/` | `vendor/ecc/rules/common/` | builders, fixer, readability reviewer, simplifier |
| rules `typescript/` | `vendor/ecc/rules/typescript/` | builders, fixer, readability reviewer, simplifier |
| rules `python/` | `vendor/ecc/rules/python/` | builders, fixer, readability reviewer, simplifier |
| rules `react/` | `vendor/ecc/rules/react/` | builders, fixer, readability reviewer, simplifier |
| rules `web/` | `vendor/ecc/rules/web/` | builders, fixer, readability reviewer, simplifier |

## Changes made to upstream files

- Agents: renamed `ecc-<name>`; `skills: [wh-agent-rules]` added to the frontmatter; a
  provenance comment; a "WorkHorse adapter" section appended. `react-reviewer` points at
  the vendored react rules instead of ECC skills that are not vendored. Bodies otherwise verbatim.
- Rules: verbatim.

## Deliberately not vendored

- ECC hooks. Reviewed line by line: no data leaves the machine, but they fire on every
  tool call, and `gateguard-fact-force` demands facts before the first edit, which stalls
  headless WorkHorse builders. WorkHorse keeps its own deterministic hooks.
- The other 59 agents and 292 skills. Either WorkHorse already has an equivalent
  (planner, architect, code/security reviewer, TDD guide, simplifier) or the domain is
  outside this use case. A whole-plugin install would also put 292 skill descriptions in
  every session listing and 94 commands in the menu.
- continuous-learning-v2 observation hooks. They record every prompt and tool call, which
  includes client code in an FDE setting, and evolve instincts without human review.
  WorkHorse adopts the instinct format in `wh-retro-learner` instead, with human approval.
