// The run ledger: every WorkHorse change in every repository, one row each, recomputed from
// the committed record. Zero dependencies.
//
// A change's conductor-log.md and approvals.md are committed with the change, and the clock
// (lib.js computeClock) is derived from those two files alone. So the ledger re-reads them
// from git, at a ref, and recomputes every run the same way: nobody types a number into it,
// and a release can only claim it made runs faster if the ledger shows it.
//
//   wh.js ledger [--repo <path>[#<ref>]]... [--out <dir>] [--json]
//
// Without --repo it reads every repository `workhorse` remembers, plus the current one.
// With --out it writes <dir>/runs.json and <dir>/RUNS.md; otherwise it prints RUNS.md.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');

/** The four stages WorkHorse has gone through, by the release that opened each. */
const GENERATIONS = [
  { name: 'Five gates', from: '0.1.0', note: 'a person approved every phase' },
  { name: 'Two gates', from: '0.3.0', note: 'Design and Ship only; agents never stop to ask' },
  { name: 'Speed release', from: '0.3.12', note: 'deterministic CLI for checks and folds; conductor on a cheaper model' },
  { name: 'Lead time', from: '0.5.0', note: 'every run measured from ask to merge; waiting removed' },
];

/** Compares two x.y.z versions numerically. */
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** Releases from CHANGELOG.md headings (`## X.Y.Z — YYYY-MM-DD`), oldest first. */
function parseReleases(changelog) {
  const out = [];
  const re = /^## (\d+\.\d+\.\d+) [—-] (\d{4}-\d{2}-\d{2})/gm;
  let m;
  while ((m = re.exec(String(changelog || '')))) out.push({ version: m[1], date: m[2] });
  return out.sort((a, b) => cmpVersion(a.version, b.version));
}

/** The plugin release a run used, from its start date: one version when a single release was
 *  in force that day, a range when several shipped the same day (inferred either way). */
function versionAt(releases, isoDate) {
  const day = String(isoDate || '').slice(0, 10);
  if (!day) return null;
  const before = releases.filter((r) => r.date < day);
  const sameDay = releases.filter((r) => r.date === day);
  const prior = before.length ? before[before.length - 1].version : null;
  if (!sameDay.length) return prior ? { version: prior, source: 'inferred' } : null;
  const lo = prior || sameDay[0].version;
  const hi = sameDay[sameDay.length - 1].version;
  return { version: lo === hi ? lo : `${lo}–${hi}`, source: 'inferred' };
}

/** The generation a version (or the lower end of a range) belongs to. */
function generationOf(version) {
  if (!version) return null;
  const v = String(version).split('–')[0];
  let g = null;
  for (const gen of GENERATIONS) if (cmpVersion(v, gen.from) >= 0) g = gen.name;
  return g;
}

/** The first risk tier a change's documents state, or null. */
function tierFrom(...texts) {
  for (const t of texts) {
    const m = /\b(?:risk\s+)?tier\**[:\s]*\**\s*(\d)\b/i.exec(String(t || ''));
    if (m) return Number(m[1]);
  }
  return null;
}

/** Owner decisions recorded at gates: approvals and rejections in approvals.md. */
function countDecisions(approvals) {
  const heads = String(approvals || '').match(/^## G\d: (approved|rejected)/gm) || [];
  return { touches: heads.length, rejections: heads.filter((h) => h.endsWith('rejected')).length };
}

/** git in a repository, returning stdout or '' on failure. */
function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}

/** Reads every change folder under docs/sdlc at a ref, as { id: { file: text } }. */
function readChanges(repo, ref) {
  const names = git(repo, ['ls-tree', '-r', '--name-only', ref, '--', 'docs/sdlc']).split('\n');
  const wanted = /^docs\/sdlc\/(\d{4}-\d{2}-\d{2}-[^/]+)\/(conductor-log|approvals|brief|ship|intent|retro|metrics)\.(md|json)$/;
  const changes = {};
  for (const n of names) {
    const m = wanted.exec(n);
    if (!m) continue;
    (changes[m[1]] = changes[m[1]] || {})[`${m[2]}.${m[3]}`] = git(repo, ['show', `${ref}:${n}`]);
  }
  return changes;
}

/** The plugin version a conductor log names (`plugin root 0.3.11 used`), or null. */
function versionFromLog(log) {
  const m = /plugin(?: root)?\s+v?(\d+\.\d+\.\d+)/i.exec(String(log || ''));
  return m ? m[1] : null;
}

/** One ledger row for a change, its clock recomputed from the committed log and approvals.
 *  `fix` is an entry from overrides.json: a cited correction where the record is incomplete. */
function runRow(L, repoName, id, files, releases, fix) {
  let metrics = null;
  try { metrics = files['metrics.json'] ? JSON.parse(files['metrics.json']) : null; } catch (e) { metrics = null; }
  const log = files['conductor-log.md'] || '';
  const rows = L.parseConductorLog(log);
  const finished = Boolean(metrics) || rows.some((r) => /^done$/i.test(r.phase)) || Boolean(files['retro.md']);
  const tier = metrics && Number.isInteger(metrics.tier) ? metrics.tier
    : tierFrom(files['brief.md'], files['ship.md'], files['intent.md'], files['retro.md']);
  const clock = L.computeClock({
    log, approvals: files['approvals.md'] || '',
    state: { phase: 'done', tier: tier === null ? 2 : tier }, profile: {},
  });
  const logged = versionFromLog(log);
  const ver = metrics && metrics.plugin_version ? { version: metrics.plugin_version, source: 'recorded' }
    : fix && fix.version ? { version: fix.version, source: 'cited' }
      : logged ? { version: logged, source: 'logged' }
        : versionAt(releases, clock.started_at);
  const d = countDecisions(files['approvals.md']);
  return {
    repo: repoName, id,
    started: clock.started_at ? clock.started_at.slice(0, 10) : id.slice(0, 10),
    tier, status: (fix && fix.status) || (finished ? 'finished' : 'record not closed'),
    version: ver ? ver.version : null, version_source: ver ? ver.source : null,
    generation: generationOf(ver && ver.version),
    agent_minutes: clock.agent_minutes, waiting_minutes: clock.waiting_minutes,
    dead_minutes: clock.dead_minutes, unexplained_minutes: clock.gap_minutes, wall_minutes: clock.wall_minutes,
    budget_minutes: tier === null ? null : clock.budget_minutes,
    within_budget: tier === null ? null : clock.within_budget,
    touches: d.touches, rejections: d.rejections,
    cost_usd: metrics && typeof metrics.cost_usd === 'number' ? metrics.cost_usd : null,
    correction: fix ? { ...fix } : null,
  };
}

/** Median of a list of numbers, or null. */
function median(xs) {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

/** Per-generation figures over finished runs at tiers 0 to 2 (tier 3 runs are reported apart). */
function summarize(runs) {
  return GENERATIONS.map((g) => {
    const all = runs.filter((r) => r.generation === g.name && r.status === 'finished');
    const set = all.filter((r) => r.tier !== null && r.tier <= 2);
    const agent = set.reduce((a, r) => a + r.agent_minutes, 0);
    const wall = set.reduce((a, r) => a + r.wall_minutes, 0);
    return {
      generation: g.name, from: g.from, note: g.note, runs: set.length, tier3_runs: all.length - set.length,
      median_agent_minutes: median(set.map((r) => r.agent_minutes)),
      median_wall_minutes: median(set.map((r) => r.wall_minutes)),
      within_budget: set.length ? `${set.filter((r) => r.within_budget).length} of ${set.length}` : null,
      agent_share_of_wall: wall ? Math.round((agent / wall) * 100) : null,
    };
  });
}

/** Minutes as `1 h 05 m` or `42 m`. */
function hm(m) {
  if (m === null || m === undefined) return '–';
  const n = Math.round(m);
  return n >= 60 ? `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, '0')} m` : `${n} m`;
}

/** RUNS.md: a plain-language opening, the per-generation summary, then every run. */
function renderMarkdown(runs, summary, generatedAt) {
  const finished = runs.filter((r) => r.status === 'finished');
  const fixed = runs.filter((r) => r.correction);
  const lines = [
    '# WorkHorse, run by run',
    '',
    'Every change WorkHorse has carried from a one-line request to a merged pull request, one row each.',
    'Nobody typed these numbers. `wh.js ledger` re-reads each change\'s committed conductor log and',
    'approvals from git and recomputes its clock the same way every time, so a release can only claim',
    'it made runs faster if this table shows it.',
    '',
    `Generated ${generatedAt}. ${finished.length} finished runs and ${runs.length - finished.length} whose record was never closed, across ${new Set(runs.map((r) => r.repo)).size} repositories.`,
    '',
    '## What the words mean',
    '',
    '- **Agent time**: minutes the agents were working.',
    '- **Wall time**: from the request to the last record of the change, nights and weekends included.',
    '- **Waiting**: minutes a finished Design or Ship document sat until a person approved it.',
    '- **Dead time**: minutes lost to a stopped run (a usage limit, a crash, a refused merge) before it resumed.',
    '- **Budget**: the agent minutes a change of that risk tier is allowed: 25 (tier 0), 30 (1), 90 (2), 180 (3).',
    '- **Tier**: risk, from 0 (docs, tests) to 3 (regulated or irreversible).',
    '',
    '## By generation',
    '',
    'Finished runs at tiers 0 to 2. Tier 3 runs are counted separately because their budget is twice as large.',
    '',
    '| Generation | From | Runs | Median agent time | Within budget | Median wall time | Agent share of wall time | Tier 3 runs |',
    '|---|---|---|---|---|---|---|---|',
    ...summary.map((s) => `| ${s.generation} | ${s.from} | ${s.runs} | ${hm(s.median_agent_minutes)} | ${s.within_budget || '–'} | ${hm(s.median_wall_minutes)} | ${s.agent_share_of_wall === null ? '–' : s.agent_share_of_wall + '%'} | ${s.tier3_runs} |`),
    '',
    '## Every run',
    '',
    'Versions marked `~` are inferred from the release dates in `CHANGELOG.md` (a range when several',
    'releases shipped that day); the rest are named in the run\'s own log or cited under Corrections.',
    'From 0.5.0 each change records the version it ran on in its own `metrics.json`. "Unexplained" is a',
    'silence of more than 90 minutes in the log that no row accounts for; it counts as neither agent',
    'nor dead time. "Record not closed" means the change\'s documents stop before its done step.',
    '',
    '| Started | Repository | Change | Tier | Version | Agent time | Budget | Waiting | Dead | Unexplained | Wall | Gate decisions | Rejected | Cost |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of runs) {
    const name = r.id.slice(11).replace(/-+$/, '').replace(/-/g, ' ');
    const over = r.within_budget === false ? ' (over)' : '';
    lines.push(`| ${r.started} | ${r.repo} | ${name}${r.status === 'finished' ? '' : ` *(${r.status})*`} | ${r.tier === null ? '–' : r.tier} | ${r.version ? (r.version_source === 'inferred' ? '~' : '') + r.version : '–'} | ${hm(r.agent_minutes)}${over} | ${hm(r.budget_minutes)} | ${hm(r.waiting_minutes)} | ${hm(r.dead_minutes)} | ${hm(r.unexplained_minutes)} | ${hm(r.wall_minutes)} | ${r.touches} | ${r.rejections} | ${r.cost_usd === null ? '–' : '$' + r.cost_usd.toFixed(2)} |`);
  }
  if (fixed.length) {
    lines.push('', '## Corrections', '', 'Where a change\'s own record is incomplete, the fix is written in `docs/ledger/overrides.json` with its source. Nothing else is adjusted.', '');
    for (const r of fixed) lines.push(`- **${r.repo}, ${r.id}**: ${r.correction.note} Source: ${r.correction.source}.`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Builds the ledger for a list of `{ path, ref, name }` repositories. */
function build(L, repos, changelogText, overrides) {
  const fixes = overrides || {};
  const releases = parseReleases(changelogText);
  const runs = [];
  for (const r of repos) {
    const changes = readChanges(r.path, r.ref || 'HEAD');
    for (const id of Object.keys(changes).sort()) {
      if (!changes[id]['conductor-log.md']) continue;
      runs.push(runRow(L, r.name, id, changes[id], releases, fixes[`${r.name}/${id}`] || null));
    }
  }
  runs.sort((a, b) => (a.started + a.id).localeCompare(b.started + b.id));
  return { runs, summary: summarize(runs) };
}

/** Parses `<path>[#<ref>]` into a repository spec named after its folder. */
function parseRepoSpec(spec) {
  const i = spec.lastIndexOf('#');
  const p = path.resolve(i > 0 ? spec.slice(0, i) : spec);
  return { path: p, ref: i > 0 ? spec.slice(i + 1) : 'HEAD', name: path.basename(p) };
}

/** Cited corrections for changes whose own record is incomplete (docs/ledger/overrides.json). */
function pluginOverrides() {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'docs', 'ledger', 'overrides.json'), 'utf8')); } catch (e) { return {}; }
}

/** The plugin's own changelog, the source of release dates. */
function pluginChangelog() {
  try { return fs.readFileSync(path.join(PLUGIN_ROOT, 'CHANGELOG.md'), 'utf8'); } catch (e) { return ''; }
}

module.exports = {
  GENERATIONS, cmpVersion, parseReleases, versionAt, generationOf, tierFrom, countDecisions,
  runRow, median, versionFromLog, pluginOverrides, summarize, renderMarkdown, build, parseRepoSpec, pluginChangelog, readChanges,
};
