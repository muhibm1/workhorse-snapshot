---
name: design
description: Design phase only. Creates a WorkHorse change from "<problem> -> <outcome>" (or takes the active one), runs the designer, constraint auditor and eval designer, and presents the Design document (G2) without building anything. Replaces /workhorse:intent, /workhorse:spec and /workhorse:plan.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:design

Arguments: `$ARGUMENTS` = `"<problem> -> <outcome>"`, or empty to redesign the active change
(for example after a G2 rejection).

1. If `.workhorse/profile.yml` does not exist, stop and tell the user to run
   `/workhorse:onboard` first.
2. Dispatch `wh-conductor` with this prompt, verbatim plus the arguments:

   > Run only the design phase. Request: `$ARGUMENTS` (empty means the active change). Create
   > the change if none is active, then follow the design row of your phase table: wh-designer
   > sets the tier and writes spec.md, plan.md, adr/ and brief.md last; then
   > wh-constraint-auditor and wh-eval-designer in one message; one revision round on a high
   > finding only. Present Design (G2) and stop. Do not start Build, even at tier 0 where G2 is
   > automatic; say so instead.

3. Print the conductor's report, then `wh.js status` and `wh.js clock`.
4. Next step: `/workhorse:approve G2` (or `--reject "notes"`), then `/workhorse:run` to build.
   At tier 0, G2 is `auto` and the next step is `/workhorse:run` directly.

Do not dispatch the designer directly; the conductor owns sequencing and the state changes.
