---
name: review
description: Review phase only for the active WorkHorse change. Runs the reviewers in parallel, sends fixable high and medium findings to the fixer and re-verifies, then the shipper writes ship.md, pushes the branch, opens the PR, and presents Ship (G4).
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *), Bash(gh *)
---

# /workhorse:review

1. Confirm `verification.status` is `green`. If not, say so and stop; the gate-guard hook
   will refuse the push anyway.
2. Dispatch `wh-conductor` with the prompt:

   > Run only the Review phase for the active change, following the Review section of your
   > instructions: the reviewers in parallel (each writing reviews/<agent>.md), then wh-fixer
   > once on every high or medium finding with a concrete fix, then wh-verifier again, then
   > wh-shipper in mode ship (ship.md with the clock pasted in and "## Your decision" last,
   > branch pushed, PR open). Present Ship (G4) and stop. Never hand a fixable finding to the
   > human.

3. Print the Ship document's short version, its decisions with their recommendations, the PR
   link, `wh.js clock`, and the two commands: `/workhorse:approve G4` and
   `/workhorse:approve G4 --reject "notes"`.
