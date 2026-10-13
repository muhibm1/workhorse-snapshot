# WorkHorse 0.5: from ask to merged, and proof on every release

Muhammad Muhibullah, 2026-10-13. The plan for the next version of WorkHorse, the harness plugin
in which agents design, build, verify, review and ship a change while a person approves twice.

## In plain words

The agents got fast. Across 18 recorded runs, the median agent time for an ordinary change fell
from about 8 hours to about 1 hour. But a change still took about two and a half hours from the
request to the merge, and on the latest runs the agents were working for only a third of that.
The rest was waiting: on a merge nobody could press, on a run that stopped and was not restarted,
on a person reading a Design document with twenty questions in it.

So 0.5 measures what a user feels, the time from asking to having it merged, and removes the
waiting one cause at a time. And it publishes every run, so anyone can check that each release
made WorkHorse faster instead of taking it on trust.

## What the record shows

From `docs/ledger/RUNS.md`, finished runs at risk tiers 0 to 2 ("tier" is how risky a change is;
tier 2 covers schema, auth and integrations, with a 90-minute agent budget):

| Generation | Runs | Median agent time | Median wall time | Agents working, share of wall time |
|---|---|---|---|---|
| Five gates (0.1 to 0.2) | 2 | 7 h 59 m | 45 h 14 m | 18% |
| Two gates (0.3.0 to 0.3.11) | 7 | 1 h 43 m | 11 h 05 m | 13% |
| Speed release onward (0.3.12 to 0.4.2) | 5 | 1 h 05 m | 2 h 26 m | 33% |

Where the other two thirds went, from the runs' own logs:

- **A merge nobody could press.** The shipper's merge is refused by the harness's permission
  check on every repository, so the run blocks until the owner merges by hand. One Portfolio run
  sat 8 h 36 m on this (2026-09-29).
- **Runs that stopped quietly.** A design run died headless and cost 90 minutes on AgentOps
  increment 4; an approval sat two days because nothing resumed the run (fixed in 0.4.2).
- **Documents too big to read.** Design documents carried 19 to 24 decisions. Every one was
  accepted wholesale, which means they were not read.
- **Big changes in one piece.** Both tier 3 runs went over their 180-minute budget at about
  9,000 lines each. Review took 110 of 212 minutes on one of them.

## The releases

Each one names its target before it ships, so it can miss.

### 0.5.0 The ledger (shipped with this plan)

`workhorse ledger` recomputes every run's clock from the committed record and writes
`RUNS.md`. Each change now writes `metrics.json` at close with the plugin version and its cost.
Every changelog entry carries a `Ledger:` line, enforced by a test.

### 0.5.1 No dead time after Ship

- Approving Ship turns on GitHub's auto-merge (`gh pr merge --auto`). GitHub merges when CI is
  green, so the refused merge and the owner's manual step disappear.
- The change's records (Ship approval, deploy record) are committed before the merge, not after,
  so no second documents-only pull request is needed.
- The conductor waits for the pull request's CI before presenting Ship, so the owner never
  approves a red build or watches CI by hand.
- `wh.js` warns when the loaded plugin is older than the installed one (it once ran 0.3.13 while
  0.4.0 was installed, silently).

Target: zero dead minutes between Ship approval and merge on every run.

### 0.5.2 Every run is a LangSmith trace

The Paddock review (2026-10-13) asked for this, and it fits: LangSmith is where teams already
look at agent runs. After a run, `wh.js trace` turns the run's stream log and conductor log into
one LangSmith trace per change: the change at the root, a child for each phase, a child for each
agent dispatch with its tool calls, tokens, cost and latency. It is uploaded after the run ends,
so it adds no time to the run. It is off unless `LANGSMITH_API_KEY` is set.

What it buys: a searchable record of what the agents did, per-agent latency finer than the
conductor log, and a trace set Flywheel (the LangSmith trace-to-test project) can mine for
regressions. Speed is unaffected; measuring speed gets sharper.

### 0.5.3 Five decisions, not twenty

The Design document lists at most five decisions that need the owner, each with a
recommendation. Everything else the agents decided goes in a "Decided by the agents" appendix:
reversible, recorded, not asked. The artifact-check hook enforces the five. This edits the
designer agent, which another thread is changing tonight to restore Studbook search, so it lands
after that merges.

Target: at most five owner decisions per brief; rejections at Design do not rise.

### 0.5.4 Review alongside build

Reviewers start on each build wave as soon as it is folded, instead of after the whole build and
verify. The two-round fix cap from 0.4.1 stays. Measured first on a recorded tier 3 log to size
the saving before it ships.

Target: review minutes on a tier 3 run under half of agent time (110 of 212 today).

### 0.5.5 Split big changes at Design

When the plan's size predicts a run over budget (for example more than 20 requirements at tier
3), the designer offers a split into increments as a Design decision, with the first increment
ready to approve.

## How we show it

1. **The ledger, in the repository and on the site.** `RUNS.md` is regenerated, never edited.
   The portfolio gets a "WorkHorse, run by run" chart built from `runs.json`: agent time and
   wall time per run, coloured by generation. The public snapshot repository carries the same
   file.
2. **Releases that lead with the number.** Each version gets a git tag and release notes whose
   first line is the ledger change, for example "median wall time 2 h 26 m to 1 h 10 m on 4 runs".
   A release that was not measured says so.
3. **A standing benchmark.** WorkHorse Bench: three fixed tasks on the example service with
   acceptance tests the agents never see, run on each minor release, results added to the
   ledger. A run costs real money (the first run measures how much; it starts only after that
   number is known).
4. **Regenerated on a schedule.** A weekly routine rebuilds the ledger and opens a pull request
   when a new run landed, so the public record never goes stale.

## Targets for the 0.5 line

Stated now so they can fail. Finished tier 0 to 2 runs on 0.5.x, against the speed-release
generation:

| Measure | Now | Target |
|---|---|---|
| Median wall time, ask to last record | 2 h 26 m | under 1 h 30 m |
| Agents working, share of wall time | 33% | over 60% |
| Dead minutes after Ship approval | up to 8 h 36 m | 0 on every run |
| Owner decisions per Design document | 19 to 24 | 5 or fewer |
| Median agent time | 1 h 05 m | no worse |
