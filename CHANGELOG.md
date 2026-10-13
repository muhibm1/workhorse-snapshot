# Changelog

Releases of the WorkHorse plugin, newest first. Each entry is built from the commits it shipped
(listed by hash), and names the release it follows and what that release did, so any one entry states where
it sits in the sequence on its own. Paddock, the desktop app, has its own changelog in `desk/CHANGELOG.md`.

Installing the plugin copies it (see README), so a change reaches a machine only once its version
is bumped and it is reinstalled.

## 0.5.2 — 2026-10-13

Follows 0.5.1 (approving Ship merges the change). Every run becomes a LangSmith trace.

- Asked for by the Paddock review (2026-10-13): users lacked a searchable record of what the
  agents did, and LangSmith is where teams already look at agent runs.
- `wh.js trace` turns a change's conductor log into one trace: the change at the root, a child
  per phase, and a child per step, timed from the row before it to its own row. Each step is
  tagged `agent`, `waiting`, `dead` or `unexplained` by the same rule the clock uses, and the
  root carries the clock's minutes, tier, plugin version and cost. With the launcher's stream
  logs (now recorded per change by `wh.js cost add --log`) the root also gets tokens by agent.
- Closing a change (`wh.js phase done`) sends its trace in the background, so closing never
  waits on the network. Off unless `LANGSMITH_API_KEY` is set; `WORKHORSE_NO_TRACE=1` turns it
  off; `WORKHORSE_LANGSMITH_PROJECT` picks the project (default `workhorse`).
- `--repo <path>[#<ref>] --all` sends past changes from the committed record. LangSmith only
  accepts runs from the last 24 hours, so an older change is replayed: shifted to end now with
  exact durations, tagged `replayed`, its recorded times in metadata. A change that ran longer
  than 23 hours is not sent. Ids are derived from the change id, so sending twice is harmless.
- Sent once on 2026-10-13: 16 of the ledger's 18 runs (AgentOps, Portfolio, Studbook,
  WorkHorse, wasl). The two Portfolio runs of 68 h and 85 h were too long to send.
- Tests: 418 in `hooks/tests/run.js` (from 405): stable ids, the dotted order, the clock's
  minutes on the root, phase and step nesting, replay, the 23-hour limit, tokens by agent, and
  no upload without a key.
- Ledger: not measured yet. Tracing adds no time to a run by construction; it runs after close.

## 0.5.1 — 2026-10-13

Follows 0.5.0 (the run ledger). No dead time after Ship: approving Ship merges the change.

- Seen in the ledger: the harness refuses an agent's merge on every repository, so after the
  owner approved Ship the run blocked until the owner merged by hand. One Portfolio run sat
  8 h 36 m on this (2026-09-29); AgentOps increment 1 needed three extra manual steps for it.
- `wh.js ship-merge`: after a Ship approval, commits and pushes the change's records (so the
  merge carries them and no second documents-only pull request is needed), then merges the pull
  request if CI is green, pinned to the commit whose checks it read. While CI runs it waits and
  the watcher retries each minute; it never merges over a red check, and logs a block instead.
  A repository with no CI merges and says so. `profile.github.merge: false` keeps the old path.
- `wh.js approve G4` (and so `/approve` on the pull request, through the watcher) runs it at
  once: the approval is the owner saying "merge it". This runs as a plain process, not as an
  agent, which is why the harness does not refuse it.
- `wh.js checks [--wait MIN]` reads the pull request's CI. The conductor waits up to 15 minutes
  for it before presenting Ship, and sends a red check back to the fixer, so the owner never
  reads a Ship document over a red build or watches CI by hand.
- The shipper's deploy step no longer merges itself unless GitHub is off for the repository.
- Tests: 405 in `hooks/tests/run.js` (from 385), including a fake `gh` that drives the wait,
  merge, refuse and retry paths end to end.
- Ledger: not measured yet. Target from the 0.5 plan: zero dead minutes between Ship approval
  and merge on every run.

## 0.5.0 — 2026-10-13

Follows 0.4.2 (the watcher resumes stalled runs). The run ledger: every WorkHorse run in every
repository, measured the same way, so each release can show whether it made runs faster.

- `wh.js ledger` (and `workhorse ledger`) reads each change's committed conductor log and
  approvals from git and recomputes its clock with the same function `wh.js clock` uses. No
  number is typed by hand. `--repo <path>[#<ref>]` picks repositories (default: every one
  `workhorse` remembers); `--out <dir>` writes `runs.json` and `RUNS.md`. Changes whose own
  record is incomplete get a cited correction in `docs/ledger/overrides.json`, listed in
  `RUNS.md`; nothing else is adjusted.
- `wh.js phase done` writes `metrics.json` into the change folder: the clock, the gate
  decisions, the plugin version the run used, and its cost at list price. The launcher adds each
  headless run's reported cost to the change (`wh.js cost add`), so from now on cost per change
  is recorded, not estimated.
- `docs/ledger/RUNS.md` is the first ledger: 18 runs across AgentOps, Portfolio, Studbook,
  WorkHorse and wasl, 2026-09-11 to 2026-10-08. Finished tier 0 to 2 runs, by generation:
  median agent time 7 h 59 m (five gates, 2 runs), 1 h 43 m (two gates, 7), 1 h 05 m (speed
  release onward, 5). Median wall time 45 h, 11 h, 2 h 26 m. Agents were working for only a
  third of the wall time on the latest runs; the rest was waiting and dead time. That is what
  0.5.x goes after (`docs/superpowers/specs/2026-10-13-lead-time-design.md`).
- From this release every changelog entry carries a `- Ledger:` line naming the runs it was
  measured on, or saying it is not measured yet. A test enforces it.
- Tests: 385 in `hooks/tests/run.js` (from 364): release and version inference, tier parsing,
  the recomputed clock on a committed fixture, `--out`, cited corrections, the launcher's cost
  sum, and `metrics.json` at close.
- Ledger: not measured yet. The first run on 0.5.0 is the first row with a recorded version and
  cost.

## 0.4.2 — 2026-10-07

Follows 0.4.1 (the counted review fix loop). The watcher resumes runs nobody is driving.

- Seen live: a Design approval recorded in a terminal on 2026-10-05 sat for two days because
  nothing resumed the run; a headless design run died and cost 90 minutes on increment 4; a
  shipper whose merge the harness refused left every AgentOps run blocked until someone
  looked. The watcher now resumes the active change when no gate is waiting, no run holds
  the lock and the conductor log has been quiet for ten minutes: at most three times without
  a new log line, never more than once in thirty minutes, with a conductor-log row for each
  automatic resume and a `~/.workhorse/watch-state.json` record. A run blocked on something a
  person must do is left alone and the watch log says why, once; a run blocked on a merge
  resumes once `gh` reports the pull request merged.
- The shipper skips the merge when the PR is already merged, and reports a refused merge as
  a block instead of stopping the run silently; the conductor records it with `WH blocked`.
  `/workhorse:approve` says the watcher will continue the run.
- Tests: 364 in `hooks/tests/run.js` (from 346): the stall decision in every state, the log
  reader, and the agent wording.
- Not measured yet. The stalled AgentOps run (`wire-live-anthropic-model-path`) is the first
  case; the watcher should resume it within ten minutes of this version being installed.

## 0.4.1 — 2026-10-05

Follows 0.4.0 (the `workhorse` command and gates on GitHub). The review fix loop is counted and
scoped, and evals must cover the failure paths that shipped past a green verify. Both come from
four measured AgentOps runs (2026-10-01 and 02): review took 110 of 212 and 78 of 219
agent-minutes at tier 3, a review fix introduced the next defect in three runs of four, one
re-check re-ran seven reviewers over a whole change for 77 minutes, and two high findings sat
under 64 of 64 passing eval cases.

- `wh.js review-fix start | check | reopen`. `start` records the head before each fixer and
  refuses a third round (exit 3): two fix rounds, then open findings go to the Ship document.
  `check` lists the round's commits, fails (exit 2) when a commit changed source with no test
  file in it, and prints the exact diff the re-check reads. Documentation-only commits are
  exempt. Test files are the profile's `conventions.test_globs` plus the common test paths
  (`tests/`, `*.test.*`, `test_*.py`, `*_test.*` and the like). A rejection at a gate resets the count: the human's notes get
  their own rounds.
- The conductor's Review step uses it: the re-check goes to at most three of the reviewers
  whose findings were fixed, reads the round's diff and files only, and tries the inputs next
  to each fix. A second round is confirmed only by the reviewer that raised the finding.
- The fixer ships a regression test and a negative case in the same commit as every fix, and
  reports what else its change altered.
- `evals.md` gains a "Side effects and records" table, required by the artifact-check hook at
  tier 2 and above: for every call that writes, sends, applies or deletes, a case for a crash
  between the effect and its record, the effect failing or unknown, a repeat of the key, and
  the verifying read failing; for every approval, authorization or idempotency record, a case
  where it is replayed against another subject. `None: <why>` when the change has neither.
  The designer fills it, the eval designer checks it against the code's own list, and the
  wh-evals skill explains it.
- The bug and security reviewers rate a finding about a trusted record by the claim it
  breaks, not by reachability: unbound to its subject is high at least.
- Tests: 346 in `hooks/tests/run.js` (from 323). Not yet measured on a run: the next tier 2
  or 3 change is the first evidence that review time and fix regressions fall.
- Not in this release, from the same runs: gates approved unread, the merge the shipper cannot
  perform, dead headless runs going unnoticed, and tier 3 scope against its budget.

## 0.4.0 — 2026-09-29

Follows 0.3.14 (command line and the harness first; Studbook out). One command, and gates you
answer from your phone.

- `workhorse` is the command: `workhorse "<problem> -> <outcome>"` starts a change, and `status`,
  `approve [notes]`, `reject "<notes>"`, `resume`, `watch`, `log` and `doctor` cover the rest.
  `npm link` puts it on the PATH. It remembers every repository it ran in, so `status` shows all
  of them, and an unknown command exits 2 with the help.
- Gates are posted to GitHub. Presenting a gate commits the change's documents, pushes the
  branch, opens a draft pull request at Design (marked ready at Ship) and comments the gate with
  its decisions and a link to the document on the change branch. `/approve`, `/approve D2: ...`
  or `/reject <notes>` in the PR (or an approving review, or "request changes") decides it.
  Only `profile.github.approvers` count (default: the `gh` login); a decision made before the
  gate was presented, or a review of a different commit, does not.
- `wh.js github-sync` reads the PR and records the decision through `wh.js approve`, now with
  `--by github:<login>` and `--source <comment url>` in `approvals.md`, then replies on the PR
  that it was recorded. `workhorse resume` syncs first; `workhorse watch` polls every minute and
  resumes the run. Subagents may not run `github-sync` (bash-guard), same as `approve`.
- An approval that names a decision ID in its notes no longer also records "recommendation
  accepted" for that ID.
- The shipper reuses the pull request the Design gate opened instead of opening a second one.
- The watcher starts by itself: the SessionStart hook keeps one detached `workhorse watch`
  alive (a pid file with a heartbeat, so a second session reuses it), and `workhorse watch
  --at-login` adds a hidden Windows Startup entry. `--background`, `--stop` and
  `--not-at-login` complete it; `doctor` and `status` say whether it is running. It calls no
  model: Claude runs only when a recorded decision resumes the run.
- Optional phone push through ntfy (`~/.workhorse/config.json` `ntfy_topic`, or
  `WORKHORSE_NTFY_TOPIC`): sends the gate name, change title and PR link only. ntfy is a third
  party and a new subprocessor for whoever turns it on; it is off unless configured.
  `github.approvals: false` in the profile keeps every gate local.
- Tests: 312 in `hooks/tests/run.js` (from 279), covering decision parsing, approver and timing
  rules, the audit fields, the sync with nothing waiting, the CLI, the watcher and the guard. Confirmed end to
  end once on a throwaway pull request (muhibm1/workhorse#21, closed): the gate comment posted,
  a reply of `/approve D1: ...` was recorded as `github:muhibm1` with its link.

## 0.3.14 — 2026-09-29

Follows 0.3.13 (verify cites known failures). Command line and the harness first; Studbook out.

- `scripts/wh-launch.js` starts or resumes an unattended run from a terminal: refuses while
  another run holds the lock, names every tool a run needs (Write and Edit included), runs in
  acceptEdits, writes the stream to `.git/workhorse/runs/`, prints each conductor step live, and
  exits 4 on a usage limit so a wrapper knows to resume. On the plugin's own repository it loads
  the plugin from a detached checkout beside it, created or refreshed on every run. `npm link`
  installs it as `workhorse`. This replaces what Paddock's Start and Resume buttons did.
- The designer runs on Fable again. It absorbed the spec architect and the implementation
  planner, the two agents that ran on Fable before 0.3.0, and the design decides everything
  downstream. Fable costs more per token; the rest of the 0.3.12 savings stand.
- Studbook is out of use: the designer and the discovery analyst no longer list its tools (a
  test now fails if any agent does), and the designer reads earlier changes' records straight
  from `docs/sdlc/` when its edit list overlaps theirs.
- WorkHorse's own profile checks the plugin only (`npm test` and `claude plugin validate .`);
  Paddock is retired and keeps its separate CI job.
- Tests: 279 in `hooks/tests/run.js` (from 271), covering the launcher's arguments and plugin
  checkout, and each agent's model.

## 0.3.13 — 2026-09-29

Follows 0.3.12 (the speed release). Both fixes were applied live during the first measured run
of 0.3.12 and are ported here with tests.

- `wh.js verify`: a skipped install is never a failure (a full pass without `--install` counts
  it as skipped, not as "not run"), and a recorded known failure is cited from
  `.workhorse/known-failures.md` rather than re-run: it was reproduced on the base branch when
  it was recorded, and re-running it costs time and can have side effects. On the run, Paddock's
  flaky e2e smoke test failed, wrote `desk/playwright-report/`, and the next lint pass failed on
  the generated trace files; cited, it no longer runs.
- `desk/eslint.config.mjs` ignores `playwright-report/**`.
- Test: every agent that names a Studbook tool passes `own_change_id` and carries the fail-open
  instruction (the test the Studbook-tools change deferred to keep tier 1).
- Documented in the README: running WorkHorse on its own repository needs the plugin loaded from
  a separate checkout (the harness refuses a plugin agent's writes inside the directory the
  plugin was loaded from), and headless runs name `Write` and `Edit` in `--allowedTools`.

**First measured run of 0.3.12** (the Studbook-tools change, tier 1, 2 files): build 90 s,
each full `wh.js verify` 48 to 78 s, three reviewers 77 s, each fix under a minute, Ship
presented 23 minutes after Design approval including 5 minutes of operator interventions. The
clock's 45 minutes against the 30-minute budget include 21 minutes of false starts before the
design existed, all the harness permission edges (the self-modification refusal and two
allowlist gaps), none of them pipeline time. Per-agent table in that change's `retro.md`.

## 0.3.12 — 2026-09-29

Follows 0.3.11 (agents use `git -C` instead of `cd && git`).

The speed release. Measured on the studbook MCP-server run of 2026-09-26 (4 h 10 m of agent time
against a 90-minute budget, about $60 at list price): the conductor spent 137 of 250
attributable minutes folding, re-probing and deciding; the verifier 57 minutes on a suite that
runs in 45 seconds; two agents were cut off at their turn caps with uncommitted work; eight
reviewers read a five-file change; and a blocked run sat unnoticed for two hours. Each item
below removes one of those.

- `wh.js verify` runs the profile's checks, writes `verify-logs/<check>.log`, `summary.json` and
  the Checks table and measured sentences of `verification.md`, and exits 1 on a failure. The
  verifier agent now runs the evals only (Sonnet, low effort, 40 turns) and reads the summary,
  never the logs. `--only` re-runs named checks and keeps the earlier failures on the books;
  `--final` records green itself when a change has no eval cases.
- `wh.js fold --tasks 1,2 --wave N` folds a wave's task branches into the change branch in order
  (cherry-pick, or merge per the profile), removes the worktrees and task branches, records
  progress and logs the row; a conflict aborts cleanly, exits 2 and names the task and files.
- `wh.js lock acquire|release|status`: one conductor per repository. `/workhorse:run` takes the
  lock; every `wh.js log` row refreshes it; presenting a gate, `wh.js blocked` and `done`
  release it; it goes stale after 30 idle minutes. `verify-before-stop` now holds only the
  session that took the lock, so a person supervising from another window is no longer nagged.
- `wh.js blocked "<reason>"` and desktop notifications: a presented gate, a block and `done`
  each raise a notification (Windows toast, macOS, Linux), best effort, never an error.
- `wh.js clock --by-agent` charges every interval of the conductor log to the agent that
  reported at its end, so each run shows where its minutes went; the conductor prints it at
  every gate.
- The conductor runs on Sonnet and never folds, runs a check or reads a whole log itself. A wave
  of one or two tasks goes to one builder with both tasks (a cold builder context cost about 12
  minutes before its first edit). Reviewers scale with the tier: 1 / 3 / 6 / all, with 0 / 1 /
  2 / 4 ECC specialists, reading the diff and the files it touches. After a review fix, only the
  reviewers whose findings were fixed re-check, once.
- The designer runs on Opus (Fable is 2.5 times the price per token); at tier 0-1 the spec aims
  for 60 lines with no ADR unless a real alternative exists, the evals for 6 to 10 cases, and
  there is no auditor: the designer applies the security checklist itself on a sensitive path.
- The fixer commits after every green fix (80 turns, from 50); the builder has 120 (from 80).
- `wh-agent-rules` gains "Context is paid for": `tail -40` a log, never `cat` it; read
  `summary.json` before any log; read the diff before the files, the files before the neighbours.

Not changed: the gates, the approval record, the clock, the hooks that guard paths and tests.
Tests: 264 in `hooks/tests/run.js` (from 224), covering verify, fold, lock, blocked and the
per-agent clock.

## 0.3.11 — 2026-09-28

Follows 0.3.10 (the change branch is cut at `new`; builders commit every green step).

- Agents run git in another folder with `git -C <dir>`, never `cd <dir> && git`. The harness asks for
  approval on the second form whatever the allow rules say (the target folder could carry its own git
  hooks), and an unattended run has nobody to approve, so it stalled. Confirmed 2026-09-28 in a
  headless run with no permission flags: `cd` then `git` was held for approval; `git -C` ran.
  Rule added to `wh-agent-rules` under "Harness limits", which every agent loads.

## 0.3.10 — 2026-09-21

Follows 0.3.9 (the worktree fence recognises harness isolation worktrees).

- `wh.js new` cuts and checks out the change branch, so the design documents and the Design
  approval commit land on it. They used to land on the default branch, leaving local main ahead
  of origin with commits the squash merge already carried, and a conflict on the next pull.
- Builders commit after every green step, with 80 turns instead of 60. A live builder finished
  its task and lost the work to its turn cap before committing; the conductor had to recover it
  from the tree.

## 0.3.9 — 2026-09-20

Follows 0.3.8 (a gate stamped auto before the tier is known returns to pending).

- The worktree fence recognises the harness's `.claude/worktrees/` as well as the plugin's
  `.worktrees/`. While `state.worktree` pointed at one builder's tree, a builder in another tree
  and the conductor in the main checkout were both denied an edit the approved plan named (run
  4, `.github/workflows/deploy.yml`).

## 0.3.8 — 2026-09-20

Follows 0.3.7 (tier 0 budget 25; the proving runs recorded).

- Setting the tier resets to pending any gate the tier requires that was stamped `auto` while
  the tier was unknown, and `present` flips an `auto` gate to pending. Run 4 (Portfolio) marked
  Design `auto` before the designer had set the tier, which would have skipped the Design touch.

## 0.3.7 — 2026-09-20

Follows 0.3.6 (the sensitive-path hook reads the approved plan from the main checkout).

- Tier 0 budget is 25 agent-minutes, not 15. The three proving runs are recorded in
  `docs/STATUS.md`: a verify pass and a review pass with their fixes cost about 25 minutes on a
  one-file change, and that rigour is the product.

## 0.3.6 — 2026-09-20

Follows 0.3.5 (harness-guarded files become a human decision; verifier writes first).

- The sensitive-path hook reads the approved design from the main checkout as well as the
  builder's worktree. A worktree cut before the design documents were committed had no `plan.md`,
  so run 3 (wasl) was denied an edit its approved plan named.

## 0.3.5 — 2026-09-20

Follows 0.3.4 (an approved design unlocks the sensitive paths it names).

- Files the harness itself refuses to write headless (`.npmrc`, `.env*`, keys, credentials) are
  never assigned to a builder: the designer puts them in the brief as a decision the human
  performs, with the exact content and the design that avoids the file. Run 2 lost ten minutes
  to a builder blocked on `.npmrc`; no plugin rule can lift that guard.
- The verifier writes `verification.md` first and updates it after every check, with 80 turns
  instead of 50, so a turn-limit stop leaves a truthful file. Run 3 ran out of turns with every
  check green and no file written.

## 0.3.4 — 2026-09-20

Follows 0.3.3 (a gate waits on the human only once presented).

- A sensitive path that the approved Design document names may be edited without asking. A
  headless run has nobody to answer the hook's "ask", so run 2 (Portfolio) was blocked creating
  `.npmrc` and editing `package.json`, files its approved brief listed. Protected paths are still
  denied; a sensitive path the plan does not name still asks.

## 0.3.3 — 2026-09-20

Follows 0.3.2 (evals in the plan, the review fix with the lock off, dashed task branches).

- `wh.js present <G>`: a gate counts as waiting on the human only once the conductor has
  presented it. A finished brief used to read as waiting during the auditor's revision round,
  which charged agent time to "waiting on you" and let Paddock offer Approve too early. The
  command also refuses an incomplete packet or a blocked Ship document, resets a rejected gate to
  pending, logs a clock row, and prints the summary the human reads.

## 0.3.2 — 2026-09-20

Follows 0.3.1 (the brief's own tier line). Three fixes from the first measured run of the
two-gates pipeline (hello-service, tier 0: 33 agent-minutes against a 15-minute budget, one
touch, no waiting, no dead time).

- The designer writes `evals.md`, and every eval case is implemented by exactly one plan task;
  the eval designer becomes a reviewer that runs at tier 2 and above and extends both files.
  Run 1 lost eight minutes to cases written after the plan existed.
- The review-phase fix runs with the test lock off, so the fixer can correct a finding in a
  test file; the lock stays on in the verify loop. Run 1 routed three such findings through a
  builder and a third verification instead.
- Task branches are `<change-branch>-t<N>`; the slash form cannot coexist with the change
  branch in git.

## 0.3.1 — 2026-09-19

Follows 0.3.0 (two gates and a clock).

- `brief.md` carries its tier on its own line, `Risk tier: N (reason)`, the line both Studbook
  ingesters read; the header no longer folds it into the change-id line.

## 0.3.0 — 2026-09-19

Follows 0.2.14 (the verifier's plain-words "What was measured" section). Two gates and a clock,
from `docs/superpowers/specs/2026-09-19-two-gates-design.md`. (`bd2750c`)

- Two human gates instead of five. The human touches a change at Ask (nothing to read), Design
  (G2, `brief.md`) and Ship (G4, `ship.md`); tier 3 adds Deploy (G5, `release.md`), and `assisted`
  or `shadow` autonomy adds Deploy at every tier. Tier 0 needs G4 only; tiers 1 and 2 need G2 and
  G4. G1 and G3 keep their ids for state, approvals and Paddock, but no tier requires them and the
  conductor sets them `auto`.
- A clock on every run. `WH clock` reads the conductor log and reports agents working, waiting on
  the human, dead time and gaps against the tier budget (0: 15 minutes, 1: 30, 2: 90, 3: 180;
  `budgets.agent_minutes` in the profile overrides). The shipper pastes it into `ship.md`; the
  retro judges the run against it.
- Known failures. A check that is red on the base branch is recorded once with `WH known-failure
  add` and cited by later phases with `WH known-failure list`; verification may be green with a
  known failure cited, never with one that is not recorded.
- Agents merged. `wh-designer` replaces the intent writer, risk classifier, spec architect and
  implementation planner; `wh-polish` replaces the readability reviewer and simplifier;
  `wh-shipper` replaces the packet compiler and release engineer; the verifier absorbs the eval
  runner; `wh-express-dev` is removed, since tier 0 is now the same pipeline with one gate.
- Document size limits enforced by `artifact-check.js`, which replaces `artifact-size.js`: line
  limits by tier for every change document, a cap on eval cases (15/40/80 by tier, counted by
  id), and reviewer reports written to `reviews/<agent>.md` at 60/80/100 lines.
- The Ship document is never presented with a blocker. Findings marked high or medium with a
  concrete fix go to the fixer before `ship.md` exists, and the hook and `WH approve G4` both
  refuse a Ship document that still carries one.
- The retro runs in the background after `WH phase done`, the one exception to the conductor's
  always-wait rule; it commits its own `retro.md`.
- Phases renamed to design, build, verify, review, deploy, done. The templates `intent.md` and
  `review-packet.md` are replaced by `brief.md` and `ship.md`.
- The decision policy: no agent stops a run to ask a question. A question becomes a decision row
  with a recommendation, the run continues with the recommendation, and the row appears in the
  next packet; approving a packet accepts every recommendation unless the notes say otherwise.
- Why: measured from three real changes' logs, the human waited 41, 10 and 17 hours on runs whose
  agents worked 7 hours, 3 hours 40 minutes and 1 hour 45 minutes, with every wasl approval note
  reading "none".

## 0.2.14 — 2026-09-18

Follows 0.2.13 (a version bump with no content change).

- The verifier writes a plain-words "What was measured" section in `verification.md`: one sentence
  per check with the counts read from its log ("Test suite: 47 tests, 47 passed, 0 failed"),
  compared with the previous change's verification by name. (`77caa0e`)

## 0.2.13 — 2026-09-17

Follows 0.2.12 (approvals must answer every packet decision).

- No content change since 0.2.12. A version bump so the installed copy and the copy bundled in
  Paddock 0.4.0 agree. (`b3cbe0a`)

## 0.2.12 — 2026-09-15

Follows 0.2.11 (fixes from the ECC live run: artifact size enforced, a change cannot close before its retro).

- An approval must answer every decision its packet raises, not just approve the gate as a whole.
  (`6a5c77d`)
- Released with Paddock 0.3.0, the Dracula redesign, which bundles it. (`62b3161`)

## 0.2.11 — 2026-09-15

Follows 0.2.10 (bug-reviewer fixes on the autopilot commit). Fixes from the ECC live run.

- Artifact size is enforced by a hook, and read-only access to sensitive paths no longer raises a
  change's tier. (`916d83a`)
- Re-verification always runs the eval runner; the review packet template names the ECC
  specialists. (`cf7ec73`)
- A change cannot close before its retro exists, and the close commit carries the retro's instinct
  files. (`818a3d8`, `aa7b5ea`)

## 0.2.10 — 2026-09-14

Follows 0.2.9 (a reviewed subset of ECC vendored).

- Six findings from the bug reviewer on the autopilot commit, and a rejected gate now waits on
  agents rather than the human. (`a3a4c5e`)

## 0.2.9 — 2026-09-14

Follows 0.2.8 (the tier-0 fast lane and tier-matched models).

- A reviewed subset of ECC is vendored and composed alongside WorkHorse's own agents: its rule
  packs, nine specialist agents, AgentShield in the security review, and instinct-format learning
  in the retro. (`5a77526`)

## 0.2.8 — 2026-09-13

Follows 0.2.7 (the tracker uses the claude.ai Notion connector).

- A tier-0 fast lane (`wh-express-dev`) and models matched to the tier. (`97e4fa3`)

## 0.2.7 — 2026-09-12

Follows 0.2.6 (the build sized to the change).

- The tracker mirror uses the claude.ai Notion connector instead of the Notion plugin's skills.
  (`19b39d4`)

## 0.2.6 — 2026-09-12

Follows 0.2.5 (real conductor-log timestamps, artifacts sized to the change).

- The build is sized to the change: fewer tasks, and one polish pass at low tiers. (`705f098`)
- A finished change is closed in git, and Paddock offers Start rather than Resume once it is done.
  (`5e77361`)

## 0.2.5 — 2026-09-12

Follows 0.2.4 (control state moved into the git common dir).

- Real timestamps in the conductor log, and artifacts sized to the change. (`66d3274`)
- The approve skill, CI review and Paddock spec point at the new control-state location.
  (`7221909`)

## 0.2.4 — 2026-09-12

Follows 0.2.3 (the conductor's dispatch contract: name every agent and wait for it).

- Control state moved into the git common dir, where no checkout can rewrite it. Before this, a
  checkout of the change branch rewrote the tracked state files: the active change went empty, the
  phase went back from build to spec, every state-driven hook stood down, and builder worktrees had
  no gate or test-lock enforcement at all. (`e7a7cc8`)

## 0.2.3 — 2026-09-12

Follows 0.2.2 (approvals pin and hash their packet).

- The conductor must name every agent it dispatches (an exact `subagent_type`) and wait for it
  (`run_in_background: false`). A run had stalled after G2 when a dispatch without either went to a
  generic background agent and the conductor ended its turn. (`c29349f`)

## 0.2.2 — 2026-09-12

Follows 0.2.1 (no green verification without defined checks).

- An approval pins and hashes the packet it approves: the change's artifacts are committed first,
  and the recorded commit contains the packet. Before this, an approval recorded whatever HEAD was,
  and the approved packet could be edited afterwards with nothing showing it. (`e460354`)

## 0.2.1 — 2026-09-11

Follows 0.2.0 (the Notion tracker mirror).

- A verification cannot be marked green when the profile defines no checks. (`ca43b5f`)

## 0.2.0 — 2026-09-09

Follows 0.1.0 (the first release).

- A Notion tracker mirror (`wh-tracker-sync`). (`07a6652`)
- Quoted scalars in the profile YAML parser are unescaped. (`6f54c3b`)

## 0.1.0 — 2026-09-07

The first release: the agentic SDLC plugin with risk-tiered human gates. (`26fb42a`)
