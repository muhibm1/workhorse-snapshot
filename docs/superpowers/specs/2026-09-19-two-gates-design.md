# WorkHorse 0.3: two gates and a clock

Status: approved by the owner on 2026-09-19 (artifact "WorkHorse: two gates and a clock").
Supersedes the gate model and phase table of `2026-09-06-workhorse-sdlc-design.md` sections 4
and 5; everything else in that document stands.

## 1. Why

Measured from the three real changes' own timestamps (`conductor-log.md`, `approvals.md`):

| Change | Wall | Agents working | of which code | Waiting on the human | Dead (service cut-offs) |
|---|---|---|---|---|---|
| Portfolio deploy (13 tasks) | 64 h | 7 h | 2 h 20 m | 41 h | 12 h 45 m |
| Portfolio font fix (3 tasks) | 18 h | 3 h 40 m | 4 min | 10 h 40 m | 3 h 26 m |
| client-style app, zoom fix (2 tasks) | 18 h 30 m | 1 h 45 m | 26 min | 17 h | 0 |

Causes, each confirmed against the logs: five checkpoints the human had nothing to decide at
(every approval note on the client-style app was "none"); small changes forced to tier 2 by path floors and then
given the full ceremony; documents sized to the template (a 2,279-line spec for a portfolio
site) that no person read and every agent had to; fourteen sequential agent sessions; agents
stopping mid-run to ask questions with obvious answers; no clock anywhere; reviewer findings
handed to the human instead of fixed (two G4 rejections, three hours).

## 2. The human's three touches

| Touch | Gate id | What the human reads | Approving means |
|---|---|---|---|
| Ask | none | nothing; they typed "problem -> outcome" | the run starts |
| Design | G2 | `brief.md`, at most 80/120/160 lines by tier | build it exactly this way; no more questions |
| Ship | G4 | `ship.md`, at most 100/150/200 lines | merge and deploy to every environment the profile marks automatic |
| Deploy (tier 3 only) | G5 | `release.md`, the runbook | the human runs the production step |

Required gates by tier: 0 → G4; 1 and 2 → G2, G4; 3 → G2, G4, G5. `assisted` and `shadow`
autonomy require G2, G4, G5 at every tier. G1 and G3 keep their ids so state, approvals and
Paddock keep their shape; no tier requires them and the conductor sets them `auto`.

Tier still decides depth: which reviewers run, whether the security reviewer is mandatory
(tier 2+), whether rollback is rehearsed (tier 2+), which model builds (sonnet below tier 3).

## 3. The pipeline

Phases: `design`, `build`, `verify`, `review`, `deploy`, `done`.

| Phase | Dispatch | Writes | Gate |
|---|---|---|---|
| design | `wh-designer` writes spec, evals, plan (every eval case has a task) and brief; tier 1+: `wh-constraint-auditor`; tier 2+: also `wh-eval-designer` (reviews and extends evals and the plan) in parallel; at most one revision round, only on a high finding | `brief.md` (last), `spec.md`, `plan.md`, `evals.md`, `adr/` | G2 |
| build | `wh-builder` per task in file-disjoint waves (unchanged); then `wh-polish` once | commits on the change branch | none |
| verify | `wh-verifier` (runs checks and evals in one session); `wh-fixer` on red, max 5 loops | `verification.md` | none |
| review | reviewers in parallel, each writing `reviews/<agent>.md`; `wh-fixer` once on every high or medium finding with a concrete fix, then `wh-verifier` again; `wh-shipper` | `ship.md`, PR | G4 |
| deploy | `wh-shipper` deploys to automatic environments; at tier 3 writes `release.md` | deploy record in `ship.md` | G5 (tier 3) |
| done | `WH phase done`; `wh-retro-learner` dispatched with `background: true` after | `retro.md`, committed by the retro itself | none |

Agents removed: intent-writer, risk-classifier, spec-architect, implementation-planner,
readability-reviewer, simplifier, eval-runner, packet-compiler, release-engineer, express-dev.

## 4. Contracts every agent follows

**Documents.** `docs/sdlc/<id>/`: `brief.md`, `spec.md`, `plan.md`, `evals.md`, `adr/`,
`verification.md`, `reviews/<agent>.md`, `ship.md`, `release.md` (tier 3), `retro.md`,
`approvals.md`, `conductor-log.md`. The `artifact-check` hook enforces the size limits after
every write and sends the writer back with the reason; it also refuses a finished `ship.md`
that carries a blocker.

**Gate packets.** A packet is live for the human only once its `## Your decision` section
exists. Every writer of `brief.md` and `ship.md` writes that section last.

**Decision policy.** No agent stops a run to ask a question. A question becomes a decision row
(`| D<n> | decision | recommendation | alternative | why |`). Reversible: take the
recommendation, record it, continue; it appears in the next packet. Irreversible, needs a
credential, or needs a permission the agent lacks: it goes in the brief if known at design
time; discovered later, the run continues with everything that does not depend on it and the
item leads the Ship document's Decisions table. Approving a packet accepts every recommendation
in it unless the notes say otherwise.

**Known failures.** A check that is red on the base branch before the change is recorded once:
`WH known-failure add <check> --command "<cmd>" --base <sha> --reason "<why>"`. Later phases cite
the row (`WH known-failure list`) and never re-derive it. Verification may be green with known
failures cited; it is never green with a failure that is not recorded.

**SDLC prose is not a verification target.** The verifier checks code, tests, evals and the
profile's commands. A wording mismatch between two planning documents is a note in the Ship
document, never a red.

**Reviewer reports.** Each reviewer writes `reviews/<agent>.md`, at most 60/80/100 lines by
tier: one row per finding with severity (critical, high, medium, low), file:line, the failure
scenario, and a concrete fix where one exists. Findings marked high or medium with a fix go to
the fixer before the Ship document exists. That review-phase fix runs with the test lock off
(`WH mode normal`): review findings are often in test files, and the reviewer has already judged
them. The lock stays on in the verify loop, where a red test must never be edited green.

**Evals are in the plan.** The designer writes `evals.md` and every case is implemented by
exactly one plan task, so the verifier never finds a case with no test. (Run 1 of 0.3.1 lost
eight minutes to cases the eval designer added after the plan existed.)

**Task branches** are `<change-branch>-t<N>`, with a dash: git cannot hold `wh/x` and
`wh/x/t1` at once.

**The clock.** `WH clock` reports agents working, waiting on the human, dead time and gaps,
against the tier budget (0: 15 min, 1: 30, 2: 90, 3: 180; `budgets.agent_minutes` in the
profile overrides). The shipper pastes it into `ship.md`; the retro judges the run against it.

**Resume procedure.** A conductor that starts with an active change in any phase but `design`
with no brief: read `WH status --json`, `conductor-log.md`, and every document on disk; diff
each against its last committed version; log one row `conductor | resumed at <phase> after
<reason>`; continue from the first thing the phase table says is missing. Never re-run a step
whose output exists and is complete; never guess a timestamp.

**Models and effort.** designer: fable, effort high. constraint-auditor: opus, medium.
eval-designer: sonnet, medium. builder: sonnet below tier 3, opus at tier 3; effort medium.
polish: sonnet, low. verifier: sonnet, medium. bug-reviewer and security-reviewer: opus, high.
other reviewers: sonnet, medium. fixer: sonnet, medium. shipper: sonnet, medium. retro-learner:
sonnet, low. Turn caps: designer 80, builder 60, polish 30, verifier 50, reviewers 30 (security
40), fixer 50, shipper 40, retro 25.

## 5. Paddock 0.5

Gate labels Design / Ship / Deploy; the Gate screen renders `brief.md` and `ship.md`; two
primary actions, "Approve as recommended" and "Reject with notes", with per-decision overrides
kept; the Run screen shows the clock live against the budget; opening a gate screen records
`WH state set gate_opened.<G> <iso>` so the clock can measure the human's time.

## 5b. Budgets, revised after measurement

The tier 0 budget of 15 agent-minutes was not reachable: a verify pass and a review pass with
their fixes cost about 25 minutes on a one-file change, and that rigour is the product. Budget
for tier 0 is 25 minutes from 0.3.6; tiers 1 to 3 stay at 30, 90 and 180. The three runs of
2026-09-20 were recorded as measured.

## 6. Proving it

Three changes with the clock running, each from an existing backlog: hello-service tier 0 (15
agent-minutes, one touch), Portfolio Node pin (30 to 60 agent-minutes, two touches), a client-style app's
`dvh`/`vh` and cross-reference comments (90 agent-minutes, two touches). Results are recorded
as measured, budget missed or not.
