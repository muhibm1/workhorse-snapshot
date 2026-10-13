---
name: onboard
description: Discover phase for a new client repository. Audits the codebase and business workflow, writes .workhorse/profile.yml, the codebase map, constraints, and a client CLAUDE.md, then presents G0 for you to confirm.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *), AskUserQuestion
---

# /workhorse:onboard

Arguments: `$ARGUMENTS` is optional free text about the client: industry, jurisdictions, known
constraints, contacts by role.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" init` in the repo root. This creates
   `.workhorse/profile.yml` from the template if absent.
2. If `$ARGUMENTS` is empty, ask the user one question: industry and where the users and the
   hosting are (jurisdictions). Proceed with whatever they answer.
3. Dispatch `wh-discovery-analyst` with the repo and the client context. Wait for it.
4. Dispatch `wh-compliance-mapper` with the analyst's report. Wait for it.
5. Print the G0 packet from the end of `docs/sdlc/constraints.md`, then the profile's
   `protected_paths`, `sensitive_paths`, `autonomy`, `commands`, and `compliance` sections so
   the user can check the facts the hooks will enforce.
6. Tell the user: edit `.workhorse/profile.yml` for anything wrong, then commit
   `.workhorse/`, `docs/sdlc/`, and `CLAUDE.md`. G0 has no approval record; the commit is the
   sign-off.
