---
name: retro
description: Run a WorkHorse retro on the last completed change, or triage an incident into a new change. Feeds lessons into CLAUDE.md, the profile, and evals as reviewable diffs.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:retro

Arguments: `$ARGUMENTS` is empty (retro the active or most recent change) or
`--incident "<alert or incident text>"`.

- **Retro.** Dispatch `wh-retro-learner` for the change. Print `retro.md`'s proposed memory
  updates and where they were applied.
- **Incident.** Dispatch `wh-incident-triager` with the incident text. Print its report. If
  it created a change, say the next step is `/workhorse:run` to take it through the gates.
