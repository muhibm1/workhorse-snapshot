# WorkHorse

> [!IMPORTANT]
> **This repository is a snapshot, not a live project.** It is a point-in-time export (2026-09-27) of
> a private working repository, published so the work can be read. It has no commit history, is not maintained here,
> and issues or pull requests are not monitored.
>
> Source: WorkHorse plugin 0.3.10. The desktop app that ran alongside it is its own snapshot, [paddock-snapshot](https://github.com/muhibm1/paddock-snapshot); the RAG service over the record is [studbook-snapshot](https://github.com/muhibm1/studbook-snapshot). Internal working notes and per-run records were left out. Connection strings, keys, database project identifiers and
> local paths were never in it or were replaced with placeholders; nothing here connects to a
> live system.

An agentic software delivery lifecycle for forward-deployed engineering, packaged as a Claude
Code plugin. Give it a problem and an outcome inside any client repository. Agents design,
build, verify, review, and ship. You touch a change three times: you ask, you approve the
Design document, you approve the Ship document. Every step leaves a committed artifact, and a
clock measures every run against a budget.

Built on Anthropic's AI-native SDLC playbook, the FDE audit-evals-deploy loop, and a set of
security rules distilled from a real production audit.

## The loop

```
 Ask ─► Design ─► Build ─► Verify ─► Review ─► Deploy ─► Done
         G2     (agents,   (agents,    G4     G5 at     (retro in the
               parallel)   loops)            tier 3     background)
```

| Touch | Gate | You read | Approving means |
|-------|------|----------|-----------------|
| Ask | none | nothing; you typed "problem -> outcome" | the run starts |
| Design | G2 | `brief.md`, at most 80/120/160 lines by tier | build it exactly this way; no more questions |
| Ship | G4 | `ship.md`, at most 100/150/200 lines | merge and deploy to every environment the profile marks automatic |
| Deploy (tier 3 only) | G5 | `release.md`, the runbook | you run the production step |

| Tier | Typical change | You approve at |
|------|----------------|----------------|
| 0 | docs, tests, pure refactor | G4 only |
| 1 | feature, no schema/auth/payment/PII | G2, G4 |
| 2 | schema, auth, payments, PII, infra, integrations | G2, G4; security review mandatory, rollback rehearsed |
| 3 | regulated or irreversible | G2, G4, G5; you run the production deploy |

`assisted` and `shadow` autonomy add Deploy (G5) at every tier. Tier still decides depth: which
reviewers run, whether the security reviewer is mandatory, whether rollback is rehearsed, which
model builds.

Both documents end with a `## Your decision` section and a Decisions table in which every
question the agents met already has a recommended answer. Approving accepts every
recommendation unless your notes say otherwise; no agent stops a run to ask. Approve with one
command; the approval is committed with who, when, and the artifact hash.

## Install (global, on your machine)

```bash
claude plugin marketplace add <path-to-workhorse>
```

```bash
claude plugin install workhorse@workhorse --scope user
```

Or for a one-off session without installing: `claude --plugin-dir <path-to-workhorse>`.

Requires Node 18+ on PATH (the hooks and CLI are dependency-free Node scripts).

## Quickstart on a client repo

1. `cd` into the client repo and start Claude Code.
2. `/workhorse:onboard fintech, UK users, AWS eu-west-2` writes `.workhorse/profile.yml`, a
   codebase map, constraints, and a one-page `CLAUDE.md`. Check the protected paths and
   commands it found; commit.
3. `/workhorse:run "support cannot see why a payout failed -> payout failures show a reason code in the admin UI and are searchable"`.
   The designer sets the tier and writes the spec, plan, evals and the Design document; the
   conductor stops at G2 with `brief.md` if your tier requires it.
4. `/workhorse:approve G2` (or `--reject "notes"`). Then `/workhorse:run` again: build, verify
   and review run without you, reviewer findings with a fix are fixed, and the conductor stops
   at G4 with a PR and `ship.md`.
5. `/workhorse:approve G4`. Then `/workhorse:run` again merges, deploys to the automatic
   environments, and closes the change; at tier 3 it stops once more at G5 with `release.md`.
   `/workhorse:handover` at the end of the engagement.

Try it on the sample first: `cd examples/hello-service`, then step 2 with "internal tool, no
users, no compliance", then `/workhorse:run "there is no way to check the service is up -> GET /health returns 200 with uptime seconds"`.

## Commands

| Command | Does |
|---------|------|
| `/workhorse:onboard [context]` | Discover. Profile, map, constraints, CLAUDE.md. Once per client. |
| `/workhorse:run ["problem -> outcome"]` | Whole pipeline to the next required gate, or resume. |
| `/workhorse:approve <G> [--reject] [notes]` | Record your decision. The only human step. |
| `/workhorse:status [--metrics]` | Where the active change is and what blocks it. |
| `/workhorse:design`, `build`, `verify`, `review`, `ship` | One phase at a time. |
| `/workhorse:handover [--export-workflow]` | Client docs pack; optionally vendor the plugin into the repo. |
| `/workhorse:retro [--incident "..."]` | Learn from a change, or triage an incident into a new change. |
| `/workhorse:sync [--all\|--setup]` | Mirror changes into a Notion tracker so others can see what needs you. |

Under the skills sits `scripts/wh.js`, the CLI every agent uses for state: `new`, `phase`,
`gate`, `approve`, `required`, `log`, `status`, `digest`, and two added in 0.3.0. `wh.js clock`
reports agent time, waiting time and dead time for the active change against its tier budget
(0: 25 minutes, 1: 30, 2: 90, 3: 180; `budgets.agent_minutes` in the profile overrides).
`wh.js known-failure add <check> --command "<cmd>" --base <sha> --reason "<why>"` records a check
that was already red on the base branch, once; `wh.js known-failure list` is what later phases
cite instead of re-deriving it.

## What enforces what

Prompts can be argued with. Hooks cannot. `hooks/hooks.json` wires nine Node scripts (at eleven
points: gate-guard runs on both edits and Bash, verify-before-stop on both Stop and
SubagentStop):

| Hook | Refuses |
|------|---------|
| protect-paths | edits to `protected_paths`; asks on `sensitive_paths`; any direct edit of `approvals.md` |
| test-lock | edits to test files while the fixer is working |
| worktree-fence | source edits in the main checkout while a change is being built in a worktree |
| bash-guard | force-push, push to the default branch, destructive resets, profile deny list; asks on the ask list; production deploy without G5; any approval attempted from a subagent |
| gate-guard | writing the next phase's artifact, pushing, or merging while a required gate is unapproved; direct edits of `state.json` |
| artifact-check | a change document longer than its tier allows, an `evals.md` with more cases than its tier allows (15/40/80), a reviewer report over 60/80/100 lines, and a finished `ship.md` that still carries a blocker (replaces artifact-size, added in 0.2.11) |
| format-on-write | nothing; runs the profile's formatter |
| verify-before-stop | the builder, fixer, or verifier finishing without a green `verification.md` |
| session-context | nothing; injects profile and change state at session start |

Run the hook tests: `node hooks/tests/run.js`.

## Agents

Twenty-eight single-purpose agents in `agents/`: nineteen WorkHorse agents and nine vendored
from ECC (`ecc-*`). The conductor sequences them, runs Build as waves of up to
`build.max_parallel` (default 10) builders in isolated worktrees, and stops at gates. The
verifier cannot edit or spawn agents. The fixer cannot touch tests. Reviewers cannot fix. No
agent can approve.

| Agent | Does |
|-------|------|
| wh-conductor | Drives the six phases, dispatches the others, keeps state through the CLI, stops only at G2, G4 and (tier 3) G5. |
| wh-discovery-analyst | Onboarding: audits the repository and the business workflow, writes the profile, codebase map, constraints and client CLAUDE.md. |
| wh-compliance-mapper | Onboarding: decides which compliance regimes apply and which controls each phase must honour. |
| wh-designer | Design: in one session turns "problem -> outcome" into the tier, `spec.md` with ADRs, `evals.md`, `plan.md` in file-disjoint waves (every eval case has a task), and `brief.md`. Never stops to ask. |
| wh-constraint-auditor | Design: audits the spec against the security baseline, compliance regimes and the profile's constraints; a high finding earns one revision round. |
| wh-eval-designer | Design, tier 2+: reviews `evals.md`, adds the edge, failure and adversarial cases worth having, and the matching plan steps. |
| wh-builder | Build: one task from the plan, test-first, in its own worktree on a task branch; up to `max_parallel` at once. |
| wh-polish | Build: one pass over the whole diff after the last wave for naming, structure, dead code and needless abstraction; keeps tests green. |
| wh-verifier | Verify: runs every profile check and every automatable eval case in one session, writes `verification.md`; green only with every check passed or a cited known failure. |
| wh-fixer | Verify and Review: fixes the failures and findings it is given by changing implementation code, never tests. |
| wh-bug-reviewer | Review: logic errors, edge cases, races, leaks, error handling; only findings with a concrete failure scenario. |
| wh-conformance-reviewer | Review: maps every requirement to code and test, and every change back to a requirement. |
| wh-security-reviewer | Review: OWASP categories, the security baseline and the compliance controls; mandatory at tier 2 and above. |
| wh-adoption-reviewer | Review: could a client engineer maintain this from the repository alone. |
| wh-shipper | Review and Deploy: writes `ship.md`, pushes, opens the PR; after G4 merges, deploys the automatic environments, and at tier 3 writes `release.md`. |
| wh-retro-learner | Done: writes `retro.md` in the background and proposes edits to CLAUDE.md, the profile and the evals. |
| wh-incident-triager | Maintain: headless read-only diagnosis of an alert into a reproducing eval case and a new change. |
| wh-handover-writer | Handover: the `docs/handover/` pack so the client can run the system without the FDE. |
| wh-tracker-sync | Any phase: one-way mirror into the Notion tracker; never blocks. |
| ecc-typescript-reviewer, ecc-python-reviewer, ecc-react-reviewer, ecc-fastapi-reviewer, ecc-database-reviewer, ecc-rag-pipeline-reviewer, ecc-silent-failure-hunter, ecc-pr-test-analyzer | Review specialists chosen by stack, at most four per change. |
| ecc-build-error-resolver | Verify: build, typecheck and compile failures, before the fixer sees test failures. |

### What comes from ECC

WorkHorse vendors a reviewed subset of [ECC](https://github.com/affaan-m/ECC) (MIT), listed
with the upstream commit in `vendor/ecc/VENDORED.md`: nine agents and the common, TypeScript,
Python, React, and web rule packs, which builders and reviewers read through the
`wh-language-standards` skill. ECC's hooks, the other agents and skills, and its observation-
based learning are deliberately not vendored; the reasons are in
`docs/ecc-adoption.md`.

## Policy skills

Loaded by the agents that need them: `wh-security-baseline`, `wh-compliance-{gdpr, hipaa,
pci-dss, soc2, financial}`, `wh-readable-code`, `wh-review-packet`, `wh-evals`, `wh-adr`,
`wh-handover`, `wh-agent-rules`. Add a client-specific policy by dropping a skill into the
client's `.claude/skills/` and naming it in the profile's `notes`.

## Layout inside a client repo

```
.workhorse/profile.yml      the client profile (hooks and agents read it)
.workhorse/known-failures.md checks that were red before any change touched them
.git/workhorse/             control state, never committed: the active change and each
                            change's state.json, shared by every worktree
docs/sdlc/<change-id>/      brief.md, spec.md, plan.md, evals.md, adr/, verification.md,
                            reviews/<agent>.md, ship.md, release.md (tier 3), retro.md,
                            approvals.md, conductor-log.md
docs/handover/              written at handover
CLAUDE.md                   one page, client-facing
```

## How a change flows

1. **Ask.** `/workhorse:run "problem -> outcome"`. The designer sets the tier and its reason,
   writes `spec.md`, `plan.md` and the ADRs, and writes `brief.md` last; the constraint auditor
   and eval designer run in parallel on the spec. One revision round at most, only on a high
   audit finding; medium findings become decision rows.
2. **Design document.** At G2 you read `brief.md`: problem, outcome, what changes for people,
   risks and guards, decisions with recommendations, how it will be proved, and the estimate
   against the tier budget. Approve, or reject with notes.
3. **Build, verify, review.** Builders run the plan's waves in worktrees, polish runs once on
   the whole diff, the verifier runs the checks and evals and the fixer loops on red (five at
   most). Reviewers write `reviews/<agent>.md`; every high or medium finding with a concrete fix
   goes to the fixer and the verifier runs again. Nothing here asks you anything.
4. **Ship document.** The shipper pushes the branch, opens the PR, and writes `ship.md`: what
   changed in plain words then a diff tour ordered by risk, the proof table with every command
   and exit code, what the reviewers found and how each was resolved, the decisions taken, the
   deploy and rollback plan, and the clock. It is never presented with a blocker.
5. **Merged and deployed.** Approving G4 merges and deploys to every environment the profile
   marks automatic. At tier 3 the shipper writes `release.md` and stops at G5 for you to run the
   production step. `WH phase done` commits the artifacts and the retro runs in the background.

## CI and headless

`ci/claude-review.yml` runs the security and conformance reviewers on every PR and fails the
build if the API key secret is missing rather than silently passing. `ci/incident-triage.sh`
shows the Maintain loop: an alert on stdin becomes a read-only diagnosis and a new change that
enters the pipeline through normal gates.

## Running headless

In an interactive session the profile's commands run after your normal permission prompts. In
`claude -p` there is nobody to answer a prompt, so pass the tools the pipeline needs or the
verifier will be refused and will report the gap instead of green:

```bash
claude -p '/workhorse:run' --permission-mode acceptEdits --allowedTools "Agent,Read,Glob,Grep,Edit,Write,Bash(node *),Bash(npm *),Bash(git *)"
```

Match the `Bash(...)` entries to the commands in `.workhorse/profile.yml`. The CI example in
`ci/claude-review.yml` does this for the reviewers.

## Notion tracker (optional)

`/workhorse:sync --setup` creates a Notion database for the client, then set `tracker.provider:
notion` and `tracker.database: <id>` in the profile. From then on the conductor mirrors each
change: one row with status, tier, verification, branch, PR, and a `Waiting On` column.

Filter that database to `Waiting On` starting with "You" and you get the cross-client view of
every gate blocked on your approval, readable from a phone. The mirror is one-way and
non-blocking: nothing in Notion can approve a gate or change a change, and a tracker outage
never stalls the pipeline.

## Design

The gate model, phase table, document contracts, decision policy and clock are in
`docs/superpowers/specs/2026-09-19-two-gates-design.md`, approved 2026-09-19. The rest of the
design (sources, principles, state, guardrails, memory, commands, conventions, CI, handover,
measurement) is in `docs/superpowers/specs/2026-09-06-workhorse-sdlc-design.md`, whose gate and
phase sections that document supersedes.

Why two gates: measured from three real changes' own logs (design document, section 1), the
human waited 41, 10 and 17 hours on runs whose agents worked 7 hours, 3 hours 40 minutes and
1 hour 45 minutes, and every approval note on the smallest change read "none".

## Known limits

- Approvals are trusted to come from the human because the approve skill is user-invocable
  only and the bash-guard refuses it from subagents. The main session model could still be
  talked into running it; treat `approvals.md` history in git as the audit source.
- Tracker sync mirrors to Notion only (since 0.2.0); Jira and Linear are documented hook points,
  not implemented.
- Worktree paths are whatever the platform gives `isolation: worktree`; the fence hook is
  lenient when the path is unknown.
- The two-gate pipeline was measured on five real changes before this snapshot; the reasoning
  and the numbers are in `docs/superpowers/specs/2026-09-19-two-gates-design.md` and
  `CHANGELOG.md` (0.3.0 to 0.3.10).
