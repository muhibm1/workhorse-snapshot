#!/usr/bin/env node
// workhorse: the one command a person types. Everything else (wh.js) is the agents' internal CLI.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../hooks/scripts/lib.js');
const { spawn, spawnSync } = require('child_process');

const HERE = __dirname;
const WH = path.join(HERE, 'wh.js');
const LAUNCH = path.join(HERE, 'wh-launch.js');
const PLUGIN = path.resolve(HERE, '..');
const HOME = path.join(os.homedir(), '.workhorse');
const REPOS = path.join(HOME, 'repos.json');
const GATE_WORDS = { G2: 'Design', G4: 'Ship', G5: 'Deploy' };

const HELP = `workhorse: agents build the change, you decide at two gates.

  workhorse "<problem> -> <outcome>"    start a change in this repository
  workhorse resume                      continue the change (picks up /approve from GitHub first)
  workhorse status                      every change you have running, and what waits on you
  workhorse approve [notes]             approve the gate that is waiting (Design, Ship or Deploy)
  workhorse reject "<what to change>"   send it back to the agents with your notes
  workhorse watch                       resume runs: after /approve on GitHub, after a stall, after a
                                        merge (starts by itself with the harness; --at-login, --stop)
  workhorse log                         follow the current run step by step
  workhorse doctor                      check that this machine and repository are ready
  workhorse ledger [--out <dir>]        every run in every repository you have used, measured the
                                        same way from the committed record (agent time, waiting, cost)

On your phone: open the pull request the gate posted and reply /approve, /approve D2: <choice>,
or /reject <what to change>. The background watcher picks it up within a minute.`;

// ---------- small helpers ----------

function wh(repo, args) {
  return spawnSync(process.execPath, [WH, ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });
}
function whJson(repo, args) {
  const r = wh(repo, args);
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}
function findRepo(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.workhorse', 'profile.yml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
function say(s) { process.stdout.write(s + '\n'); }
function fail(s, code) { process.stderr.write(`workhorse: ${s}\n`); process.exit(code || 1); }

function loadRepos() {
  try { return JSON.parse(fs.readFileSync(REPOS, 'utf8')).filter((p) => fs.existsSync(path.join(p, '.workhorse', 'profile.yml'))); } catch (e) { return []; }
}
function remember(repo) {
  const list = loadRepos();
  if (!list.some((p) => path.resolve(p) === path.resolve(repo))) {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(REPOS, JSON.stringify(list.concat([repo]), null, 2) + '\n');
  }
}
function hereOrDie() {
  const repo = findRepo(process.cwd());
  if (!repo) fail('no .workhorse/profile.yml here or above. In the harness, run /workhorse:onboard in this repository first.', 2);
  remember(repo);
  return repo;
}

/** The gate waiting on a person in `repo`, from the digest: G2, G4, G5 or null. */
function waitingGate(repo) {
  const d = whJson(repo, ['digest', '--json']);
  return d && d.blocking_gate ? { gate: d.blocking_gate, digest: d } : { gate: null, digest: d };
}

// ---------- commands ----------

function run(argv) {
  const repo = hereOrDie();
  const child = spawnSync(process.execPath, [LAUNCH, ...argv], { cwd: repo, stdio: 'inherit' });
  process.exit(child.status === null ? 1 : child.status);
}

function resume(argv) {
  const repo = hereOrDie();
  const sync = whJson(repo, ['github-sync']);
  if (sync && sync.recorded) say(`GitHub: ${GATE_WORDS[sync.gate]} ${sync.decision === 'reject' ? 'rejected' : 'approved'} by @${sync.by}; recorded.`);
  const { gate } = waitingGate(repo);
  if (gate) {
    say(`${GATE_WORDS[gate]} is still waiting on you. Approve it first: workhorse approve (or /approve on the pull request).`);
    process.exit(0);
  }
  run(['--resume', ...argv]);
}

function decide(kind, argv) {
  const repo = hereOrDie();
  const { gate, digest } = waitingGate(repo);
  if (!gate) fail(digest && digest.change_id ? `nothing is waiting on you in ${digest.change_id} (phase ${digest.phase}, waiting on ${digest.waiting_on}).` : 'no active change here.', 2);
  const notes = argv.join(' ').trim();
  if (kind === 'reject' && !notes) fail('say what to change: workhorse reject "<what to change>"', 2);
  const args = ['approve', gate];
  if (kind === 'reject') args.push('--reject', notes);
  else { args.push('--accept-all'); if (notes) args.push(notes); }
  const r = wh(repo, args);
  if (r.status !== 0) fail((r.stderr || '').replace(/^wh: /, '').trim());
  say(`${GATE_WORDS[gate]} ${kind === 'reject' ? 'rejected; the agents will rework it' : 'approved'} (${digest.change_id}).`);
  say('Continuing the run...\n');
  run(['--resume']);
}

function status() {
  const here = findRepo(process.cwd());
  if (here) remember(here);
  const repos = loadRepos();
  if (!repos.length) { say('No repositories yet. Start one with: workhorse "<problem> -> <outcome>"'); return; }
  let shown = 0;
  for (const repo of repos) {
    const all = whJson(repo, ['digest', '--all']) || [];
    const live = all.filter((d) => d.phase !== 'done');
    if (!live.length) continue;
    say(`${path.basename(repo)}  (${repo})`);
    for (const d of live) {
      const waitedFor = typeof d.gate_waiting_minutes === 'number' ? ` for ${L.fmtAge(d.gate_waiting_minutes)}` : '';
      const who = d.blocking_gate ? `${GATE_WORDS[d.blocking_gate]} is waiting on YOU${waitedFor}` : `agents working (${d.phase})`;
      const lock = whJson(repo, ['lock', 'status']);
      const running = lock && lock.holder ? 'running' : (d.blocking_gate ? '' : 'stopped: workhorse resume');
      say(`  ${d.title}`);
      say(`    ${who}${running ? `; ${running}` : ''}`);
      if (d.pr_url) say(`    ${d.pr_url}`);
      if (d.clock && d.clock.events) say(`    agents ${Math.round(d.clock.agent_minutes)} of ${d.clock.budget_minutes} min, tier ${d.tier}`);
      shown++;
    }
  }
  if (!shown) say('Nothing in progress. Start a change with: workhorse "<problem> -> <outcome>"');
  const w = watcherAlive();
  say('');
  say(w ? 'Phone approvals: picked up automatically.' : 'Phone approvals: not watching. Run: workhorse watch --background');
}

function log() {
  const repo = hereOrDie();
  const st = whJson(repo, ['status', '--json']);
  if (!st || !st.change_id) fail('no active change here.', 2);
  const file = path.join(repo, 'docs', 'sdlc', st.change_id, 'conductor-log.md');
  let seen = 0;
  const show = () => {
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^\d{4}-/.test(l));
    for (const l of lines.slice(seen)) say(`${l.slice(11, 19)} ${l.split(' | ').slice(1).join(' | ')}`);
    seen = lines.length;
  };
  say(`${st.title}  (Ctrl+C to stop following)`);
  show();
  setInterval(show, 3000);
}

// ---------- the background watcher ----------
//
// One watcher per machine, started without anyone thinking about it: the plugin's SessionStart
// hook calls ensureWatcher() in every harness session, and `workhorse watch --at-login` adds
// a Startup entry that does the same at Windows sign-in. It spends no tokens: each tick is a local
// digest per repository, plus one `gh api` read while a gate is waiting. Claude runs only when a
// decision was recorded and the run resumes. watch.json is its pid file and heartbeat; a file
// older than three ticks belongs to a dead watcher, whatever process now has that pid.

const WATCH_FILE = path.join(HOME, 'watch.json');
const WATCH_LOG = path.join(HOME, 'watch.log');
const WATCH_STATE = path.join(HOME, 'watch-state.json');

// A run that nobody is driving (0.4.2). Seen live: a Design approval recorded in a terminal sat
// for two days because nothing resumed the run; a headless design run died and cost 90 minutes;
// a shipper whose merge the harness refused left the run blocked until someone looked. The
// watcher now resumes a run that has no gate waiting, no lock holder and no new log line for
// STALL_MINUTES, at most MAX_AUTO_RESUMES times without progress and never more often than
// RESUME_COOLDOWN_MINUTES, so a run that cannot proceed is not restarted forever. A run blocked
// on something a person must do is left alone, except a merge: once the pull request is merged
// the run resumes and closes out.
const STALL_MINUTES = 10;
const RESUME_COOLDOWN_MINUTES = 30;
const MAX_AUTO_RESUMES = 3;

function lastLogLine(repo, id) {
  try {
    const lines = fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'conductor-log.md'), 'utf8').split(/\r?\n/).filter((l) => /^\d{4}-\d{2}-\d{2}T\S+ \| /.test(l));
    if (!lines.length) return null;
    const last = lines[lines.length - 1];
    return { at: Date.parse(last.split(' | ')[0]), text: last };
  } catch (e) { return null; }
}

function prState(repo, prUrl) {
  if (!prUrl) return null;
  const r = spawnSync('gh', ['pr', 'view', prUrl, '--json', 'state', '--jq', '.state'], { cwd: repo, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Pure: should the watcher resume this run now, and why or why not. `prior` is what the
 *  watcher remembers about earlier automatic resumes of this change. */
function stallDecision({ digest, lockHeld, lastLog, prMerged, now, prior }) {
  if (!digest || !digest.change_id || digest.phase === 'done') return { resume: false, why: 'nothing in progress' };
  if (digest.blocking_gate) return { resume: false, why: 'a gate is waiting on a person' };
  if (lockHeld) return { resume: false, why: 'a run holds the lock' };
  if (!lastLog) return { resume: false, why: 'no conductor log yet' };
  const idle = (now - lastLog.at) / 60000;
  if (idle < STALL_MINUTES) return { resume: false, why: `active ${Math.round(idle)} min ago` };
  const blocked = /\| blocked:/.test(lastLog.text);
  if (blocked && !(prMerged && /\b(merge|merged|pull request|PR)\b/i.test(lastLog.text))) return { resume: false, why: 'blocked on something a person must do' };
  const p = prior || {};
  const progressed = p.last_log !== lastLog.text;
  const attempts = progressed ? 0 : (p.attempts || 0);
  if (attempts >= MAX_AUTO_RESUMES) return { resume: false, why: `resumed ${attempts} times with no progress; needs a look` };
  if (p.last_at && (now - Date.parse(p.last_at)) / 60000 < RESUME_COOLDOWN_MINUTES) return { resume: false, why: 'resumed recently' };
  return { resume: true, why: blocked ? 'the pull request is merged' : `no activity for ${Math.round(idle)} min and no gate waiting`, attempts: attempts + 1 };
}

function loadWatchState() { try { return JSON.parse(fs.readFileSync(WATCH_STATE, 'utf8')); } catch (e) { return {}; } }
function saveWatchState(s) { try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(WATCH_STATE, JSON.stringify(s, null, 2) + '\n'); } catch (e) { /* best effort */ } }
const STARTUP = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'workhorse-watch.vbs')
  : null;

/** The live watcher's { pid, every, started }, or null. */
function watcherAlive() {
  let w;
  try { w = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')); } catch (e) { return null; }
  try {
    if (Date.now() - fs.statSync(WATCH_FILE).mtimeMs > 3 * (w.every || 60000) + 30000) return null;
    process.kill(w.pid, 0);
    return w;
  } catch (e) {
    return e.code === 'EPERM' ? w : null;
  }
}

/** Start the background watcher unless one is alive. Never throws; returns what it did. */
function ensureWatcher() {
  try {
    const w = watcherAlive();
    if (w) return { running: true, started: false, pid: w.pid };
    fs.mkdirSync(HOME, { recursive: true });
    try { if (fs.statSync(WATCH_LOG).size > 1e6) fs.truncateSync(WATCH_LOG, 0); } catch (e) { /* no log yet */ }
    const out = fs.openSync(WATCH_LOG, 'a');
    const child = spawn(process.execPath, [__filename, 'watch'], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    return { running: true, started: true, pid: child.pid };
  } catch (e) {
    return { running: false, error: e.message };
  }
}

/** Claim watch.json for this process, or return false if another watcher holds it. */
function claimWatch(every) {
  fs.mkdirSync(HOME, { recursive: true });
  if (fs.existsSync(WATCH_FILE) && !watcherAlive()) fs.rmSync(WATCH_FILE, { force: true });
  try {
    fs.writeFileSync(WATCH_FILE, JSON.stringify({ pid: process.pid, every, started: new Date().toISOString() }), { flag: 'wx' });
  } catch (e) {
    return false;
  }
  const release = () => {
    try { if (JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')).pid === process.pid) fs.rmSync(WATCH_FILE, { force: true }); } catch (e) { /* gone */ }
  };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
  return true;
}

function atLogin(on) {
  if (!STARTUP) fail('starting at sign-in is set up on Windows only for now; run `workhorse watch --background` from your login script.', 2);
  if (!on) { fs.rmSync(STARTUP, { force: true }); say('workhorse watch will no longer start at sign-in.'); return; }
  const q = (s) => s.replace(/"/g, '""');
  fs.mkdirSync(path.dirname(STARTUP), { recursive: true });
  fs.writeFileSync(STARTUP, [
    "' WorkHorse: start `workhorse watch` hidden at sign-in. Remove with: workhorse watch --not-at-login",
    `CreateObject("WScript.Shell").Run """${q(process.execPath)}"" ""${q(__filename)}"" watch --background", 0, False`,
    '',
  ].join('\r\n'));
  say(`workhorse watch will start at sign-in (${STARTUP}).`);
}

function watch(argv) {
  if (argv.includes('--at-login')) return atLogin(true);
  if (argv.includes('--not-at-login')) return atLogin(false);
  if (argv.includes('--stop')) {
    const w = watcherAlive();
    if (!w) { say('No watcher is running.'); return; }
    try { process.kill(w.pid); } catch (e) { /* already gone */ }
    fs.rmSync(WATCH_FILE, { force: true });
    say(`Stopped the watcher (pid ${w.pid}).`);
    return;
  }
  if (argv.includes('--background')) {
    const r = ensureWatcher();
    if (!r.running) fail(`could not start the watcher: ${r.error}`);
    say(r.started ? `Watching in the background (pid ${r.pid}); log: ${WATCH_LOG}` : `Already watching (pid ${r.pid}).`);
    return;
  }
  const every = Math.max(20, Number((argv[argv.indexOf('--every') + 1]) || 60)) * 1000;
  if (!claimWatch(every)) {
    const w = watcherAlive();
    say(`Already watching in the background${w ? ` (pid ${w.pid})` : ''}. Stop it with: workhorse watch --stop`);
    return;
  }
  const beat = () => { try { const t = new Date(); fs.utimesSync(WATCH_FILE, t, t); } catch (e) { /* removed by --stop */ } };
  const stamp = () => new Date().toTimeString().slice(0, 8);
  const tick = () => {
    beat();
    for (const repo of loadRepos()) {
      try { tickRepo(repo); } catch (e) { say(`${stamp()} ${path.basename(repo)}: ${e.message}`); }
    }
  };
  const startResume = (repo) => {
    const runs = path.join(repo, '.git', 'workhorse', 'runs');
    fs.mkdirSync(runs, { recursive: true });
    const out = fs.openSync(path.join(runs, `watch-${Date.now()}.txt`), 'w');
    const child = spawn(process.execPath, [LAUNCH, '--resume', '--quiet'], { cwd: repo, detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
  };
  const tickRepo = (repo) => {
    // 0.5.1: a Ship approval whose merge waits on CI is merged here the minute CI turns green.
    const sm = whJson(repo, ['ship-merge', '--if-pending']);
    if (sm && sm.action === 'merged') say(`${stamp()} ${path.basename(repo)}: merged ${sm.pr} (${sm.why}).`);
    const { gate, digest } = waitingGate(repo);
    if (gate && digest && digest.pr_url) {
      const sync = whJson(repo, ['github-sync']);
      if (!sync || !sync.recorded) return;
      say(`${stamp()} ${path.basename(repo)}: ${GATE_WORDS[sync.gate]} ${sync.decision === 'reject' ? 'rejected' : 'approved'} by @${sync.by}. Resuming.`);
      const lock = whJson(repo, ['lock', 'status']);
      if (lock && lock.holder) { say(`${stamp()}   a run already holds the lock; not starting another.`); return; }
      startResume(repo);
      return;
    }
    // Nobody is driving the run: approved in a terminal and never resumed, a headless run that
    // died, or a block on a merge that has since happened.
    if (!digest || !digest.change_id || digest.phase === 'done' || gate) return;
    const lock = whJson(repo, ['lock', 'status']);
    const lastLog = lastLogLine(repo, digest.change_id);
    const blockedOnMerge = lastLog && /\| blocked:/.test(lastLog.text) && /\b(merge|merged|pull request|PR)\b/i.test(lastLog.text);
    const prMerged = blockedOnMerge ? prState(repo, digest.pr_url) === 'MERGED' : false;
    const ws = loadWatchState();
    const d = stallDecision({ digest, lockHeld: !!(lock && lock.holder), lastLog, prMerged, now: Date.now(), prior: ws[digest.change_id] });
    if (!d.resume) {
      // Say it once per change, so the log explains a run that is left alone.
      const key = `${digest.change_id}:${d.why}`;
      if (lastLog && (Date.now() - lastLog.at) / 60000 >= STALL_MINUTES && !(ws.said || []).includes(key)) {
        say(`${stamp()} ${path.basename(repo)}: ${digest.title || digest.change_id} is idle (${d.why}); not resuming.`);
        ws.said = (ws.said || []).slice(-50).concat([key]);
        saveWatchState(ws);
      }
      return;
    }
    say(`${stamp()} ${path.basename(repo)}: ${digest.title || digest.change_id} in ${digest.phase}: ${d.why}. Resuming (${d.attempts} of ${MAX_AUTO_RESUMES}).`);
    ws[digest.change_id] = { attempts: d.attempts, last_at: new Date().toISOString(), last_log: lastLog.text };
    saveWatchState(ws);
    wh(repo, ['log', `watcher | resumed a stalled run: ${d.why} (automatic resume ${d.attempts} of ${MAX_AUTO_RESUMES})`]);
    startResume(repo);
  };
  const repos = loadRepos();
  say(`Watching ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'} every ${every / 1000}s for /approve and /reject on gate pull requests. Ctrl+C to stop.`);
  for (const r of repos) say(`  ${r}`);
  tick();
  setInterval(tick, every);
}

function doctor() {
  const rows = [];
  const check = (name, ok, fix) => rows.push({ name, ok, fix });
  const ver = (bin, args) => { const r = spawnSync(bin, args || ['--version'], { encoding: 'utf8', windowsHide: true }); return r.status === 0 ? (r.stdout || r.stderr).trim().split('\n')[0] : null; };
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  check(`node ${process.versions.node}`, nodeMajor >= 18, 'install Node 18 or newer');
  check(`git ${ver('git') || ''}`.trim(), Boolean(ver('git')), 'install git');
  const claude = ver(process.platform === 'win32' ? 'claude.exe' : 'claude');
  check(`claude ${claude || ''}`.trim(), Boolean(claude), 'install the harness CLI and sign in');
  const ghv = ver('gh');
  check(`gh ${ghv ? ghv.replace(/^gh version /, '').split(' ')[0] : ''}`.trim(), Boolean(ghv), 'install the GitHub CLI (gh) to approve gates from GitHub');
  if (ghv) {
    const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', windowsHide: true });
    check('gh signed in', auth.status === 0, 'run: gh auth login');
  }
  const pluginVersion = (() => { try { return JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch (e) { return '?'; } })();
  check(`WorkHorse ${pluginVersion} at ${PLUGIN}`, true);
  const repo = findRepo(process.cwd());
  if (repo) {
    check(`repository ${repo}`, true);
    const remote = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    check('origin is on GitHub (gates post to pull requests)', /github\.com[:/]/.test(remote), 'without a GitHub remote, approve in the terminal: workhorse approve');
    const lock = whJson(repo, ['lock', 'status']);
    check(lock && lock.holder ? `a run holds the lock (${lock.holder})` : 'no run in progress', true);
  } else {
    check('this folder is a WorkHorse repository', false, 'cd into a repository, or run /workhorse:onboard in the harness there');
  }
  const cfgFile = path.join(HOME, 'config.json');
  const cfg = (() => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { return {}; } })();
  const w = watcherAlive();
  check(w ? `watcher running (pid ${w.pid}): a /approve on GitHub resumes the run` : 'watcher not running', !!w, 'workhorse watch --background (the harness starts it in every session)');
  check(STARTUP && fs.existsSync(STARTUP) ? 'watcher starts at sign-in' : 'watcher does not start at sign-in', true);
  check(cfg.ntfy_topic || process.env.WORKHORSE_NTFY_TOPIC ? 'phone push: on (ntfy)' : 'phone push: off (GitHub notifications only)', true);
  for (const r of rows) say(`${r.ok ? ' ok ' : 'FIX '} ${r.name}${r.ok || !r.fix ? '' : `\n      -> ${r.fix}`}`);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}

// ---------- routing ----------

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined: case '-h': case '--help': case 'help': say(HELP); return;
    case 'run': case 'start': return run(rest);
    case 'resume': case 'continue': return resume(rest);
    case 'status': case 'st': return status();
    case 'approve': case 'yes': return decide('approve', rest);
    case 'reject': case 'no': return decide('reject', rest);
    case 'watch': return watch(rest);
    case 'log': case 'follow': return log();
    case 'doctor': return doctor();
    case 'ledger': case 'runs': {
      const r = spawnSync(process.execPath, [WH, 'ledger', ...rest], { cwd: process.cwd(), stdio: 'inherit', windowsHide: true });
      process.exitCode = r.status === null ? 1 : r.status;
      return;
    }
    default:
      // `workhorse "<problem> -> <outcome>"`: the request is the whole command line.
      if (argv.join(' ').includes('->')) return run(argv);
      fail(`unknown command "${cmd}". Run: workhorse help`, 2);
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { main, HELP, findRepo, loadRepos, remember, ensureWatcher, watcherAlive, stallDecision, lastLogLine, STALL_MINUTES, RESUME_COOLDOWN_MINUTES, MAX_AUTO_RESUMES };
