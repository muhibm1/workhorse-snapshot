---
name: verify
description: Verify phase only for the active WorkHorse change. `wh.js verify` runs every profile check and writes the evidence; the verifier agent runs the automatable evals; the fixer loops with tests locked until green (max 5); verification.md is the record.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:verify

1. Dispatch `wh-conductor` with the prompt:

   > Run only the Verify phase for the active change, following the Verify section of your
   > instructions: `WH verify` runs the checks and wh-verifier runs the evals; on red, route build
   > failures to ecc-build-error-resolver and test, lint and eval failures to wh-fixer, then
   > verify again. Stop when verification is green or after five fix loops with a blocked
   > report. Do not start Review.

2. Print the conductor's report, the checks table from `verification.md`, `wh.js status` and
   `wh.js clock`. Next step: `/workhorse:review`.
