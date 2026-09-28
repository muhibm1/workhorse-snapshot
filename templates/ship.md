# Ship: {{title}}

Change id: `{{change_id}}` · Tier {{tier}} · Branch `{{branch}}` at `{{commit}}` · PR {{pr_url}}
Prepared {{timestamp}} UTC · Design approved: see [approvals.md](./approvals.md)

This is the Ship document. A person reads it in under ten minutes. Approving it merges the change
and deploys it to every environment the profile marks automatic (at tier 3, production waits for
the Deploy touch).

## The short version

Three sentences. What was built, what it changes, and what you are being asked to decide.

## What changed

Plain words first, then the diff tour ordered by risk: protected and sensitive paths first.

1. `path` — what changed and why it is first.

## Proof

Every row is `confirmed` (the agent ran it and read the output) or `believed, not verified`.

| Check | Command | Exit code | Output | Status |
|-------|---------|-----------|--------|--------|
| | | | | |

Evals: golden {{g}}/{{gt}}, edge {{e}}/{{et}}, failure {{f}}/{{ft}}, adversarial {{a}}/{{at}}.
Known pre-existing failures cited: none, or the rows from `.workhorse/known-failures.md`.

## What the reviewers found

Every high or medium finding is fixed (Resolution names the commit) or accepted with a reason.
Lows are listed so nothing is hidden. Reports: [reviews/](./reviews/).

| Severity | Reviewer | File:line | Finding | Resolution |
|----------|----------|-----------|---------|------------|
| | | | | |

Spec conformance: {{n}} of {{m}} requirements traced to code and test.

## Decisions

Decisions taken during the build under the decision policy, and any that need you. Each with
the recommended answer chosen; approving accepts them.

| # | Decision | Recommendation | Alternative | Why the recommendation |
|---|----------|----------------|-------------|------------------------|
| D1 | | | | |

## Deploy and undo

| Environment | Command | Automatic on approval | Rollback |
|-------------|---------|-----------------------|----------|
| | | | |

Rollback rehearsed (tier 2+): steps and exit codes, or "not rehearsed: reason".
Config and secrets touched (names only, never values): none.

## Clock

{{clock}}

## Your decision

Approve to merge and deploy, or reject with notes to send it back.
