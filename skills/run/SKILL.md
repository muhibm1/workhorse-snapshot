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
2. Take the run lock: `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" lock acquire --holder run`.
   If it exits 3, another conductor holds it: print its message and stop; do not dispatch a
   second conductor (two conductors raced on one task worktree on a live run). The lock is
   released when the conductor presents a gate, reports a block, or reaches done.
3. Dispatch the `wh-conductor` agent with this prompt, verbatim plus the arguments:

   > Run the WorkHorse pipeline. Request: `$ARGUMENTS`. If the request is empty, resume the
   > active change from state.json. Work through the phases (design, build, verify, review,
   > deploy, done) and stop only at Design (G2), Ship (G4), or Deploy (G5, tier 3 only) with
   > the packet presented, at a blocked report, or at done. Never stop to ask a question; take
   > the recommendation and record it as a decision row. Never approve a gate yourself.

4. When the conductor returns, release the lock in case it did not
   (`node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" lock release`), then print its final report to
   the user unchanged, followed by the output of `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" status`
   and then `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" clock --by-agent`.
5. If the conductor stopped at a gate, name it (Design, Ship, or Deploy), give the packet path
   (`brief.md`, `ship.md`, or `release.md`) and the pull request link if the gate was posted,
   and tell the user the three ways to answer: reply `/approve` or `/reject <notes>` on the pull
   request (from any device), `workhorse approve` / `workhorse reject "<notes>"` in a terminal,
   or `/workhorse:approve <G>` here.

Do not run any phase agent directly from this skill; the conductor owns sequencing.
