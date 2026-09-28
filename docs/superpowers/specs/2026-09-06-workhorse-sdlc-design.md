# WorkHorse: an agentic SDLC for forward-deployed engineering

Date: 2026-09-06
Status: approved design, v1
Owner: Muhammad Muhibullah

## 1. Purpose

WorkHorse is a Claude Code plugin that turns "a problem and an outcome" into shipped, reviewed,
documented software inside any client repository. Agents do the work. A human judges at gates.
Every decision leaves a versioned artifact so a client auditor, a client engineer, or you six
months later can reconstruct who asked, what was built, what was checked, and who approved.

It is designed for one engineer working across many clients and industries. Nothing in it
assumes a stack, a tracker, a cloud, or a compliance regime. Those come from a per-client
profile written once at onboarding.

## 2. Sources and what was taken from each

**Anthropic's AI-native SDLC playbook.** The six stages (Plan, Design, Build, Test, Deploy,
Maintain), the artifact chain (`intent.md` to `spec.md` to `plan.md` to diff and tests to PR to
deployment record), humans concentrated at gates, hooks as deterministic guardrails, `CLAUDE.md`
and skills as institutional memory, headless loops that turn incidents into new intents, and the
leading and lagging indicators in section 12.

**The FDE video (Greg Isenberg with Vas of Varick Agents).** The job is audit, then evals, then
deployment. Use deterministic code where certainty is available, the model where uncertainty
creates value, and a human where a wrong action costs more than the speed of automation. Agents
run the loop; the human approves a full audit trail at the end. Deploy along an autonomy ladder.

**Your global security rules.** Row-level security is not column-level security, revoke default
function privileges, diff every `CREATE OR REPLACE`, verify before asserting and label epistemic
status, CI must actually run the security tests, and the pre-ship checklist. These are shipped
as the `wh-security-baseline` skill and are loaded by every reviewer and the spec auditor.

## 3. Design principles

1. **Artifacts, not conversations, are the record.** Every phase writes a markdown file under
   `docs/sdlc/<change-id>/` and commits it. Chat is scaffolding.
2. **Deterministic where possible.** Path protection, gate enforcement, destructive-command
   blocking, and formatting are hooks, not prompts. A prompt can be argued with; a hook cannot.
3. **One job per agent.** Small agents with narrow tool access are more reliable and easier to
   audit than one large agent. The verifier cannot edit. The fixer cannot touch tests.
4. **Evidence before assertion.** No agent may report green without the command, the exit code,
   and the location of the output. Every claim is labelled `confirmed` or `believed, not verified`.
5. **Gates scale with risk.** A docs change and a production data migration do not deserve the
   same ceremony. A risk tier decides how many gates a change passes through. The pre-merge
   gate can never be removed.
6. **Human-friendly output is a requirement, not a style.** Readability and adoption are
   reviewed as first-class concerns because the code outlives your engagement.
7. **Reuse what is installed.** WorkHorse orchestrates the superpowers, code-review,
   security-review, feature-dev, and context7 plugins rather than duplicating them.

## 4. The lifecycle

> Superseded on 2026-09-19 by [2026-09-19-two-gates-design.md](./2026-09-19-two-gates-design.md),
> sections 2 and 3. The pipeline is now six phases (design, build, verify, review, deploy, done)
> with three human touches: Ask, Design (G2, `brief.md`) and Ship (G4, `ship.md`), plus Deploy
> (G5) at tier 3. The gate ids, the state shape and the risk tiers below still hold; the phase
> table, the gate-per-phase mapping and the required-gates-by-tier rule in 4.1 do not. Kept as
> written for the record.

```
 Discover ─► Intent ─► Spec ─► Plan ─► Build ─► Verify ─► Review ─► Deploy ─► Handover
   G0         G1       G2      G3      (agents)  (agents)    G4        G5     (client)
                                                                          │
                                        Maintain ◄────────────────────────┘
                                   (incidents become new intents)
```

| # | Phase | What agents do | Artifacts | Gate |
|---|-------|----------------|-----------|------|
| 0 | Discover | Audit the codebase and the real business workflow. Map stack, build and test commands, conventions, protected paths, deploy environments, compliance regime. | `.workhorse/profile.yml`, `docs/sdlc/codebase-map.md`, `docs/sdlc/constraints.md`, client `CLAUDE.md` | G0, once per client |
| 1 | Intent | Turn problem + outcome into a proto-spec: problem, outcome, users, systems, constraints, open questions, success metrics. Classify risk tier. | `docs/sdlc/<id>/intent.md` | G1 |
| 2 | Spec | Requirements and design in one session under client policy skills. Constraint audit. Eval design. ADRs for each non-obvious decision. | `spec.md`, `evals.md`, `adr/NNNN-*.md` | G2 |
| 3 | Plan | Implementation plan naming files, order, tests first, risk notes, rollback. | `plan.md` | G3 |
| 4 | Build | Plan tasks run as file-disjoint waves of up to `build.max_parallel` (default 10) builders, each TDD in its own isolated worktree on a task branch. Waves fold into the change branch; readability and simplification pass per wave. | commits | none |
| 5 | Verify | Run every quantifiable check from the profile plus the evals. Write evidence. Fix loop with test files locked. | `verification.md` | none |
| 6 | Review | Four parallel reviews (bugs, spec conformance, security, adoption). Compile one review packet. Open PR. | `review-packet.md`, PR | G4, always |
| 7 | Deploy | Changelog, deploy plan per environment tier, runbook, rollback rehearsal. | `release.md` | G5 for production |
| 8 | Handover | Client README, ADR index, runbook, client `CLAUDE.md`, "how to work on this with and without AI". | `docs/handover/` | client sign-off |
| 9 | Maintain | Headless triage of incidents and scheduled scans into new `intent.md`. Retro turns findings into `CLAUDE.md` and skill updates. | `intent.md`, `retro.md` | re-enters at Intent |

### 4.1 Risk tiers

The risk classifier assigns a tier at Intent. The human may override it at any gate; overrides
are recorded in `approvals.md`.

| Tier | Typical changes | Human gates | Mandatory extras |
|------|-----------------|-------------|------------------|
| 0 | docs, tests, pure refactor with no data or auth surface | G4 | none |
| 1 | feature without schema, auth, payment, or PII change | G2, G4 | none |
| 2 | schema, auth, payments, PII, infra, third-party integration | G1, G2, G3, G4, G5 | security reviewer, pre-ship checklist |
| 3 | regulated or irreversible: production data migration, financial movement, health data | all gates | compliance skill, human executes deploy, rollback rehearsed before G5 |

Tier signals (any one raises the tier): touches a path listed under `protected_paths` or
`sensitive_paths` in the profile; adds or changes a migration, an RLS policy, a database
function, an auth flow, a payment call, a storage bucket, an external integration, a CI
workflow, or infrastructure as code; handles a data category the profile marks as special.

### 4.2 Autonomy ladder

`profile.yml` carries `autonomy`, borrowed from the FDE autonomy ladder:

| Level | Meaning |
|-------|---------|
| `shadow` | Agents produce artifacts and diffs but never commit to a shared branch. You copy what you accept. |
| `assisted` | Agents commit to a worktree branch. Every gate is human, regardless of tier. |
| `bounded` | Default. Gates follow the tier table. Agents open PRs. |
| `full` | Tier 0 and 1 changes may auto-merge after G4 passes with zero findings, if the client's branch protection allows it. G4 still runs; a human still receives the packet. |

Autonomy can add gates. It can never remove G4.

### 4.3 Parallel build

Complex changes need throughput. The planner groups tasks into waves: every task in a wave
touches a disjoint set of files, and a wave depends only on earlier waves. The conductor
dispatches one `wh-builder` per task in the wave, all at once, up to `build.max_parallel` from
the profile (default 10, hard-capped at 10). Each builder runs with `isolation: worktree` on its
own task branch `<change-branch>-t<N>` (a dash since 0.3.2), so builders cannot see or clobber each other's edits.

When the wave returns, the conductor folds task branches into the change branch in task order
(`build.wave_merge`: rebase or merge). A conflict, which the file-disjoint rule makes rare,
goes to a single builder with both diffs. Then the readability reviewer and the simplifier run
once over the wave's diff, tests must stay green, and the next wave starts. A blocked builder
stops its wave; the conductor finishes the others, then re-plans or asks the human.

If the platform refuses to start a subagent, the refused count becomes the effective cap for
the rest of the run and the conductor says so in its log.

### 4.4 The gate contract

Every gate presents a packet with the same six sections so the human learns one shape:

1. **TL;DR.** Three sentences: what, why, what you are being asked to decide.
2. **Decisions requested.** Each with the agent's recommendation, the alternative, and what
   changes downstream if the human picks differently.
3. **Evidence.** A table of every command run, its exit code, and where its output lives. Every
   row labelled `confirmed` (agent ran it and read the output) or `believed, not verified`.
4. **Risk register.** Each risk with likelihood, impact, mitigation, and owner.
5. **Diff tour.** Ordered by risk, not by filename. Protected and sensitive paths first.
6. **Checklist.** Items the human ticks. At tier 2 and above the pre-ship security checklist is
   embedded verbatim.

Approval: `/workhorse:approve <gate> [notes]` writes a block to `approvals.md` with the gate, the
approver (from `git config user.email`), the UTC timestamp, the commit hash of the artifact being approved, and notes, then commits it. Before
recording, it commits the change's artifacts so that hash genuinely contains the packet, and it
records the packet's SHA-256, so an edit made after the decision is detectable. Rejection: `/workhorse:approve <gate> --reject "notes"`
records the rejection and re-enters the phase with the notes as input.

Enforcement: `hooks/scripts/gate-guard.js` reads `state.json` and refuses any phase-advancing
action (conductor writing the next phase's artifact, `git push`, PR creation) while a required
gate is unapproved.

### 4.5 State

`.git/workhorse/changes/<change-id>/state.json`:

```json
{
  "change_id": "2026-09-06-health-endpoint",
  "title": "Add /health endpoint reporting uptime",
  "tier": 0,
  "tier_override": null,
  "phase": "review",
  "mode": "normal",
  "worktree": ".worktrees/2026-09-06-health-endpoint",
  "branch": "wh/2026-09-06-health-endpoint",
  "gates": { "G1": "auto", "G2": "auto", "G3": "auto", "G4": "pending", "G5": "n/a" },
  "verification": { "status": "green", "at": "2026-09-06T10:22:14Z" },
  "updated_at": "2026-09-06T10:25:00Z"
}
```

`mode` is `normal` or `fix`. In `fix` mode the test-lock hook refuses edits to test files. The
conductor sets `mode` to `fix` when it dispatches the fixer and back to `normal` when the
verifier reports green.

Control state lives in the git common directory, not in tracked files: the active change in
`.git/workhorse/active` and each change's state in `.git/workhorse/changes/<id>/state.json`.
Git never tracks that directory, so no checkout can rewrite it, and every worktree of the
repository shares it, so hooks enforce inside builder worktrees too. It used to live in
`.workhorse/active` and `docs/sdlc/<id>/state.json`; a live run showed a branch checkout
rewriting both from the branch point, emptying the active change and turning the phase
backwards, which disabled every state-driven hook. Old repositories migrate on first read.

## 5. Deterministic guardrails

> Partly superseded on 2026-09-19 by [2026-09-19-two-gates-design.md](./2026-09-19-two-gates-design.md),
> section 4 ("Documents"). The table below predates `artifact-check.js` (0.3.0, replacing the
> `artifact-size.js` of 0.2.11), which holds every change document to its tier's line limit,
> counts eval cases, limits reviewer reports under `reviews/`, and refuses a finished `ship.md`
> that carries a blocker; the gate-guard now protects `brief.md` and `ship.md` rather than
> `intent.md` and `review-packet.md`. The failure-mode rule (fail open, except gate-guard) and
> the other eight hooks stand as written.

All hooks are Node scripts with zero dependencies so they run identically on Windows, macOS,
and Linux. Each reads the hook JSON on stdin and writes a `hookSpecificOutput` decision. A
script that cannot read state fails open with a warning in `additionalContext`, never closed,
so a broken hook cannot brick a client session; the exception is `gate-guard.js`, which fails
closed because a missing gate is exactly the case it exists for.

| Hook | Event | Matcher | Behaviour |
|------|-------|---------|-----------|
| `protect-paths.js` | PreToolUse | Edit, Write, MultiEdit, NotebookEdit | Deny if the target matches `protected_paths` in the profile. Ask if it matches `sensitive_paths`. |
| `test-lock.js` | PreToolUse | Edit, Write, MultiEdit | Deny edits to files matching `test_globs` while `state.mode == "fix"`. |
| `worktree-fence.js` | PreToolUse | Edit, Write, MultiEdit | While a change has a worktree, deny edits to repo files outside it, except `docs/sdlc/**`. |
| `bash-guard.js` | PreToolUse | Bash | Deny `git push --force`, `git push` to the default branch, `git reset --hard` on shared branches, `rm -rf` outside the worktree, and anything on the profile's `deny_commands` list. Ask for anything on `ask_commands`. |
| `gate-guard.js` | PreToolUse | Bash, Write | Deny `git push`, `gh pr create`, and writes to the next phase's artifact while the current phase's gate is required and unapproved. |
| `format-on-write.js` | PostToolUse | Edit, Write, MultiEdit | Run `profile.commands.format` on the changed file if defined. |
| `verify-before-stop.js` | Stop, SubagentStop | | If the active phase is build or verify and `verification.md` is absent or not green, block the stop with a message naming what is missing. |
| `session-context.js` | SessionStart | | Inject a summary of the profile and the active change's state as additional context. |

## 6. Institutional memory

- **Client `CLAUDE.md`** under one page, generated at Discover from the profile: commands,
  conventions, architecture in five lines, mistakes to avoid. Retro appends to "mistakes to
  avoid".
- **Policy skills** loaded by the agents that need them: security baseline, compliance regimes
  (GDPR, HIPAA, PCI DSS, SOC 2, financial services), readable code, review packet, evals,
  handover, ADR.
- **Evals** in `evals.md` are written as executable cases where the stack allows it and become
  permanent tests. Every production incident becomes an eval before its fix is merged.
- **Retro** runs after each G4 approval and after each incident, and proposes edits to the client
  `CLAUDE.md` and to the profile. Those edits go through G4 like any other change.

## 7. Agents

Each agent file states: purpose, inputs, outputs, tools, model, hard rules, and exit criteria.
The shared rules below are repeated in every agent so they survive being run standalone.

**Shared rules.** Label every claim `confirmed` or `believed, not verified`. Never report green
without the command and its output. Prefer existing code and existing patterns. Write for a
client engineer who has never met you. One job; stop and report rather than guess outside it.
No em-dashes in anything client-facing.

| Agent | Phase | Model | Tools | Exit criterion |
|-------|-------|-------|-------|----------------|
| `wh-conductor` | all | opus | Agent, Read, Glob, Grep, Bash, Write, Edit | State advanced to the next gate or a gate packet presented |
| `wh-discovery-analyst` | 0 | opus | Read, Glob, Grep, Bash, WebFetch, context7 | profile.yml, codebase-map.md, constraints.md written, each claim sourced |
| `wh-compliance-mapper` | 0 | sonnet | Read, WebSearch, WebFetch | Applicable regimes and controls listed with reasons; profile updated |
| `wh-intent-writer` | 1 | opus | Read, Glob, Grep, Write | intent.md complete with no empty sections |
| `wh-risk-classifier` | 1 | sonnet | Read, Glob, Grep | Tier and every triggering signal written to intent.md |
| `wh-spec-architect` | 2 | opus | Read, Glob, Grep, Write, context7 | spec.md and ADRs written; every requirement testable |
| `wh-constraint-auditor` | 2 | opus | Read, Glob, Grep | Findings by severity; blocks G2 on any high |
| `wh-eval-designer` | 2 | sonnet | Read, Write | evals.md with golden, edge, failure, adversarial cases and numeric targets |
| `wh-implementation-planner` | 3 | opus | Read, Glob, Grep, Write | plan.md tasks each with test-first steps and file list |
| `wh-builder` | 4 | opus | Read, Glob, Grep, Edit, Write, Bash | One task green with test output shown |
| `wh-readability-reviewer` | 4 | sonnet | Read, Glob, Grep, Edit | Naming and structure findings fixed or listed |
| `wh-simplifier` | 4 | sonnet | Read, Glob, Grep, Edit, Bash | Accidental complexity removed, tests still green |
| `wh-verifier` | 5 | sonnet | Read, Glob, Grep, Bash | verification.md with every check's command, exit code, output path |
| `wh-fixer` | 5 | opus | Read, Glob, Grep, Edit, Write, Bash | Named failures fixed; tests untouched |
| `wh-eval-runner` | 5 | sonnet | Read, Bash | Pass rate per eval category vs target |
| `wh-bug-reviewer` | 6 | opus | Read, Glob, Grep | Findings with file, line, failure scenario |
| `wh-conformance-reviewer` | 6 | sonnet | Read, Glob, Grep | Every spec requirement mapped to code and test, drift listed |
| `wh-security-reviewer` | 6 | opus | Read, Glob, Grep, Bash | OWASP, security baseline, regime controls checked |
| `wh-adoption-reviewer` | 6 | sonnet | Read, Glob, Grep | Adoption score with concrete blockers |
| `wh-packet-compiler` | 6 | sonnet | Read, Glob, Grep, Write | review-packet.md in the six-section shape |
| `wh-release-engineer` | 7 | sonnet | Read, Glob, Grep, Bash, Write | release.md with rollback rehearsed |
| `wh-handover-writer` | 8 | opus | Read, Glob, Grep, Write | docs/handover complete; client CLAUDE.md under one page |
| `wh-incident-triager` | 9 | sonnet | Read, Glob, Grep, Bash, Write | intent.md from an incident with evidence |
| `wh-retro-learner` | 9 | sonnet | Read, Glob, Grep, Edit, Write | Proposed CLAUDE.md and profile diffs |
| `wh-tracker-sync` | any | sonnet | Read, Bash, Skill (no Edit/Write) | Mirrors `wh.js digest` into the Notion tracker; one direction, never blocking |

## 8. Commands

All commands are user-invocable skills. `/workhorse:run` drives the whole pipeline to the next human
gate; the phase commands exist for running or re-running one phase.

| Command | Does |
|---------|------|
| `/workhorse:onboard` | Discover phase for the current repo. Writes the profile, map, constraints, client CLAUDE.md. Presents G0. |
| `/workhorse:intent "<problem> -> <outcome>"` | Creates a change, writes intent.md, classifies tier. Presents G1 if required. |
| `/workhorse:spec` | Spec phase for the active change. Presents G2. |
| `/workhorse:plan` | Plan phase. Presents G3 if required. |
| `/workhorse:build` | Build phase in a worktree. |
| `/workhorse:verify` | Verify phase. Loops fix until green. |
| `/workhorse:review` | Review phase. Opens PR. Presents G4. |
| `/workhorse:ship` | Deploy phase. Presents G5 for production. |
| `/workhorse:handover` | Handover phase for the whole engagement. |
| `/workhorse:run "<problem> -> <outcome>"` | Intent through the next required human gate, resuming from state if a change is active. |
| `/workhorse:approve <gate> [--reject] [notes]` | Records the decision, advances or re-enters. |
| `/workhorse:status` | Prints the active change, tier, phase, gates, and what is blocking. |
| `/workhorse:retro` | Retro on the last approved change or a named incident. |

## 9. Repository conventions inside a client repo

```
.workhorse/
  profile.yml          the client profile (committed)
.git/workhorse/        control state, never committed
  active               id of the active change
  changes/<id>/state.json
docs/sdlc/
  codebase-map.md
  constraints.md
  <change-id>/
    intent.md  spec.md  evals.md  plan.md  verification.md  review-packet.md
    release.md  approvals.md  retro.md  adr/
docs/handover/         written at Handover
CLAUDE.md              client-facing, under one page
```

Change ids are `YYYY-MM-DD-<kebab-title>`. Branches are `wh/<change-id>`. Worktrees live in
`.worktrees/<change-id>` and that directory is gitignored.

## 10. CI and headless

`ci/claude-review.yml` runs the security and conformance reviewers headless on every PR via
`anthropics/claude-code-action@v1`. `ci/incident-triage.sh` shows how a monitoring alert invokes
`claude -p --agent wh-incident-triager` with read-only tools and a turn cap, writing a new
`intent.md` that enters the pipeline through the normal gates. Detection stays deterministic;
the agent only diagnoses and proposes.

## 11. Handover to clients

`/workhorse:handover` produces `docs/handover/` and, when the client wants to keep the workflow,
copies a client-safe subset of the plugin (agents, skills, hooks, templates, README) into the
repo's `.claude/` directory with the profile already filled in. Nothing about other clients is
in the plugin, so the export is a plain copy.

## 12. Measurement

Leading: time from ask to committed `intent.md`; time from `intent.md` to G2; first-pass
verification success rate; time to first review packet; share of review findings resolved
without a human push.

Lagging: rework cycles per change; defects escaped to production vs caught at G4; repeat
incidents of the same class; requirement changes after Build starts; share of changes merged in
one pass.

`/workhorse:status --metrics` computes these from the `approvals.md` and `state.json` files in the repo.

## 12a. Tracker mirror

`wh.js digest` computes a deterministic JSON payload per change: identity, tier, phase, gate
statuses, verification, the gate packet TL;DR, the decisions requested, and the last approval.
`wh-tracker-sync` maps that onto one Notion database row per change. The mapping is in the
agent definition.

Two rules make the mirror safe. It is one-directional, so nothing written in Notion can change
what a change is or approve a gate. And it is non-blocking, so an unauthorized or failing
tracker produces a report, never a stalled pipeline.

The column that earns the integration is `Waiting On`. Filtering the database to values
starting with "You" answers the question this workflow creates and git cannot: across every
client and repo, what is blocked on me right now.

## 13. Out of scope for v1

Jira and Linear tracker adapters (the digest payload and the sync agent generalise, but only
the Notion mapping is written). Two-way tracker sync, deliberately. Screenshot diffing for UI
work beyond calling the profile's own command. Multi-repo changes.
