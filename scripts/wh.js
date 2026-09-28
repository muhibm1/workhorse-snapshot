#!/usr/bin/env node
// WorkHorse CLI. Called by the /wh-* skills and by agents. Zero dependencies.
//
//   wh.js init                              scaffold .workhorse/ and docs/sdlc/ in the current repo
//   wh.js new "<title>" [--tier N]          create a change, scaffold artifacts, set it active
//   wh.js active [id|--clear]               show or set the active change
//   wh.js state get [key.path]              print state (or one key) as JSON
//   wh.js state set <key.path> <value>      set a key (numbers/booleans/null/JSON parsed)
//   wh.js phase <name>                      set phase (design|build|verify|review|deploy|done);
//                                           "done" also commits the change's artifacts
//   wh.js mode <normal|fix>                 set fix mode (locks tests)
//   wh.js gate <G1..G5> <status>            set a gate status: pending|auto|approved|rejected|n/a
//   wh.js approve <gate> [--reject] [notes] record a human decision in approvals.md (main session only);
//                                           an approval must answer every packet decision by id, or pass --accept-all;
//                                           G4 (Ship) refuses while the Ship document has a blocker
//   wh.js required                          list human gates required for the active change
//   wh.js log "<agent> | <result>"          append a line to conductor-log.md, stamped with the real time
//   wh.js present <G2|G4|G5>                mark a gate packet as presented to the human and print its summary;
//                                           until then the digest and clock do not count the gate as waiting
//   wh.js clock [--json]                    agent time, waiting time and dead time for the active change
//   wh.js known-failure add <check> --command "<cmd>" --base <sha> --reason "<why>"
//   wh.js known-failure list [--json]       pre-existing failures recorded for this repository
//   wh.js status [--json] [--metrics]       human-readable status
//   wh.js scaffold <template> [--out path]  render a template with state placeholders
//   wh.js digest [--json] [--all]           emit the tracker sync payload (one change, or every change)
//   wh.js plugin-root                       print the plugin root path
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const L = require(path.join(__dirname, '..', 'hooks', 'scripts', 'lib.js'));

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
const PHASES = L.PHASES;
/** The packet a human reads at each gate, and therefore the artifact an approval must pin.
 *  G1 and G3 are no longer required by any tier; they map to the brief and the plan so an old
 *  change or an `assisted` profile still resolves to a file. */
const GATE_PACKET = { G1: 'brief.md', G2: 'brief.md', G3: 'plan.md', G4: 'ship.md', G5: 'release.md' };

// The gate that closes each phase, and the artifact that must exist for that gate to be live.
// A phase whose gate is required, still pending, and whose packet exists and is complete (its
// "## Your decision" section written) is waiting on a human.
const PHASE_GATE = { design: 'G2', review: 'G4', deploy: 'G5' };
const PHASE_ARTIFACT = { design: 'brief.md', review: 'ship.md', deploy: 'release.md' };


const args = process.argv.slice(2);
const cmd = args.shift();

function die(msg, code) { process.stderr.write(`wh: ${msg}\n`); process.exit(code || 1); }
function out(s) { process.stdout.write(typeof s === 'string' ? s + '\n' : JSON.stringify(s, null, 2) + '\n'); }

function requireRoot() {
  const root = L.findRoot(process.cwd());
  if (!root) die('not inside a WorkHorse repo (no .workhorse/profile.yml found). Run "wh.js init" or /workhorse:onboard first.');
  return root;
}
function requireActive(root) {
  const id = L.activeChangeId(root);
  if (!id) die('no active change. Run "wh.js new <title>" or /workhorse:intent.');
  const state = L.loadState(root, id);
  if (!state) die(`state.json missing for change ${id}`);
  return { id, state };
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
function today() { return new Date().toISOString().slice(0, 10); }
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v === undefined ? true : v;
}
function hasFlag(name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
function parseValue(v) {
  if (v === undefined) return null;
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[\[{"]/.test(v)) { try { return JSON.parse(v); } catch (e) { /* fallthrough */ } }
  return v;
}
function setPath(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function getPath(obj, keyPath) {
  return keyPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
function stateVars(root, id, state) {
  const p = (() => { try { return L.loadProfile(root); } catch (e) { return {}; } })();
  return {
    change_id: id,
    title: state.title || id,
    tier: L.effectiveTier(state),
    tier_reason: state.tier_reason || '',
    branch: state.branch || '',
    worktree: state.worktree || '',
    date: today(),
    timestamp: L.nowIso(),
    commit: L.git(root, ['rev-parse', '--short', 'HEAD']) || '',
    requester: L.git(root, ['config', 'user.email']) || '',
    client_name: (p.client && p.client.name) || '',
    branch_prefix: (p.conventions && p.conventions.branch_prefix) || 'wh/',
    commit_style: (p.conventions && p.conventions.commit_style) || 'conventional',
    protected_paths: ((p.protected_paths || []).join(', ')),
    install: (p.commands && p.commands.install) || '',
    typecheck: (p.commands && p.commands.typecheck) || '',
    lint: (p.commands && p.commands.lint) || '',
    test: (p.commands && p.commands.test) || '',
    build: (p.commands && p.commands.build) || '',
    skills: '',
    gate: '',
    pr_url: state.pr_url || '',
    version: '',
    budget: L.budgetMinutes(L.effectiveTier(state), p),
    clock: L.formatClock(clockFor(root, id, state)),
    security_checklist: L.effectiveTier(state) >= 2 ? '\n### Pre-ship security checklist (tier 2+)\n\nSee the wh-security-baseline skill; every item must be ticked or explicitly waived with a reason.\n' : '',
  };
}

switch (cmd) {
  case 'plugin-root': out(PLUGIN_ROOT); break;

  case 'init': {
    const root = process.cwd();
    const wh = path.join(root, '.workhorse');
    fs.mkdirSync(wh, { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'sdlc'), { recursive: true });
    const prof = path.join(wh, 'profile.yml');
    if (!fs.existsSync(prof)) fs.copyFileSync(path.join(TEMPLATES, 'profile.yml'), prof);
    // Control state lives in the git common dir (see lib.js). These ignores cover the legacy file
    // and the no-git fallback, so neither can ever be committed and then rewritten by a checkout.
    const gi = path.join(root, '.gitignore');
    for (const line of ['.worktrees/', '.workhorse/active', '.workhorse/state/']) {
      const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
      if (!cur.split(/\r?\n/).includes(line)) fs.appendFileSync(gi, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n');
    }
    out(`initialised ${wh} and docs/sdlc/. Edit .workhorse/profile.yml (or run /workhorse:onboard to have it written for you).`);
    break;
  }

  case 'new': {
    const root = requireRoot();
    const tier = flag('--tier');
    const title = args.join(' ').trim();
    if (!title) die('usage: wh.js new "<title>" [--tier N]');
    const id = `${today()}-${slug(title)}`;
    const dir = L.changeDir(root, id);
    if (fs.existsSync(dir)) die(`change ${id} already exists`);
    fs.mkdirSync(path.join(dir, 'adr'), { recursive: true });
    const profile = L.loadProfile(root);
    const state = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'state.json'), 'utf8'));
    state.change_id = id;
    state.title = title;
    state.tier = tier !== null ? Number(tier) : null;
    state.branch = `${(profile.conventions && profile.conventions.branch_prefix) || 'wh/'}${id}`;
    state.phase = 'design';
    L.saveState(root, id, state);
    L.setActiveChangeId(root, id);
    const vars = stateVars(root, id, state);
    // Only approvals.md is scaffolded. The designer writes brief.md itself, last, so a half-written
    // packet never shows as waiting on the human.
    fs.writeFileSync(path.join(dir, 'approvals.md'), render(fs.readFileSync(path.join(TEMPLATES, 'approvals.md'), 'utf8'), vars));
    // Cut the change branch now, so the design documents and the Design approval commit land on
    // it. They used to land on whatever branch was checked out (the default branch, in every
    // live run), which left local main ahead of origin with commits the squash merge already
    // carried, and a conflict on the next pull.
    const from = L.git(root, ['branch', '--show-current']) || '(detached)';
    const exists = L.git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${state.branch}`]);
    L.git(root, exists ? ['checkout', '-q', state.branch] : ['checkout', '-q', '-b', state.branch]);
    const onBranch = L.git(root, ['branch', '--show-current']) === state.branch;
    appendLog(root, id, state, `conductor | change created: ${title}${onBranch ? ` on branch ${state.branch}, cut from ${from}` : ' (branch not cut: the checkout could not switch; cut it by hand before building)'}`);
    out({ change_id: id, dir: path.relative(root, dir), branch: state.branch, on_branch: onBranch, cut_from: onBranch ? from : null });
    break;
  }

  case 'active': {
    const root = requireRoot();
    if (hasFlag('--clear')) { L.setActiveChangeId(root, ''); out('cleared'); break; }
    if (args[0]) {
      if (!fs.existsSync(L.changeDir(root, args[0])) && !L.loadState(root, args[0])) die(`no such change ${args[0]}`);
      L.setActiveChangeId(root, args[0]);
      out(args[0]);
    } else out(L.activeChangeId(root) || '');
    break;
  }

  case 'state': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const sub = args.shift();
    if (sub === 'get') { const k = args[0]; out(k ? getPath(state, k) : state); break; }
    if (sub === 'set') {
      const k = args[0]; const v = parseValue(args[1]);
      if (!k) die('usage: wh.js state set <key.path> <value>');
      if (k === 'gates' || k.startsWith('gates.')) {
        // Gates are set through "gate" (auto/n-a/pending) or "approve" (approved/rejected).
        die('use "wh.js gate <G> <status>" for gate status; "approved" is only set by "wh.js approve".');
      }
      if (k === 'verification.status' && v === 'green') {
        const vf = path.join(L.changeDir(root, id), 'verification.md');
        if (!fs.existsSync(vf)) die('cannot mark verification green: verification.md does not exist');
        const txt = fs.readFileSync(vf, 'utf8');
        if (!/^Status:\s*green/m.test(txt)) die('cannot mark verification green: verification.md does not say "Status: green"');
        // A profile with no checks would make "every defined check passed" vacuously true, so a
        // greenfield repo could report green having run nothing. Refuse that outright.
        const prof = L.loadProfile(root);
        const CHECKS = ['typecheck', 'lint', 'test', 'build', 'e2e', 'security_audit', 'screenshot'];
        const defined = CHECKS.filter((c) => (prof.commands || {})[c]);
        if (defined.length === 0) {
          die('cannot mark verification green: .workhorse/profile.yml defines no checks, so green would prove nothing. Set at least commands.test, then re-verify.');
        }
        setPath(state, 'verification.at', L.nowIso());
      }
      setPath(state, k, v);
      // A conductor once marked G2 auto before the designer had set the tier (tier unknown reads as
      // 0, where Design is not required). Once the tier is known, any gate it requires that was
      // stamped auto goes back to pending, so it is presented rather than skipped.
      if (k === 'tier' || k === 'tier_override') {
        const prof = L.loadProfile(root);
        state.gates = state.gates || {};
        const reset = L.requiredGates(state, prof).filter((g) => state.gates[g] === 'auto');
        for (const g of reset) state.gates[g] = 'pending';
        L.saveState(root, id, state);
        out(reset.length ? { [k]: v, reset_to_pending: reset } : { [k]: v });
        break;
      }
      L.saveState(root, id, state);
      out({ [k]: v });
      break;
    }
    die('usage: wh.js state get [key] | set <key> <value>');
    break;
  }

  case 'phase': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const p = args[0];
    if (!PHASES.includes(p)) die(`phase must be one of ${PHASES.join(', ')}`);
    // The retro now runs in the background after the change closes and commits its own file,
    // so "done" no longer waits for retro.md. --no-retro is accepted for older callers.
    hasFlag('--no-retro');
    state.phase = p;
    if (p !== 'verify' && p !== 'build') state.mode = 'normal';
    L.saveState(root, id, state);
    let committed = null;
    if (p === 'done') {
      // Close the change in git history. A live run reached done with release.md, retro.md and
      // the last conductor-log lines never committed, so the record of the change was incomplete.
      const dirRel = path.relative(root, L.changeDir(root, id)).split(path.sep).join('/');
      // The retro's instinct files live at .workhorse/instincts/, outside the change folder,
      // because they accumulate across changes. A live run left them untracked; they are the
      // record of what the pipeline learned, so the close commit carries them too.
      const paths = [dirRel];
      if (fs.existsSync(path.join(root, '.workhorse', 'instincts'))) paths.push('.workhorse/instincts');
      L.git(root, ['add', '--', ...paths]);
      // Exits non-zero when nothing is staged; then there is nothing left to record.
      L.git(root, ['commit', '-q', '-m', `chore(sdlc): close ${id}`, '--', ...paths]);
      committed = L.git(root, ['log', '-1', '--format=%h', '--', ...paths]) || null;
    }
    out(committed ? { phase: p, committed } : { phase: p });
    break;
  }

  case 'mode': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const m = args[0];
    if (m !== 'normal' && m !== 'fix') die('mode must be normal or fix');
    state.mode = m;
    L.saveState(root, id, state);
    out({ mode: m });
    break;
  }

  case 'gate': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const [g, s] = args;
    if (!L.ALL_GATES.includes(g)) die('gate must be G1..G5');
    if (!['pending', 'auto', 'n/a'].includes(s)) die('status must be pending, auto, or n/a (approved/rejected come from "approve")');
    const profile = L.loadProfile(root);
    if (s === 'auto' && L.requiredGates(state, profile).includes(g)) die(`${g} is a required human gate for tier ${L.effectiveTier(state)} under autonomy "${profile.autonomy || 'bounded'}"; it cannot be auto-approved.`);
    state.gates = state.gates || {};
    state.gates[g] = s;
    L.saveState(root, id, state);
    out({ [g]: s });
    break;
  }

  case 'approve': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const reject = hasFlag('--reject');
    const acceptAll = hasFlag('--accept-all');
    const g = args.shift();
    if (!L.ALL_GATES.includes(g)) die('usage: wh.js approve <G1..G5> [--reject | --accept-all] [notes]');
    let notes = args.join(' ').trim();
    if (reject && !notes) die('a rejection needs notes so the phase can be re-entered with them');
    if (!reject && g === 'G4') {
      // Ship is never approved over a defect the pipeline could have fixed, or over a red check.
      const blockers = L.shipBlockers(readArtifact(root, id, 'ship.md'), state);
      if (blockers.length) die(`cannot approve G4 (Ship): ${blockers.join('; ')}. The conductor must fix and re-verify before presenting the Ship document.`);
    }
    if (!reject) notes = requireDecisionsAnswered(readArtifact(root, id, GATE_PACKET[g]), notes, acceptAll);
    const who = L.git(root, ['config', 'user.email']) || process.env.USER || process.env.USERNAME || 'unknown';

    // Pin what is being decided before recording the decision. Without this the recorded commit
    // was simply HEAD, which did not contain the packet: agents write artifacts but nothing had
    // committed them, so an approved spec could be edited afterwards with no trace of what was
    // actually signed off. Commit the change's artifacts first, so the recorded commit really
    // contains the packet, and hash the packet itself, so any later edit is detectable.
    const dirRel = path.relative(root, L.changeDir(root, id)).split(path.sep).join('/');
    const packetRel = `${dirRel}/${GATE_PACKET[g]}`;
    const packetAbs = path.join(root, packetRel);
    const packetSha = fs.existsSync(packetAbs)
      ? crypto.createHash('sha256').update(fs.readFileSync(packetAbs)).digest('hex')
      : null;
    L.git(root, ['add', '--', dirRel]);
    // Exits non-zero when nothing is staged (already committed); HEAD then contains it anyway.
    L.git(root, ['commit', '-q', '-m', `chore(sdlc): ${g} packet for ${id}`, '--', dirRel]);
    const commit = L.git(root, ['rev-parse', 'HEAD']) || 'no-commit';
    const at = L.nowIso();
    const status = reject ? 'rejected' : 'approved';
    const block = [
      '',
      `## ${g}: ${status}`,
      '',
      `- Who: ${who}`,
      `- When: ${at}`,
      `- Artifact commit: \`${commit}\` (contains the packet below)`,
      `- Packet: \`${packetRel}\` sha256 \`${packetSha || 'missing: no packet file existed at decision time'}\``,
      `- Tier at decision: ${L.effectiveTier(state)}${state.tier_override !== null && state.tier_override !== undefined ? ' (override)' : ''}`,
      `- Notes: ${notes || 'none'}`,
      '',
    ].join('\n');
    const af = path.join(L.changeDir(root, id), 'approvals.md');
    if (!fs.existsSync(af)) fs.writeFileSync(af, render(fs.readFileSync(path.join(TEMPLATES, 'approvals.md'), 'utf8'), stateVars(root, id, state)));
    fs.appendFileSync(af, block);
    state.gates = state.gates || {};
    state.gates[g] = status;
    if (reject) state.last_rejection = { gate: g, notes, at };
    L.saveState(root, id, state);
    // Commit the approval so the audit trail is in git history.
    // state.json is machine state kept outside git; approvals.md is the audit record.
    L.git(root, ['add', '--', path.relative(root, af)]);
    const sha = L.git(root, ['commit', '-q', '-m', `chore(sdlc): ${g} ${status} for ${id}`, '--', path.relative(root, af)]);
    out({ gate: g, status, who, at, committed: sha !== '' || L.git(root, ['log', '-1', '--format=%h']) });
    break;
  }

  case 'log': {
    // The conductor has no clock of its own; a live run showed it inventing timestamps that ran
    // ahead of the file's own write time. The CLI stamps the time and the phase instead.
    const root = requireRoot();
    const { id, state } = requireActive(root);
    // The CLI adds the phase itself; drop one the caller included, which doubled it in live logs.
    const msg = args.join(' ').replace(/\s+/g, ' ').trim().replace(new RegExp(`^${state.phase}\\s*\\|\\s*`), '');
    if (!msg) die('usage: wh.js log "<agent> | <result>"');
    out(appendLog(root, id, state, msg));
    break;
  }

  case 'present': {
    // A packet is waiting on the human only once the conductor has presented it. Without this,
    // a finished brief counted as waiting during the auditor's revision round (run 3 of 0.3.2
    // showed 7 "waiting" minutes that were agent time), and Paddock offered Approve too early.
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const g = args[0];
    if (!L.ALL_GATES.includes(g)) die('usage: wh.js present <G2|G4|G5>');
    const packet = readArtifact(root, id, GATE_PACKET[g]);
    if (!L.packetComplete(packet)) die(`cannot present ${g}: ${GATE_PACKET[g]} is missing or has no "## Your decision" section`);
    if (g === 'G4') {
      const blockers = L.shipBlockers(packet, state);
      if (blockers.length) die(`cannot present G4 (Ship): ${blockers.join('; ')}`);
    }
    state.gates = state.gates || {};
    if (state.gates[g] === 'rejected' || state.gates[g] === 'auto') state.gates[g] = 'pending';
    state.presented = state.presented || {};
    state.presented[g] = L.nowIso();
    L.saveState(root, id, state);
    appendLog(root, id, state, `conductor | ${g} ${L.GATE_NAMES[g]} presented`);
    out([
      `${L.GATE_NAMES[g]} (${g}) is waiting on you. Tier ${L.effectiveTier(state)}. Packet: docs/sdlc/${id}/${GATE_PACKET[g]}`,
      sectionText(packet, /^#{1,6}.*(short version|tl;dr)/i, 900),
      ...decisionRows(packet, 20).map((d) => `  ${d}`),
      L.formatClock(clockFor(root, id, state)),
      `Approve: /workhorse:approve ${g} --accept-all    Reject: /workhorse:approve ${g} --reject "notes"`,
    ].join('\n'));
    break;
  }

  case 'clock': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const c = clockFor(root, id, state);
    out(hasFlag('--json') ? c : L.formatClock(c));
    break;
  }

  case 'known-failure': {
    const root = requireRoot();
    const sub = args.shift();
    if (sub === 'list') {
      const rows = L.loadKnownFailures(root);
      if (hasFlag('--json')) { out(rows); break; }
      out(rows.length ? rows.map((r) => `${r.date} | ${r.check} | ${r.command} | base ${r.base} | ${r.reason} | ${r.change}`).join('\n') : 'No known failures recorded.');
      break;
    }
    if (sub === 'add') {
      const check = args.filter((a) => !a.startsWith('--'))[0];
      const command = flag('--command');
      const base = flag('--base');
      const reason = flag('--reason');
      if (!check || !command || !base || !reason) {
        die('usage: wh.js known-failure add <check> --command "<cmd>" --base <sha> --reason "<why it predates this change>"');
      }
      const id = L.activeChangeId(root) || '';
      L.addKnownFailure(root, { date: today(), check, command, base, reason, change: id });
      out({ recorded: check, file: path.relative(root, L.knownFailuresFile(root)) });
      break;
    }
    die('usage: wh.js known-failure add|list');
    break;
  }

  case 'required': {
    const root = requireRoot();
    const { state } = requireActive(root);
    out(L.requiredGates(state, L.loadProfile(root)));
    break;
  }

  case 'status': {
    const root = requireRoot();
    const json = hasFlag('--json');
    const metrics = hasFlag('--metrics');
    const profile = L.loadProfile(root);
    const id = L.activeChangeId(root);
    if (metrics) { out(computeMetrics(root)); break; }
    if (!id) { out(json ? { active: null } : 'No active change.'); break; }
    const state = L.loadState(root, id);
    const req = L.requiredGates(state, profile);
    const blocking = req.find((g) => (state.gates || {})[g] !== 'approved');
    const clock = clockFor(root, id, state);
    const summary = {
      change_id: id, title: state.title, tier: L.effectiveTier(state), phase: state.phase, mode: state.mode,
      branch: state.branch, worktree: state.worktree, gates: state.gates, required_human_gates: req,
      gate_names: L.GATE_NAMES,
      verification: state.verification, next_blocking_gate: blocking || null, autonomy: profile.autonomy || 'bounded',
      clock,
      artifacts: fs.existsSync(L.changeDir(root, id)) ? fs.readdirSync(L.changeDir(root, id)).filter((f) => f !== 'adr') : [],
    };
    if (json) { out(summary); break; }
    const named = (g) => `${g} ${L.GATE_NAMES[g]}`;
    out([
      `Change: ${id} "${state.title}"`,
      `Tier: ${summary.tier}   Phase: ${state.phase}   Mode: ${state.mode}   Autonomy: ${summary.autonomy}`,
      `Branch: ${state.branch || '-'}   Worktree: ${state.worktree || '-'}`,
      `Gates: ${Object.entries(state.gates || {}).map(([g, v]) => `${g}=${v}`).join('  ')}`,
      `Required human gates: ${req.map(named).join(', ')}`,
      `Verification: ${(state.verification || {}).status || 'none'}`,
      `Next blocking gate: ${blocking ? named(blocking) : 'none'}`,
      L.formatClock(clock),
      `Artifacts: ${summary.artifacts.join(', ') || 'none'}`,
    ].join('\n'));
    break;
  }

  case 'scaffold': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const outPath = flag('--out');
    const gate = flag('--gate');
    const name = args[0];
    if (!name) die('usage: wh.js scaffold <template.md> [--out path] [--gate G4]');
    const src = path.join(TEMPLATES, name);
    if (!fs.existsSync(src)) die(`no template ${name}`);
    const vars = stateVars(root, id, state);
    if (gate) vars.gate = gate;
    const text = render(fs.readFileSync(src, 'utf8'), vars);
    const dest = outPath ? path.resolve(root, outPath) : path.join(L.changeDir(root, id), name);
    if (fs.existsSync(dest)) die(`${path.relative(root, dest)} exists; delete it first if you mean to regenerate`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    out(path.relative(root, dest));
    break;
  }

  case 'digest': {
    const root = requireRoot();
    const all = hasFlag('--all');
    hasFlag('--json'); // accepted and ignored: the digest is always JSON
    if (all) {
      const ids = L.listChangeIds(root);
      out(ids.map((cid) => buildDigest(root, cid, L.loadState(root, cid))));
      break;
    }
    const { id, state } = requireActive(root);
    out(buildDigest(root, id, state));
    break;
  }

  default:
    die(`unknown command "${cmd || ''}". See the header of scripts/wh.js for usage.`);
}

/** Append one stamped row to conductor-log.md. The CLI is the only clock the pipeline has. */
function appendLog(root, id, state, msg) {
  const f = path.join(L.changeDir(root, id), 'conductor-log.md');
  if (!fs.existsSync(f)) fs.writeFileSync(f, `# Conductor log: ${id}\n\n`);
  const line = `${L.nowIso()} | ${state.phase} | ${msg}`;
  fs.appendFileSync(f, line + '\n');
  return line;
}

/** True once the conductor has run `present <G>` for this gate. A gate rejected and reworked is
 *  presented again, so the stamp must be newer than the last rejection. */
function presentedAfterPacket(root, id, state, gate) {
  const at = state.presented && state.presented[gate];
  if (!at) return false;
  const rej = state.last_rejection && state.last_rejection.gate === gate ? Date.parse(state.last_rejection.at) : 0;
  return Date.parse(at) >= rej;
}

/** The change's clock, from its log and approvals on disk. */
function clockFor(root, id, state) {
  const profile = (() => { try { return L.loadProfile(root); } catch (e) { return {}; } })();
  const gateHere = PHASE_GATE[state.phase];
  const pending = Boolean(gateHere && L.requiredGates(state, profile).includes(gateHere)
    && ((state.gates || {})[gateHere] || 'pending') === 'pending'
    && presentedAfterPacket(root, id, state, gateHere)
    && L.packetComplete(readArtifact(root, id, PHASE_ARTIFACT[state.phase])));
  return L.computeClock({
    log: readArtifact(root, id, 'conductor-log.md'),
    approvals: readArtifact(root, id, 'approvals.md'),
    state, profile, pending_gate: pending,
  });
}

function computeMetrics(root) {
  const base = path.join(root, 'docs', 'sdlc');
  const rows = [];
  for (const id of L.listChangeIds(root)) {
    const s = L.loadState(root, id);
    if (!s) continue;
    const af = path.join(base, id, 'approvals.md');
    const txt = fs.existsSync(af) ? fs.readFileSync(af, 'utf8') : '';
    const approvals = (txt.match(/^## G\d: (approved|rejected)/gm) || []);
    const rejections = approvals.filter((a) => a.endsWith('rejected')).length;
    const vtxt = fs.existsSync(path.join(base, id, 'verification.md')) ? fs.readFileSync(path.join(base, id, 'verification.md'), 'utf8') : '';
    const fixRows = (vtxt.match(/^\| \d+ \|/gm) || []).length;
    const clock = clockFor(root, id, s);
    rows.push({
      id, tier: L.effectiveTier(s), phase: s.phase, rejections, fix_iterations: fixRows, gates: s.gates,
      agent_minutes: clock.agent_minutes, waiting_minutes: clock.waiting_minutes, dead_minutes: clock.dead_minutes,
      budget_minutes: clock.budget_minutes, within_budget: clock.within_budget,
    });
  }
  const done = rows.filter((r) => r.phase === 'done' || r.phase === 'deploy');
  const mean = (k, set) => (set.length ? Number((set.reduce((a, r) => a + r[k], 0) / set.length).toFixed(1)) : null);
  return {
    changes: rows.length,
    completed: done.length,
    single_pass_rate: rows.length ? Number((rows.filter((r) => r.rejections === 0).length / rows.length).toFixed(2)) : null,
    mean_rework_cycles: rows.length ? Number((rows.reduce((a, r) => a + r.rejections, 0) / rows.length).toFixed(2)) : null,
    mean_fix_iterations: rows.length ? Number((rows.reduce((a, r) => a + r.fix_iterations, 0) / rows.length).toFixed(2)) : null,
    mean_agent_minutes: mean('agent_minutes', done),
    mean_waiting_minutes: mean('waiting_minutes', done),
    within_budget_rate: done.length ? Number((done.filter((r) => r.within_budget).length / done.length).toFixed(2)) : null,
    by_tier: [0, 1, 2, 3].map((t) => ({ tier: t, count: rows.filter((r) => r.tier === t).length })),
    changes_detail: rows,
  };
}

// ---------- tracker digest ----------

function readArtifact(root, id, name) {
  const p = path.join(L.changeDir(root, id), name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

// First prose paragraph under the heading matching `re`, collapsed to one line.
function sectionText(md, re, maxLen) {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  let i = lines.findIndex((l) => re.test(l));
  if (i < 0) return '';
  const buf = [];
  for (i += 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) break;
    if (!l.trim()) { if (buf.length) break; continue; }
    if (/^(\||-{3,}|<!--)/.test(l.trim())) break;
    buf.push(l.trim());
  }
  const t = buf.join(' ').replace(/\s+/g, ' ').trim();
  return maxLen && t.length > maxLen ? t.slice(0, maxLen - 1) + '\u2026' : t;
}

// The "Decisions requested" table of a gate packet, one object per row that has an id (D1,
// D2, ...). The renderer's decisions.ts parses the same table; keep the two in step.
function decisionItems(md) {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  // "## Decisions" in the brief and Ship document; "Decisions requested" in older packets.
  const start = lines.findIndex((l) => /^#{1,6}\s*(\d+\.\s*)?decisions( requested)?\s*$/i.test(l));
  if (start < 0) return [];
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#{1,6}\s/.test(l)) break;
    if (!l.startsWith('|')) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/^:?-{2,}/.test(cells[0])) continue;
    if (/^#$/.test(cells[0]) && /^decision$/i.test(cells[1] || '')) continue;
    if (!/^D\d+$/i.test(cells[0]) || !cells[1]) continue;
    items.push({ id: cells[0].toUpperCase(), decision: cells[1], recommendation: cells[2] || '', alternative: cells[3] || '' });
  }
  return items;
}

// The same rows as short strings, for the tracker and the Fleet card.
function decisionRows(md, max) {
  return decisionItems(md).slice(0, max || 5).map((d) => {
    const text = [d.id, d.decision, d.recommendation].filter(Boolean).join(' \u2014 ');
    return text.length > 300 ? text.slice(0, 299) + '\u2026' : text;
  });
}

// Every decision the packet asked for must be answered in the approval notes, by id. A live
// G4 approval answered one of two decisions; the retro found the same slip in the change
// before it. --accept-all records "recommendation accepted" for each, for the common case.
function requireDecisionsAnswered(packetMd, notes, acceptAll) {
  const items = decisionItems(packetMd);
  if (items.length === 0) return notes;
  if (acceptAll) {
    const prefix = items.map((d) => `${d.id}: recommendation accepted`).join('; ');
    return notes ? `${prefix}. ${notes}` : prefix;
  }
  const missing = items.filter((d) => !new RegExp(`\\b${d.id}\\b`, 'i').test(notes));
  if (missing.length) {
    die(`the packet asks for ${items.length} decision(s) and the notes do not answer ${missing.map((d) => d.id).join(', ')}. ` +
      `Name each one in the notes (for example "D1: recommendation accepted; D2: alternative, because ..."), or pass --accept-all to accept every recommendation.\n` +
      missing.map((d) => `  ${d.id}: ${d.decision} (recommendation: ${d.recommendation || 'none given'})`).join('\n'));
  }
  return notes;
}

function lastApproval(root, id) {
  const md = readArtifact(root, id, 'approvals.md');
  if (!md) return null;
  // Split rather than match: a lazy regex with an `m`-flag `$` stops at the first line break.
  const blocks = md.split(/^## /m).slice(1);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const head = b.match(/^(G\d): (approved|rejected)/);
    if (!head) continue;
    const field = (n) => ((b.match(new RegExp('^- ' + n + ': (.*)$', 'm')) || [])[1] || '').trim();
    return { gate: head[1], status: head[2], who: field('Who'), at: field('When'), notes: field('Notes') };
  }
  return null;
}

function buildDigest(root, id, state) {
  const profile = (() => { try { return L.loadProfile(root); } catch (e) { return {}; } })();
  const tier = L.effectiveTier(state);
  const required = L.requiredGates(state, profile);
  const gates = state.gates || {};
  const phase = state.phase;

  const gateHere = PHASE_GATE[phase];
  const artifactHere = PHASE_ARTIFACT[phase];
  const packetMd = artifactHere ? readArtifact(root, id, artifactHere) : '';
  // The packet is live once its closing "## Your decision" section exists: the agent writes that
  // last, so a half-written brief never shows as waiting on the human.
  const packetExists = artifactHere ? L.packetComplete(packetMd) : false;
  // Only a pending gate waits on the human. A rejected one waits on the agents reworking it; the
  // conductor sets it back to pending when it presents the gate again. Treating "rejected" as
  // waiting (the old `!== 'approved'`) showed Approve buttons and would have suppressed the
  // re-presentation notification, because the gate never appeared to change.
  // The Ship document also has to be free of blockers (green verification, no unresolved
  // high or medium finding); until then it is the agents' problem, not the human's.
  const shipBlockers = gateHere === 'G4' && packetExists ? L.shipBlockers(packetMd, state) : [];
  // ... and the conductor must have presented it (`wh.js present`): a complete brief is not
  // waiting on anyone while the auditor's revision round is still running.
  const humanGate =
    gateHere && required.includes(gateHere) && (gates[gateHere] || 'pending') === 'pending' && packetExists
      && shipBlockers.length === 0 && presentedAfterPacket(root, id, state, gateHere)
      ? gateHere
      : null;

  // Problem and outcome live at the top of the brief now; older changes still have intent.md.
  const intentMd = readArtifact(root, id, 'brief.md') || readArtifact(root, id, 'intent.md');
  const verification = state.verification || {};
  const clock = L.computeClock({
    log: readArtifact(root, id, 'conductor-log.md'), approvals: readArtifact(root, id, 'approvals.md'),
    state, profile, pending_gate: humanGate !== null,
  });

  // owner/repo only when origin is a real git host; a local or odd remote falls back to the folder.
  const remote = L.git(root, ['config', '--get', 'remote.origin.url']);
  const hosted = /^(https?:\/\/|git@|ssh:\/\/)/.test(remote || '');
  const repoName = hosted
    ? remote.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('/')
    : path.basename(root);

  return {
    change_id: id,
    title: state.title || id,
    client: (profile.client && profile.client.name) || '',
    repo: repoName,
    tier,
    tier_reason: state.tier_reason || '',
    phase,
    mode: state.mode || 'normal',
    status_label: phase === 'done' ? 'Done' : phase.charAt(0).toUpperCase() + phase.slice(1),
    waiting_on: humanGate ? 'You (' + humanGate + ')' : (phase === 'done' ? 'Nobody' : 'Agents'),
    blocking_gate: humanGate,
    gates,
    gate_names: L.GATE_NAMES,
    required_human_gates: required,
    ship_blockers: shipBlockers,
    clock,
    verification: verification.status || 'none',
    branch: state.branch || '',
    pr_url: state.pr_url || '',
    commit: L.git(root, ['rev-parse', '--short', 'HEAD']) || '',
    problem: sectionText(intentMd, /^#{1,6}\s*problem\b/i, 600),
    outcome: sectionText(intentMd, /^#{1,6}\s*outcome\b/i, 600),
    tldr: sectionText(packetMd, /^#{1,6}.*(tl;dr|tldr|short version)/i, 900),
    decisions: decisionRows(packetMd, 5),
    decision_items: decisionItems(packetMd),
    last_approval: lastApproval(root, id),
    artifacts: fs.existsSync(L.changeDir(root, id))
      ? fs.readdirSync(L.changeDir(root, id)).filter((f) => f.endsWith('.md')).sort()
      : [],
    artifact_dir: 'docs/sdlc/' + id + '/',
    tracker: {
      provider: (profile.tracker && profile.tracker.provider) || '',
      database: (profile.tracker && profile.tracker.database) || '',
      page_id: (state.tracker && state.tracker.page_id) || null,
    },
    updated_at: state.updated_at || L.nowIso(),
  };
}
