---
name: status
description: Show the active WorkHorse change, its tier, phase, gates by name (Design, Ship, Deploy), verification state, the clock against the tier budget, what is blocking, and optionally the engagement metrics.
disable-model-invocation: true
allowed-tools: Bash(node *), Read
---

# /workhorse:status

Arguments: `$ARGUMENTS` may be `--metrics` for the indicators across all changes in this repo,
or `--json`.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" status $ARGUMENTS` and print the output
   unchanged. Without flags it includes the gates with their names, the required human gates,
   the next blocking gate, and the clock line (agents working, waiting on the human, dead
   time, against the tier budget).
2. With `--metrics` the output is JSON across every change: `single_pass_rate`,
   `mean_rework_cycles`, `mean_fix_iterations`, `mean_agent_minutes`, `mean_waiting_minutes`,
   `within_budget_rate` (completed changes whose agent minutes stayed inside the tier
   budget), and counts by tier. Print it, then one plain sentence on `mean_agent_minutes` and
   `within_budget_rate`.
3. If a gate is blocking, print the packet path (`brief.md` for Design, `ship.md` for Ship,
   `release.md` for Deploy) and the commands `/workhorse:approve <G>` and
   `/workhorse:approve <G> --reject "notes"`.
4. If there is no active change, list the changes under `docs/sdlc/` with their phase from
   each `state.json`, newest first, and say how to resume one
   (`wh.js active <id>` then `/workhorse:run`).
