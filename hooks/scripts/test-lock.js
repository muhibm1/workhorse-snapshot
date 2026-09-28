#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit): while state.mode == "fix", deny edits to test files.
// The fixer makes failing checks pass by changing the code, never the tests.
'use strict';
const L = require('./lib');

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({});
if (ctx.error) return L.failOpen(`test-lock could not read state: ${ctx.error}`);
if (!ctx.state || ctx.state.mode !== 'fix') return L.emit({});

const file = L.toolFilePath(input);
const rel = file ? L.relToRoot(ctx.root, file) : null;
if (!rel) return L.emit({});

const globs = (ctx.profile.conventions && ctx.profile.conventions.test_globs) || [];
const hit = L.matchesAny(rel, globs);
if (hit) {
  return L.deny(`Fix mode is active for change ${ctx.id}: test files are locked ("${rel}" matches "${hit}"). Change the implementation, not the test. If the test itself is wrong, stop and report it in verification.md under "Not verified" for a human to decide.`);
}
L.emit({});
