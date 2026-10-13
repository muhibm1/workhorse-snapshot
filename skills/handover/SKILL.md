---
name: handover
description: Handover phase for the whole engagement. Produces docs/handover so client engineers can own the system, regenerates the client CLAUDE.md, and optionally exports the WorkHorse workflow into the repo.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *), Bash(cp *), Bash(mkdir *)
---

# /workhorse:handover

Arguments: `$ARGUMENTS` may include `--export-workflow` to copy the plugin into `.claude/`.

1. Dispatch `wh-handover-writer`, passing whether export was requested.
2. If export was requested, after the writer returns, copy `agents/`, `skills/`, `hooks/`,
   `templates/`, `scripts/`, `.claude-plugin/`, and `README.md` from `${CLAUDE_PLUGIN_ROOT}`
   into `.claude/plugins/workhorse/` in the repo, and add to `working-with-ai.md` the line for
   loading it: `claude --plugin-dir .claude/plugins/workhorse`.
3. Dispatch `wh-adoption-reviewer` on `docs/handover/` and print its score and blockers.
4. Print the list of things the client must still provide from the writer's report.
