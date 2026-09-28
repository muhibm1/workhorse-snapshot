#!/usr/bin/env node
// Stop | SubagentStop: during build or verify, refuse to finish without a green verification.md.
// Uses the Stop hook contract: {"decision":"block","reason":"..."} keeps the agent working.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const input = L.readStdinJson();
// Avoid infinite loops: if we are already continuing because of a stop hook, let it stop.
if (input.stop_hook_active) return L.emit({});

const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.state) return L.emit({});
const phase = ctx.state.phase;
if (phase !== 'build' && phase !== 'verify') return L.emit({});

// Only the builder, fixer and verifier agents are held to this; other subagents may stop.
const agentType = input.agent_type || '';
if (input.hook_event_name === 'SubagentStop' && agentType && !/^wh-(builder|fixer|verifier)$/.test(agentType)) return L.emit({});

const vfile = path.join(L.changeDir(ctx.root, ctx.id), 'verification.md');
const status = (ctx.state.verification && ctx.state.verification.status) || 'none';
if (fs.existsSync(vfile) && status === 'green') return L.emit({});

const missing = !fs.existsSync(vfile) ? 'verification.md does not exist' : `verification status is "${status}"`;
L.emit({
  decision: 'block',
  reason: `Change ${ctx.id} is in phase "${phase}" and ${missing}. Run the profile's checks, write docs/sdlc/${ctx.id}/verification.md with a command, exit code and output path per check, and record the result with: node "${'${CLAUDE_PLUGIN_ROOT}'}/scripts/wh.js" state set verification.status <green|red>. If a check cannot run, record it under "Not verified" with the reason and set status red so a human sees it; do not claim green.`,
});
