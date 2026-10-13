# WorkHorse, run by run

Every change WorkHorse has carried from a one-line request to a merged pull request, one row each.
Nobody typed these numbers. `wh.js ledger` re-reads each change's committed conductor log and
approvals from git and recomputes its clock the same way every time, so a release can only claim
it made runs faster if this table shows it.

Generated 2026-10-13. 16 finished runs and 2 whose record was never closed, across 5 repositories.

## What the words mean

- **Agent time**: minutes the agents were working.
- **Wall time**: from the request to the last record of the change, nights and weekends included.
- **Waiting**: minutes a finished Design or Ship document sat until a person approved it.
- **Dead time**: minutes lost to a stopped run (a usage limit, a crash, a refused merge) before it resumed.
- **Budget**: the agent minutes a change of that risk tier is allowed: 25 (tier 0), 30 (1), 90 (2), 180 (3).
- **Tier**: risk, from 0 (docs, tests) to 3 (regulated or irreversible).

## By generation

Finished runs at tiers 0 to 2. Tier 3 runs are counted separately because their budget is twice as large.

| Generation | From | Runs | Median agent time | Within budget | Median wall time | Agent share of wall time | Tier 3 runs |
|---|---|---|---|---|---|---|---|
| Five gates | 0.1.0 | 2 | 7 h 59 m | 0 of 2 | 45 h 14 m | 18% | 0 |
| Two gates | 0.3.0 | 7 | 1 h 43 m | 3 of 7 | 11 h 05 m | 13% | 0 |
| Speed release | 0.3.12 | 5 | 1 h 05 m | 3 of 5 | 2 h 26 m | 33% | 2 |
| Lead time | 0.5.0 | 0 | – | – | – | – | 0 |

## Every run

Versions marked `~` are inferred from the release dates in `CHANGELOG.md` (a range when several
releases shipped that day); the rest are named in the run's own log or cited under Corrections.
From 0.5.0 each change records the version it ran on in its own `metrics.json`. "Unexplained" is a
silence of more than 90 minutes in the log that no row accounts for; it counts as neither agent
nor dead time. "Record not closed" means the change's documents stop before its done step.

| Started | Repository | Change | Tier | Version | Agent time | Budget | Waiting | Dead | Unexplained | Wall | Gate decisions | Rejected | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-09-11 | Portfolio | deployed multi page portfolio on github pages | 2 | ~0.2.0–0.2.1 | 11 h 57 m (over) | 1 h 30 m | 19 h 30 m | 24 h 59 m | 12 h 01 m | 68 h 28 m | 7 | 2 | – |
| 2026-09-13 | Portfolio | no inlined data font urls in built css | 2 | ~0.2.7–0.2.8 | 4 h 00 m (over) | 1 h 30 m | 1 h 06 m | 2 h 16 m | 14 h 37 m | 21 h 59 m | 4 | 0 | – |
| 2026-09-14 | wasl | fix zoom scaling and enable sideways scrolling *(record not closed)* | 2 | ~0.2.8–0.2.10 | 27 m | 1 h 30 m | 6 h 02 m | 0 m | 0 m | 6 h 29 m | 3 | 0 | – |
| 2026-09-20 | Portfolio | fix phone redaction scanner | 2 | ~0.3.1–0.3.9 | 1 h 43 m (over) | 1 h 30 m | 5 m | 2 h 36 m | 0 m | 4 h 24 m | 2 | 0 | – |
| 2026-09-20 | wasl | fix pre existing typecheck and build failure in | 2 | ~0.3.1–0.3.9 | 1 h 14 m | 1 h 30 m | 2 h 43 m | 4 h 16 m | 1 h 31 m | 9 h 44 m | 1 | 0 | – |
| 2026-09-20 | Portfolio | pin node 22 12 minimum | 2 | ~0.3.1–0.3.9 | 1 h 52 m (over) | 1 h 30 m | 6 h 33 m | 5 h 19 m | 2 h 09 m | 15 h 53 m | 2 | 0 | – |
| 2026-09-21 | Portfolio | serve every app route with http 200 on github pa | 2 | ~0.3.9–0.3.10 | 1 h 03 m | 1 h 30 m | 8 h 08 m | 3 h 23 m | 0 m | 12 h 34 m | 3 | 0 | – |
| 2026-09-25 | Portfolio | rebuild portfolio to approved redesign | 2 | ~0.3.10 | 8 h 13 m (over) | 1 h 30 m | 1 h 11 m | 62 h 09 m | 13 h 52 m | 85 h 26 m | 5 | 2 | – |
| 2026-09-26 | studbook | mcp record server | 2 | ~0.3.10 | 4 h 18 m (over) | 1 h 30 m | 3 h 47 m | 3 h 00 m | 0 m | 11 h 05 m | 5 | 1 | – |
| 2026-09-29 | Portfolio | separate the integration and decision case studi | 2 | 0.3.11 | 1 h 01 m | 1 h 30 m | 45 m | 8 h 36 m | 0 m | 10 h 23 m | 3 | 1 | – |
| 2026-09-29 | workhorse | studbook tools for designer and discovery analys | 1 | 0.3.12 | 45 m (over) | 30 m | 2 m | 3 h 14 m | 0 m | 4 h 01 m | 2 | 0 | – |
| 2026-09-30 | workhorse | status shows gate age | 2 | ~0.4.0 | 24 m | 1 h 30 m | 2 h 02 m | 0 m | 0 m | 2 h 26 m | 1 | 0 | – |
| 2026-10-01 | agentops | increment 1 scaffold | 2 | ~0.4.0 | 1 h 05 m | 1 h 30 m | 50 m | 6 m | 0 m | 2 h 01 m | 2 | 0 | – |
| 2026-10-01 | agentops | increment 2 investigation half | 2 | ~0.4.0 | 1 h 17 m | 1 h 30 m | 29 m | 3 m | 0 m | 1 h 49 m | 2 | 0 | – |
| 2026-10-01 | agentops | increment 3 act pause persist resume | 3 | ~0.4.0 | 3 h 32 m (over) | 3 h 00 m | 2 m | 3 m | 0 m | 3 h 36 m | 3 | 0 | – |
| 2026-10-02 | agentops | increment 4 no spend measurement harness | 3 | ~0.4.0 | 3 h 39 m (over) | 3 h 00 m | 2 m | 1 h 31 m | 0 m | 5 h 12 m | 4 | 1 | – |
| 2026-10-05 | agentops | wire live anthropic model path *(record not closed)* | 2 | ~0.4.0–0.4.1 | 34 m | 1 h 30 m | 0 m | 0 m | 0 m | 34 m | 0 | 0 | – |
| 2026-10-08 | Portfolio | align the site to the owner s master copy | 2 | ~0.4.2 | 1 h 45 m (over) | 1 h 30 m | 1 h 59 m | 1 h 52 m | 0 m | 5 h 35 m | 2 | 0 | – |

## Corrections

Where a change's own record is incomplete, the fix is written in `docs/ledger/overrides.json` with its source. Nothing else is adjusted.

- **wasl, 2026-09-20-fix-pre-existing-typecheck-and-build-failure-in-**: Merged into v3-integration; the closing rows and retro were written on a branch that was not merged. Source: wasl v3-integration: 39aa8de "fix pre-existing typecheck and build failure in moderationApi (#2)"; docs/STATUS.md, the proving runs table.
- **workhorse, 2026-09-29-studbook-tools-for-designer-and-discovery-analys**: Ran on 0.3.12; the date alone would give the range 0.3.11 to 0.4.0. Source: CHANGELOG.md, 0.3.13: "First measured run of 0.3.12 (the Studbook-tools change)".
- **workhorse, 2026-09-30-status-shows-gate-age**: Merged as pull request #23 without a Ship approval being recorded, so the record stops at Design. Source: git log: 5b82be1 "status shows gate age (#23)"; docs/continuation-2026-10-08-session-e23e837f-workhorse-0.4.x.md, open item 4.
- **agentops, 2026-10-05-wire-live-anthropic-model-path**: The run stopped in Build on the Windows machine after the machine move; the live model path was finished by hand outside the pipeline. Source: agentops: e014915 "feat(cli): live model path with a spend guard"; docs/continuation-2026-10-08-session-e23e837f-workhorse-0.4.x.md.
