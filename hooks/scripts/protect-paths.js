#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit|NotebookEdit): deny protected_paths, ask on sensitive_paths.
'use strict';
const path = require('path');
const L = require('./lib');

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({}); // not a WorkHorse repo: no opinion
if (ctx.error) return L.failOpen(`protect-paths could not read profile: ${ctx.error}`);

const file = L.toolFilePath(input);
if (!file) return L.emit({});

// Control state lives in the git common dir and is managed only by the wh CLI. From a worktree it
// sits outside the worktree root, so check the absolute path before the repo-relative one.
if (L.isInStateRoot(ctx.root, path.resolve(input.cwd || process.cwd(), file))) {
  return L.deny('WorkHorse control state (the active change and each state.json) is managed by the wh CLI. Do not edit it directly.');
}
const rel = L.relToRoot(ctx.root, file);
if (rel === null) return L.emit({});

// approvals.md is written only by the approve script, never by a tool call.
if (/^docs\/sdlc\/[^/]+\/approvals\.md$/.test(rel)) {
  return L.deny('approvals.md is append-only and written by /workhorse:approve. Do not edit it directly.');
}

const hit = L.matchesAny(rel, ctx.profile.protected_paths);
if (hit) return L.deny(`"${rel}" matches protected path "${hit}" in .workhorse/profile.yml. Ask the human to change it or to lift the protection.`);

const soft = L.matchesAny(rel, ctx.profile.sensitive_paths);
if (soft) {
  // A headless run has nobody to answer "ask", so the edit was simply denied (Portfolio, run 2 of
  // 0.3.3: the builder could not create .npmrc or edit package.json). The human has already
  // approved a Design document that names the files the change edits, so an edit to a sensitive
  // path the approved plan names is allowed, with a note. Anything the plan did not name still asks.
  const named = namedInApprovedDesign(rel);
  if (named) return L.allow(`"${rel}" is a sensitive path, but the Design document approved at G2 (${named}) names it.`);
  return L.ask(`"${rel}" matches sensitive path "${soft}" in .workhorse/profile.yml and the approved design does not name it. Confirm this edit is intended.`);
}

L.emit({});

/** The design document (brief.md or plan.md) that names `rel`, when G2 is approved; else null.
 *  A builder's worktree may have been cut before the design documents were committed (client-style app, run
 *  3 of 0.3.4), so the main checkout's copy is consulted as well as the worktree's own. */
function namedInApprovedDesign(relPath) {
  const s = ctx.state;
  if (!ctx.id || !s || !s.gates || s.gates.G2 !== 'approved') return null;
  const fs = require('fs');
  const roots = [ctx.root];
  const common = L.gitCommonDir(ctx.root);
  if (common && path.basename(common) === '.git') {
    const mainRoot = path.dirname(common);
    if (path.resolve(mainRoot) !== path.resolve(ctx.root)) roots.push(mainRoot);
  }
  for (const root of roots) {
    for (const doc of ['plan.md', 'brief.md']) {
      const p = path.join(L.changeDir(root, ctx.id), doc);
      try {
        if (fs.readFileSync(p, 'utf8').includes(relPath)) return doc;
      } catch (e) { /* missing document here: try the next location */ }
    }
  }
  return null;
}
