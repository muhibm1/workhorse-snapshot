---
name: wh-language-standards
description: Tells code-writing WorkHorse agents which vendored ECC language rules to read for this client's stack before writing or reviewing code. Preloaded by the builder, polish, and fixer.
user-invocable: false
---

# Language standards (vendored from ECC)

WorkHorse vendors the ECC rule packs (affaan-m/ECC, MIT) under
`${CLAUDE_PLUGIN_ROOT}/vendor/ecc/rules/`. They are concrete, per-language coding, testing,
and security standards, deeper than wh-readable-code alone.

## Before you write or change code

1. Read `.workhorse/profile.yml` `stack.languages` and `stack.frameworks`.
2. Always read these three files from `${CLAUDE_PLUGIN_ROOT}/vendor/ecc/rules/common/`:
   `coding-style.md`, `testing.md`, `security.md`.
3. Then read the folder for each match:

| Stack says | Read |
|---|---|
| typescript or javascript | `typescript/` |
| python | `python/` (FastAPI projects: also `python/fastapi.md`) |
| react or nextjs | `react/` and `web/` |
| any other browser frontend | `web/` |

Read only what matches. A stack with none of these gets `common/` alone.

## Precedence

The client wins. If a rule disagrees with the repo's `CLAUDE.md`, `profile.conventions`, or the
established patterns in the surrounding code, follow the client and mention the disagreement
once in your report under "Findings outside scope". The vendored rules fill gaps; they never
override a convention the client already has.
