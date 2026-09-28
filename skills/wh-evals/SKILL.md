---
name: wh-evals
description: How WorkHorse turns "does it work" into measurable evidence. Loaded by the designer, eval designer, verifier, and incident triager. Use when designing acceptance cases, golden datasets, failure taxonomies, or turning an incident into a permanent test.
user-invocable: false
---

# Evals

Evals are the FDE's instrument for replacing opinion with evidence. Specify what good means,
measure the system under realistic conditions, improve based on errors. Every change ships
with evals; every incident becomes one.

## Designing evals

For each requirement in `spec.md`, write cases in four categories:

| Category | What it covers | Target |
|----------|----------------|--------|
| Golden | The behaviour the outcome depends on, with realistic inputs | 100% |
| Edge | Empty, null, maximum, unicode, ordering, concurrency, time zones, idempotency | 100% |
| Failure | Each dependency slow, down, or returning garbage; bad input; timeouts | 100% correct handling |
| Adversarial | Injection, authorization bypass across tenants and roles, oversized input, replay | 100% rejected |

Add non-functional rows where the brief has numeric success metrics: latency percentile,
throughput, cost per operation, error budget.

Each case is written as Given / When / Then and maps to a requirement id. Where the stack
allows it, each case is implemented as a real test and the "Implemented as" column names the
file. Where it cannot be automated (a manual UI check, a third-party sandbox), it is marked
`manual` and appears in the verification report under "Not verified" until a human runs it.

## Golden datasets

For anything involving classification, extraction, matching, search, or an LLM call, build a
dataset file under `docs/sdlc/<id>/evals/` with at least 20 representative rows: normal cases,
known-hard cases, known past failures, and adversarial inputs. Record provenance for each row.
Never include real personal data; synthesise or anonymise and say which.

## Failure taxonomy

Name the classes of failure this change can have so incidents can be filed against them:
wrong result, missing result, slow, leaked, unauthorised, corrupted, unrecoverable. For each,
say how it is detected in production (log line, metric, alert).

## Running evals

The verifier executes every automatable case in the same session as the profile checks,
reports pass counts per category against targets in `verification.md`, and lists every failing
case with its id, input, expected, actual. A category below target makes verification red.
Manual cases are listed, not counted as passes.

## Incidents become evals

When an incident is triaged, the triager writes a new eval case reproducing it, in the failure
taxonomy class it belongs to, before proposing a fix. The fix is not done until that case passes.
