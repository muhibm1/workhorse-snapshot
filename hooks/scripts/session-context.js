#!/usr/bin/env node
// SessionStart: inject a short summary of the client profile and the active change.
'use strict';
const L = require('./lib');

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({});

const p = ctx.profile;
const lines = [];
lines.push(`[WorkHorse] Client: ${(p.client && p.client.name) || 'unnamed'} (${(p.client && p.client.industry) || 'industry unset'}). Autonomy: ${p.autonomy || 'bounded'}.`);
const c = p.commands || {};
const cmds = ['typecheck', 'lint', 'test', 'build'].filter((k) => c[k]).map((k) => `${k}: ${c[k]}`);
if (cmds.length) lines.push(`Commands: ${cmds.join(' | ')}`);
const reg = (p.compliance && p.compliance.regimes) || [];
if (reg.length) lines.push(`Compliance regimes: ${reg.join(', ')}. Load the matching wh-compliance-* skill for spec and review work.`);
if (ctx.id && ctx.state) {
  const s = ctx.state;
  const gates = Object.entries(s.gates || {}).map(([g, v]) => `${g}=${v}`).join(' ');
  lines.push(`Active change: ${ctx.id} "${s.title || ''}" tier ${L.effectiveTier(s)} phase ${s.phase} mode ${s.mode}. Gates: ${gates}. Required human gates: ${L.requiredGates(s, p).join(', ')}.`);
  lines.push(`Artifacts: docs/sdlc/${ctx.id}/. Use /workhorse:status for detail, /workhorse:run to continue.`);
} else {
  lines.push('No active change. Start one with /workhorse:run "<problem> -> <outcome>" or /workhorse:intent.');
}

L.emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } });
