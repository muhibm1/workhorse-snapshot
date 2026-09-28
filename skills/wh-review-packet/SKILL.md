---
name: wh-review-packet
description: How to write the WorkHorse Ship document (ship.md), the one document a human reads to approve Ship (G4), from templates/ship.md. Loaded by the shipper and the conductor. The Design document (brief.md) follows the same rules with its own template.
user-invocable: false
---

# The Ship document

The human judges a document, not raw output. `ship.md` is the packet for Ship (G4): approving
it merges the change and deploys it to every environment the profile marks automatic. It is
written from `${CLAUDE_PLUGIN_ROOT}/templates/ship.md`, in that order, and is live for the
human only once `## Your decision` exists. Size limit: 100 lines at tier 0-1, 150 at tier 2,
200 at tier 3. The `artifact-check` hook refuses a longer write and a finished document that
carries a blocker.

## The eight sections, in order

1. **The short version.** Three sentences: what was built, what it changes, what the reader
   is being asked to decide. Enough on its own to say yes or no.
2. **What changed.** Plain words first. Then the diff tour ordered by risk, not filename:
   protected and sensitive paths, migrations and policies, auth and data access, business
   logic, interfaces, tests, docs and config. One line per file: what changed and why it sits
   at that position.
3. **Proof.** The checks table copied from `verification.md`: command, exit code, output path,
   status `confirmed` or `believed, not verified`. A check that could not run stays in the
   table with its reason. One evals line with pass counts per category against target. Known
   pre-existing failures are cited from `wh.js known-failure list`, never re-derived.
4. **What the reviewers found.** One table sorted by severity (critical, high, medium, low),
   reviewer named, file:line, finding, resolution. Every critical, high, or medium row has a
   Resolution that names the fix commit or reads `accepted: <who>, <why>`. Lows are listed
   with their state so nothing is hidden. Then the conformance line (`n of m requirements
   traced`) and the adoption score. Two reviewers on one issue share one row.
5. **Decisions.** Every decision row taken during the run under the decision policy, plus any
   that need the human, each with the recommended answer chosen: `| D<n> | decision |
   recommendation | alternative | why |`. Approving accepts every recommendation unless the
   approval notes say otherwise. A decision the run could not take (irreversible, needs a
   credential or a permission the agent lacks) leads the table.
6. **Deploy and undo.** One row per environment in the profile: command, automatic on
   approval or not, exact rollback command. Config and secret names touched, never values.
   Rollback rehearsed at tier 2+ with exit codes, or `not rehearsed: <reason>`.
7. **Clock.** The output of `wh.js clock` pasted unchanged: agents working, waiting on the
   human, dead time, against the tier budget.
8. **Your decision.** Last, written only when every section above is complete. Approve to
   merge and deploy, or reject with notes to send it back.

## Rules

- Plain language first, in every section: the person approving may not be an engineer and
  reads nothing else. No code; a path only where the path is the point. Numbers in tables.
- Write for a reader who did not watch the work. Link every artifact by relative path.
- Do not soften, merge, or drop a finding. `open`, `todo`, `pending`, or `fix before merge` in
  a critical, high, or medium row is a blocker: the document is not finished and
  `## Your decision` must not be written until the fixer has run. "Filed as a follow-up" is a
  resolution only when it names a path or a URL.
- Every factual claim is `confirmed` or `believed, not verified`. A command not run is
  `not run`, never green.
- No em-dashes. Secrets as names only. No paragraph over three sentences.
- The conductor presents the gate with the two commands, in this form and no other (rejection
  is a flag on approve):

```
/workhorse:approve G4
/workhorse:approve G4 --reject "notes"
```

## The Design document

`brief.md` (Design, G2) follows the same rules from `templates/brief.md`: 80/120/160 lines by
tier, plain language, a Decisions table with the recommendation chosen, `## Your decision`
last. `release.md` (Deploy, G5, tier 3) is the runbook the human runs production from.

## Rejection handling

When a gate is rejected, the notes in `approvals.md` become the first input to the re-entered
phase. The next document for the same gate opens with "Response to rejection", quoting each
note and saying what changed.
