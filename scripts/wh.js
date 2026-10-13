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
//   wh.js verify [--only a,b] [--install] [--final] [--timeout MIN]
//                                           run the profile's checks, write verify-logs/ and the Checks
//                                           table of verification.md; exit 1 when a check failed
//   wh.js review-fix start|check|reopen     count and scope the review fix loop: `start` before each
//                                           fixer (exit 3 once two rounds are used), `check` after it
//                                           (exit 2 when a fix commit changed source with no test;
//                                           prints the diff the re-check reads), `reopen` to send the
//                                           same round back to the fixer for the missing tests
//   wh.js fold --tasks 1,2 [--wave N]       fold task branches into the change branch in order, remove
//                                           their worktrees and branches; exit 2 on a conflict
//   wh.js lock acquire|release|status       one conductor per repository (stale after 30 idle minutes)
//   wh.js blocked "<reason>"                log a block, notify the desktop, release the lock
//   wh.js notify "<title>" "<body>"         desktop notification, best effort
//   wh.js clock --by-agent                  minutes per agent, from the conductor log
//   wh.js github-sync                       record a /approve or /reject left on the gate's pull request
//   wh.js checks [--wait MIN]               the change's pull request CI: green, red, pending or none
//                                           (exit 1 on red, 2 while still pending after the wait)
//   wh.js ship-merge [--if-pending]         after Ship (G4) is approved: commit and push the records,
//                                           then merge the pull request once CI is green (0.5.1)
//   wh.js trace [--repo <path>[#<ref>]] [--change <id> | --all] [--dry-run] [--project <name>]
//                                           send a change (default: the active one) to LangSmith as one
//                                           trace, from its conductor log; needs LANGSMITH_API_KEY (0.5.2)
//   wh.js cost [add <usd>] [--log <path>]                  the active change's cost at list price, as headless runs report it
//   wh.js ledger [--repo <path>[#<ref>]]... [--out <dir>] [--json]
//                                           every change in every repository, its clock recomputed from
//                                           the committed record (see scripts/wh-ledger.js)
//   wh.js plugin-root                       print the plugin root path
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const L = require(path.join(__dirname, '..', 'hooks', 'scripts', 'lib.js'));
const R = require(path.join(__dirname, 'wh-run.js'));
const G = require(path.join(__dirname, 'wh-github.js'));

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

  case 'checks': {
    const root = requireRoot();
    const { state } = requireActive(root);
    const wait = Number(flag('--wait') || 0);
    const number = state.github && state.github.pr_number;
    if (!number) { out({ state: 'none', why: 'no pull request recorded for this change' }); break; }
    const until = Date.now() + Math.max(0, wait) * 60000;
    let c = G.prChecks(root, number);
    while ((c.state === 'pending' || c.state === 'unknown') && Date.now() < until) {
      spawnSyncSleep(30);
      c = G.prChecks(root, number);
    }
    out({ pr: number, ...c });
    if (c.state === 'red') process.exit(1);
    if (c.state === 'pending' || c.state === 'unknown') process.exit(2);
    break;
  }

  case 'ship-merge': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    if (hasFlag('--if-pending') && !state.merge_pending) { out({ action: 'none', why: 'no merge is waiting' }); break; }
    out(shipMerge(root, id, state));
    break;
  }

  case 'trace': {
    const T = require(path.join(__dirname, 'wh-trace.js'));
    const LG = require(path.join(__dirname, 'wh-ledger.js'));
    const dry = hasFlag('--dry-run');
    const all = hasFlag('--all');
    const project = flag('--project') || process.env.WORKHORSE_LANGSMITH_PROJECT || 'workhorse';
    const repoSpec = flag('--repo');
    let changeId = flag('--change');
    const spec = LG.parseRepoSpec(typeof repoSpec === 'string' ? repoSpec : (L.findRoot(process.cwd()) || process.cwd()));
    const changes = LG.readChanges(spec.path, spec.ref);
    const releases = LG.parseReleases(LG.pluginChangelog());
    let streams = [];
    if (!all && !changeId) {
      const root = requireRoot();
      const { id, state } = requireActive(root);
      changeId = id;
      // The working tree is the record while a change is open; the launcher's stream logs add usage.
      const read = (n) => readArtifact(root, id, n);
      changes[id] = { 'conductor-log.md': read('conductor-log.md'), 'approvals.md': read('approvals.md'), 'brief.md': read('brief.md'), 'metrics.json': read('metrics.json') };
      streams = (state.run_logs || []).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8'));
    }
    const ids = all ? Object.keys(changes).sort() : [changeId];
    const traces = [];
    const skipped = [];
    for (const id of ids) {
      const files = changes[id];
      if (!files || !files['conductor-log.md']) { if (!all) die(`no conductor log for ${id}`); continue; }
      const row = LG.runRow(L, spec.name, id, files, releases, LG.pluginOverrides()[`${spec.name}/${id}`] || null);
      let metrics = null;
      try { metrics = files['metrics.json'] ? JSON.parse(files['metrics.json']) : null; } catch (e) { metrics = null; }
      const runs = T.buildTrace(L, { id, repo: spec.name, title: id.slice(11).replace(/-+$/, '').replace(/-/g, ' '), tier: row.tier, version: row.version, metrics, log: files['conductor-log.md'], approvals: files['approvals.md'], streams });
      if (runs.length) traces.push({ id, runs });
      else skipped.push({ change_id: id, why: 'longer than LangSmith\'s 24-hour window, or fewer than two log rows' });
    }
    if (dry) { out({ traces: traces.map((t) => ({ change_id: t.id, runs: t.runs.length, root: t.runs[0].name, outputs: t.runs[0].outputs })), skipped }); break; }
    const apiKey = process.env.LANGSMITH_API_KEY;
    if (!apiKey) die('LANGSMITH_API_KEY is not set; tracing is off. --dry-run shows what would be sent.', 2);
    (async () => {
      const results = [];
      for (const t of traces) {
        const r = await T.upload(t.runs, { apiKey, project, endpoint: process.env.LANGSMITH_ENDPOINT });
        results.push({ change_id: t.id, runs: t.runs.length, ...r });
      }
      out({ project, results, skipped });
      if (results.some((r) => !r.ok)) process.exitCode = 1;
    })();
    break;
  }

  case 'cost': {
    // The launcher adds each headless run's reported cost to the active change, so the change's
    // metrics.json can say what it cost. `cost add <usd>`; `cost` alone prints the running total.
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const logPath = flag('--log');
    if (args[0] === 'add') {
      const usd = Number(args[1]);
      if (!Number.isFinite(usd) || usd < 0) die('usage: wh.js cost add <usd>');
      state.cost_usd = Math.round(((typeof state.cost_usd === 'number' ? state.cost_usd : 0) + usd) * 10000) / 10000;
      state.launcher_runs = (Number.isInteger(state.launcher_runs) ? state.launcher_runs : 0) + 1;
      // The stream log is what `wh.js trace` reads for tokens by agent.
      if (typeof logPath === 'string') state.run_logs = (state.run_logs || []).concat([path.resolve(logPath)]);
      L.saveState(root, id, state);
    }
    out({ change_id: id, cost_usd: typeof state.cost_usd === 'number' ? state.cost_usd : null, launcher_runs: state.launcher_runs || 0 });
    break;
  }

  case 'ledger': {
    const LG = require(path.join(__dirname, 'wh-ledger.js'));
    const json = hasFlag('--json');
    const outDir = flag('--out');
    const specs = [];
    for (let v = flag('--repo'); v; v = flag('--repo')) specs.push(LG.parseRepoSpec(String(v)));
    if (!specs.length) {
      let known = [];
      try { known = require(path.join(__dirname, 'workhorse.js')).loadRepos(); } catch (e) { known = []; }
      const here = L.findRoot(process.cwd());
      for (const p of (here ? [here] : []).concat(known)) {
        if (!specs.some((s) => s.path === path.resolve(p))) specs.push(LG.parseRepoSpec(p));
      }
    }
    if (!specs.length) die('no repositories: pass --repo <path>, or run inside a WorkHorse repository');
    const ledger = LG.build(L, specs, LG.pluginChangelog(), LG.pluginOverrides());
    const md = LG.renderMarkdown(ledger.runs, ledger.summary, today());
    if (outDir) {
      const dir = path.resolve(outDir);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'runs.json'), JSON.stringify({ generated: today(), ...ledger }, null, 2) + '\n');
      fs.writeFileSync(path.join(dir, 'RUNS.md'), md);
      out({ runs: ledger.runs.length, wrote: [path.join(dir, 'runs.json'), path.join(dir, 'RUNS.md')] });
      break;
    }
    out(json ? ledger : md);
    break;
  }

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
      // metrics.json is the machine-readable close of the change: what the run ledger
      // (wh.js ledger) reads for the version it ran on and its cost, which the logs do not hold.
      writeMetrics(root, id, state);
      if (fs.existsSync(path.join(root, '.workhorse', 'instincts'))) paths.push('.workhorse/instincts');
      L.git(root, ['add', '--', ...paths]);
      // Exits non-zero when nothing is staged; then there is nothing left to record.
      L.git(root, ['commit', '-q', '-m', `chore(sdlc): close ${id}`, '--', ...paths]);
      committed = L.git(root, ['log', '-1', '--format=%h', '--', ...paths]) || null;
      R.lockRelease(L, root);
      // 0.5.2: the closed change goes to LangSmith as one trace, in the background, so closing
      // never waits on the network. Off unless LANGSMITH_API_KEY is set.
      if (process.env.LANGSMITH_API_KEY && !process.env.WORKHORSE_NO_TRACE) {
        try {
          const child = require('child_process').spawn(process.execPath, [__filename, 'trace'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
          child.unref();
        } catch (e) { /* tracing is best effort */ }
      }
      R.notify(`WorkHorse: ${state.title || id} is done`, 'The change closed; the retro runs in the background.');
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
    // Who decided and where, when it was not this terminal: `github:<login>` and the comment or
    // review URL. The audit record names the real approver and links to the decision itself.
    const by = flag('--by');
    const source = flag('--source');
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
    const who = (typeof by === 'string' && by) || L.git(root, ['config', 'user.email']) || process.env.USER || process.env.USERNAME || 'unknown';

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
      ...(typeof source === 'string' && source ? [`- Source: ${source}`] : []),
      '',
    ].join('\n');
    const af = path.join(L.changeDir(root, id), 'approvals.md');
    if (!fs.existsSync(af)) fs.writeFileSync(af, render(fs.readFileSync(path.join(TEMPLATES, 'approvals.md'), 'utf8'), stateVars(root, id, state)));
    fs.appendFileSync(af, block);
    state.gates = state.gates || {};
    state.gates[g] = status;
    if (reject) {
      state.last_rejection = { gate: g, notes, at };
      // A person sent it back: their notes get fix rounds of their own, whatever the reviewers used.
      if (state.review_fix && state.review_fix.rounds && state.review_fix.rounds.length) {
        state.review_fix = { rounds: [], before_rejection: (state.review_fix.before_rejection || 0) + state.review_fix.rounds.length };
      }
    }
    L.saveState(root, id, state);
    // Commit the approval so the audit trail is in git history.
    // state.json is machine state kept outside git; approvals.md is the audit record.
    L.git(root, ['add', '--', path.relative(root, af)]);
    const sha = L.git(root, ['commit', '-q', '-m', `chore(sdlc): ${g} ${status} for ${id}`, '--', path.relative(root, af)]);
    // 0.5.1: approving Ship is the owner saying "merge it". The merge used to wait for the owner
    // too (8 h 36 m on one Portfolio run), because the harness refuses an agent's merge.
    const merge = g === 'G4' && !reject ? shipMerge(root, id, state) : undefined;
    out({ gate: g, status, who, at, committed: sha !== '' || L.git(root, ['log', '-1', '--format=%h']), ...(merge ? { merge } : {}) });
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
    R.lockTouch(L, root); // every row proves the run is alive; the lock goes stale without them
    out(appendLog(root, id, state, msg));
    break;
  }

  case 'blocked': {
    // A blocked run used to sit silently until someone looked (2 hours on the studbook run).
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const reason = args.join(' ').replace(/\s+/g, ' ').trim();
    if (!reason) die('usage: wh.js blocked "<what is needed, from whom>"');
    const line = appendLog(root, id, state, `conductor | blocked: ${reason}`);
    R.lockRelease(L, root);
    R.notify(`WorkHorse: ${state.title || id} is blocked`, reason);
    out(line);
    break;
  }

  case 'notify': {
    const [title, body] = args;
    if (!title) die('usage: wh.js notify "<title>" "<body>"');
    out({ sent: R.notify(title, body || '') });
    break;
  }

  case 'lock': {
    const root = requireRoot();
    const sub = args.shift();
    if (sub === 'acquire') {
      const r = R.lockAcquire(L, root, flag('--holder') || 'conductor', hasFlag('--force'));
      if (!r.ok) die(`a run already holds the lock (${r.held_by}, since ${r.since}, last activity ${r.last_activity_minutes_ago} min ago). Stop it or wait; pass --force only if you are sure it is dead.`, 3);
      out(r);
    } else if (sub === 'release') out(R.lockRelease(L, root));
    else if (sub === 'status') out(R.readLock(L, root) || { held: false });
    else die('usage: wh.js lock acquire [--holder name] [--force] | release | status');
    break;
  }

  case 'verify': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const opts = {
      only: flag('--only'), install: hasFlag('--install'), final: hasFlag('--final'),
      timeoutMinutes: Number(flag('--timeout') || 10),
      template: fs.readFileSync(path.join(TEMPLATES, 'verification.md'), 'utf8'),
    };
    const summary = R.verify(L, root, id, state, opts);
    if (opts.final && summary.checks_green) {
      setPath(state, 'verification.status', 'green');
      setPath(state, 'verification.at', L.nowIso());
      L.saveState(root, id, state);
    } else if (!summary.checks_green) {
      setPath(state, 'verification.status', 'red');
      L.saveState(root, id, state);
    }
    appendLog(root, id, state, `wh.js verify | ${summary.checks_green ? 'checks green' : `red: ${summary.failed.join(', ')}`} at ${summary.commit.slice(0, 7)} (${summary.defined} defined${opts.only ? `, only ${opts.only}` : ''})`);
    out({
      checks_green: summary.checks_green, commit: summary.commit.slice(0, 12), failed: summary.failed,
      checks: summary.checks.map((c) => ({ check: c.check, status: c.status, exit: c.exit, seconds: c.seconds, log: c.log, first_error: c.first_error || undefined })),
      verification_status: (state.verification || {}).status || 'none',
    });
    if (!summary.checks_green) process.exit(1);
    break;
  }

  case 'fold': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const wave = flag('--wave');
    const tasks = (flag('--tasks') || '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
    if (!tasks.length) die('usage: wh.js fold --tasks 1,2 [--wave N]');
    const profile = L.loadProfile(root);
    const strategy = (profile.build && profile.build.wave_merge) === 'merge' ? 'merge' : 'rebase';
    let r;
    try { r = R.fold(L, root, id, state, tasks, strategy); } catch (e) { die(e.message); }
    if (!r.ok) {
      appendLog(root, id, state, `conductor | fold conflict on task ${r.task} (${r.branch}): ${r.conflict_files.join(', ') || 'see git'}; aborted, branch left for a builder to resolve`);
      out(r);
      process.exit(2);
    }
    state.build = state.build || {};
    const done = new Set([...(state.build.tasks_done || []), ...r.folded.filter((f) => f.status !== 'no branch').map((f) => f.task)]);
    state.build.tasks_done = [...done].sort((a, b) => a - b);
    if (wave) state.build.wave = Number(wave);
    L.saveState(root, id, state);
    appendLog(root, id, state, `conductor | wave ${wave || '?'} folded by ${strategy}: ${r.folded.map((f) => `T${f.task} ${f.status}${f.commits ? ` (${f.commits})` : ''}`).join(', ')}; head ${r.head}; worktrees and task branches removed`);
    out(r);
    break;
  }

  case 'review-fix': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const sub = args.shift();
    if (sub === 'start') {
      const r = R.reviewFixStart(L, root, state);
      if (!r.ok) {
        appendLog(root, id, state, `conductor | fix round refused: ${R.MAX_FIX_ROUNDS} used; open findings go to the Ship document`);
        out(r);
        process.exit(3);
      }
      L.saveState(root, id, state);
      if (!r.resumed) appendLog(root, id, state, `conductor | fix round ${r.round} of ${R.MAX_FIX_ROUNDS} opened at ${r.base.slice(0, 7)}`);
      out(r);
    } else if (sub === 'check') {
      const r = R.reviewFixCheck(L, root, state, L.loadProfile(root));
      if (!r.ok) die(r.reason);
      L.saveState(root, id, state);
      appendLog(root, id, state, `conductor | fix round ${r.round}: ${r.commits.length} commit(s) ${r.base}..${r.head}, ${r.untested.length} without a test; re-check reads ${r.recheck.files.length} file(s)`);
      out(r);
      if (r.untested.length) process.exit(2);
    } else if (sub === 'reopen') {
      const rounds = (state.review_fix && state.review_fix.rounds) || [];
      if (!rounds.length) die('no fix round to reopen');
      delete rounds[rounds.length - 1].head;
      L.saveState(root, id, state);
      out({ ok: true, round: rounds.length, base: rounds[rounds.length - 1].base });
    } else die('usage: wh.js review-fix start | check | reopen');
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
    // 0.4.0: the gate document goes to the pull request, so it can be read and answered from any
    // device. Best effort: without GitHub the terminal path below is unchanged.
    const summary = sectionText(packet, /^#{1,6}.*(short version|tl;dr)/i, 900);
    const hub = G.presentOnGitHub(L, root, id, state, g, {
      tier: L.effectiveTier(state), summary, decisions: decisionItems(packet),
      packetPath: `docs/sdlc/${id}/${GATE_PACKET[g]}`, clock: L.formatClock(clockFor(root, id, state)),
    });
    if (hub.url) {
      state.github = state.github || {};
      state.github.pr_number = hub.number;
      state.github.presented_head = { ...(state.github.presented_head || {}), [g]: hub.head };
      state.pr_url = state.pr_url || hub.url;
      L.saveState(root, id, state);
      appendLog(root, id, state, `conductor | ${g} ${L.GATE_NAMES[g]} posted to ${hub.url}`);
    }
    // The run stops here for the human: free the lock and say so on the desktop (and the phone).
    R.lockRelease(L, root);
    R.notify(`WorkHorse: ${L.GATE_NAMES[g]} is waiting on you`, `${state.title || id}${hub.url ? ` - reply /approve on ${hub.url}` : ': workhorse approve'}`, hub.url);
    out([
      `${L.GATE_NAMES[g]} (${g}) is waiting on you. Tier ${L.effectiveTier(state)}. Packet: docs/sdlc/${id}/${GATE_PACKET[g]}`,
      summary,
      ...decisionRows(packet, 20).map((d) => `  ${d}`),
      L.formatClock(clockFor(root, id, state)),
      hub.url ? `On GitHub: ${hub.url} (reply /approve or /reject <notes>)` : `GitHub: ${hub.skipped}`,
      `Terminal: workhorse approve    workhorse reject "<what to change>"`,
    ].join('\n'));
    break;
  }

  case 'github-sync': {
    // Record a decision made on GitHub for the gate that is waiting. Run by `workhorse resume`
    // and `workhorse watch` before a conductor starts, never by an agent.
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const profile = L.loadProfile(root);
    const waiting = ['G2', 'G4', 'G5'].find((g) => L.requiredGates(state, profile).includes(g)
      && (state.gates || {})[g] === 'pending' && presentedAfterPacket(root, id, state, g));
    if (!waiting) { out({ recorded: false, reason: 'no gate is waiting on a decision' }); break; }
    const number = state.github && state.github.pr_number;
    if (!number) { out({ recorded: false, gate: waiting, reason: 'the gate was not posted to GitHub' }); break; }
    const conv = G.fetchConversation(root, number);
    const d = G.readDecision({
      ...conv, presentedAt: state.presented[waiting],
      presentedHead: state.github.presented_head && state.github.presented_head[waiting],
      approvers: G.approvers(root, profile),
    });
    if (!d) { out({ recorded: false, gate: waiting, pr: number, reason: 'no /approve or /reject from an approver yet' }); break; }
    const a = [path.join(__dirname, 'wh.js'), 'approve', waiting, '--by', `github:${d.by}`, '--source', d.url];
    if (d.decision === 'reject') a.push('--reject', d.notes);
    else { a.push('--accept-all'); if (d.notes) a.push(d.notes); }
    const r = require('child_process').spawnSync(process.execPath, a, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) {
      G.postComment(root, number, `Could not record that decision: ${(r.stderr || '').replace(/^wh: /, '').trim().slice(0, 600)}`);
      die(`could not record the GitHub decision: ${(r.stderr || '').trim()}`);
    }
    G.postComment(root, number, `Recorded: **${L.GATE_NAMES[waiting]} ${d.decision === 'reject' ? 'rejected' : 'approved'}** by @${d.by}. ${d.decision === 'reject' ? 'The agents will rework it and present it again.' : 'The run continues.'}`);
    out({ recorded: true, gate: waiting, decision: d.decision, by: d.by, source: d.url });
    break;
  }

  case 'clock': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const c = clockFor(root, id, state);
    if (hasFlag('--by-agent')) {
      const rows = R.minutesByAgent(L, readArtifact(root, id, 'conductor-log.md'));
      out(hasFlag('--json') ? { clock: c, by_agent: rows } : `${L.formatClock(c)}\n${R.formatByAgent(rows)}`);
      break;
    }
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

/** Block for a number of seconds without a busy loop (the CLI is synchronous). */
function spawnSyncSleep(seconds) {
  require('child_process').spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${Math.round(seconds * 1000)})`]);
}

/**
 * After a Ship approval: commit and push the change's records so the merge carries them, then
 * merge the pull request if CI is green, wait (state.merge_pending, picked up by the watcher)
 * while it runs, or refuse over a red check. Best effort: no GitHub leaves the shipper's path.
 */
function shipMerge(root, id, state) {
  const profile = (() => { try { return L.loadProfile(root); } catch (e) { return {}; } })();
  const cfg = profile.github || {};
  if ((state.gates || {}).G4 !== 'approved') return { action: 'none', why: 'Ship (G4) is not approved' };
  if (cfg.merge === false) return { action: 'none', why: 'github.merge is off in the profile; the shipper merges' };
  if (!G.enabled(L, root, profile)) return { action: 'none', why: 'GitHub approvals are off or origin is not on GitHub' };
  const number = state.github && state.github.pr_number;
  if (!number) return { action: 'none', why: 'no pull request recorded for this change' };
  const branch = state.branch || L.git(root, ['branch', '--show-current']);
  const dirRel = path.relative(root, L.changeDir(root, id)).split(path.sep).join('/');
  L.git(root, ['add', '--', dirRel]);
  L.git(root, ['commit', '-q', '-m', `chore(sdlc): records for ${id} before merge`, '--', dirRel]);
  if (branch) require('child_process').spawnSync('git', ['push', '-q', 'origin', branch], { cwd: root, encoding: 'utf8', timeout: 120000 });
  const view = G.gh(root, ['pr', 'view', String(number), '--json', 'state,headRefOid,url']);
  let pr = {};
  try { pr = JSON.parse(view.out); } catch (e) { pr = {}; }
  const checks = pr.state === 'OPEN' ? G.prChecks(root, number) : null;
  const d = G.mergeDecision({ prState: pr.state, checks });
  const url = pr.url || `#${number}`;
  const was = Boolean(state.merge_pending);
  let result = { action: d.action, why: d.why, pr: url };
  if (d.action === 'merge') {
    const m = G.mergePr(root, number, cfg.merge_method, pr.headRefOid);
    if (m.ok) {
      state.merge_pending = false;
      state.merged_at = L.nowIso();
      appendLog(root, id, state, `conductor | merged ${url} after the Ship approval: ${d.why}`);
      result = { action: 'merged', why: d.why, pr: url };
    } else {
      state.merge_pending = true;
      const why = (m.err || 'merge refused').split('\n').pop();
      if (!was) appendLog(root, id, state, `conductor | merge of ${url} not done yet: ${why}; the watcher retries`);
      result = { action: 'wait', why, pr: url };
    }
  } else if (d.action === 'wait') {
    state.merge_pending = true;
    if (!was) appendLog(root, id, state, `conductor | merge of ${url} waits: ${d.why}; WorkHorse merges it when green`);
  } else if (d.action === 'merged') {
    state.merge_pending = false;
  } else {
    state.merge_pending = false;
    appendLog(root, id, state, `conductor | blocked: not merging ${url}: ${d.why}`);
  }
  L.saveState(root, id, state);
  return result;
}

/** The plugin version this CLI belongs to, from .claude-plugin/plugin.json. */
function pluginVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version || null; } catch (e) { return null; }
}

/** Write docs/sdlc/<id>/metrics.json: the clock, the gate decisions, the plugin version and the
 *  run's cost at list price as the launcher recorded it (null when no launcher run reported one). */
function writeMetrics(root, id, state) {
  const c = clockFor(root, id, state);
  const heads = readArtifact(root, id, 'approvals.md').match(/^## G\d: (approved|rejected)/gm) || [];
  const metrics = {
    schema: 1, change_id: id, title: state.title || id, tier: L.effectiveTier(state),
    plugin_version: pluginVersion(), closed_at: L.nowIso(),
    agent_minutes: c.agent_minutes, waiting_minutes: c.waiting_minutes, dead_minutes: c.dead_minutes,
    unexplained_minutes: c.gap_minutes, wall_minutes: c.wall_minutes,
    budget_minutes: c.budget_minutes, within_budget: c.within_budget,
    gate_decisions: heads.length, rejections: heads.filter((h) => h.endsWith('rejected')).length,
    cost_usd: typeof state.cost_usd === 'number' ? Math.round(state.cost_usd * 100) / 100 : null,
    launcher_runs: Number.isInteger(state.launcher_runs) ? state.launcher_runs : 0,
  };
  fs.writeFileSync(path.join(L.changeDir(root, id), 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  return metrics;
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
    // Accept every recommendation the notes do not decide themselves: "/approve D2: the
    // alternative" accepts the rest and records the override for D2, not a contradiction.
    const named = (d) => new RegExp(`\\b${d.id}\\b`, 'i').test(notes || '');
    const prefix = items.filter((d) => !named(d)).map((d) => `${d.id}: recommendation accepted`).join('; ');
    return [prefix, notes].filter(Boolean).join('. ');
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

  // The age counts from the present stamp, the moment the human could first act (ADR 0001).
  // humanGate is non-null only when presentedAfterPacket parsed that stamp, so it is set here.
  const presentedAt = humanGate ? state.presented[humanGate] : null;
  const waitingSince = presentedAt && Number.isFinite(Date.parse(presentedAt)) ? presentedAt : null;
  const waitingMinutes = waitingSince ? Math.max(0, Math.floor((Date.now() - Date.parse(waitingSince)) / 60000)) : null;

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
    gate_waiting_since: waitingSince,
    gate_waiting_minutes: waitingMinutes,
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
