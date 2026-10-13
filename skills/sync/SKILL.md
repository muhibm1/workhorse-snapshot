---
name: sync
description: Mirror WorkHorse changes into the client's Notion tracker so people who do not read git can see phase, tier, and which gates are waiting on a human. Run with --setup once per client to create the database.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), AskUserQuestion
---

# /workhorse:sync

Arguments: `$ARGUMENTS` is empty (sync the active change), `--all` (resync every change in this
repo), or `--setup` (create the tracker database once and print its id).

1. Read `tracker.provider` from `.workhorse/profile.yml`. If it is empty and the argument is not
   `--setup`, print this and stop:

   > No tracker configured. Run `/workhorse:sync --setup` to create a Notion database for this
   > client, or leave it empty to stay repo-only.

2. For `--setup`: ask which Notion page should be the parent, then dispatch `wh-tracker-sync`
   with "create the tracker database under that page and print its id". When it returns, tell
   the user to set `tracker.provider: notion` and `tracker.database: <id>` in
   `.workhorse/profile.yml`, then commit it.
3. Otherwise dispatch `wh-tracker-sync` with the argument and print its report unchanged.

The tracker is a mirror. Nothing in Notion changes what a change is: the repository is
authoritative, and every sync overwrites the page.
