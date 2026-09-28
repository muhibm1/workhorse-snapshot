#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit): while a change has a worktree, source edits must happen
// inside it. Artifacts under docs/sdlc and .workhorse may be edited from the main checkout.
'use strict';
const path = require('path');
const L = require('./lib');

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({});
if (ctx.error) return L.failOpen(`worktree-fence could not read state: ${ctx.error}`);
if (!ctx.state || !ctx.state.worktree) return L.emit({});

const file = L.toolFilePath(input);
if (!file) return L.emit({});
const abs = path.resolve(input.cwd || process.cwd(), file);
const rel = L.relToRoot(ctx.root, file);
if (rel === null) return L.emit({}); // outside the repo entirely: other hooks decide

// If this session is itself running inside a worktree, root is the worktree: nothing to fence.
if (L.isInsideWorktree(ctx.root)) return L.emit({});

if (/^(docs\/sdlc\/|\.workhorse\/|CLAUDE\.md$)/.test(rel)) return L.emit({});

const wt = path.resolve(ctx.root, ctx.state.worktree);
if (abs.startsWith(wt + path.sep) || abs === wt) return L.emit({});

L.deny(`Change ${ctx.id} is being built in worktree "${ctx.state.worktree}". Edit source there, not in the main checkout ("${rel}").`);
