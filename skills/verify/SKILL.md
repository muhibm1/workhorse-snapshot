---
name: verify
description: Verify phase only for the active WorkHorse change. The verifier runs every profile check and every automatable eval in one session; the fixer loops with tests locked until green (max 5); verification.md is the record.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:verify

1. Dispatch `wh-conductor` with the prompt:

   > Run only the Verify phase for the active change, following the Verify section of your
   > instructions: wh-verifier runs the checks and the evals itself; on red, route build
   > failures to ecc-build-error-resolver and test, lint and eval failures to wh-fixer, then
   > verify again. Stop when verification is green or after five fix loops with a blocked
   > report. Do not start Review.

2. Print the conductor's report, the checks table from `verification.md`, `wh.js status` and
   `wh.js clock`. Next step: `/workhorse:review`.
