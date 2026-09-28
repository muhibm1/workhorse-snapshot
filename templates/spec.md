# Spec: {{title}}

Change id: `{{change_id}}`
Intent: [intent.md](./intent.md)
Status: draft | approved at G2
Policy skills applied: {{skills}}

## Summary

Three sentences. What is being built, for whom, and the one design decision that matters most.

## Requirements

Each requirement is numbered, testable, and traceable to the intent. Use SHALL for mandatory.

| ID | Requirement | Acceptance check | Source |
|----|-------------|------------------|--------|
| R1 | | | intent: Outcome |

## Design

### Architecture

Where the change sits in the existing system. Reference existing modules by path. New
components get one paragraph each: responsibility, interface, dependencies.

### Data

Schema changes, migrations, data flow. For every new or changed table: columns, who may read,
who may write, and which columns are pinned against update.

### Interfaces

APIs, events, CLI, UI. Request and response shapes. Error contract.

### Security and privacy

Threats considered, controls applied, data categories handled, retention. Reference the
security baseline checklist items that apply.

### Failure modes

What happens when each dependency is slow, down, or returns garbage. What is retried, what is
surfaced, what is logged.

### Observability

Logs, metrics, alerts added. What an on-call engineer sees when this breaks.

## Alternatives considered

| Option | Why not |
|--------|---------|
| | |

## Decisions

Link each ADR in `./adr/`.

## Open questions

Carried from intent, plus new ones. Each with a proposed default.

## Constraint audit

Filled by the constraint auditor. Severity: high blocks G2.

| Severity | Finding | Requirement affected | Resolution |
|----------|---------|----------------------|------------|
| | | | |
