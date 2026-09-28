#!/usr/bin/env node
// PreToolUse (Bash): deny destructive git and infra commands, deny anything on the profile's
// deny_commands list, ask for ask_commands, and refuse approvals from inside a subagent.
'use strict';
const L = require('./lib');

const input = L.readStdinJson();
const cmd = String((input.tool_input && input.tool_input.command) || '');
if (!cmd) return L.emit({});
const lc = cmd.toLowerCase();

// Approvals are a human act. A subagent can never record one.
if (/wh\.js["']?\s+approve\b/.test(lc) || /approve\.js/.test(lc)) {
  if (input.agent_id || input.agent_type) {
    return L.deny('Gate approvals may only be recorded by the human via /workhorse:approve in the main session, never from a subagent.');
  }
}

const ctx = L.loadContext(input.cwd);
const profile = ctx.profile || {};
const defaultBranch = (profile.conventions && profile.conventions.default_branch) || 'main';

const builtinDeny = [
  /git\s+push\s+[^|;&]*(--force|-f\b|--force-with-lease)/,
  new RegExp(`git\\s+push\\s+[^|;&]*\\b(origin\\s+)?${defaultBranch}\\b`),
  new RegExp(`git\\s+push\\s+[^|;&]*\\bhead:${defaultBranch}\\b`),
  /git\s+reset\s+--hard\s+[^|;&]*origin\//,
  /git\s+branch\s+-d\s+[^|;&]*\b(main|master)\b/i,
  /git\s+checkout\s+[^|;&]*--\s+\./,
  /git\s+clean\s+-[a-z]*f/,
  /rm\s+-rf?\s+(\/|~|\$home|c:\\|\.\.)\s*$/i,
  /rm\s+-rf?\s+\/\S*/,
];
for (const re of builtinDeny) {
  if (re.test(lc)) return L.deny(`Blocked destructive command: ${cmd.slice(0, 120)}. Agents never force-push, push to ${defaultBranch}, or discard work. Open a PR instead.`);
}

for (const s of profile.deny_commands || []) {
  if (typeof s === 'string' && s && lc.includes(s.toLowerCase())) {
    return L.deny(`Command matches deny_commands entry "${s}" in .workhorse/profile.yml.`);
  }
}
for (const s of profile.ask_commands || []) {
  if (typeof s === 'string' && s && lc.includes(s.toLowerCase())) {
    return L.ask(`Command matches ask_commands entry "${s}" in .workhorse/profile.yml. Confirm before running.`);
  }
}

// Production deploys need an explicit human G5 whenever the profile says prod is not auto,
// regardless of tier: the profile is the client's declared deployment policy.
const envs = profile.environments || {};
const prod = envs.prod || {};
if (prod.deploy && lc.includes(String(prod.deploy).toLowerCase()) && prod.auto !== true) {
  const g5 = ctx.state && ctx.state.gates ? ctx.state.gates.G5 : undefined;
  if (g5 !== 'approved') {
    return L.deny(`Production deploy requires an explicit G5 approval (/workhorse:approve G5); current G5 status: ${g5 || 'no active change'}. At tier 3 the human runs the deploy command themselves.`);
  }
}

L.emit({});
