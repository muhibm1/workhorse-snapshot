#!/usr/bin/env node
// Start or resume a WorkHorse run from a terminal, unattended, and follow it.
//
//   node <plugin>/scripts/wh-launch.js "<problem> -> <outcome>"   start a change in the current repo
//   node <plugin>/scripts/wh-launch.js --resume                    resume the active change
//   options: --allow "Bash(cargo *),Bash(make *)"  extra allowed tools for this repository's commands
//            --max-turns N (default 400)   --quiet (no live log lines)
//
// This is what Paddock's Start and Resume buttons did, without the app. Every flag below was
// learned on a live run: Write and Edit must be named in --allowedTools or the harness refuses
// writes into the change folder; acceptEdits covers the rest; a run on the plugin's own
// repository loads the plugin from a separate checkout, because the harness refuses a plugin
// agent's writes inside the directory it was loaded from (2026-09-29); and one conductor per
// repository, enforced by `wh.js lock`. Zero dependencies. Argument arrays, never shell strings.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..');
const WH = path.join(__dirname, 'wh.js');

/** Tools every run needs. Bash patterns cover the commands WorkHorse's own agents run; a
 *  repository's build tools come from --allow or the user's settings. */
const BASE_TOOLS = [
  'Agent', 'Read', 'Glob', 'Grep', 'Edit', 'Write',
  'Bash(node *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(git *)', 'Bash(gh *)',
  'Bash(python *)', 'Bash(pip *)', 'Bash(ruff *)', 'Bash(env *)', 'Bash(mkdir *)', 'Bash(echo *)',
  'Bash(.venv/Scripts/*)', 'Bash(.venv/bin/*)', 'Bash(*/.venv/Scripts/*)', 'Bash(*/.venv/bin/*)',
  'Bash(claude plugin validate *)',
];

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

/** The repository root that holds .workhorse/profile.yml, from `start` upwards. */
function findRepo(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.workhorse', 'profile.yml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function commonDir(dir) {
  const c = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return c ? path.resolve(c) : null;
}

/** The plugin directory to load. When the repository being changed IS the plugin (same git
 *  common directory), use a detached checkout of its default branch beside it, created or
 *  refreshed here, so the run's agents may write into the repository. */
function pluginDirFor(repo, opts = {}) {
  const plugin = opts.plugin || PLUGIN;
  const same = commonDir(repo) && commonDir(repo) === commonDir(plugin);
  if (!same) return { dir: plugin, separate: false };
  const dir = opts.checkout || path.join(path.dirname(repo), `${path.basename(repo)}-plugin`);
  const base = git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') || 'master';
  // The released plugin is the default branch: the local branch when there is one, else the
  // remote's, else (a detached CI checkout has neither) the commit that is checked out.
  const exists = (ref) => Boolean(git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]));
  const ref = [base, `origin/${base}`, 'HEAD'].find(exists);
  if (!fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) {
    const r = spawnSync('git', ['worktree', 'add', '--detach', dir, ref], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`cannot create the plugin checkout at ${dir}: ${(r.stderr || '').trim()}`);
  } else {
    spawnSync('git', ['checkout', '-q', '--detach', ref], { cwd: dir, encoding: 'utf8' });
  }
  return { dir, separate: true, base: ref };
}

function buildArgs({ request, resume, pluginDir, extraTools, maxTurns }) {
  const tools = BASE_TOOLS.concat((extraTools || '').split(',').map((s) => s.trim()).filter(Boolean));
  const prompt = resume ? '/workhorse:run' : `/workhorse:run "${String(request).replace(/"/g, '\\"')}"`;
  return [
    '-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--permission-mode', 'auto', '--allowedTools', [...new Set(tools)].join(','),
    '--plugin-dir', pluginDir, '--max-turns', String(maxTurns || 400),
  ];
}

function parseArgv(argv) {
  const o = { resume: false, quiet: false, allow: '', maxTurns: 400, request: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--resume') o.resume = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--allow') o.allow = argv[++i] || '';
    else if (a === '--max-turns') o.maxTurns = Number(argv[++i]) || 400;
    else if (a === '-h' || a === '--help') o.help = true;
    else rest.push(a);
  }
  o.request = rest.join(' ').trim();
  return o;
}

function whJson(repo, args) {
  const r = spawnSync(process.execPath, [WH, ...args], { cwd: repo, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

function main() {
  const o = parseArgv(process.argv.slice(2));
  if (o.help || (!o.resume && !o.request)) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    process.exit(o.help ? 0 : 2);
  }
  if (!o.resume && !/->/.test(o.request)) {
    process.stderr.write('wh-launch: the request is "<problem> -> <outcome>"; the arrow is how the designer tells them apart.\n');
    process.exit(2);
  }
  const repo = findRepo(process.cwd());
  if (!repo) { process.stderr.write('wh-launch: no .workhorse/profile.yml here or above; run /workhorse:onboard first.\n'); process.exit(2); }
  // Remembered so `workhorse status` and `workhorse watch` cover every repository you run in.
  try { require('./workhorse.js').remember(repo); } catch (e) { /* not fatal */ }
  if (o.resume) {
    // A decision left on the gate's pull request is recorded before the conductor looks at state.
    const sync = whJson(repo, ['github-sync']);
    if (sync && sync.recorded) process.stdout.write(`GitHub: ${sync.gate} ${sync.decision === 'reject' ? 'rejected' : 'approved'} by @${sync.by}; recorded.\n`);
  }

  const lock = whJson(repo, ['lock', 'status']);
  if (lock && lock.holder) {
    const idle = Math.round((Date.now() - Date.parse(lock.updated || lock.started)) / 60000);
    if (idle < 30) {
      process.stderr.write(`wh-launch: a run already holds the lock (${lock.holder}, last activity ${idle} min ago). Not starting a second conductor.\n`);
      process.exit(3);
    }
  }

  let plugin;
  try { plugin = pluginDirFor(repo); } catch (e) { process.stderr.write(`wh-launch: ${e.message}\n`); process.exit(2); }
  const runs = path.join(commonDir(repo) || path.join(repo, '.git'), 'workhorse', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const logPath = path.join(runs, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const claude = process.platform === 'win32' ? 'claude.exe' : 'claude';

  process.stdout.write(`WorkHorse ${o.resume ? 'resume' : 'run'} in ${repo}\n`);
  process.stdout.write(`  plugin: ${plugin.dir}${plugin.separate ? ` (separate checkout of ${plugin.base}: this repository is the plugin)` : ''}\n`);
  process.stdout.write(`  log:    ${logPath}\n\n`);

  const out = fs.openSync(logPath, 'w');
  const child = spawn(claude, buildArgs({ request: o.request, resume: o.resume, pluginDir: plugin.dir, extraTools: o.allow, maxTurns: o.maxTurns }),
    { cwd: repo, stdio: ['ignore', out, out], windowsHide: true });
  child.on('error', (e) => { process.stderr.write(`wh-launch: cannot start claude: ${e.message}\n`); process.exit(2); });

  // Follow the conductor log: one line per step, the same record the clock reads.
  let seen = 0;
  let logFile = null;
  const follow = () => {
    if (o.quiet) return;
    if (!logFile) {
      const st = whJson(repo, ['status', '--json']);
      if (st && st.change_id) logFile = path.join(repo, 'docs', 'sdlc', st.change_id, 'conductor-log.md');
    }
    if (!logFile || !fs.existsSync(logFile)) return;
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter((l) => /^\d{4}-/.test(l));
    if (!seen) seen = o.resume ? lines.length : 0;
    for (const l of lines.slice(seen)) process.stdout.write(`  ${l.slice(11, 19)} ${l.split(' | ').slice(1).join(' | ').slice(0, 160)}\n`);
    seen = lines.length;
  };
  const timer = setInterval(follow, 5000);

  child.on('exit', (code) => {
    clearInterval(timer);
    follow();
    fs.closeSync(out);
    const text = fs.readFileSync(logPath, 'utf8');
    const results = text.split(/\r?\n/).filter((l) => l.includes('"type":"result"'));
    let final = '';
    try { final = JSON.parse(results[results.length - 1]).result || ''; } catch (e) { /* no result line */ }
    process.stdout.write(`\n${final || `(claude exited ${code} with no result; see the log)`}\n\n`);
    // What this run cost at list price, added to the change it worked on (metrics.json at close).
    const usd = runCost(text);
    if (usd > 0) spawnSync(process.execPath, [WH, 'cost', 'add', String(usd), '--log', logPath], { cwd: repo, encoding: 'utf8' });
    const status = spawnSync(process.execPath, [WH, 'status'], { cwd: repo, encoding: 'utf8' });
    if (status.stdout) process.stdout.write(status.stdout);
    if (/session limit|usage limit|rate limit/i.test(final)) {
      process.stdout.write('\nStopped at a usage limit. Run again with --resume after it resets.\n');
      process.exit(4);
    }
    process.exit(code || 0);
  });
}

/** Total `total_cost_usd` over the result events of a stream-json log. A resumed session can
 *  report more than one result; each covers its own turns, so they add. */
function runCost(text) {
  let sum = 0;
  for (const l of String(text || '').split(/\r?\n/)) {
    if (!l.includes('"type":"result"')) continue;
    try { const e = JSON.parse(l); if (typeof e.total_cost_usd === 'number' && e.total_cost_usd > 0) sum += e.total_cost_usd; } catch (e) { /* partial line */ }
  }
  return Math.round(sum * 10000) / 10000;
}

if (require.main === module) main();
module.exports = { BASE_TOOLS, buildArgs, parseArgv, pluginDirFor, findRepo, runCost };
