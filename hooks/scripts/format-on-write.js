#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): run the profile's format command on the changed file.
'use strict';
const { execSync } = require('child_process');
const L = require('./lib');

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({});
const fmt = ctx.profile.commands && ctx.profile.commands.format;
if (!fmt) return L.emit({});
const file = L.toolFilePath(input);
if (!file) return L.emit({});
const rel = L.relToRoot(ctx.root, file);
if (rel === null) return L.emit({});
if (/^docs\/sdlc\//.test(rel) || /\.md$/.test(rel) && !fmt.includes('.md')) return L.emit({});

const cmd = fmt.includes('{file}') ? fmt.replace('{file}', JSON.stringify(rel)) : `${fmt} ${JSON.stringify(rel)}`;
try {
  execSync(cmd, { cwd: ctx.root, stdio: 'ignore', timeout: 30000 });
  L.emit({});
} catch (e) {
  L.emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `[workhorse] formatter failed on ${rel}: ${String(e.message).slice(0, 200)}` } });
}
