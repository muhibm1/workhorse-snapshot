---
name: wh-handover
description: What a WorkHorse engagement hands to a client so their engineers can own the system without the FDE. Loaded by the handover writer and adoption reviewer. Use when producing docs/handover or judging whether a change is maintainable by the client.
user-invocable: false
---

# Handover pack

The measure of an FDE engagement is whether the client's engineers can run, change, and debug
the system after you leave. The handover pack is that proof.

## Contents of `docs/handover/`

| File | Purpose | Length |
|------|---------|--------|
| `README.md` | Start here. What the system does, how to run it locally, how to deploy, where everything else is. | One screen |
| `architecture.md` | The system in one diagram (mermaid) and one page. Components, data flow, trust boundaries. | Two pages |
| `decisions.md` | Index of every ADR with one-line summaries, newest first. | Grows |
| `runbook.md` | For each failure class in the evals taxonomy: symptom, where to look, what to do, how to roll back. | As needed |
| `operations.md` | Environments, secrets (names and where they live, never values), scheduled jobs, monitoring, alert routing, on-call expectations. | Two pages |
| `security.md` | Data categories handled, compliance regimes, controls in place, the pre-ship checklist as a living document, disclosure contact. | Two pages |
| `working-with-ai.md` | How to use WorkHorse in this repo, and how to work on it without any AI tooling. Both must be true. | One page |
| `open-items.md` | Known gaps, deferred work with reasons, risk acceptances with owners. | As needed |

Plus a repo `CLAUDE.md` under one page, generated from the template and kept current.

## Rules

- Every command in the pack has been run by the handover writer in the session that wrote it,
  and the output confirmed. A handover doc with a stale command is worse than none.
- No reference to you, your company, or "the consultant". The client owns this.
- Every path in the pack is a relative link that resolves.
- Secrets are named, never valued. If a secret's location is a vendor dashboard, say which page.
- Write for the least senior engineer who will be on call.

## Adoption review score

The adoption reviewer scores each change 1 to 5 on the question "could a client engineer
maintain this from the repo alone?" A score below 4 is a finding in the Ship document with concrete blockers:

| Score | Meaning |
|-------|---------|
| 5 | Docs, tests, naming, and structure make the change self-explanatory |
| 4 | Minor gaps a reader can fill from context |
| 3 | Needs a walkthrough from the author |
| 2 | Relies on knowledge only the author has |
| 1 | Would be rewritten by the next person |

## Exporting the workflow

When the client keeps WorkHorse, copy `agents/`, `skills/`, `hooks/`, `templates/`,
`scripts/`, and `README.md` from the plugin into the repo's `.claude/` directory as a project
plugin, with `.workhorse/profile.yml` already filled. Nothing in the plugin references other
clients, so the copy is safe as-is.
