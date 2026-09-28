---
name: build
description: Build phase only for the active WorkHorse change. Runs plan.md tasks as parallel waves of up to profile.build.max_parallel builders in isolated worktrees, then one polish pass over the whole diff.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:build

1. Confirm G2 (Design) is `approved` or `auto` and `plan.md` exists
   (`node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" status --json`). If not, say so and stop.
2. Dispatch `wh-conductor` with the prompt:

   > Run only the Build phase for the active change, following the Build section of your
   > instructions: waves from plan.md, up to build.max_parallel builders per wave in isolated
   > worktrees, fold each wave, then wh-polish once on the whole diff after the last wave.
   > Stop after polish; do not start Verify.

3. Print the conductor's report, `wh.js status` and `wh.js clock`. Next step: `/workhorse:verify`.
