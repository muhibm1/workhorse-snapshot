---
name: wh-adr
description: Architecture decision record format for WorkHorse changes. Loaded by the designer. Use whenever a design choice has a plausible alternative a client engineer might later ask about.
user-invocable: false
---

# Architecture decision records

An ADR answers "why is it like this?" for the engineer who inherits the code. Write one for
every decision with a plausible alternative. Skip ADRs for choices the client's conventions
already make.

Location: `docs/sdlc/<change-id>/adr/NNNN-<kebab-title>.md`, numbered from 0001 within the
change. At handover, ADRs are indexed into `docs/handover/decisions.md`.

## Format

```markdown
# NNNN: <Title as a decision, e.g. "Store consent events in an append-only table">

Date: YYYY-MM-DD
Status: proposed | accepted | superseded by NNNN
Change: <change-id>

## Context

Two to five sentences. The forces at play: requirement ids, constraints from the profile,
existing patterns in the repo, compliance obligations.

## Decision

One paragraph. What we will do, stated in the active voice.

## Alternatives

| Option | Why not |
|--------|---------|
| | |

## Consequences

What becomes easier, what becomes harder, what must be revisited and when.
```

## Rules

- Title is the decision, not the topic. "Use Postgres advisory locks for job claims", not
  "Locking".
- Context cites sources: `R3`, `profile.compliance.regimes: [hipaa]`, `src/jobs/claim.ts`.
- Alternatives are real options someone would propose, each with the concrete reason it lost.
- Consequences include at least one cost. An ADR with only benefits was not thought through.
- Under 60 lines.
