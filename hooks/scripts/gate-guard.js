#!/usr/bin/env node
// PreToolUse (Bash|Write|Edit): deny phase-advancing actions while a required gate is
// unapproved. Fails CLOSED when state exists but cannot be read, because a missing gate is
// exactly the case this hook exists for.
'use strict';
const path = require('path');
const L = require('./lib');

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({});
if (ctx.error) return L.deny(`gate-guard could not read WorkHorse state (${ctx.error}). Check the control state under .git/workhorse (the active change and its state.json) before continuing.`);
if (!ctx.id || !ctx.state) return L.emit({}); // no active change: nothing to guard

const state = ctx.state;
const profile = ctx.profile;
const tool = input.tool_name || '';

function blocked(gate, what) {
  const req = L.requiredGates(state, profile).join(', ');
  const status = (state.gates && state.gates[gate]) || 'pending';
  return L.deny(`${what} requires ${gate} (status: ${status}) for change ${ctx.id} at tier ${L.effectiveTier(state)}. Required human gates: ${req}. Present the gate packet and wait for /workhorse:approve ${gate}.`);
}

if (tool === 'Bash') {
  const cmd = String((input.tool_input && input.tool_input.command) || '').toLowerCase();
  if (/\bgh\s+pr\s+merge\b/.test(cmd) || /\bgit\s+merge\b/.test(cmd)) {
    if (!L.gateSatisfied(state, profile, 'G4')) return blocked('G4', 'Merging');
  }
  if (/\bgh\s+pr\s+create\b/.test(cmd) || /\bgit\s+push\b/.test(cmd)) {
    // Pushing the change branch is allowed once the design is approved and verification is
    // green; it is how the PR for G4 (Ship) is opened.
    if (!L.gateSatisfied(state, profile, 'G2')) return blocked('G2', 'Pushing');
    const v = state.verification || {};
    if (v.status !== 'green') {
      return L.deny(`Pushing requires a green verification.md for change ${ctx.id} (current: ${v.status || 'none'}). Run the verifier first.`);
    }
  }
  return L.emit({});
}

if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
  const file = L.toolFilePath(input);
  const rel = file ? L.relToRoot(ctx.root, file) : null;
  if (!rel) return L.emit({});
  const m = rel.match(/^docs\/sdlc\/([^/]+)\/([^/]+)$/);
  if (!m) return L.emit({});
  const [, id, name] = m;
  if (id !== ctx.id) return L.emit({});
  const gate = L.PHASE_ARTIFACT_GATE[name];
  if (gate && !L.gateSatisfied(state, profile, gate)) return blocked(gate, `Writing ${name}`);
  if (name === 'state.json') {
    // state.json is managed by the wh CLI; direct edits would let an agent mark its own gates.
    return L.deny('state.json is managed by the wh CLI (node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" state ...). Do not edit it directly.');
  }
}

L.emit({});
