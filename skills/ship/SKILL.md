---
name: ship
description: Deploy phase for the active WorkHorse change after Ship (G4) is approved. The shipper merges the PR and deploys to every environment the profile marks automatic; at tier 3 it writes release.md and presents Deploy (G5) for the human to run production.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *), Bash(gh *)
---

# /workhorse:ship

1. Confirm G4 (Ship) is `approved` (`node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" status --json`).
   If not, say so and stop; the shipper refuses to merge without it.
2. Dispatch `wh-conductor` with the prompt:

   > Run only the Deploy phase for the active change, following the deploy row of your phase
   > table: wh-shipper in mode deploy merges the PR, deploys to every environment marked
   > automatic in profile order, records each command in ship.md, and at tier 3 writes
   > release.md and presents Deploy (G5). If G5 is already approved, record the production
   > result the human reports, then run the done row (wh.js phase done, retro in the
   > background, active cleared). Below tier 3, go straight to done.

3. Print the conductor's report, the deploy record from `ship.md`, `wh.js status` and
   `wh.js clock`. At tier 3 with G5 pending, print the packet path (`release.md`) and the two
   commands: `/workhorse:approve G5` and `/workhorse:approve G5 --reject "notes"`.
