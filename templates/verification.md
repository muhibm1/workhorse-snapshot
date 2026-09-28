# Verification: {{title}}

Change id: `{{change_id}}`
Status: green | red | partial
Run at: {{timestamp}} UTC
Commit: `{{commit}}`

Status is green only when every defined check exited 0 and every eval category met its target.
"No check defined" rows do not count as passes; they are listed so the gap is visible.

## What was measured

One plain sentence per defined check, in the words someone would use to ask about it later, with
the numbers read from its log. Compare with the previous change's verification.md when there is
one, and name it. For example:

- Test suite: 47 tests, 47 passed, 0 failed (`npm test`). Up from 27 tests at the previous change,
  `add-get-health-endpoint-returning-uptime`.
- Type check: 0 errors (`npx tsc --noEmit`).
- Lint: 0 errors, 3 warnings (`npm run lint`); the linter checks syntax only.

## Checks

| Check | Command | Exit code | Output | Status |
|-------|---------|-----------|--------|--------|
| typecheck | | | `path/to/log` | confirmed |
| lint | | | | |
| test | | | | |
| build | | | | |
| e2e | | | | |
| security_audit | | | | |
| screenshot | | | | |

## Evals

| Category | Cases | Passed | Target | Met |
|----------|-------|--------|--------|-----|
| golden | | | 100% | |
| edge | | | 100% | |
| failure | | | 100% | |
| adversarial | | | 100% | |

## Failures and fixes

Chronological. Each failure names the check, the cause, the fix commit, and the re-run.

| # | Check | Cause | Fix commit | Re-run exit code |
|---|-------|-------|------------|------------------|
| | | | | |

## Not verified

Anything believed but not run, with the reason.

- 
