---
name: run
description: Run the WorkHorse pipeline from "<problem> -> <outcome>" through to the next human touch (Design, Ship, or Deploy at tier 3), or resume the active change. Agents do the work; you approve at gates.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:run

Arguments: `$ARGUMENTS` is either `"<problem> -> <outcome>"` to start a change, or empty to
resume the active one.

1. If `.workhorse/profile.yml` does not exist, stop and tell the user to run
   `/workhorse:onboard` first.
2. Dispatch the `wh-conductor` agent with this prompt, verbatim plus the arguments:

   > Run the WorkHorse pipeline. Request: `$ARGUMENTS`. If the request is empty, resume the
   > active change from state.json. Work through the phases (design, build, verify, review,
   > deploy, done) and stop only at Design (G2), Ship (G4), or Deploy (G5, tier 3 only) with
   > the packet presented, at a blocked report, or at done. Never stop to ask a question; take
   > the recommendation and record it as a decision row. Never approve a gate yourself.

3. When the conductor returns, print its final report to the user unchanged, followed by the
   output of `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" status` and then
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" clock`.
4. If the conductor stopped at a gate, name it (Design, Ship, or Deploy), give the packet path
   (`brief.md`, `ship.md`, or `release.md`), and remind the user of the two commands:
   `/workhorse:approve <G>` and `/workhorse:approve <G> --reject "notes"`.

Do not run any phase agent directly from this skill; the conductor owns sequencing.
