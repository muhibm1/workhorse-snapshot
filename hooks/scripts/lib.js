// Shared helpers for WorkHorse hooks and the wh CLI. Zero dependencies. Node 18+.
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- stdin / stdout contract ----------

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function preToolDecision(decision, reason, extra) {
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision } };
  if (reason) out.hookSpecificOutput.permissionDecisionReason = reason;
  if (extra && extra.additionalContext) out.hookSpecificOutput.additionalContext = extra.additionalContext;
  emit(out);
}

function allow(reason) { preToolDecision('allow', reason); }
function deny(reason) { preToolDecision('deny', reason); }
function ask(reason) { preToolDecision('ask', reason); }

// Fail open: warn Claude, but do not block. Used when state cannot be read.
function failOpen(msg) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: `[workhorse] ${msg}` } });
}

// ---------- repo discovery ----------

function findRoot(startDir) {
  if (process.env.WORKHORSE_ROOT && fs.existsSync(path.join(process.env.WORKHORSE_ROOT, '.workhorse', 'profile.yml'))) {
    return process.env.WORKHORSE_ROOT;
  }
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.workhorse', 'profile.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Both the plugin's own `.worktrees/` and Claude Code's `isolation: worktree` trees under
// `.claude/worktrees/`: a builder inside the latter was fenced out of its own tree (run 4).
function isInsideWorktree(root) {
  return root ? /[\\/](\.worktrees|\.claude[\\/]worktrees)[\\/]/.test(root + path.sep) : false;
}

function loadProfile(root) {
  const p = path.join(root, '.workhorse', 'profile.yml');
  return parseYaml(fs.readFileSync(p, 'utf8'));
}

// ---------- control state ----------
//
// Which change is active, and each change's state.json, used to live in tracked files
// (.workhorse/active and docs/sdlc/<id>/state.json). A live run showed why that is wrong: the
// conductor checked out the change branch in the main checkout, git rewrote both files from the
// branch point, `active` went empty and the phase went backwards, and every state-driven hook
// stood down. Builder worktrees had the same blind spot from the start. Control state now lives
// in the git common directory: git never tracks it, no checkout can rewrite it, and every
// worktree of the repository shares it. Artifacts stay in docs/sdlc and remain versioned.

/** The repository's shared git directory, read from disk without spawning git (hooks run per tool call). */
function gitCommonDir(root) {
  const dotgit = path.join(root, '.git');
  try {
    if (fs.statSync(dotgit).isDirectory()) return dotgit;
    // A worktree's .git is a file: "gitdir: <main>/.git/worktrees/<name>", which holds a commondir file.
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, 'utf8'));
    if (m) {
      const gitdir = path.resolve(root, m[1].trim());
      const cf = path.join(gitdir, 'commondir');
      return fs.existsSync(cf) ? path.resolve(gitdir, fs.readFileSync(cf, 'utf8').trim()) : gitdir;
    }
  } catch (e) { /* no .git at root; fall through */ }
  const out = git(root, ['rev-parse', '--git-common-dir']);
  return out ? path.resolve(root, out) : null;
}

/** Where control state lives. Outside git (no repository) it falls back to an ignored folder. */
function stateRoot(root) {
  const common = gitCommonDir(root);
  return common ? path.join(common, 'workhorse') : path.join(root, '.workhorse', 'state');
}

function activeFile(root) { return path.join(stateRoot(root), 'active'); }
function stateFile(root, id) { return path.join(stateRoot(root), 'changes', id, 'state.json'); }

function setActiveChangeId(root, id) {
  const p = activeFile(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, (id || '') + '\n');
}

function activeChangeId(root) {
  const p = activeFile(root);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim() || null;
  // One-time migration from the old tracked location. Once the new file exists, even empty, it wins.
  const legacy = path.join(root, '.workhorse', 'active');
  if (fs.existsSync(legacy)) {
    const id = fs.readFileSync(legacy, 'utf8').trim();
    if (id) { setActiveChangeId(root, id); return id; }
  }
  return null;
}

function changeDir(root, id) {
  return path.join(root, 'docs', 'sdlc', id);
}

function writeStateFile(root, id, state) {
  const p = stateFile(root, id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

function loadState(root, id) {
  const p = stateFile(root, id);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  const legacy = path.join(changeDir(root, id), 'state.json');   // one-time migration
  if (fs.existsSync(legacy)) {
    const s = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    writeStateFile(root, id, s);
    return s;
  }
  return null;
}

function saveState(root, id, state) {
  state.updated_at = new Date().toISOString();
  writeStateFile(root, id, state);
}

/** Every change id with state, from the control-state store and any not-yet-migrated legacy folders. */
function listChangeIds(root) {
  const ids = new Set();
  const store = path.join(stateRoot(root), 'changes');
  if (fs.existsSync(store)) {
    for (const d of fs.readdirSync(store)) if (fs.existsSync(path.join(store, d, 'state.json'))) ids.add(d);
  }
  const docs = path.join(root, 'docs', 'sdlc');
  if (fs.existsSync(docs)) {
    for (const d of fs.readdirSync(docs)) if (fs.existsSync(path.join(docs, d, 'state.json'))) ids.add(d);
  }
  return [...ids].sort();
}

/** True when `abs` sits inside the control-state directory (case-insensitive on Windows). */
function isInStateRoot(root, abs) {
  const norm = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const sr = norm(stateRoot(root));
  const a = norm(abs);
  return a === sr || a.startsWith(sr + path.sep);
}

// Returns { root, profile, id, state } or nulls, never throws.
function loadContext(cwd) {
  const out = { root: null, profile: null, id: null, state: null, error: null };
  try {
    out.root = findRoot(cwd);
    if (!out.root) return out;
    out.profile = loadProfile(out.root);
    out.id = activeChangeId(out.root);
    if (out.id) out.state = loadState(out.root, out.id);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// ---------- gates ----------

// Two human touches: Design (G2) and Ship (G4). Tier 3 adds Deploy (G5), where the human runs
// the production step. G1 and G3 are kept as ids so state, approvals and Paddock keep their
// shape, but no tier requires them: three real runs showed they were answered "none" and cost
// hours of waiting each (docs/superpowers/specs/2026-09-19-two-gates-design.md).
const ALL_GATES = ['G1', 'G2', 'G3', 'G4', 'G5'];
const GATE_NAMES = { G1: 'Intent', G2: 'Design', G3: 'Plan', G4: 'Ship', G5: 'Deploy' };
const TIER_GATES = {
  0: ['G4'],
  1: ['G2', 'G4'],
  2: ['G2', 'G4'],
  3: ['G2', 'G4', 'G5'],
};
const PHASES = ['design', 'build', 'verify', 'review', 'deploy', 'done'];

// Agent-time budget per tier, in minutes. A run over budget says so in its Ship document. The
// profile may override with `budgets: { agent_minutes: { 0: 15, ... } }`.
const BUDGET_MINUTES = { 0: 25, 1: 30, 2: 90, 3: 180 };
function budgetMinutes(tier, profile) {
  const t = Math.min(Math.max(Number(tier) || 0, 0), 3);
  const o = profile && profile.budgets && profile.budgets.agent_minutes;
  const v = o && (o[t] !== undefined ? o[t] : o[String(t)]);
  return v !== undefined && v !== null && v !== '' ? Number(v) : BUDGET_MINUTES[t];
}

function effectiveTier(state) {
  if (!state) return 0;
  if (state.tier_override !== null && state.tier_override !== undefined) return Number(state.tier_override);
  return state.tier === null || state.tier === undefined ? 0 : Number(state.tier);
}

// Which gates need a human for this change. Autonomy can add gates, never remove G4.
// `assisted` and `shadow` add the Deploy touch at every tier; the Design touch at tier 0.
function requiredGates(state, profile) {
  const tier = effectiveTier(state);
  const autonomy = (profile && profile.autonomy) || 'bounded';
  if (autonomy === 'assisted' || autonomy === 'shadow') return ['G2', 'G4', 'G5'];
  const gates = new Set(TIER_GATES[Math.min(Math.max(tier, 0), 3)] || ['G4']);
  gates.add('G4');
  return ALL_GATES.filter((g) => gates.has(g));
}

function gateSatisfied(state, profile, gate) {
  const required = requiredGates(state, profile).includes(gate);
  const status = state && state.gates ? state.gates[gate] : 'pending';
  if (!required) return true;
  return status === 'approved';
}

// Artifact that opens each phase, and the gate that must be satisfied before it may be written.
// Everything the designer writes (brief, spec, plan, evals) comes before Design; verification
// and the Ship document come after it; the Deploy runbook comes after Ship.
const PHASE_ARTIFACT_GATE = {
  'verification.md': 'G2',
  'ship.md': 'G2',
  'release.md': 'G4',
};

// ---------- paths ----------

function normalize(p) {
  return p.replace(/\\/g, '/');
}

function relToRoot(root, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..')) return null; // outside root
  return normalize(rel);
}

// Minimal glob: ** matches any path segment(s), * matches within a segment, ? one char.
function globToRegex(glob) {
  let g = normalize(glob).replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        // ** or **/
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  // A glob without a slash matches at any depth (like gitignore).
  if (!g.includes('/')) re = '(?:.*/)?' + re;
  return new RegExp('^' + re + '$');
}

function matchesAny(relPath, globs) {
  if (!relPath || !Array.isArray(globs)) return null;
  const p = normalize(relPath);
  for (const g of globs) {
    if (typeof g === 'string' && globToRegex(g).test(p)) return g;
  }
  return null;
}

function toolFilePath(input) {
  const ti = (input && input.tool_input) || {};
  return ti.file_path || ti.notebook_path || ti.path || null;
}

// ---------- tiny YAML subset parser ----------
// Supports: nested maps by indentation, "- item" lists, scalars, quoted strings, comments,
// inline [a, b] lists and { k: v } maps, and lists of maps. Enough for profile.yml.

function parseScalar(s) {
  s = s.trim();
  if (s === '' ) return '';
  if (s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // Double quotes process escapes; single quotes only unescape a doubled quote. Getting this
  // wrong hands the verifier a command with literal backslashes in it.
  if (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\(["\\/nrtb])/g, (m, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b' }[c] || c));
  }
  if (s.length > 1 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  if (s[0] === '[' && s[s.length - 1] === ']') {
    const inner = s.slice(1, -1).trim();
    return inner ? splitTop(inner).map(parseScalar) : [];
  }
  if (s[0] === '{' && s[s.length - 1] === '}') {
    const inner = s.slice(1, -1).trim();
    const obj = {};
    if (!inner) return obj;
    for (const part of splitTop(inner)) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      obj[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
    }
    return obj;
  }
  return s;
}

// Split on top-level commas, respecting quotes and brackets.
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function stripComment(line) {
  let q = null, out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { out += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; out += ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += ch;
  }
  return out.replace(/\s+$/, '');
}

function parseYaml(text) {
  const lines = text.split(/\r?\n/).map(stripComment).filter((l) => l.trim() !== '');
  let i = 0;
  function indentOf(l) { return l.match(/^ */)[0].length; }

  function parseBlock(indent) {
    // Decide list or map by first line.
    if (i >= lines.length) return null;
    const first = lines[i];
    if (indentOf(first) < indent) return null;
    if (first.trim().startsWith('- ')) return parseList(indentOf(first));
    return parseMap(indentOf(first));
  }

  function parseMap(indent) {
    const obj = {};
    while (i < lines.length) {
      const line = lines[i];
      const ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) { i++; continue; } // stray, skip
      const t = line.trim();
      if (t.startsWith('- ')) break;
      const idx = t.indexOf(':');
      if (idx < 0) { i++; continue; }
      const key = t.slice(0, idx).trim().replace(/^["']|["']$/g, '');
      const rest = t.slice(idx + 1).trim();
      i++;
      if (rest === '') {
        // nested block or empty
        if (i < lines.length && indentOf(lines[i]) > indent) obj[key] = parseBlock(indentOf(lines[i]));
        else if (i < lines.length && indentOf(lines[i]) === indent && lines[i].trim().startsWith('- ')) obj[key] = parseList(indent);
        else obj[key] = null;
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (i < lines.length) {
      const line = lines[i];
      const ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) { i++; continue; }
      const t = line.trim();
      if (!t.startsWith('- ')) break;
      const rest = t.slice(2).trim();
      i++;
      if (rest.includes(':') && !rest.startsWith('[') && !rest.startsWith('{') && !/^["']/.test(rest)) {
        // list of maps: treat "- key: v" as first entry of a map at indent+2
        const idx = rest.indexOf(':');
        const key = rest.slice(0, idx).trim();
        const val = rest.slice(idx + 1).trim();
        const item = {};
        item[key] = val === '' ? (i < lines.length && indentOf(lines[i]) > indent ? parseBlock(indentOf(lines[i])) : null) : parseScalar(val);
        // continuation keys at deeper indent
        if (i < lines.length && indentOf(lines[i]) > indent && !lines[i].trim().startsWith('- ')) {
          Object.assign(item, parseMap(indentOf(lines[i])));
        }
        arr.push(item);
      } else {
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  return parseBlock(0) || {};
}

// ---------- clock ----------
//
// Speed was never measured: three real runs took about a hundred hours for under three hours of
// code-writing, and nothing in the pipeline could say so. The clock reads the timestamps the CLI
// already stamps (conductor-log.md rows, approvals.md blocks) and splits wall time into agents
// working, waiting on the human, and dead time after a service cut-off. It is derived, never
// stored, so it cannot drift from the record.

/** Rows of conductor-log.md in either format the CLI has written: `<iso> | phase | rest` or the
 *  older table `| <iso> | phase | agent | result |`. Timestamps without a zone are UTC. */
function parseConductorLog(text) {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^\|\s*/, '').replace(/\s*\|$/, '');
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)\s*\|\s*([^|]*?)\s*\|\s*(.*)$/.exec(line);
    if (!m) continue;
    const stamp = /Z|[+-]\d{2}:\d{2}$/.test(m[1]) ? m[1] : m[1] + 'Z';
    const t = Date.parse(stamp);
    if (Number.isNaN(t)) continue;
    rows.push({ t, phase: m[2].trim(), text: m[3].trim() });
  }
  return rows;
}

/** Approval blocks of approvals.md: gate, status and when. */
function parseApprovals(text) {
  const out = [];
  for (const b of String(text || '').split(/^## /m).slice(1)) {
    const head = /^(G\d): (approved|rejected)/.exec(b);
    const when = /^- When: (.*)$/m.exec(b);
    if (!head || !when) continue;
    const t = Date.parse(when[1].trim());
    if (Number.isNaN(t)) continue;
    out.push({ t, gate: head[1], status: head[2] });
  }
  return out;
}

const RESUME_RE = /\b(resumed|resuming|killed|cut off|usage limit|rate limit|session limit)\b/i;
const GAP_MINUTES = 90;

/**
 * Split the change's wall time. Every interval between two consecutive events is one of:
 * waiting (it ends in a human decision, or the run is currently stopped at a pending gate),
 * dead (it ends in a row that says the conductor resumed after a cut-off), a gap (over
 * GAP_MINUTES with nothing to explain it; reported, counted in neither), or agents working.
 * `human_minutes` is the time between Paddock opening a packet (state.gate_opened.<G>) and the
 * decision, when Paddock recorded it; null otherwise.
 */
function computeClock(opts) {
  const now = opts.now !== undefined ? opts.now : Date.now();
  const state = opts.state || {};
  const rows = parseConductorLog(opts.log).map((r) => ({ ...r, kind: 'log' }));
  const approvals = parseApprovals(opts.approvals).map((a) => ({ ...a, kind: 'approval' }));
  const events = rows.concat(approvals).sort((a, b) => a.t - b.t);
  const tier = effectiveTier(state);
  const budget = budgetMinutes(tier, opts.profile);
  const done = state.phase === 'done';
  const empty = {
    agent_minutes: 0, waiting_minutes: 0, dead_minutes: 0, gap_minutes: 0, wall_minutes: 0,
    human_minutes: null, budget_minutes: budget, within_budget: true, tier, done,
    phases: [], gaps: [], events: 0, started_at: null, ended_at: null,
  };
  if (events.length === 0) return empty;

  const waitingNow = Boolean(opts.pending_gate) && !done;
  const end = done ? events[events.length - 1].t : Math.max(now, events[events.length - 1].t);
  const byPhase = {};
  const gaps = [];
  let agent = 0, waiting = 0, dead = 0, gap = 0;
  const intervals = [];
  for (let i = 1; i < events.length; i++) intervals.push([events[i - 1], events[i]]);
  if (!done && end > events[events.length - 1].t) intervals.push([events[events.length - 1], { t: end, kind: 'now' }]);

  for (const [a, b] of intervals) {
    const mins = Math.max(0, (b.t - a.t) / 60000);
    if (b.kind === 'approval') { waiting += mins; continue; }
    if (b.kind === 'now' && waitingNow) { waiting += mins; continue; }
    if (b.kind === 'log' && RESUME_RE.test(b.text)) { dead += mins; continue; }
    if (mins > GAP_MINUTES) {
      gap += mins;
      gaps.push({ from: new Date(a.t).toISOString(), to: new Date(b.t).toISOString(), minutes: Math.round(mins) });
      continue;
    }
    agent += mins;
    const phase = (a.kind === 'log' ? a.phase : (b.kind === 'log' ? b.phase : state.phase)) || 'unknown';
    byPhase[phase] = (byPhase[phase] || 0) + mins;
  }

  let human = null;
  const opened = state.gate_opened || {};
  for (const ap of approvals) {
    const o = opened[ap.gate] ? Date.parse(opened[ap.gate]) : NaN;
    if (Number.isNaN(o) || o > ap.t) continue;
    human = (human || 0) + (ap.t - o) / 60000;
  }

  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    agent_minutes: r1(agent), waiting_minutes: r1(waiting), dead_minutes: r1(dead), gap_minutes: r1(gap),
    wall_minutes: r1((end - events[0].t) / 60000),
    human_minutes: human === null ? null : r1(human),
    budget_minutes: budget, within_budget: agent <= budget, tier, done,
    phases: Object.entries(byPhase).map(([phase, m]) => ({ phase, agent_minutes: r1(m) })),
    gaps, events: events.length,
    started_at: new Date(events[0].t).toISOString(), ended_at: new Date(end).toISOString(),
  };
}

function fmtMinutes(m) {
  const n = Math.round(m);
  return n >= 60 ? `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, '0')} m` : `${n} m`;
}

/** One line for status, the Ship document and Paddock. */
function formatClock(c) {
  if (!c || !c.events) return 'Clock: no events yet';
  const parts = [
    `agents ${fmtMinutes(c.agent_minutes)} of ${fmtMinutes(c.budget_minutes)} budget${c.within_budget ? '' : ' (OVER)'}`,
    `waiting on you ${fmtMinutes(c.waiting_minutes)}`,
    `dead ${fmtMinutes(c.dead_minutes)}`,
  ];
  if (c.gap_minutes) parts.push(`unexplained gaps ${fmtMinutes(c.gap_minutes)}`);
  if (c.human_minutes !== null) parts.push(`your time ${fmtMinutes(c.human_minutes)}`);
  parts.push(`wall ${fmtMinutes(c.wall_minutes)}`);
  return 'Clock: ' + parts.join(' · ');
}

// ---------- known failures ----------
//
// A pre-existing failure (a check that is red on the base branch before the change touched
// anything) was re-derived four times in one live run by four agents. It is recorded once,
// with the base-branch reproduction, and every later phase cites the record.

function knownFailuresFile(root) { return path.join(root, '.workhorse', 'known-failures.md'); }

function parseKnownFailures(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5 || /^:?-{2,}/.test(cells[0]) || /^date$/i.test(cells[0])) continue;
    out.push({ date: cells[0], check: cells[1], command: cells[2], base: cells[3], reason: cells[4], change: cells[5] || '' });
  }
  return out;
}

function loadKnownFailures(root) {
  const f = knownFailuresFile(root);
  return fs.existsSync(f) ? parseKnownFailures(fs.readFileSync(f, 'utf8')) : [];
}

function addKnownFailure(root, entry) {
  const f = knownFailuresFile(root);
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, [
      '# Known pre-existing failures',
      '',
      'Checks that fail on the base branch before any change touched them. Recorded once by the',
      'verifier with the base-branch reproduction; every later phase cites the row instead of',
      're-deriving it. Remove a row when the failure is fixed.',
      '',
      '| Date | Check | Command | Reproduced on base | Reason | Recorded by change |',
      '|------|-------|---------|--------------------|--------|--------------------|',
      '',
    ].join('\n'));
  }
  const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  fs.appendFileSync(f, `| ${cell(entry.date)} | ${cell(entry.check)} | ${cell(entry.command)} | ${cell(entry.base)} | ${cell(entry.reason)} | ${cell(entry.change)} |\n`);
}

// ---------- ship readiness ----------
//
// The Ship document is never presented with a defect the pipeline could have fixed. A live G4
// packet said "fix before merge" about two items and was approved without them being fixed.

const OPEN_RESOLUTION_RE = /^(|open|todo|pending|unresolved|fix before merge|fix now|not fixed|-)$/i;
const BLOCKING_SEVERITY_RE = /^(critical|high|medium)$/i;

/** Reasons the Ship document may not be presented, as human-readable strings; empty when ready. */
function shipBlockers(shipMd, state) {
  const blockers = [];
  const v = (state && state.verification && state.verification.status) || 'none';
  if (v !== 'green') blockers.push(`verification is ${v}, not green`);
  const lines = String(shipMd || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}.*reviewers? found/i.test(l) || /^#{1,6}.*review findings/i.test(l));
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^#{1,6}\s/.test(l)) break;
      if (!l.startsWith('|')) continue;
      const cells = l.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 5 || /^:?-{2,}/.test(cells[0]) || /^severity$/i.test(cells[0])) continue;
      if (BLOCKING_SEVERITY_RE.test(cells[0]) && OPEN_RESOLUTION_RE.test(cells[4])) {
        blockers.push(`${cells[0].toLowerCase()} finding without a resolution: ${cells[3].slice(0, 80)}`);
      }
    }
  }
  if (!/^## Your decision/m.test(shipMd || '')) blockers.push('the "## Your decision" section is missing (the document is not finished)');
  return blockers;
}

/** A gate packet is live for the human only once its closing section exists. Until then the
 *  agent is still writing it, and Paddock must not show it as waiting on you. */
function packetComplete(md) {
  return /^## Your decision/m.test(String(md || ''));
}

// ---------- misc ----------

function nowIso() { return new Date().toISOString(); }

function git(root, args) {
  const { execFileSync } = require('child_process');
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return '';
  }
}

module.exports = {
  readStdinJson, emit, preToolDecision, allow, deny, ask, failOpen,
  findRoot, isInsideWorktree, loadProfile, activeChangeId, setActiveChangeId, changeDir, loadState, saveState, loadContext,
  gitCommonDir, stateRoot, stateFile, activeFile, listChangeIds, isInStateRoot,
  ALL_GATES, GATE_NAMES, TIER_GATES, PHASES, BUDGET_MINUTES, budgetMinutes,
  effectiveTier, requiredGates, gateSatisfied, PHASE_ARTIFACT_GATE,
  parseConductorLog, parseApprovals, computeClock, formatClock, fmtMinutes,
  knownFailuresFile, parseKnownFailures, loadKnownFailures, addKnownFailure,
  shipBlockers, packetComplete,
  normalize, relToRoot, globToRegex, matchesAny, toolFilePath,
  parseYaml, nowIso, git,
};
