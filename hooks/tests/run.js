#!/usr/bin/env node
// Hook and CLI tests. Builds a throwaway repo under the OS temp dir, feeds each hook sample
// JSON on stdin, and asserts the decision. Run: node hooks/tests/run.js
'use strict';
process.env.WORKHORSE_NO_WATCH = '1';
process.env.WORKHORSE_NO_TRACE = '1'; // phase done would otherwise send fixture changes to LangSmith // session-context.js would otherwise start a real watcher
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(PLUGIN, 'hooks', 'scripts');
const WH = path.join(PLUGIN, 'scripts', 'wh.js');
const L = require(path.join(SCRIPTS, 'lib.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); }
}

function hook(script, input) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { input: JSON.stringify(input), encoding: 'utf8' });
  if (r.status !== 0) return { error: r.stderr };
  try { return r.stdout.trim() ? JSON.parse(r.stdout) : {}; } catch (e) { return { error: 'bad json: ' + r.stdout }; }
}
function decision(res) { return (res.hookSpecificOutput && res.hookSpecificOutput.permissionDecision) || (res.decision) || 'none'; }
function wh(cwd, ...a) {
  const r = spawnSync(process.execPath, [WH, ...a], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

// ---------- fixture ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-test-'));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: repo });
execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
execFileSync('git', ['add', '.'], { cwd: repo });
execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

console.log('yaml parser');
{
  const p = L.parseYaml(fs.readFileSync(path.join(PLUGIN, 'templates', 'profile.yml'), 'utf8'));
  check('parses autonomy', p.autonomy === 'bounded');
  check('parses nested list', Array.isArray(p.conventions.test_globs) && p.conventions.test_globs.includes('**/*.test.*'));
  check('parses inline map', p.environments.prod.auto === false && p.environments.dev.auto === true);
  check('parses numeric-key map with inline list', Array.isArray(p.tier_floor_paths['3']) && p.tier_floor_paths['3'][0] === '**/migrations/**');
  check('parses build.max_parallel', p.build && p.build.max_parallel === 10);
  check('empty string stays empty', p.commands.test === '');
  const q = L.parseYaml([
    'a: "pytest -m \\"not integration\\""',
    "b: 'it''s fine'",
    'c: "C:\\\\tmp"',
  ].join('\n'));
  check('double-quoted escapes are unescaped', q.a === 'pytest -m "not integration"', JSON.stringify(q.a));
  check('single-quoted doubles collapse', q.b === "it's fine", JSON.stringify(q.b));
  check('escaped backslash collapses to one', q.c === 'C:\\tmp', JSON.stringify(q.c));
}

console.log('glob');
{
  check('** matches nested', L.globToRegex('**/migrations/**').test('db/migrations/001.sql'));
  check('** matches top', L.globToRegex('**/migrations/**').test('migrations/001.sql'));
  check('.env* matches at depth', L.globToRegex('.env*').test('apps/web/.env.local'));
  check('*.test.* matches', L.globToRegex('**/*.test.*').test('src/a/b.test.ts'));
  check('no false match', !L.globToRegex('infra/**').test('src/infra.ts'));
}

console.log('worktree detection');
{
  check('recognises the plugin worktree folder', L.isInsideWorktree('C:\\repo\\.worktrees\\t1'));
  check('recognises harness isolation worktrees', L.isInsideWorktree('C:\\repo\\.claude\\worktrees\\agent-abc'));
  check('a plain checkout is not a worktree', !L.isInsideWorktree('C:\\repo'));
}

console.log('cli init/new');
{
  let r = wh(repo, 'init');
  check('init creates profile', r.code === 0 && fs.existsSync(path.join(repo, '.workhorse', 'profile.yml')), r.err);
  // Give the fixture real commands so hooks have something to read.
  let prof = fs.readFileSync(path.join(repo, '.workhorse', 'profile.yml'), 'utf8');
  prof = prof.replace('  name: ""', '  name: "Fixture Co"');
  prof = prof.replace('  test: ""', '  test: "node -e \\"process.exit(0)\\""').replace('prod: { deploy: "", auto: false }', 'prod: { deploy: "deploy-prod.sh", auto: false }');
  fs.writeFileSync(path.join(repo, '.workhorse', 'profile.yml'), prof);
  r = wh(repo, 'new', 'Add health endpoint', '--tier', '0');
  check('new creates change', r.code === 0 && /"change_id"/.test(r.out), r.err);
  const id = JSON.parse(r.out).change_id;
  check('active set', wh(repo, 'active').out === id);
  check('new starts in the design phase', L.loadState(repo, id).phase === 'design');
  check('approvals scaffolded, brief left to the designer',
    fs.existsSync(path.join(repo, 'docs', 'sdlc', id, 'approvals.md')) && !fs.existsSync(path.join(repo, 'docs', 'sdlc', id, 'brief.md')));
  check('new writes the first clock row', /change created: Add health endpoint/.test(fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'conductor-log.md'), 'utf8')));
  // The change branch is cut at `new`, so design documents never land on the default branch
  // (every live run left local main ahead of origin with commits the squash already carried).
  check('new cuts and checks out the change branch', execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim() === L.loadState(repo, id).branch);
  check('new reports the branch it was cut from', JSON.parse(r.out).cut_from === 'master' || JSON.parse(r.out).cut_from === 'main', r.out);
  // Two human touches: Design (G2) and Ship (G4). Tier 3 adds Deploy (G5). Tier 0 is Ship only.
  check('required gates tier 0 = Ship', wh(repo, 'required').out.replace(/\s/g, '') === '["G4"]');
  wh(repo, 'state', 'set', 'tier', '2');
  check('required gates tier 2 = Design, Ship', wh(repo, 'required').out.replace(/\s/g, '') === '["G2","G4"]');
  wh(repo, 'state', 'set', 'tier', '3');
  check('required gates tier 3 = Design, Ship, Deploy', wh(repo, 'required').out.replace(/\s/g, '') === '["G2","G4","G5"]');
  check('gate names are exposed', JSON.parse(wh(repo, 'status', '--json').out).gate_names.G4 === 'Ship');
  let g = wh(repo, 'gate', 'G4', 'auto');
  check('cannot auto a required gate', g.code !== 0 && /cannot be auto-approved/.test(g.err), g.err);
  g = wh(repo, 'gate', 'G1', 'auto');
  check('G1 is never required, so it can be auto at any tier', g.code === 0, g.err);
  g = wh(repo, 'gate', 'G3', 'auto');
  check('G3 is never required, so it can be auto at any tier', g.code === 0, g.err);
  // A gate stamped auto while the tier was unknown goes back to pending once the tier requires it.
  wh(repo, 'state', 'set', 'tier', '0');
  check('G2 can be auto at tier 0', wh(repo, 'gate', 'G2', 'auto').code === 0);
  const t2 = wh(repo, 'state', 'set', 'tier', '2');
  check('setting a tier that requires G2 resets its auto to pending', /reset_to_pending/.test(t2.out) && wh(repo, 'state', 'get', 'gates.G2').out === 'pending', t2.out);
  wh(repo, 'state', 'set', 'tier', '0');
  const v = wh(repo, 'state', 'set', 'verification.status', 'green');
  check('cannot mark green without verification.md', v.code !== 0, v.out);

  // A greenfield repo with no commands must not report a green that proves nothing.
  const bare = path.join(tmp, 'bare');
  fs.mkdirSync(bare, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: bare });
  execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: bare });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: bare });
  wh(bare, 'init');
  wh(bare, 'new', 'Bootstrap');
  const bid = wh(bare, 'active').out;
  fs.writeFileSync(path.join(bare, 'docs', 'sdlc', bid, 'verification.md'),
    '# Verification\n\nStatus: green\n');
  const vac = wh(bare, 'state', 'set', 'verification.status', 'green');
  check('refuses a vacuous green when the profile defines no checks',
    vac.code !== 0 && /prove nothing/.test(vac.err), vac.err || vac.out);
}
const id = wh(repo, 'active').out;
const cwd = repo;
const base = { session_id: 's', cwd, hook_event_name: 'PreToolUse' };
function edit(file) { return { ...base, tool_name: 'Edit', tool_input: { file_path: path.join(repo, file) } }; }
function bash(command, extra) { return { ...base, tool_name: 'Bash', tool_input: { command }, ...(extra || {}) }; }

console.log('protect-paths');
{
  check('denies workflow edit', decision(hook('protect-paths.js', edit('.github/workflows/ci.yml'))) === 'deny');
  check('denies .env edit', decision(hook('protect-paths.js', edit('apps/api/.env.production'))) === 'deny');
  check('asks on migrations', decision(hook('protect-paths.js', edit('db/migrations/002.sql'))) === 'ask');
  check('allows src edit', decision(hook('protect-paths.js', edit('src/index.ts'))) === 'none');
  check('denies approvals.md', decision(hook('protect-paths.js', edit(`docs/sdlc/${id}/approvals.md`))) === 'deny');
  // A headless run cannot answer "ask". Once the human has approved the Design document, a
  // sensitive path that the approved plan names is allowed; one it does not name still asks.
  const cdir = path.join(repo, 'docs', 'sdlc', id);
  fs.writeFileSync(path.join(cdir, 'brief.md'), '# Brief\n\n## The short version\n\nx\n\n## Your decision\n\nApprove.\n');
  fs.writeFileSync(path.join(cdir, 'plan.md'), '# Plan\n\nT1 edits db/migrations/002.sql and adds the trigger.\n');
  check('sensitive path still asks before Design is approved', decision(hook('protect-paths.js', edit('db/migrations/002.sql'))) === 'ask');
  wh(repo, 'state', 'set', 'tier', '2');
  const g2 = wh(repo, 'approve', 'G2', '--accept-all');
  check('Design approved for the sensitive-path check', g2.code === 0, g2.err);
  const named = hook('protect-paths.js', edit('db/migrations/002.sql'));
  check('a sensitive path the approved plan names is allowed', decision(named) === 'allow' && /plan\.md/.test(named.hookSpecificOutput.permissionDecisionReason), JSON.stringify(named));
  check('a sensitive path the plan does not name still asks', decision(hook('protect-paths.js', edit('db/migrations/003.sql'))) === 'ask');
  check('a protected path is denied even when the plan names it', (() => { fs.appendFileSync(path.join(cdir, 'plan.md'), 'T2 edits .github/workflows/ci.yml\n'); return decision(hook('protect-paths.js', edit('.github/workflows/ci.yml'))) === 'deny'; })());
  wh(repo, 'gate', 'G2', 'pending'); wh(repo, 'state', 'set', 'tier', '0');
  fs.unlinkSync(path.join(cdir, 'brief.md')); fs.unlinkSync(path.join(cdir, 'plan.md'));
  check('no opinion outside repo', decision(hook('protect-paths.js', { ...base, cwd: os.tmpdir(), tool_name: 'Edit', tool_input: { file_path: path.join(os.tmpdir(), 'x.yml') } })) === 'none');
}

console.log('test-lock');
{
  check('allows test edit in normal mode', decision(hook('test-lock.js', edit('src/a.test.ts'))) === 'none');
  wh(repo, 'mode', 'fix');
  check('denies test edit in fix mode', decision(hook('test-lock.js', edit('src/a.test.ts'))) === 'deny');
  check('denies tests dir in fix mode', decision(hook('test-lock.js', edit('tests/e2e/login.spec.ts'))) === 'deny');
  check('allows src edit in fix mode', decision(hook('test-lock.js', edit('src/a.ts'))) === 'none');
  wh(repo, 'mode', 'normal');
}

console.log('worktree-fence');
{
  check('no fence without worktree', decision(hook('worktree-fence.js', edit('src/a.ts'))) === 'none');
  wh(repo, 'state', 'set', 'worktree', '.worktrees/' + id);
  check('denies main checkout src edit', decision(hook('worktree-fence.js', edit('src/a.ts'))) === 'deny');
  check('allows docs/sdlc edit', decision(hook('worktree-fence.js', edit(`docs/sdlc/${id}/plan.md`))) === 'none');
  check('allows edit inside worktree', decision(hook('worktree-fence.js', edit(`.worktrees/${id}/src/a.ts`))) === 'none');
  wh(repo, 'state', 'set', 'worktree', 'null');
}

console.log('bash-guard');
{
  check('denies force push', decision(hook('bash-guard.js', bash('git push --force origin wh/x'))) === 'deny');
  check('denies -f push', decision(hook('bash-guard.js', bash('git push -f'))) === 'deny');
  check('denies push to main', decision(hook('bash-guard.js', bash('git push origin main'))) === 'deny');
  check('allows push to change branch', decision(hook('bash-guard.js', bash('git push -u origin wh/2026-x'))) === 'none');
  // 0.4.0: every way of recording a decision is the human's, not a subagent's
  const sub = { agent_id: 'a1', agent_type: 'workhorse:wh-builder' };
  check('denies workhorse approve from a subagent', decision(hook('bash-guard.js', bash('workhorse approve', sub))) === 'deny');
  check('denies workhorse reject from a subagent', decision(hook('bash-guard.js', bash('node scripts/workhorse.js reject "x"', sub))) === 'deny');
  check('denies wh.js github-sync from a subagent', decision(hook('bash-guard.js', bash('node "/p/scripts/wh.js" github-sync', sub))) === 'deny');
  check('allows workhorse status from a subagent', decision(hook('bash-guard.js', bash('workhorse status', sub))) === 'none');
  check('denies rm -rf /', decision(hook('bash-guard.js', bash('rm -rf /'))) === 'deny');
  check('denies profile deny_commands', decision(hook('bash-guard.js', bash('terraform destroy -auto-approve'))) === 'deny');
  check('asks profile ask_commands', decision(hook('bash-guard.js', bash('terraform apply'))) === 'ask');
  check('allows plain test', decision(hook('bash-guard.js', bash('npm test'))) === 'none');
  check('denies prod deploy without G5', decision(hook('bash-guard.js', bash('./deploy-prod.sh'))) === 'deny');
  check('denies approve from subagent', decision(hook('bash-guard.js', bash(`node "${WH}" approve G4`, { agent_id: 'abc', agent_type: 'wh-conductor' }))) === 'deny');
  check('allows approve from main session', decision(hook('bash-guard.js', bash(`node "${WH}" approve G4`))) === 'none');
}

console.log('gate-guard');
{
  // Everything the designer writes comes before the Design gate, at every tier.
  wh(repo, 'state', 'set', 'tier', '2');
  check('allows spec write at tier 2 before Design', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/spec.md`))) === 'none');
  check('allows brief write at tier 2 before Design', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/brief.md`))) === 'none');
  check('denies ship.md at tier 2 before Design', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/ship.md`))) === 'deny');
  check('denies verification.md at tier 2 before Design', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/verification.md`))) === 'deny');
  check('denies push at tier 2 before Design', decision(hook('gate-guard.js', bash('git push -u origin wh/x'))) === 'deny');
  wh(repo, 'state', 'set', 'tier', '0');
  check('allows ship.md at tier 0 (no Design gate)', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/ship.md`))) === 'none');
  check('denies state.json direct edit', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/state.json`))) === 'deny');
  check('denies push without green verification', decision(hook('gate-guard.js', bash('git push -u origin wh/x'))) === 'deny');
  fs.writeFileSync(path.join(repo, 'docs', 'sdlc', id, 'verification.md'), '# Verification\n\nStatus: green\n');
  const v = wh(repo, 'state', 'set', 'verification.status', 'green');
  check('marks green with verification.md present', v.code === 0, v.err);
  check('allows push with green verification', decision(hook('gate-guard.js', bash('git push -u origin wh/x'))) === 'none');
  check('denies merge before G4', decision(hook('gate-guard.js', bash('gh pr merge 12'))) === 'deny');
  check('denies release.md before G4', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/release.md`))) === 'deny');
  // An approval must pin the packet it approves: committed, and hashed.
  const packetRel = `docs/sdlc/${id}/ship.md`;
  const packetBody = '# Ship\n\n## The short version\n\nPinned by the approval test.\n\n## Your decision\n\nApprove.\n';
  fs.writeFileSync(path.join(repo, packetRel), packetBody);
  const a = wh(repo, 'approve', 'G4', 'looks good');
  check('approve records', a.code === 0 && /approved/.test(a.out), a.err);
  const af = fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'approvals.md'), 'utf8');
  check('approvals.md has who/when/commit', /Who: tester@example.com/.test(af) && /Artifact commit:/.test(af));
  check('approval committed', /G4 approved/.test(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' })));
  const recorded = (af.slice(af.lastIndexOf("## G4:")).match(/Artifact commit: `([0-9a-f]{7,40})`/) || [])[1];
  const shaLine = af.slice(af.lastIndexOf("## G4:")).match(/Packet: `([^`]+)` sha256 `([0-9a-f]{64})`/) || [];
  const expectSha = require('crypto').createHash('sha256').update(packetBody).digest('hex');
  check('approval records the packet sha256 matching its content', shaLine[1] === packetRel && shaLine[2] === expectSha, JSON.stringify(shaLine.slice(1)));
  let inCommit = '';
  try { inCommit = execFileSync('git', ['show', `${recorded}:${packetRel}`], { cwd: repo, encoding: 'utf8' }); } catch (e) { inCommit = ''; }
  check('the recorded commit actually contains the approved packet', inCommit === packetBody, `recorded=${recorded}`);
  check('the approved packet is tracked, not left untracked', execFileSync('git', ['ls-files', packetRel], { cwd: repo, encoding: 'utf8' }).trim() === packetRel);
  check('allows merge after G4', decision(hook('gate-guard.js', bash('gh pr merge 12'))) === 'none');
  check('allows release.md after G4', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/release.md`))) === 'none');
  // --accept-all answers every decision with the recommendation and keeps any notes.
  fs.writeFileSync(path.join(repo, 'docs', 'sdlc', id, 'release.md'),
    '# Release\n\n## Decisions requested\n\n| # | Decision | Recommendation | Alternative |\n|---|---|---|---|\n| D1 | Deploy Friday | Wait for Monday | Deploy Friday |\n');
  const aa = wh(repo, 'approve', 'G5', '--accept-all', 'fine by me');
  check('--accept-all approves and composes the decision notes', aa.code === 0
    && /D1: recommendation accepted\. fine by me/.test(fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'approvals.md'), 'utf8')), aa.err);
  check('a rejection needs no decision answers', wh(repo, 'approve', 'G5', '--reject', 'not yet').code === 0);
  fs.unlinkSync(path.join(repo, 'docs', 'sdlc', id, 'release.md')); // the next checks want no packet on disk
  const rj = wh(repo, 'approve', 'G5', '--reject');
  check('reject needs notes', rj.code !== 0);
  const rj2 = wh(repo, 'approve', 'G5', '--reject', 'not yet');
  check('reject records', rj2.code === 0 && wh(repo, 'state', 'get', 'gates.G5').out === 'rejected');
  const af2 = fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'approvals.md'), 'utf8');
  check('a decision with no packet file says so rather than inventing a hash', /## G5: rejected[\s\S]*sha256 `missing/.test(af2));
}

console.log('verify-before-stop');
{
  wh(repo, 'phase', 'build');
  wh(repo, 'state', 'set', 'verification.status', 'red');
  // Without a run lock there is no run to hold (0.3.12): a person's own session is let go.
  let r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop' });
  check('lets a session stop when no run holds the lock', r.decision !== 'block');
  wh(repo, 'lock', 'acquire', '--holder', 'test');
  // The lock records the session that took it; a different session is let go, the same one is held.
  const lockPath = path.join(L.stateRoot(repo), 'run.lock');
  const lk = JSON.parse(fs.readFileSync(lockPath, 'utf8')); lk.session = 'sess-run'; fs.writeFileSync(lockPath, JSON.stringify(lk));
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop', session_id: 'sess-other' });
  check('lets another session stop while a run holds the lock', r.decision !== 'block');
  base.session_id = 'sess-run';
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop' });
  check('blocks stop in build when red', r.decision === 'block');
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop', stop_hook_active: true });
  check('does not loop when stop_hook_active', r.decision !== 'block');
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'SubagentStop', agent_type: 'wh-bug-reviewer' });
  check('lets unrelated subagents stop', r.decision !== 'block');
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'SubagentStop', agent_type: 'wh-builder' });
  check('blocks builder stop when red', r.decision === 'block');
  wh(repo, 'state', 'set', 'verification.status', 'green');
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop' });
  check('allows stop when green', r.decision !== 'block');
  wh(repo, 'phase', 'review');
}

console.log('session-context');
{
  const r = hook('session-context.js', { ...base, hook_event_name: 'SessionStart' });
  const ctx = r.hookSpecificOutput && r.hookSpecificOutput.additionalContext || '';
  check('mentions active change', ctx.includes(id));
  check('mentions required gates', /Required human gates/.test(ctx));
}

console.log('digest');
{
  // A second change, so the digest cases are not entangled with the gate-guard fixture above.
  const r = wh(repo, 'new', 'Digest fixture change', '--tier', '1');
  const did = JSON.parse(r.out).change_id;
  const ddir = path.join(repo, 'docs', 'sdlc', did);
  const d = () => JSON.parse(wh(repo, 'digest').out);

  check('digest identifies the change', d().change_id === did && d().title === 'Digest fixture change');
  check('digest reads tier and required gates', d().tier === 1 && d().required_human_gates.join() === 'G2,G4');
  check('digest reads the client name', d().client === 'Fixture Co', d().client);
  check('repo falls back to folder name for a non-hosted remote', d().repo === 'repo');

  // Problem and outcome live at the top of the brief. A brief without its closing section is
  // still being written, so it is not yet waiting on anyone.
  fs.writeFileSync(path.join(ddir, 'brief.md'),
    '# Brief\n\n## Problem\n\nOrders vanish with no trace.\n\n## Outcome\n\nEvery order is logged.\n');
  check('digest extracts problem from the brief', d().problem === 'Orders vanish with no trace.');
  check('digest extracts outcome from the brief', d().outcome === 'Every order is logged.');
  check('a brief without "## Your decision" is not yet waiting on the human', d().waiting_on === 'Agents' && d().blocking_gate === null);
  fs.appendFileSync(path.join(ddir, 'brief.md'), '\n## Your decision\n\nApprove.\n');
  // A finished brief is still the agents' while the auditor round runs; only `present` hands it over.
  check('a finished brief is not waiting on the human until it is presented', d().waiting_on === 'Agents' && d().blocking_gate === null);
  const early = wh(repo, 'present', 'G4');
  check('present refuses a gate whose packet is missing', early.code !== 0 && /no "## Your decision"/.test(early.err), early.err);
  const pres = wh(repo, 'present', 'G2');
  check('present prints the gate name, the packet and the commands', pres.code === 0 && /Design \(G2\) is waiting on you/.test(pres.out) && /workhorse approve/.test(pres.out) && /GitHub: /.test(pres.out), pres.err || pres.out);
  check('present logs a clock row', /G2 Design presented/.test(fs.readFileSync(path.join(ddir, 'conductor-log.md'), 'utf8')));
  check('a presented brief at tier 1 waits on the human at Design', d().waiting_on === 'You (G2)' && d().blocking_gate === 'G2');
  const g2 = wh(repo, 'approve', 'G2', 'build it');
  check('Design approval records', g2.code === 0, g2.err);

  wh(repo, 'phase', 'review');
  check('waiting_on stays Agents while ship.md is missing', d().waiting_on === 'Agents');
  const shipDoc = (findingRow) => [
    '# Ship', '', '## The short version', '',
    'Adds an order audit log. Twelve tests. You are asked to approve the merge.', '',
    '## What the reviewers found', '',
    '| Severity | Reviewer | File:line | Finding | Resolution |', '|---|---|---|---|---|',
    findingRow, '',
    '## Decisions', '',
    '| # | Decision | Recommendation |', '|---|---|---|',
    '| D1 | Retain logs for 7 years | Accept |', '| D2 | Log to Postgres not files | Accept |', '',
    '## Your decision', '', 'Approve.', '',
  ].join('\n');
  fs.writeFileSync(path.join(ddir, 'ship.md'), shipDoc('| high | bug | src/log.ts:12 | Drops the last order | fix before merge |'));
  // The Ship document is never the human's problem while it carries a blocker.
  check('a ship.md with red verification is not waiting on the human', d().waiting_on === 'Agents' && d().ship_blockers.some((b) => /verification is none/.test(b)), JSON.stringify(d().ship_blockers));
  fs.writeFileSync(path.join(ddir, 'verification.md'), '# Verification\n\nStatus: green\n');
  wh(repo, 'state', 'set', 'verification.status', 'green');
  check('a ship.md with an unresolved high finding is not waiting on the human',
    d().blocking_gate === null && d().ship_blockers.length === 1 && /high finding without a resolution/.test(d().ship_blockers[0]), JSON.stringify(d().ship_blockers));
  const refused = wh(repo, 'approve', 'G4', '--accept-all');
  check('approve refuses the Ship gate while a blocker stands', refused.code !== 0 && /cannot approve G4/.test(refused.err), refused.err);
  fs.writeFileSync(path.join(ddir, 'ship.md'), shipDoc('| high | bug | src/log.ts:12 | Drops the last order | fixed in a1b2c3d |'));
  check('a clean ship document is still not waiting until presented', d().waiting_on === 'Agents' && d().ship_blockers.length === 0);
  check('present accepts a clean ship document', wh(repo, 'present', 'G4').code === 0);
  check('waiting_on names the gate once the ship document is clean and presented', d().waiting_on === 'You (G4)');
  check('blocking_gate is G4', d().blocking_gate === 'G4');
  check('digest extracts the short version as the TL;DR', /order audit log/i.test(d().tldr));
  check('digest extracts decision rows, skipping the header', d().decisions.length === 2, JSON.stringify(d().decisions));
  check('decision row keeps id and text', /^D1 /.test(d().decisions[0]));

  // A rejected gate waits on the agents reworking it, not on the human; presenting it again sets
  // it back to pending. The old rule (anything not approved is waiting) showed Approve buttons
  // during rework and hid the re-presentation from phone notifications.
  const rjd = wh(repo, 'approve', 'G4', '--reject', 'needs a retention ADR');
  check('reject succeeds for the digest fixture', rjd.code === 0, rjd.err);
  check('a rejected gate waits on Agents, not on the human',
    d().waiting_on === 'Agents' && d().blocking_gate === null, JSON.stringify([d().waiting_on, d().blocking_gate]));
  wh(repo, 'present', 'G4');
  check('presenting the gate again puts it back on the human', d().blocking_gate === 'G4' && wh(repo, 'state', 'get', 'gates.G4').out === 'pending');

  // Approval flips waiting_on and is parsed back out of approvals.md.
  // The packet asks two decisions (D1, D2). An approval must answer both by id: a live G4
  // approval answered one of two, and the retro found the same slip in the change before it.
  const di = d().decision_items;
  check('digest exposes structured decision items', di.length === 2 && di[0].id === 'D1'
    && di[0].decision === 'Retain logs for 7 years' && di[0].recommendation === 'Accept', JSON.stringify(di));
  const half = wh(repo, 'approve', 'G4', 'D1 accepted, ship it');
  check('approve refuses when a packet decision goes unanswered', half.code !== 0 && /do not answer D2/.test(half.err), half.err);
  check('the refusal names the unanswered decision', /D2: Log to Postgres not files/.test(half.err), half.err);
  const ap = wh(repo, 'approve', 'G4', 'D1: accepted. D2: alternative, files are fine here. ship it');
  check('approve succeeds once every decision is answered', ap.code === 0, ap.err);
  const la = d().last_approval;
  check('digest parses the full approval block', la && la.gate === 'G4' && la.status === 'approved'
    && la.who === 'tester@example.com' && la.at.length > 0 && la.notes === 'D1: accepted. D2: alternative, files are fine here. ship it', JSON.stringify(la));
  check('waiting_on clears once the gate is approved', d().waiting_on === 'Agents');

  // page_id round-trips so a resync updates rather than duplicates.
  check('tracker page_id starts null', d().tracker.page_id === null);
  wh(repo, 'state', 'set', 'tracker.page_id', 'notion-abc-123');
  check('tracker page_id round-trips', d().tracker.page_id === 'notion-abc-123');
  check('tracker provider is empty until configured', d().tracker.provider === '');

  const all = JSON.parse(wh(repo, 'digest', '--all').out);
  check('digest --all covers every change', Array.isArray(all) && all.length === 2, `got ${all.length}`);
  check('digest --all includes both ids', all.map((x) => x.change_id).sort().join() === [id, did].sort().join());
  check('digest carries the clock', typeof d().clock.agent_minutes === 'number' && d().clock.budget_minutes === 30);

  wh(repo, 'active', id); // restore the original fixture for later blocks
}

console.log('clock');
{
  // Three real runs took about a hundred hours for under three hours of code-writing, and
  // nothing could say so. The clock splits wall time from the timestamps the CLI already stamps.
  const t0 = Date.parse('2026-09-14T10:00:00.000Z');
  const at = (m) => new Date(t0 + m * 60000).toISOString();
  const log = [
    `${at(0)} | design | conductor | change created`,
    `${at(12)} | design | wh-designer | brief.md written`,          // 12 m agents (design)
    // 30 m waiting: the approval at 42 closes it
    `${at(50)} | build | wh-builder | done`,                         // 8 m agents (build)
    `${at(140)} | build | conductor | resumed after a rate limit kill`, // 90 m dead
    `${at(146)} | verify | wh-verifier | green`,                     // 6 m agents (build row a)
    `${at(300)} | review | wh-shipper | ship.md written`,            // 154 m: over the gap limit, unexplained
  ].join('\n');
  const approvals = `## G2: approved\n\n- Who: t\n- When: ${at(42)}\n- Notes: ok\n`;
  const c = L.computeClock({ log, approvals, state: { tier: 1, phase: 'review', gate_opened: { G2: at(30) } }, profile: {}, pending_gate: true, now: t0 + 310 * 60000 });
  check('agent minutes exclude waiting, dead and gaps', c.agent_minutes === 26, JSON.stringify(c));
  check('waiting counts up to each approval, and the open gate now', c.waiting_minutes === 40, JSON.stringify(c));
  check('dead time is the interval ending in a resume row', c.dead_minutes === 90, String(c.dead_minutes));
  check('an unexplained long gap is reported, not counted', c.gap_minutes === 154 && c.gaps.length === 1, JSON.stringify(c.gaps));
  check('your time is measured from when Paddock opened the packet', c.human_minutes === 12, String(c.human_minutes));
  check('tier 1 budget is 30 minutes and 26 is within it', c.budget_minutes === 30 && c.within_budget === true);
  check('agent minutes are attributed per phase', c.phases.find((p) => p.phase === 'design').agent_minutes === 12 && c.phases.find((p) => p.phase === 'build').agent_minutes === 14, JSON.stringify(c.phases));
  check('the one-line form reads plainly', /^Clock: agents 26 m of 30 m budget · waiting on you 40 m · dead 1 h 30 m/.test(L.formatClock(c)), L.formatClock(c));
  const over = L.computeClock({ log, approvals, state: { tier: 0, phase: 'done' }, profile: { budgets: { agent_minutes: { 0: 20 } } }, now: t0 + 310 * 60000 });
  check('a done change stops at its last event', over.wall_minutes === 300 && over.waiting_minutes === 30, JSON.stringify(over));
  check('the profile can override a budget, and over-budget is flagged', over.budget_minutes === 20 && over.within_budget === false);
  // The older table format from the first live runs still parses (UTC assumed when no zone).
  const old = L.parseConductorLog('| 2026-09-11T02:01 | intent | conductor | created |\n| 2026-09-11T02:05 | intent | wh-intent-writer | intent.md |');
  check('the legacy table format parses with UTC assumed', old.length === 2 && old[1].t - old[0].t === 4 * 60000, JSON.stringify(old));
  const cl = wh(repo, 'clock');
  check('the CLI prints the clock line', cl.code === 0 && /^Clock: /.test(cl.out), cl.err || cl.out);
  check('the CLI prints the clock as JSON', typeof JSON.parse(wh(repo, 'clock', '--json').out).wall_minutes === 'number');
  check('fmtAge renders three hours as 3h', L.fmtAge(180) === '3h', L.fmtAge(180));
  const boundaries = [0, 59, 60, 61, 1439].map(L.fmtAge).join('|');
  check('fmtAge minute and hour boundaries', boundaries === '0m|59m|1h|1h 1m|23h 59m', boundaries);
  const dayScale = [1440, 1500, 3125, -5, NaN].map(L.fmtAge).join('|');
  check('fmtAge drops minutes at day scale and floors bad input to 0m', dayScale === '1d|1d 1h|2d 4h|0m|0m', dayScale);
  const missing = [undefined, null, ''].map(L.fmtAge).join('|');
  check('fmtAge treats missing input as 0m', missing === '0m|0m|0m', missing);
}

console.log('known failures');
{
  // The same pre-existing failure was derived four separate times in one live run.
  check('no known failures to start', /No known failures/.test(wh(repo, 'known-failure', 'list').out));
  const bad = wh(repo, 'known-failure', 'add', 'typecheck');
  check('add needs command, base and reason', bad.code !== 0 && /usage/.test(bad.err));
  const ok = wh(repo, 'known-failure', 'add', 'typecheck', '--command', 'npx tsc --noEmit', '--base', 'abc1234', '--reason', 'moderationApi.ts TS2698, fails on main before this change');
  check('add records the failure', ok.code === 0 && fs.existsSync(path.join(repo, '.workhorse', 'known-failures.md')), ok.err);
  const rows = JSON.parse(wh(repo, 'known-failure', 'list', '--json').out);
  check('list returns the row with its base reproduction and the recording change', rows.length === 1 && rows[0].check === 'typecheck' && rows[0].base === 'abc1234' && rows[0].change === id, JSON.stringify(rows));
}

console.log('status/metrics');
{
  const s = wh(repo, 'status', '--json');
  check('status json', s.code === 0 && JSON.parse(s.out).change_id === id, s.err);
  const m = wh(repo, 'status', '--metrics');
  check('metrics computed', m.code === 0 && JSON.parse(m.out).changes === 2, m.err || m.out);
}

console.log('conductor log');
{
  const before = Date.now();
  const r = wh(repo, 'log', 'wh-spec-architect | spec.md written,', '19 requirements');
  const f = path.join(repo, 'docs', 'sdlc', id, 'conductor-log.md');
  const last = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').pop() : '';
  const [stamp, phase, ...rest] = last.split(' | ');
  const t = Date.parse(stamp);
  check('log appends one line with the phase and message', r.code === 0 && phase === L.loadState(repo, id).phase && rest.join(' | ') === 'wh-spec-architect | spec.md written, 19 requirements', r.err || last);
  check('log stamps the real time, not a supplied one', t >= before - 1000 && t <= Date.now() + 1000, stamp);
  check('log refuses an empty message', wh(repo, 'log').code !== 0);
  wh(repo, 'log', `${phase} | wh-release-engineer | release.md written`);
  const repeated = fs.readFileSync(f, 'utf8').trim().split('\n').pop();
  check('log drops a phase the caller repeated', repeated.split(' | ').filter((s) => s === phase).length === 1, repeated);
}

console.log('plugin structure');
{
  const AG = path.join(PLUGIN, 'agents');
  const SK = path.join(PLUGIN, 'skills');
  const agentFiles = fs.readdirSync(AG).filter((f) => f.endsWith('.md'));
  const front = (f) => (fs.readFileSync(path.join(AG, f), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const field = (fm, k) => ((fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1] || '').trim();

  const misnamed = agentFiles.filter((f) => field(front(f), 'name') !== f.replace(/\.md$/, ''));
  check('every agent file name matches its frontmatter name', misnamed.length === 0, misnamed.join(', '));

  // A typo in a skills: list silently drops that skill from the agent, so check every reference.
  const skillDirs = new Set(fs.readdirSync(SK));
  const missing = [];
  for (const f of agentFiles) {
    const list = field(front(f), 'skills').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of list) if (!skillDirs.has(s)) missing.push(`${f}: ${s}`);
  }
  check('every skill an agent preloads exists', missing.length === 0, missing.join('; '));

  const noDefense = agentFiles.filter((f) => !/Prompt defense baseline/i.test(fs.readFileSync(path.join(AG, f), 'utf8')));
  check('every agent carries the prompt defense baseline', noDefense.length === 0, noDefense.join(', '));

  const verifierTools = field(front('wh-verifier.md'), 'tools');
  check('verifier cannot spawn agents (least privilege: Bash without Agent)', !/\bAgent\b/.test(verifierTools), verifierTools);

  // A verification report is read later by people and by retrieval (Studbook), and a table of exit
  // codes answers "how big was the test suite?" for neither: Studbook's cross-doc eval could not
  // find a suite's size because the record said it only as "# pass 47" in a log excerpt.
  const vTemplate = fs.readFileSync(path.join(PLUGIN, 'templates', 'verification.md'), 'utf8');
  check('verification template has a plain-words "What was measured" section', /^## What was measured$/m.test(vTemplate));
  const verifier = fs.readFileSync(path.join(AG, 'wh-verifier.md'), 'utf8');
  check('verifier is told to fill "What was measured" from the logs, compared with the previous change',
    /What was measured/.test(verifier) && /previous change/i.test(verifier));

  const ecc = agentFiles.filter((f) => f.startsWith('ecc-'));
  check('nine ECC agents vendored', ecc.length === 9, ecc.join(', '));
  const noAdapter = ecc.filter((f) => !fs.readFileSync(path.join(AG, f), 'utf8').includes('## WorkHorse adapter'));
  check('every vendored ECC agent has the WorkHorse adapter', noAdapter.length === 0, noAdapter.join(', '));
  check('vendored ECC licence and manifest present',
    fs.existsSync(path.join(PLUGIN, 'vendor', 'ecc', 'LICENSE')) && fs.existsSync(path.join(PLUGIN, 'vendor', 'ecc', 'VENDORED.md')));
  const rulesFor = ['common', 'typescript', 'python', 'react', 'web'].filter((r) => !fs.existsSync(path.join(PLUGIN, 'vendor', 'ecc', 'rules', r)));
  check('every rules folder wh-language-standards names is vendored', rulesFor.length === 0, rulesFor.join(', '));

  const conductor = fs.readFileSync(path.join(AG, 'wh-conductor.md'), 'utf8');
  const undispatchable = ecc.filter((f) => !conductor.includes(`workhorse:${f.replace(/\.md$/, '')}`));
  check('the conductor can name every vendored ECC agent', undispatchable.length === 0, undispatchable.join(', '));

  // The two-gates roster (2026-09-19): ten agents merged into three, and none of the retired
  // names may survive anywhere the runtime reads, or a dispatch would silently fail.
  const roster = ['wh-designer', 'wh-polish', 'wh-shipper', 'wh-verifier', 'wh-conductor', 'wh-builder', 'wh-fixer',
    'wh-constraint-auditor', 'wh-eval-designer', 'wh-bug-reviewer', 'wh-conformance-reviewer', 'wh-security-reviewer',
    'wh-adoption-reviewer', 'wh-retro-learner', 'wh-tracker-sync'];
  const absent = roster.filter((a) => !agentFiles.includes(`${a}.md`));
  check('every agent of the two-gates roster exists', absent.length === 0, absent.join(', '));
  const retired = /wh-(intent-writer|risk-classifier|spec-architect|implementation-planner|readability-reviewer|simplifier|eval-runner|packet-compiler|release-engineer|express-dev)\b/;
  const stillNamed = [];
  for (const dir of ['agents', 'skills', 'templates', 'hooks/scripts', 'scripts']) {
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (retired.test(fs.readFileSync(p, 'utf8'))) stillNamed.push(path.relative(PLUGIN, p)); } };
    walk(path.join(PLUGIN, dir));
  }
  check('no runtime file names a retired agent', stillNamed.length === 0, stillNamed.join(', '));
  const undispatchableWh = roster.filter((a) => a !== 'wh-conductor' && !conductor.includes(`workhorse:${a}`));
  check('the conductor can name every roster agent', undispatchableWh.length === 0, undispatchableWh.join(', '));
  const noEffort = agentFiles.filter((f) => f !== 'wh-conductor.md' && !/^effort:\s*(low|medium|high|xhigh|max)$/m.test(front(f)));
  check('every agent but the conductor sets a reasoning effort', noEffort.length === 0, noEffort.join(', '));
  const reviewers = agentFiles.filter((f) => /reviewer|silent-failure|test-analyzer/.test(f));
  const noReportFile = reviewers.filter((f) => !/reviews\//.test(fs.readFileSync(path.join(AG, f), 'utf8')));
  check('every reviewer writes its report under reviews/', noReportFile.length === 0, noReportFile.join(', '));
  for (const t of ['brief.md', 'ship.md']) {
    check(`templates/${t} ends with the "## Your decision" section`, /^## Your decision/m.test(fs.readFileSync(path.join(PLUGIN, 'templates', t), 'utf8')));
  }
  check('the retired templates are gone', !fs.existsSync(path.join(PLUGIN, 'templates', 'intent.md')) && !fs.existsSync(path.join(PLUGIN, 'templates', 'review-packet.md')));
  check('the design skill replaces intent, spec and plan',
    fs.existsSync(path.join(SK, 'design', 'SKILL.md')) && !fs.existsSync(path.join(SK, 'intent')) && !fs.existsSync(path.join(SK, 'spec')) && !fs.existsSync(path.join(SK, 'plan')));
  const designer = fs.readFileSync(path.join(AG, 'wh-designer.md'), 'utf8');
  check('the designer writes the brief last', /brief\.md[^\n]*last|last[^\n]*brief\.md/i.test(designer));
  // Run 1 of 0.3.1: eval cases written after the plan had no tests, and slash-named task
  // branches collided with the change branch. Both are now rules, and both are checked here.
  check('the designer writes evals.md so every case is planned', /evals\.md/.test(designer) && /exactly one/i.test(designer));
  const builder = fs.readFileSync(path.join(AG, 'wh-builder.md'), 'utf8');
  check('task branches use a dash, never a slash', /-t<N>/.test(conductor) && !/\/t<N>/.test(conductor) && /-t<N>/.test(builder) && !/\/t<N>/.test(builder));
  check('the review-phase fix runs with the test lock off', /mode `review`[\s\S]{0,300}WH mode normal/.test(conductor));
  check('the conductor dispatches the retro in the background', /wh-retro-learner[\s\S]{0,200}run_in_background: true/.test(conductor));
}

console.log('changelog');
{
  // Studbook answers release-order questions from CHANGELOG.md. A release that bumps the version
  // without an entry leaves it answering from a stale record, silently -- so the newest entry must
  // be the current version, and every entry after the oldest must name the one it follows.
  const changelog = fs.readFileSync(path.join(PLUGIN, 'CHANGELOG.md'), 'utf8');
  const version = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/gm)].map((m) => m[1]);
  check('CHANGELOG.md has an entry for the current plugin version, first', versions[0] === version,
    `plugin.json says ${version}, newest entry is ${versions[0]}`);
  const follows = [...changelog.matchAll(/^Follows (\d+\.\d+\.\d+) \(/gm)].map((m) => m[1]);
  const broken = follows.map((f, i) => (f === versions[i + 1] ? null : `${versions[i]} follows ${f}, not ${versions[i + 1]}`)).filter(Boolean);
  check('every changelog entry names the release before it, by version and content',
    follows.length === versions.length - 1 && broken.length === 0, broken.join('; ') || `${follows.length} follows lines`);
  // From 0.5.0 a release says what the run ledger shows for it, or that it is not measured yet,
  // so a claim of "faster" always points at runs.
  const entries = changelog.split(/^(?=## \d+\.\d+\.\d+ — )/m).filter((e) => /^## \d/.test(e));
  const LGc = require(path.join(PLUGIN, 'scripts', 'wh-ledger.js'));
  const missing = entries.filter((e) => LGc.cmpVersion(/^## (\S+)/.exec(e)[1], '0.5.0') >= 0 && !/^- Ledger: /m.test(e)).map((e) => /^## (\S+)/.exec(e)[1]);
  check('every release from 0.5.0 carries a "- Ledger:" line', missing.length === 0, missing.join(', '));
}

console.log('artifact-check');
{
  // Live runs wrote a 2,279-line spec and a 1,124-line eval plan for a personal website; prompt
  // guidance alone did not hold, so a hook measures after each write.
  const az = path.join(tmp, 'az');
  fs.mkdirSync(az, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: az, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  wh(az, 'init');
  const aid = JSON.parse(wh(az, 'new', 'Size me', '--tier', '1').out).change_id;
  const putText = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(az, rel)), { recursive: true });
    fs.writeFileSync(path.join(az, rel), text);
    return { session_id: 's', cwd: az, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(az, rel) } };
  };
  const put = (name, n) => putText(`docs/sdlc/${aid}/${name}`, Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  const res = (input) => hook('artifact-check.js', input);

  const big = res(put('brief.md', 90));
  check('a tier-1 brief over 80 lines is sent back to be cut', big.decision === 'block' && /90 lines; the limit for brief\.md at tier 1 is 80/.test(big.reason || ''), JSON.stringify(big));
  check('a brief within the limit passes silently', res(put('brief.md', 70)).decision === undefined);
  check('a tier-1 spec over 120 lines is sent back', res(put('spec.md', 130)).decision === 'block');
  check('a tier-1 ship document over 100 lines is sent back', res(put('ship.md', 110)).decision === 'block');
  wh(az, 'state', 'set', 'tier', '2');
  check('the same spec passes at tier 2 (limit 250)', res(put('spec.md', 130)).decision === undefined);
  wh(az, 'state', 'set', 'tier', '3');
  check('a tier-3 spec is capped at 400', res(put('spec.md', 401)).decision === 'block');
  check('a tier-3 plan over 300 lines is sent back', res(put('plan.md', 320)).decision === 'block');
  wh(az, 'state', 'set', 'tier', '1');
  // Eval cases are counted, not just lines: every case is a test someone must run.
  const cases = (n) => '# Evals\n\n| ID | Category | Given |\n|---|---|---|\n' + Array.from({ length: n }, (_, i) => `| E${i + 1} | golden | x |`).join('\n') + '\n';
  check('16 eval cases at tier 1 is sent back', res(putText(`docs/sdlc/${aid}/evals.md`, cases(16))).decision === 'block');
  check('15 eval cases at tier 1 passes', res(putText(`docs/sdlc/${aid}/evals.md`, cases(15))).decision === undefined);
  // Reviewer reports are files now, capped so the fixer and shipper can read them.
  check('a 61-line reviewer report at tier 1 is sent back', res(putText(`docs/sdlc/${aid}/reviews/bug.md`, 'x\n'.repeat(61))).decision === 'block');
  check('a 60-line reviewer report passes', res(putText(`docs/sdlc/${aid}/reviews/bug.md`, 'x\n'.repeat(60))).decision === undefined);
  // A finished Ship document with a blocker is sent back with the reason.
  const ship = (row) => `# Ship\n\n## What the reviewers found\n\n| Severity | Reviewer | File:line | Finding | Resolution |\n|---|---|---|---|---|\n${row}\n\n## Your decision\n\nApprove.\n`;
  const blocked = res(putText(`docs/sdlc/${aid}/ship.md`, ship('| medium | security | a.ts:1 | Leaks the id | open |')));
  check('a finished ship.md with an open medium finding is sent back', blocked.decision === 'block' && /medium finding without a resolution/.test(blocked.reason) && /verification is none/.test(blocked.reason), JSON.stringify(blocked));
  check('an unfinished ship.md is left alone while it is being written', res(putText(`docs/sdlc/${aid}/ship.md`, '# Ship\n\n| medium | x | y | z | open |\n')).decision === undefined);
  fs.writeFileSync(path.join(az, 'README.md'), 'x\n'.repeat(1000));
  check('files outside a change folder are ignored',
    res({ session_id: 's', cwd: az, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(az, 'README.md') } }).decision === undefined);
}

console.log('phase done');
{
  // A live run reached done with release.md, retro.md and the log never committed.
  const pd = path.join(tmp, 'pd');
  fs.mkdirSync(pd, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: pd, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  wh(pd, 'init');
  g('add', '.'); g('commit', '-q', '-m', 'onboard');
  const pid = JSON.parse(wh(pd, 'new', 'Close me', '--tier', '0').out).change_id;
  const dir = `docs/sdlc/${pid}`;
  // The retro runs in the background after the close and commits its own file, so "done" no
  // longer waits for it (it used to refuse without retro.md).
  fs.writeFileSync(path.join(pd, 'unrelated.txt'), 'not part of the change\n');
  fs.mkdirSync(path.join(pd, '.workhorse', 'instincts'), { recursive: true });
  fs.writeFileSync(path.join(pd, '.workhorse', 'instincts', 'wait-for-close.md'), '---\nid: wait-for-close\nconfidence: 0.7\n---\n');
  const r = wh(pd, 'phase', 'done');
  check('phase done commits the change folder', r.code === 0 && g('status', '--porcelain', '--', dir) === '' && g('log', '-1', '--format=%s') === `chore(sdlc): close ${pid}`, r.err || g('status', '--porcelain'));
  check('phase done reports the commit', r.code === 0 && JSON.parse(r.out).committed === g('log', '-1', '--format=%h'), r.out);
  check('phase done leaves files outside the change folder alone', g('status', '--porcelain').includes('unrelated.txt'));
  check('the close commit carries the retro instincts too',
    g('ls-files', '.workhorse/instincts').includes('wait-for-close.md') && g('status', '--porcelain', '--', '.workhorse/instincts') === '');
  JSON.parse(wh(pd, 'new', 'No retro', '--tier', '0').out);
  check('phase done closes a change without a retro, and still accepts --no-retro', wh(pd, 'phase', 'done', '--no-retro').code === 0);
}

console.log('control state location');
{
  // A fresh fixture: these tests move branches and add worktrees, which must not disturb the rest.
  const cs = path.join(tmp, 'cs');
  fs.mkdirSync(cs, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: cs, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  wh(cs, 'init');
  g('add', '.'); g('commit', '-q', '-m', 'onboard');   // profile tracked, as in a real client repo
  const cid = JSON.parse(wh(cs, 'new', 'Survive checkout', '--tier', '1').out).change_id;
  wh(cs, 'phase', 'build');

  const stateAt = path.join(cs, '.git', 'workhorse', 'changes', cid, 'state.json');
  check('state.json lives in the git common dir', fs.existsSync(stateAt));
  check('the active change lives in the git common dir',
    fs.readFileSync(path.join(cs, '.git', 'workhorse', 'active'), 'utf8').trim() === cid);
  check('no state.json is written into docs/sdlc', !fs.existsSync(path.join(cs, 'docs', 'sdlc', cid, 'state.json')));
  check('.gitignore covers the legacy active file', fs.readFileSync(path.join(cs, '.gitignore'), 'utf8').includes('.workhorse/active'));

  // The bug this guards: checking out the change branch rewrote tracked state from the branch point,
  // so the active change went empty, the phase went backwards, and every state-driven hook stood down.
  g('checkout', '-q', '-b', 'elsewhere', 'HEAD');
  g('commit', '-q', '--allow-empty', '-m', 'other work');
  check('the active change survives a branch checkout', wh(cs, 'active').out === cid);
  check('the phase survives a branch checkout', wh(cs, 'state', 'get', 'phase').out === 'build');

  // Worktrees share the same state, so hooks enforce inside builder worktrees too.
  const wt = path.join(tmp, 'cs-wt');
  g('worktree', 'add', '-q', wt, '-b', 'builder-t1');
  check('a worktree sees the same active change', wh(wt, 'active').out === cid);
  check('a worktree sees the same phase', wh(wt, 'state', 'get', 'phase').out === 'build');
  wh(wt, 'mode', 'fix');
  check('a change made from a worktree is visible in the main checkout', wh(cs, 'state', 'get', 'mode').out === 'fix');
  const wtTestEdit = { session_id: 's', cwd: wt, hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: path.join(wt, 'tests', 'a.test.js') } };
  check('test-lock enforces inside a builder worktree', decision(hook('test-lock.js', wtTestEdit)) === 'deny');
  wh(cs, 'mode', 'normal');

  // Control state is managed by the CLI only, including from a worktree, where it sits outside the root.
  const editMain = { session_id: 's', cwd: cs, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: stateAt } };
  const writeWt = { session_id: 's', cwd: wt, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: stateAt } };
  check('protect-paths denies editing control state', decision(hook('protect-paths.js', editMain)) === 'deny');
  check('protect-paths denies editing control state from a worktree', decision(hook('protect-paths.js', writeWt)) === 'deny');

  // The worktree above was cut before any design document existed. Once Design is approved in the
  // main checkout, a builder inside that stale worktree may still edit the sensitive paths the plan
  // names: the hook reads the plan from the main checkout (wasl, run 3 of 0.3.4).
  const csDir = path.join(cs, 'docs', 'sdlc', cid);
  fs.writeFileSync(path.join(csDir, 'brief.md'), '# Brief\n\n## The short version\n\nx\n\n## Your decision\n\nApprove.\n');
  fs.writeFileSync(path.join(csDir, 'plan.md'), '# Plan\n\nT1 edits db/migrations/009.sql.\n');
  wh(cs, 'state', 'set', 'tier', '2');
  check('Design approved in the main checkout', wh(cs, 'approve', 'G2', '--accept-all').code === 0);
  check('the stale worktree has no copy of the plan', !fs.existsSync(path.join(wt, 'docs', 'sdlc', cid, 'plan.md')));
  const wtSensitive = { session_id: 's', cwd: wt, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(wt, 'db', 'migrations', '009.sql') } };
  check('a sensitive path the approved plan names is allowed from a stale worktree', decision(hook('protect-paths.js', wtSensitive)) === 'allow');
}

console.log('legacy state migration');
{
  const lg = path.join(tmp, 'legacy');
  fs.mkdirSync(lg, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: lg });
  wh(lg, 'init');
  // Lay down the old layout by hand: the active id in .workhorse/active, state.json in docs/sdlc.
  const lid = '2026-01-01-old-change';
  fs.mkdirSync(path.join(lg, 'docs', 'sdlc', lid), { recursive: true });
  fs.writeFileSync(path.join(lg, '.workhorse', 'active'), lid + '\n');
  fs.writeFileSync(path.join(lg, 'docs', 'sdlc', lid, 'state.json'), JSON.stringify({
    change_id: lid, title: 'old', tier: 1, tier_override: null, phase: 'review', mode: 'normal',
    gates: { G1: 'auto', G2: 'approved', G3: 'auto', G4: 'pending', G5: 'pending' }, verification: { status: 'green' },
  }));
  check('a legacy active change is still found', wh(lg, 'active').out === lid);
  check('legacy state is still read', wh(lg, 'state', 'get', 'phase').out === 'review');
  check('legacy state is migrated into the git common dir',
    fs.existsSync(path.join(lg, '.git', 'workhorse', 'changes', lid, 'state.json')));
}

console.log('wh.js verify, fold, lock, clock --by-agent (0.3.12)');
{
  const R = require(path.join(PLUGIN, 'scripts', 'wh-run.js'));
  const rr = path.join(tmp, 'runrepo');
  fs.mkdirSync(rr, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: rr });
  execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: rr });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: rr });
  fs.writeFileSync(path.join(rr, 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(rr, 'ok.js'), "console.log('Ran 3 tests in 0.01s');console.log('OK (skipped=1)');\n");
  fs.writeFileSync(path.join(rr, 'bad.js'), "console.log('2 problems (1 error, 1 warning)');process.exit(1);\n");
  wh(rr, 'init');
  const prof = path.join(rr, '.workhorse', 'profile.yml');
  fs.writeFileSync(prof, fs.readFileSync(prof, 'utf8')
    .replace(/^(\s*)test:.*$/m, '$1test: "node ok.js"')
    .replace(/^(\s*)lint:.*$/m, '$1lint: "node bad.js"'));
  execFileSync('git', ['add', '.'], { cwd: rr });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: rr });
  wh(rr, 'new', 'run change', '--tier', '1');
  const cid = wh(rr, 'active').out;
  const vdir = path.join(rr, 'docs', 'sdlc', cid);

  // measure(): the sentences a person asks about later
  check('measure reads unittest totals', /3 tests, all passed \(skipped=1\)/.test(R.measure('test', 'x', 'Ran 3 tests in 0.2s\n\nOK (skipped=1)\n', 0)));
  check('measure reads vitest totals', /12 passed, 0 failed, 1 skipped/.test(R.measure('test', 'x', ' Tests  12 passed | 1 skipped (13)', 0)));
  check('measure reads eslint problems', /2 errors, 1 warnings/.test(R.measure('lint', 'x', '✖ 3 problems (2 errors, 1 warning)', 1)));
  check('measure reads ruff clean', /Lint: 0 errors/.test(R.measure('lint', 'x', 'All checks passed!', 0)));
  check('measure reads pip-audit clean', /0 known vulnerabilities/.test(R.measure('security_audit', 'x', 'No known vulnerabilities found', 0)));

  // verify: runs the defined checks, writes the evidence, reports red on a failure
  const v1 = wh(rr, 'verify');
  const j1 = JSON.parse(v1.out);
  check('verify exits 1 when a check fails', v1.code === 1);
  check('verify names the failed check', j1.failed.length === 1 && j1.failed[0] === 'lint');
  check('verify writes a log per check', fs.existsSync(path.join(vdir, 'verify-logs', 'lint.log')) && fs.existsSync(path.join(vdir, 'verify-logs', 'test.log')));
  check('verify writes summary.json', fs.existsSync(path.join(vdir, 'verify-logs', 'summary.json')));
  const md1 = fs.readFileSync(path.join(vdir, 'verification.md'), 'utf8');
  check('verification.md says red', /^Status: red/m.test(md1));
  check('verification.md has the checks table with the exit code', /\| lint \| `node bad\.js` \| 1 \| `verify-logs\/lint\.log` \| failed \|/.test(md1));
  check('verification.md has a measured sentence per check', /Test suite: 3 tests, all passed/.test(md1) && /Lint: 1 errors, 1 warnings/.test(md1));
  check('undefined checks are listed, not passed', /\| build \|  \| \| \| no check defined \|/.test(md1));
  check('verify records red in state', wh(rr, 'state', 'get', 'verification.status').out === 'red');
  // --only narrows the work, never the bar
  const v2 = JSON.parse(wh(rr, 'verify', '--only', 'test', '--final').out);
  check('--only keeps the earlier failure on the books', v2.checks_green === false && v2.failed.includes('lint'));
  check('--final does not go green over a carried failure', wh(rr, 'state', 'get', 'verification.status').out === 'red');
  // fix the lint, then a full final pass is green and records it
  fs.writeFileSync(path.join(rr, 'bad.js'), "console.log('All checks passed!');\n");
  const v3 = JSON.parse(wh(rr, 'verify', '--final').out);
  check('a full pass with every check passing is green', v3.checks_green === true);
  check('--final records green in state', wh(rr, 'state', 'get', 'verification.status').out === 'green');
  check('verification.md says green', /^Status: green/m.test(fs.readFileSync(path.join(vdir, 'verification.md'), 'utf8')));
  // a known failure is cited, not failed
  fs.writeFileSync(path.join(rr, 'bad.js'), "process.exit(1);\n");
  wh(rr, 'known-failure', 'add', 'lint', '--command', 'node bad.js', '--base', 'abc1234', '--reason', 'red on main before this change');
  const v4 = JSON.parse(wh(rr, 'verify', '--only', 'lint').out);
  check('a recorded known failure keeps the checks green', v4.checks_green === true && /known failure/.test(v4.checks.find((c) => c.check === 'lint').status));

  // fold: task branches land in order, worktrees and branches go away, a conflict aborts cleanly
  execFileSync('git', ['add', '-A'], { cwd: rr });
  execFileSync('git', ['commit', '-q', '-m', 'artifacts'], { cwd: rr });
  const branch = wh(rr, 'state', 'get', 'branch').out;
  for (const n of [1, 2]) {
    execFileSync('git', ['checkout', '-q', '-b', `${branch}-t${n}`, branch], { cwd: rr });
    fs.writeFileSync(path.join(rr, `t${n}.txt`), `task ${n}\n`);
    execFileSync('git', ['add', '.'], { cwd: rr });
    execFileSync('git', ['commit', '-q', '-m', `feat: task ${n}`], { cwd: rr });
  }
  execFileSync('git', ['checkout', '-q', branch], { cwd: rr });
  const f1 = JSON.parse(wh(rr, 'fold', '--tasks', '1,2,3', '--wave', '1').out);
  check('fold lands both tasks in order', f1.ok === true && f1.folded[0].status === 'folded' && f1.folded[1].status === 'folded');
  check('fold reports a missing task branch without failing', f1.folded[2].status === 'no branch');
  check('folded commits are on the change branch', /task 2/.test(execFileSync('git', ['log', '--oneline', '-2'], { cwd: rr, encoding: 'utf8' })) && fs.existsSync(path.join(rr, 't1.txt')));
  check('fold deletes the task branches', spawnSync('git', ['rev-parse', '--verify', '-q', `${branch}-t1`], { cwd: rr }).status !== 0);
  check('fold records tasks_done and the wave', wh(rr, 'state', 'get', 'build.wave').out === '1' && wh(rr, 'state', 'get', 'build.tasks_done').out.replace(/\s/g, '') === '[1,2]');
  // conflict: two branches editing the same line
  execFileSync('git', ['checkout', '-q', '-b', `${branch}-t4`, branch], { cwd: rr });
  fs.writeFileSync(path.join(rr, 'README.md'), 'from t4\n');
  execFileSync('git', ['commit', '-q', '-am', 'feat: t4'], { cwd: rr });
  execFileSync('git', ['checkout', '-q', branch], { cwd: rr });
  fs.writeFileSync(path.join(rr, 'README.md'), 'from main\n');
  execFileSync('git', ['commit', '-q', '-am', 'chore: main moved'], { cwd: rr });
  const f2 = wh(rr, 'fold', '--tasks', '4');
  check('a conflict exits 2 and names the file', f2.code === 2 && /README\.md/.test(f2.out));
  // The log row for the conflict is the one expected change; nothing may be mid-merge or staged.
  const st = execFileSync('git', ['status', '--porcelain'], { cwd: rr, encoding: 'utf8' }).split(/\r?\n/).filter((l) => l && !/conductor-log\.md$/.test(l));
  check('a conflict leaves the tree clean', st.length === 0 && !fs.existsSync(path.join(rr, '.git', 'CHERRY_PICK_HEAD')), st.join('; '));
  check('a conflict keeps the task branch for a builder', spawnSync('git', ['rev-parse', '--verify', '-q', `${branch}-t4`], { cwd: rr }).status === 0);

  // lock
  check('lock acquire succeeds when free', wh(rr, 'lock', 'acquire', '--holder', 'a').code === 0);
  check('a second acquire is refused with exit 3', wh(rr, 'lock', 'acquire', '--holder', 'b').code === 3);
  check('lock status shows the holder', /"holder": "a"/.test(wh(rr, 'lock', 'status').out));
  check('log refreshes the lock', (() => { wh(rr, 'log', 'wh-builder | still going'); return Date.parse(JSON.parse(wh(rr, 'lock', 'status').out).updated) >= Date.now() - 5000; })());
  check('release frees it', wh(rr, 'lock', 'release').code === 0 && wh(rr, 'lock', 'acquire', '--holder', 'c').code === 0);
  check('--force takes a held lock', wh(rr, 'lock', 'acquire', '--holder', 'd', '--force').code === 0);
  wh(rr, 'lock', 'release');
  check('blocked releases the lock and logs the reason', (() => {
    wh(rr, 'lock', 'acquire');
    const r = wh(rr, 'blocked', 'needs the NPM_TOKEN secret from the owner');
    const log = fs.readFileSync(path.join(vdir, 'conductor-log.md'), 'utf8');
    return r.code === 0 && /blocked: needs the NPM_TOKEN/.test(log) && !fs.existsSync(R.lockFile(L, rr));
  })());

  // clock --by-agent
  const byAgent = R.minutesByAgent(L, [
    '2026-01-01T10:00:00Z | build | conductor | wave 1 dispatched',
    '2026-01-01T10:20:00Z | build | wh-builder | T1 green',
    '2026-01-01T10:25:00Z | build | conductor | wave 1 folded',
    '2026-01-01T10:30:00Z | verify | wh-verifier | green',
    '2026-01-01T14:30:00Z | verify | conductor | resumed after usage limit',
    '2026-01-01T14:31:00Z | review | wh-shipper | ship.md written',
  ].join('\n'));
  const mins = Object.fromEntries(byAgent.map((r) => [`${r.phase}/${r.agent}`, r.minutes]));
  check('by-agent charges intervals to the reporting agent', mins['build/wh-builder'] === 20 && mins['build/conductor'] === 5 && mins['verify/wh-verifier'] === 5);
  check('by-agent skips dead time and gaps', mins['verify/conductor'] === undefined && mins['review/wh-shipper'] === 1);
  check('clock --by-agent prints the table', /By agent/.test(wh(rr, 'clock', '--by-agent').out));

  // 0.3.13: a skipped install is not a failure, and a recorded known failure is cited, not re-run
  fs.writeFileSync(prof, fs.readFileSync(prof, 'utf8').replace(/^(\s*)install:.*$/m, '$1install: "node ok.js"'));
  fs.writeFileSync(path.join(rr, 'bad.js'), "process.exit(1);\n"); // lint red, but recorded as a known failure above
  const marker = '# marker: this log must not be rewritten by a cited known failure\n';
  fs.writeFileSync(path.join(vdir, 'verify-logs', 'lint.log'), marker);
  const v5 = JSON.parse(wh(rr, 'verify', '--final').out);
  const inst = v5.checks.find((c) => c.check === 'install');
  const lint5 = v5.checks.find((c) => c.check === 'lint');
  check('a full pass without --install is green with install skipped', v5.checks_green === true && /skipped/.test(inst.status));
  check('a recorded known failure is cited, not re-run', /cited not re-run/.test(lint5.status) && fs.readFileSync(path.join(vdir, 'verify-logs', 'lint.log'), 'utf8') === marker);
  check('--install runs the install command', /passed/.test(JSON.parse(wh(rr, 'verify', '--install', '--only', 'install').out).checks.find((c) => c.check === 'install').status));
}

console.log('agent models and tools (0.3.14)');
{
  const dir = path.join(PLUGIN, 'agents');
  const front = (f) => {
    const m = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n'));
    return m ? m[1] : '';
  };
  const model = (f) => ((/^model:\s*(\S+)/m.exec(front(f)) || [])[1] || '');
  // The design stage decides everything downstream; it keeps the strongest model.
  check('the designer runs on Fable', model('wh-designer.md') === 'fable', model('wh-designer.md'));
  check('the conductor runs on Sonnet', model('wh-conductor.md') === 'sonnet', model('wh-conductor.md'));
  // No agent may list a tool from a server the plugin does not register itself, or every dispatch of
  // it would carry a dead tool name. The bare `mcp__studbook__` names came from a registration each
  // person had to make by hand (removed 0.3.14); the plugin's own `.mcp.json` now starts the server.
  const naming = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && /mcp__studbook__/.test(front(f)));
  check('no agent lists a Studbook tool', naming.length === 0, naming.join(', '));
}

console.log('studbook record server');
{
  const dir = path.join(PLUGIN, 'agents');
  const front = (f) => {
    const m = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n'));
    return m ? m[1] : '';
  };
  const mcp = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.mcp.json'), 'utf8'));
  const server = mcp.mcpServers && mcp.mcpServers.studbook;
  check('the plugin registers the studbook server', !!server && server.command === 'node'
    && server.args.length === 1 && server.args[0] === '${CLAUDE_PLUGIN_ROOT}/scripts/studbook-mcp.js');
  const users = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && /mcp__plugin_workhorse_studbook__/.test(front(f)));
  check('the designer and the discovery analyst can search the record',
    users.sort().join(',') === 'wh-designer.md,wh-discovery-analyst.md', users.join(', '));
  for (const f of users) {
    const tools = (/^tools:\s*(.*)$/m.exec(front(f)) || [])[1].split(',').map((t) => t.trim());
    const studbook = tools.filter((t) => t.includes('studbook'));
    check(`${f} lists only the free search tool`, studbook.join() === 'mcp__plugin_workhorse_studbook__search_record', studbook.join());
    const body = fs.readFileSync(path.join(dir, f), 'utf8');
    check(`${f} caps calls and continues without the tool`, /At most 3 calls/.test(body) && /continue without it/.test(body));
  }
  check('the designer passes its change id as own_change_id', /own_change_id/.test(fs.readFileSync(path.join(dir, 'wh-designer.md'), 'utf8')));

  const S = require(path.join(PLUGIN, 'scripts', 'studbook-mcp.js'));
  const env = S.serverEnv({}, '/h');
  check('the server reads the local record by default', env.STUDBOOK_LOCAL_DB === path.join('/h', '.studbook', 'record.sqlite'));
  check('the paid answer tool is capped at zero by default', env.STUDBOOK_MCP_ASK_LIMIT === '0');
  check('search is fast by default: reranker off, models preloaded, ONNX encoder, one OpenMP thread',
    env.STUDBOOK_MCP_RERANK === 'off' && env.STUDBOOK_MCP_PRELOAD === '1' && env.STUDBOOK_QUERY_ENCODER === 'onnx'
    && env.OMP_NUM_THREADS === '1');
  const reranked = S.serverEnv({ STUDBOOK_MCP_RERANK: 'on' }, '/h');
  check('choosing the reranker leaves the thread count alone', reranked.OMP_NUM_THREADS === undefined);
  check('a chosen database URL is left alone', S.serverEnv({ STUDBOOK_DATABASE_URL: 'x' }, '/h').STUDBOOK_LOCAL_DB === undefined);
  check('a chosen local file and ask cap are kept',
    S.serverEnv({ STUDBOOK_LOCAL_DB: '/r.sqlite', STUDBOOK_MCP_ASK_LIMIT: '2' }, '/h').STUDBOOK_LOCAL_DB === '/r.sqlite'
    && S.serverEnv({ STUDBOOK_MCP_ASK_LIMIT: '2' }, '/h').STUDBOOK_MCP_ASK_LIMIT === '2');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-studbook-'));
  check('no checkout found gives null', S.findHome({}, tmp) === null);
  const home = path.join(tmp, 'C.Projects', 'studbook');
  fs.mkdirSync(path.join(home, 'mcp_server'), { recursive: true });
  fs.writeFileSync(path.join(home, 'mcp_server', '__main__.py'), '');
  check('finds ~/C.Projects/studbook', S.findHome({}, tmp) === home);
  check('STUDBOOK_HOME wins when it holds a checkout', S.findHome({ STUDBOOK_HOME: home }, '/nowhere') === home);
  check('no virtualenv gives null', S.findPython(home) === null);
  fs.mkdirSync(path.join(home, '.venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.venv', 'bin', 'python'), '');
  check('finds the POSIX virtualenv', S.findPython(home) === path.join(home, '.venv', 'bin', 'python'));
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'studbook-mcp.js')], {
    env: { ...process.env, HOME: path.join(tmp, 'empty'), USERPROFILE: path.join(tmp, 'empty'), STUDBOOK_HOME: '' }, encoding: 'utf8',
  });
  check('with no checkout the launcher exits 1 with one line', r.status === 1 && /no Studbook checkout/.test(r.stderr), r.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('wh-launch (0.3.14)');
{
  const W = require(path.join(PLUGIN, 'scripts', 'wh-launch.js'));
  const a = W.buildArgs({ request: 'x -> y', pluginDir: '/p', extraTools: 'Bash(cargo *)' });
  const tools = a[a.indexOf('--allowedTools') + 1].split(',');
  check('launch names Write and Edit (the change folder is refused otherwise)', tools.includes('Write') && tools.includes('Edit'));
  check('launch runs in auto mode', a[a.indexOf('--permission-mode') + 1] === 'auto');
  check('launch adds extra tools once', tools.filter((t) => t === 'Bash(cargo *)').length === 1);
  check('launch passes the request to /workhorse:run', a[a.indexOf('-p') + 1] === '/workhorse:run "x -> y"');
  check('resume sends a bare /workhorse:run', W.buildArgs({ resume: true, pluginDir: '/p' })[1] === '/workhorse:run');
  check('launch loads the given plugin dir', a[a.indexOf('--plugin-dir') + 1] === '/p');
  const p = W.parseArgv(['--allow', 'Bash(make *)', '--resume', '--max-turns', '50']);
  check('argv: --allow, --resume, --max-turns', p.allow === 'Bash(make *)' && p.resume && p.maxTurns === 50);
  check('a client repository loads the plugin in place', W.pluginDirFor(repo).separate === false);
  const pd = W.pluginDirFor(PLUGIN, { checkout: path.join(tmp, 'plugin-checkout') });
  check('the plugin repository loads a separate checkout of its default branch', pd.separate === true && fs.existsSync(path.join(pd.dir, '.claude-plugin', 'plugin.json')));
  spawnSync('git', ['worktree', 'remove', '--force', pd.dir], { cwd: PLUGIN });
}

console.log('gates on GitHub (0.4.0)');
{
  const G = require(path.join(PLUGIN, 'scripts', 'wh-github.js'));
  const presentedAt = '2026-09-30T10:00:00Z';
  const base = { presentedAt, presentedHead: 'abc', approvers: ['owner', 'client-lead'] };
  const c = (login, body, at) => ({ login, body, created_at: at, url: `https://gh/c/${at}` });
  const rv = (login, state, at, commit, body) => ({ login, state, body: body || '', submitted_at: at, commit_id: commit, url: `https://gh/r/${at}` });
  let d = G.readDecision({ ...base, comments: [c('owner', '/approve', '2026-09-30T10:05:00Z')], reviews: [] });
  check('/approve from an approver is an approval', d && d.decision === 'approve' && d.by === 'owner' && d.notes === '');
  d = G.readDecision({ ...base, comments: [c('Owner', '/approve D2: take the alternative, cheaper', '2026-09-30T10:05:00Z')], reviews: [] });
  check('/approve carries notes and matches logins case-insensitively', d && d.notes === 'D2: take the alternative, cheaper');
  d = G.readDecision({ ...base, comments: [c('owner', '/reject split the migration into two changes', '2026-09-30T10:05:00Z')], reviews: [] });
  check('/reject carries the notes', d && d.decision === 'reject' && /split the migration/.test(d.notes));
  d = G.readDecision({ ...base, comments: [c('owner', '/reject', '2026-09-30T10:05:00Z')], reviews: [] });
  check('a bare /reject still records a reason', d && d.decision === 'reject' && d.notes.length > 0);
  d = G.readDecision({ ...base, comments: [c('stranger', '/approve', '2026-09-30T10:05:00Z')], reviews: [] });
  check('someone who is not an approver cannot approve', d === null);
  d = G.readDecision({ ...base, comments: [c('owner', '/approve', '2026-09-30T09:59:00Z')], reviews: [] });
  check('a decision from before the gate was presented does not count', d === null);
  d = G.readDecision({ ...base, comments: [c('owner', `${G.MARKER}\n/approve`, '2026-09-30T10:05:00Z')], reviews: [] });
  check("WorkHorse's own gate comment never counts as a decision", d === null);
  d = G.readDecision({ ...base, comments: [c('owner', 'looks good, /approve later', '2026-09-30T10:05:00Z')], reviews: [] });
  check('only a comment that starts with the command counts', d === null);
  d = G.readDecision({ ...base, comments: [], reviews: [rv('client-lead', 'APPROVED', '2026-09-30T10:06:00Z', 'abc')] });
  check('an approving review on the presented commit is an approval', d && d.decision === 'approve' && d.by === 'client-lead');
  d = G.readDecision({ ...base, comments: [], reviews: [rv('client-lead', 'APPROVED', '2026-09-30T10:06:00Z', 'def')] });
  check('a review of a different commit does not count', d === null);
  d = G.readDecision({ ...base, comments: [], reviews: [rv('client-lead', 'CHANGES_REQUESTED', '2026-09-30T10:06:00Z', 'abc', 'rename the flag')] });
  check('request changes is a rejection with its notes', d && d.decision === 'reject' && d.notes === 'rename the flag');
  d = G.readDecision({ ...base, comments: [c('owner', '/approve', '2026-09-30T10:05:00Z'), c('owner', '/reject wait, the budget is wrong', '2026-09-30T10:07:00Z')], reviews: [] });
  check('the latest decision wins', d && d.decision === 'reject');
  const body = G.gateComment({ gate: 'G2', title: 'Add health check', tier: 1, summary: 'Short.', decisions: [{ id: 'D1', decision: 'Port', recommendation: '8080' }], packetPath: 'docs/sdlc/x/brief.md' });
  check('the gate comment carries the marker, the decisions and the commands', body.startsWith(G.MARKER) && body.includes('(docs/sdlc/x/brief.md)') && /D1\*\* Port/.test(body) && /\/approve/.test(body) && /\/reject/.test(body));
  check('GitHub approvals are off for a repository whose origin is not GitHub', G.enabled(L, repo, {}) === false);
  check('the profile can turn GitHub approvals off', G.enabled(L, PLUGIN, { github: { approvals: false } }) === false);
  check('approvers come from the profile when listed', G.approvers(repo, { github: { approvers: ['@Owner', 'b'] } }).join() === 'owner,b');

  // approve: the audit record names the real approver and links to the decision
  const ar = path.join(tmp, 'approverepo');
  fs.mkdirSync(ar, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: ar });
  execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: ar });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: ar });
  fs.writeFileSync(path.join(ar, 'README.md'), 'x\n');
  wh(ar, 'init');
  execFileSync('git', ['add', '.'], { cwd: ar });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: ar });
  wh(ar, 'new', 'github gate', '--tier', '1');
  const aid = wh(ar, 'active').out;
  fs.writeFileSync(path.join(ar, 'docs', 'sdlc', aid, 'brief.md'), '# B\n\n## Decisions\n\n| # | Decision | Recommendation | Alternative | Why |\n|---|---|---|---|---|\n| D1 | Port | 8080 | 9090 | std |\n| D2 | Store | sqlite | pg | small |\n\n## Your decision\n\nApprove.\n');
  const ap = wh(ar, 'approve', 'G2', '--accept-all', '--by', 'github:owner', '--source', 'https://github.com/o/r/pull/1#issuecomment-9', 'D2: pg, we already run it');
  const rec = fs.readFileSync(path.join(ar, 'docs', 'sdlc', aid, 'approvals.md'), 'utf8');
  check('a GitHub approval records who and where', ap.code === 0 && /- Who: github:owner/.test(rec) && /- Source: https:\/\/github\.com\/o\/r\/pull\/1#issuecomment-9/.test(rec), ap.err);
  check('an override in the notes is not contradicted by accept-all', /D1: recommendation accepted/.test(rec) && !/D2: recommendation accepted/.test(rec) && /D2: pg, we already run it/.test(rec));
  check('github-sync with no gate waiting records nothing', /"recorded": false/.test(wh(ar, 'github-sync').out));

  // the workhorse command
  const W = path.join(PLUGIN, 'scripts', 'workhorse.js');
  const cli = (cwd, ...a) => spawnSync(process.execPath, [W, ...a], { cwd, encoding: 'utf8', env: { ...process.env, USERPROFILE: tmp, HOME: tmp } });
  check('workhorse with no arguments prints help', /workhorse "<problem> -> <outcome>"/.test(cli(ar).stdout));
  check('workhorse rejects an unknown command', cli(ar, 'frobnicate').status === 2);
  check('workhorse approve with nothing waiting says so', /nothing is waiting on you/.test(cli(ar, 'approve').stderr));
  check('workhorse reject needs notes', (() => {
    const r = cli(ar, 'reject');
    return r.status === 2 && /nothing is waiting|say what to change/.test(r.stderr);
  })());
  check('workhorse outside a repository points at onboarding', /onboard/.test(cli(tmp, 'approve').stderr));
  const cliEnv = { ...process.env, USERPROFILE: tmp, HOME: tmp, APPDATA: path.join(tmp, 'appdata') };
  const cliw = (...a) => spawnSync(process.execPath, [W, ...a], { cwd: tmp, encoding: 'utf8', env: cliEnv });
  check('watch --background starts one watcher and a second call reuses it', (() => {
    const a = cliw('watch', '--background');
    const pidFile = path.join(tmp, '.workhorse', 'watch.json');
    const until = Date.now() + 5000;
    while (!fs.existsSync(pidFile) && Date.now() < until) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},200)']);
    const b = cliw('watch', '--background');
    const stop = cliw('watch', '--stop');
    return /Watching in the background/.test(a.stdout) && /Already watching/.test(b.stdout) && /Stopped the watcher/.test(stop.stdout);
  })());
  check('watch --stop with nothing running says so', /No watcher is running/.test(cliw('watch', '--stop').stdout));
  check('watch --at-login writes a hidden Startup entry, and --not-at-login removes it', (() => {
    const f = path.join(tmp, 'appdata', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'workhorse-watch.vbs');
    cliw('watch', '--at-login');
    const body = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    cliw('watch', '--not-at-login');
    return /watch --background", 0, False/.test(body) && !fs.existsSync(f);
  })());
  check('opening a harness session starts the watcher, unless WORKHORSE_NO_WATCH is set', (() => {
    const input = JSON.stringify({ cwd: ar, hook_event_name: 'SessionStart' });
    const pidFile = path.join(tmp, '.workhorse', 'watch.json');
    const env = { ...cliEnv, CI: '' };
    spawnSync(process.execPath, [path.join(SCRIPTS, 'session-context.js')], { input, encoding: 'utf8', env: { ...env, WORKHORSE_NO_WATCH: '1' } });
    const quiet = !fs.existsSync(pidFile);
    delete env.WORKHORSE_NO_WATCH;
    spawnSync(process.execPath, [path.join(SCRIPTS, 'session-context.js')], { input, encoding: 'utf8', env });
    const until = Date.now() + 5000;
    while (!fs.existsSync(pidFile) && Date.now() < until) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},200)']);
    const started = fs.existsSync(pidFile);
    cliw('watch', '--stop');
    return quiet && started;
  })());
  check('workhorse remembers the repositories it is used in', (() => {
    cli(ar, 'status');
    return fs.readFileSync(path.join(tmp, '.workhorse', 'repos.json'), 'utf8').includes(path.basename(ar));
  })());

  console.log('gate age');
  const agerepo = path.join(tmp, 'agerepo');
  fs.mkdirSync(agerepo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: agerepo });
  execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: agerepo });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: agerepo });
  fs.writeFileSync(path.join(agerepo, 'README.md'), 'x\n');
  wh(agerepo, 'init');
  execFileSync('git', ['add', '.'], { cwd: agerepo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: agerepo });
  wh(agerepo, 'new', 'gate age', '--tier', '1');
  const ageId = wh(agerepo, 'active').out;
  fs.writeFileSync(path.join(agerepo, 'docs', 'sdlc', ageId, 'brief.md'), '# B\n\n## Decisions\n\n| # | Decision | Recommendation | Alternative | Why |\n|---|---|---|---|---|\n| D1 | Port | 8080 | 9090 | std |\n\n## Your decision\n\nApprove.\n');
  const ageDigest = () => JSON.parse(wh(agerepo, 'digest').out);
  const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

  const idle = ageDigest();
  const idleStatus = cli(agerepo, 'status').stdout;
  check('no age while nothing waits on the human',
    idle.gate_waiting_since === null && idle.gate_waiting_minutes === null
      && idleStatus.includes('agents working (design)') && !idleStatus.includes(' for '));

  wh(agerepo, 'present', 'G2');
  const presentedStamp = minutesAgo(180);
  wh(agerepo, 'state', 'set', 'presented.G2', presentedStamp);
  const waiting = ageDigest();
  check('digest carries when the gate was presented and how long ago',
    waiting.blocking_gate === 'G2' && waiting.gate_waiting_since === presentedStamp
      && waiting.gate_waiting_minutes >= 180 && waiting.gate_waiting_minutes < 183);
  check('status says how long Design has waited', /Design is waiting on YOU for 3h/.test(cli(agerepo, 'status').stdout));

  wh(agerepo, 'approve', 'G2', '--reject', 'age test');
  wh(agerepo, 'present', 'G2');
  const represented = ageDigest();
  check('a re-presented gate counts from the new presentation',
    represented.blocking_gate === 'G2' && represented.gate_waiting_minutes < 3);

  wh(agerepo, 'state', 'set', 'presented.G2', new Date(Date.now() + 10 * 60000).toISOString());
  const future = ageDigest();
  check('a stamp in the future reads as 0m, never negative',
    future.gate_waiting_minutes === 0 && /Design is waiting on YOU for 0m/.test(cli(agerepo, 'status').stdout));

  wh(agerepo, 'state', 'set', 'presented.G2', 'not-a-date');
  const corrupt = ageDigest();
  const corruptRun = cli(agerepo, 'status');
  check('a corrupted stamp leaves the gate not waiting and nothing crashes',
    corrupt.blocking_gate === null && corrupt.gate_waiting_minutes === null && corruptRun.status === 0);

  const readmeRow = fs.readFileSync(path.join(PLUGIN, 'README.md'), 'utf8').split('\n').find((l) => l.includes('workhorse status')) || '';
  check('the README status row says the age is shown', readmeRow.includes('how long'));
}

console.log('review fix rounds and side-effect evals (0.4.1)');
{
  // Four measured runs: a review fix introduced the next defect in three of them, and review
  // took half of each tier-3 run. The loop is counted and scoped by wh.js, not by the conductor.
  const fr = path.join(tmp, 'fixrepo');
  fs.mkdirSync(path.join(fr, 'src'), { recursive: true });
  fs.mkdirSync(path.join(fr, 'tests'), { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: fr, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  fs.writeFileSync(path.join(fr, 'src', 'a.js'), 'module.exports = 1;\n');
  wh(fr, 'init');
  g('add', '.'); g('commit', '-q', '-m', 'init');
  wh(fr, 'new', 'fix loop', '--tier', '2');
  const fid = wh(fr, 'active').out;
  const commit = (files, msg) => {
    for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(fr, rel), text);
    g('add', '.'); g('commit', '-q', '-m', msg);
  };
  const json = (r) => { try { return JSON.parse(r.out); } catch (e) { return {}; } };

  check('review-fix check before start says to start first', wh(fr, 'review-fix', 'check').code !== 0);
  const s1 = wh(fr, 'review-fix', 'start');
  check('review-fix start opens round 1 at the current head', s1.code === 0 && json(s1).round === 1 && json(s1).base === g('rev-parse', 'HEAD'), s1.out + s1.err);
  check('starting again before a check reuses the round (a resumed run spends nothing)', json(wh(fr, 'review-fix', 'start')).resumed === true);

  commit({ 'src/a.js': 'module.exports = 2;\n' }, 'fix(review): source only');
  commit({ 'README.md': 'docs only\n' }, 'fix(review): readme wording');
  const c1 = wh(fr, 'review-fix', 'check');
  const j1 = json(c1);
  check('a fix commit that changed source with no test fails the check', c1.code === 2 && j1.untested.length === 1 && /source only/.test(j1.untested[0].subject), c1.out + c1.err);
  check('a documentation-only fix needs no test', j1.commits.length === 2 && !j1.untested.some((u) => /readme/.test(u.subject)));
  check('the check prints the diff the re-check reads', /^git diff [0-9a-f]{12}\.\.[0-9a-f]{12}$/.test(j1.recheck.diff) && j1.recheck.files.includes('src/a.js'), JSON.stringify(j1.recheck));

  check('reopen sends the same round back to the fixer', json(wh(fr, 'review-fix', 'reopen')).round === 1 && json(wh(fr, 'review-fix', 'start')).resumed === true);
  commit({ 'src/a.js': 'module.exports = 3;\n', 'tests/a.test.js': '// regression and negative case\n' }, 'fix(review): with tests');
  const c2 = wh(fr, 'review-fix', 'check');
  // Per commit, by design: the first commit is still listed, so the shipper can name it.
  check('a fix commit carrying a test file passes on its own', json(c2).commits.find((c) => /with tests/.test(c.subject)).tests.length === 1 && json(c2).untested.length === 1, c2.out);

  const s2 = wh(fr, 'review-fix', 'start');
  check('a second round opens, with none left after it', s2.code === 0 && json(s2).round === 2 && json(s2).rounds_left === 0, s2.out);
  commit({ 'src/a.js': 'module.exports = 4;\n', 'tests/b.test.js': '// case\n' }, 'fix(review): round two');
  const c3 = wh(fr, 'review-fix', 'check');
  check('round two is scoped to its own commits', c3.code === 0 && json(c3).commits.length === 1 && json(c3).round === 2, c3.out);
  const s3 = wh(fr, 'review-fix', 'start');
  check('a third fix round is refused with exit 3', s3.code === 3 && /go to ship\.md as unresolved/.test(s3.out + s3.err), s3.out + s3.err);
  // A person's rejection gets rounds of its own.
  wh(fr, 'gate', 'G4', 'pending');
  const rej = wh(fr, 'approve', 'G4', '--reject', 'fix the replay');
  const s4 = wh(fr, 'review-fix', 'start');
  check('a gate rejection resets the fix rounds', rej.code === 0 && s4.code === 0 && json(s4).round === 1, rej.err + s4.out + s4.err);
  wh(fr, 'review-fix', 'check');
  const flog = fs.readFileSync(path.join(fr, 'docs', 'sdlc', fid, 'conductor-log.md'), 'utf8');
  check('rounds and the refusal are in the conductor log', /fix round 1 of 2 opened/.test(flog) && /fix round refused/.test(flog));

  // evals.md at tier 2+: the side effects table is required
  const put = (text) => {
    const f = path.join(fr, 'docs', 'sdlc', fid, 'evals.md');
    fs.writeFileSync(f, text);
    return hook('artifact-check.js', { session_id: 's', cwd: fr, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: f } });
  };
  const rows = '# Evals\n\n| ID | Category | Given |\n|---|---|---|\n| E1 | golden | x |\n';
  const bare = put(rows);
  check('tier-2 evals without a side effects section are sent back', bare.decision === 'block' && /Side effects and records/.test(bare.reason || ''), JSON.stringify(bare));
  check('tier-2 evals with the section pass', put(rows + '\n## Side effects and records\n\nNone: this change only reads.\n').decision === undefined);
  wh(fr, 'state', 'set', 'tier', '1');
  check('tier-1 evals are not asked for the section', put(rows).decision === undefined);
  check('the evals template carries the section', /^## Side effects and records/m.test(fs.readFileSync(path.join(PLUGIN, 'templates', 'evals.md'), 'utf8')));

  // The agents are told the same thing the script enforces.
  const agent = (f) => fs.readFileSync(path.join(PLUGIN, 'agents', f), 'utf8');
  const cond = agent('wh-conductor.md');
  check('the conductor opens and checks every fix round', /WH review-fix start/.test(cond) && /WH review-fix check/.test(cond) && /There is no third round/.test(cond));
  check('the re-check reads the round diff, with at most three reviewers', /recheck\.diff/.test(cond) && /at most three/.test(cond));
  check('the fixer ships a regression test and a negative case with each fix', /regression test/.test(agent('wh-fixer.md')) && /negative case/.test(agent('wh-fixer.md')));
  check('reviewers rate a trusted record by the claim it breaks', /claim it breaks/.test(agent('wh-bug-reviewer.md')) && /claim it breaks/.test(agent('wh-security-reviewer.md')));
  check('the designer and eval designer fill the side effects table', /Side effects and records/.test(agent('wh-designer.md')) && /Side effects and records/.test(agent('wh-eval-designer.md')));
  check('the evals skill names the four failure cases and the replay case',
    /crash between the effect and the record/.test(fs.readFileSync(path.join(PLUGIN, 'skills', 'wh-evals', 'SKILL.md'), 'utf8'))
    && /replayed against a\s+different subject/.test(fs.readFileSync(path.join(PLUGIN, 'skills', 'wh-evals', 'SKILL.md'), 'utf8')));
}

console.log('the watcher resumes stalled runs (0.4.2)');
{
  // A Design approval recorded in a terminal sat for two days; a headless run died; a refused
  // merge blocked every AgentOps run. The decision is pure, so every state is tested here.
  const W = require(path.join(PLUGIN, 'scripts', 'workhorse.js'));
  const now = Date.parse('2026-10-07T12:00:00Z');
  const log = (minAgo, text) => ({ at: now - minAgo * 60000, text: text || '2026-10-07T00:00:00Z | build | conductor | wave 1 folded' });
  const dg = (o) => Object.assign({ change_id: 'c1', title: 't', phase: 'build', blocking_gate: null, pr_url: 'https://github.com/o/r/pull/1' }, o);
  const dec = (o) => W.stallDecision(Object.assign({ digest: dg({}), lockHeld: false, lastLog: log(120), prMerged: false, now }, o));
  check('a run idle for two hours with no gate and no lock is resumed', dec({}).resume === true && dec({}).attempts === 1, JSON.stringify(dec({})));
  check('a run active three minutes ago is left alone', dec({ lastLog: log(3) }).resume === false);
  check('a run waiting on a gate is left alone', dec({ digest: dg({ blocking_gate: 'G2' }) }).resume === false);
  check('a run that holds the lock is left alone', dec({ lockHeld: true }).resume === false);
  check('a finished change is left alone', dec({ digest: dg({ phase: 'done' }) }).resume === false);
  check('no conductor log means nothing to resume', dec({ lastLog: null }).resume === false);
  const blocked = (text) => log(120, `2026-10-07T00:00:00Z | deploy | conductor | blocked: ${text}`);
  check('a run blocked on a credential is left alone', dec({ lastLog: blocked('needs the STRIPE_KEY from the owner') }).resume === false);
  check('a run blocked on a merge stays blocked until the PR is merged', dec({ lastLog: blocked('merge of PR https://x by the owner') }).resume === false);
  check('a run blocked on a merge resumes once the PR is merged', dec({ lastLog: blocked('merge of PR https://x by the owner'), prMerged: true }).resume === true);
  const prior = (attempts, lastAtMinAgo, lastLog) => ({ attempts, last_at: new Date(now - lastAtMinAgo * 60000).toISOString(), last_log: lastLog === undefined ? log(0).text : lastLog });
  check('a resume within the cooldown is not repeated', dec({ prior: prior(1, 10) }).resume === false);
  check('after the cooldown it tries again and counts the attempt', dec({ prior: prior(1, 40) }).resume === true && dec({ prior: prior(1, 40) }).attempts === 2);
  check('three resumes with no new log line and it stops, naming why', dec({ prior: prior(3, 400) }).resume === false && /needs a look/.test(dec({ prior: prior(3, 400) }).why));
  check('a new log line resets the attempt count', dec({ prior: prior(3, 400, 'an older line') }).attempts === 1);
  check('the thresholds are ten minutes, thirty minutes, three tries', W.STALL_MINUTES === 10 && W.RESUME_COOLDOWN_MINUTES === 30 && W.MAX_AUTO_RESUMES === 3);

  const lr = path.join(tmp, 'logrepo');
  fs.mkdirSync(path.join(lr, 'docs', 'sdlc', 'cx'), { recursive: true });
  fs.writeFileSync(path.join(lr, 'docs', 'sdlc', 'cx', 'conductor-log.md'), '# Conductor log: cx\n\n2026-10-07T01:00:00.000Z | design | conductor | change created\n2026-10-07T02:30:00.000Z | design | conductor | G2 Design presented\n');
  const ll = W.lastLogLine(lr, 'cx');
  check('the log reader returns the last stamped row with its time', ll && ll.at === Date.parse('2026-10-07T02:30:00.000Z') && /G2 Design presented/.test(ll.text), JSON.stringify(ll));
  check('the log reader returns null without a log', W.lastLogLine(lr, 'nope') === null);

  const agent = (f) => fs.readFileSync(path.join(PLUGIN, 'agents', f), 'utf8');
  check('the shipper skips an already merged PR and reports a refused merge', /already merged/.test(agent('wh-shipper.md')) && /merge refused/.test(agent('wh-shipper.md')));
  check('the conductor records a refused merge as a block the watcher clears', /WH blocked "merge of PR/.test(agent('wh-conductor.md')));
}

console.log('run ledger (0.5.0)');
{
  const LG = require(path.join(PLUGIN, 'scripts', 'wh-ledger.js'));
  const W = require(path.join(PLUGIN, 'scripts', 'wh-launch.js'));
  const rel = LG.parseReleases('## 0.3.10 — 2026-09-21\n\n## 0.3.12 — 2026-09-29\n## 0.3.13 — 2026-09-29\n## 0.4.0 — 2026-09-29\n## 0.4.2 — 2026-10-07\n');
  check('releases parse oldest first', rel.map((r) => r.version).join(',') === '0.3.10,0.3.12,0.3.13,0.4.0,0.4.2');
  check('a day with one release in force names it', LG.versionAt(rel, '2026-10-01T00:00:00Z').version === '0.4.0');
  check('a day with several releases gives the honest range', LG.versionAt(rel, '2026-09-29T08:00:00Z').version === '0.3.10–0.4.0');
  check('every inferred version says so', LG.versionAt(rel, '2026-10-08').source === 'inferred');
  check('a range belongs to the generation of its lower end', LG.generationOf('0.3.10–0.4.0') === 'Two gates' && LG.generationOf('0.3.12') === 'Speed release' && LG.generationOf('0.5.0') === 'Lead time');
  check('the tier is read from the documents', LG.tierFrom('', 'Risk tier: 2 (edits wh.js)') === 2 && LG.tierFrom('**Tier:** 3') === 3 && LG.tierFrom('nothing') === null);
  check('a conductor log that names its plugin version is believed', LG.versionFromLog('2026-09-29T06:39:57Z | design | conductor | plugin root 0.3.11 used') === '0.3.11');
  check('the median of an even list is the mean of the middle two', LG.median([4, 1, 3, 2]) === 2.5 && LG.median([]) === null);
  check('launcher cost adds every result event and skips partial lines',
    W.runCost('{"type":"result","total_cost_usd":1.25}\n{"type":"assistant"}\n{"type":"result","total_cost_usd":0.5}\n{"type":"result","total_') === 1.75);

  // A repository whose record is committed: the ledger reads git, not the working tree.
  const lg = path.join(tmp, 'ledger');
  fs.mkdirSync(lg, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: lg, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  const cdir = path.join(lg, 'docs', 'sdlc', '2026-10-01-make-it-fast');
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(path.join(cdir, 'brief.md'), '# Brief\n\nRisk tier: 1\n');
  fs.writeFileSync(path.join(cdir, 'conductor-log.md'), [
    '# Conductor log', '',
    '2026-10-01T10:00:00.000Z | design | conductor | change created',
    '2026-10-01T10:20:00.000Z | design | conductor | G2 Design presented',
    '2026-10-01T10:50:00.000Z | build | conductor | resumed after approval',
    '2026-10-01T11:05:00.000Z | done | conductor | closed', '',
  ].join('\n'));
  fs.writeFileSync(path.join(cdir, 'approvals.md'), '# Approvals\n\n## G2: approved\n\n- When: 2026-10-01T10:30:00.000Z\n');
  g('add', '.'); g('commit', '-q', '-m', 'record');
  fs.writeFileSync(path.join(cdir, 'conductor-log.md'), 'uncommitted edits are not the record\n');
  const r = wh(lg, 'ledger', '--repo', lg, '--json');
  const led = r.code === 0 ? JSON.parse(r.out) : { runs: [] };
  const row = led.runs[0] || {};
  check('the ledger recomputes a committed run: 35 agent minutes, 10 waiting, 20 dead', r.code === 0 && row.agent_minutes === 35 && row.waiting_minutes === 10 && row.dead_minutes === 20, r.err || JSON.stringify(row));
  check('the ledger reads tier, budget and status from the record', row.tier === 1 && row.budget_minutes === 30 && row.within_budget === false && row.status === 'finished', JSON.stringify(row));
  check('the ledger counts gate decisions', row.touches === 1 && row.rejections === 0);
  const outDir = path.join(tmp, 'ledger-out');
  const w = wh(lg, 'ledger', '--repo', lg, '--out', outDir);
  const md = w.code === 0 ? fs.readFileSync(path.join(outDir, 'RUNS.md'), 'utf8') : '';
  check('--out writes runs.json and a RUNS.md that opens in plain words', w.code === 0 && fs.existsSync(path.join(outDir, 'runs.json')) && /^# WorkHorse, run by run\n\nEvery change/.test(md) && /What the words mean/.test(md), w.err);
  const fixed = LG.build(L, [{ path: lg, ref: 'HEAD', name: 'ledger' }], '', { 'ledger/2026-10-01-make-it-fast': { version: '0.3.12', note: 'n.', source: 's' } });
  check('a cited correction sets the version and is listed with its source', fixed.runs[0].version === '0.3.12' && fixed.runs[0].version_source === 'cited' && /## Corrections/.test(LG.renderMarkdown(fixed.runs, fixed.summary, 'x')));
  const nolog = path.join(tmp, 'ledger-none');
  fs.mkdirSync(nolog, { recursive: true });
  check('the ledger refuses with nothing to read', wh(nolog, 'ledger').code === 1);

  // metrics.json at close, with the cost the launcher added.
  const mx = path.join(tmp, 'metrics');
  fs.mkdirSync(mx, { recursive: true });
  const gm = (...a) => execFileSync('git', a, { cwd: mx, encoding: 'utf8' }).trim();
  gm('init', '-q'); gm('config', 'user.email', 'tester@example.com'); gm('config', 'user.name', 'Tester');
  wh(mx, 'init'); gm('add', '.'); gm('commit', '-q', '-m', 'onboard');
  const mid = JSON.parse(wh(mx, 'new', 'Measure me', '--tier', '0').out).change_id;
  check('cost add refuses a negative or missing amount', wh(mx, 'cost', 'add', '-1').code === 1 && wh(mx, 'cost', 'add').code === 1);
  wh(mx, 'cost', 'add', '1.5'); wh(mx, 'cost', 'add', '0.25');
  check('cost adds launcher runs up', JSON.parse(wh(mx, 'cost').out).cost_usd === 1.75 && JSON.parse(wh(mx, 'cost').out).launcher_runs === 2);
  wh(mx, 'phase', 'done');
  const mf = path.join(mx, 'docs', 'sdlc', mid, 'metrics.json');
  const m = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : {};
  const pv = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  check('phase done writes metrics.json with the version, the tier and the cost', m.schema === 1 && m.plugin_version === pv && m.tier === 0 && m.cost_usd === 1.75 && m.launcher_runs === 2, JSON.stringify(m));
  check('metrics.json is in the close commit', gm('ls-files', `docs/sdlc/${mid}/metrics.json`) !== '');
  const back = LG.build(L, [{ path: mx, ref: 'HEAD', name: 'metrics' }], '', {});
  check('the ledger prefers the recorded version and cost', back.runs[0] && back.runs[0].version === pv && back.runs[0].version_source === 'recorded' && back.runs[0].cost_usd === 1.75, JSON.stringify(back.runs[0]));
}

console.log('merge on Ship approval (0.5.1)');
{
  const G = require(path.join(PLUGIN, 'scripts', 'wh-github.js'));
  const sc = G.summarizeChecks;
  check('a failed or cancelled check makes CI red and names it', sc([{ name: 'a', bucket: 'pass' }, { name: 'b', bucket: 'fail' }, { name: 'c', bucket: 'cancel' }]).state === 'red' && sc([{ name: 'b', bucket: 'fail' }]).failing[0] === 'b');
  check('a running check makes CI pending', sc([{ name: 'a', bucket: 'pass' }, { name: 'b', bucket: 'pending' }]).state === 'pending');
  check('passing and skipped checks are green; no checks is none', sc([{ name: 'a', bucket: 'pass' }, { name: 'b', bucket: 'skipping' }]).state === 'green' && sc([]).state === 'none');
  const md = G.mergeDecision;
  check('green CI merges', md({ prState: 'OPEN', checks: { state: 'green', failing: [] } }).action === 'merge');
  check('a repository without CI merges, and says so', /no CI/.test(md({ prState: 'OPEN', checks: { state: 'none', failing: [] } }).why));
  check('running or unreadable CI waits', md({ prState: 'OPEN', checks: { state: 'pending' } }).action === 'wait' && md({ prState: 'OPEN', checks: { state: 'unknown' } }).action === 'wait');
  check('red CI is never merged over', md({ prState: 'OPEN', checks: { state: 'red', failing: ['ci'] } }).action === 'refuse');
  check('an already merged PR is left alone; a closed one is refused', md({ prState: 'MERGED' }).action === 'merged' && md({ prState: 'CLOSED' }).action === 'refuse');

  // A fake gh on PATH: answers pr view, pr checks and pr merge from files, and logs every call.
  const sm = path.join(tmp, 'shipmerge');
  const bin = path.join(tmp, 'fakebin');
  fs.mkdirSync(sm, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
  const ghLog = path.join(tmp, 'gh-calls.log');
  const ghScript = path.join(bin, 'gh-fake.js');
  fs.writeFileSync(ghScript, [
    "const fs = require('fs'); const a = process.argv.slice(2); const d = process.env.FAKE_GH_DIR;",
    "fs.appendFileSync(process.env.FAKE_GH_LOG, a.join(' ') + '\\n');",
    "if (a[0] === 'pr' && a[1] === 'view') { process.stdout.write(fs.readFileSync(d + '/view.json', 'utf8')); process.exit(0); }",
    "if (a[0] === 'pr' && a[1] === 'checks') { process.stdout.write(fs.readFileSync(d + '/checks.json', 'utf8')); process.exit(0); }",
    "if (a[0] === 'pr' && a[1] === 'merge') { process.exit(fs.existsSync(d + '/merge-fails') ? 1 : 0); }",
    "process.exit(1);",
  ].join('\n'));
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'gh.cmd'), `@"${process.execPath}" "${ghScript}" %*\r\n`);
  else { fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${ghScript}" "$@"\n`); fs.chmodSync(path.join(bin, 'gh'), 0o755); }
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, FAKE_GH_DIR: sm, FAKE_GH_LOG: ghLog };
  const whE = (...a) => { const r = spawnSync(process.execPath, [WH, ...a], { cwd: sm, encoding: 'utf8', env }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  const g = (...a) => execFileSync('git', a, { cwd: sm, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  const bare = path.join(tmp, 'shipmerge-origin.git');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  g('remote', 'add', 'origin', 'https://github.com/example/shipmerge.git');
  g('config', 'remote.origin.pushurl', bare);
  whE('init'); g('add', '.'); g('commit', '-q', '-m', 'onboard');
  const sid = JSON.parse(whE('new', 'Merge me', '--tier', '1').out).change_id;
  const setState = (patch) => { const st = L.loadState(sm, sid); Object.assign(st, patch); L.saveState(sm, sid, st); };
  check('ship-merge does nothing before Ship is approved', JSON.parse(whE('ship-merge').out).action === 'none');
  setState({ gates: { ...(L.loadState(sm, sid).gates || {}), G4: 'approved' }, github: { pr_number: 7 } });
  fs.writeFileSync(path.join(sm, 'view.json'), JSON.stringify({ state: 'OPEN', headRefOid: 'abc123', url: 'https://github.com/example/shipmerge/pull/7' }));
  fs.writeFileSync(path.join(sm, 'checks.json'), JSON.stringify([{ name: 'ci', bucket: 'pending' }]));
  fs.writeFileSync(path.join(sm, 'docs', 'sdlc', sid, 'ship.md'), '# Ship\n\nrecord written before the merge\n');
  let r = JSON.parse(whE('ship-merge').out);
  check('while CI runs, the merge waits and is remembered', r.action === 'wait' && L.loadState(sm, sid).merge_pending === true, JSON.stringify(r));
  check('the records are committed before the merge', g('log', '-1', '--format=%s') === `chore(sdlc): records for ${sid} before merge` && g('status', '--porcelain', '--', `docs/sdlc/${sid}/ship.md`) === '');
  whE('ship-merge');
  const log1 = fs.readFileSync(path.join(sm, 'docs', 'sdlc', sid, 'conductor-log.md'), 'utf8');
  check('waiting is logged once, not every minute', (log1.match(/waits: CI is still running/g) || []).length === 1);
  fs.writeFileSync(path.join(sm, 'checks.json'), JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
  r = JSON.parse(whE('ship-merge', '--if-pending').out);
  const calls = fs.readFileSync(ghLog, 'utf8');
  check('once CI is green the watcher\'s call merges, pinned to the checked head', r.action === 'merged' && /pr merge 7 --squash --match-head-commit abc123/.test(calls) && L.loadState(sm, sid).merge_pending === false, JSON.stringify(r));
  check('with nothing pending, --if-pending calls no gh at all', (() => { const before = fs.readFileSync(ghLog, 'utf8').length; whE('ship-merge', '--if-pending'); return fs.readFileSync(ghLog, 'utf8').length === before; })());
  fs.writeFileSync(path.join(sm, 'checks.json'), JSON.stringify([{ name: 'ci', bucket: 'fail' }]));
  r = JSON.parse(whE('ship-merge').out);
  check('red CI is refused and logged as a block', r.action === 'refuse' && /blocked: not merging .*CI is red: ci/.test(fs.readFileSync(path.join(sm, 'docs', 'sdlc', sid, 'conductor-log.md'), 'utf8')));
  fs.writeFileSync(path.join(sm, 'checks.json'), JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
  fs.writeFileSync(path.join(sm, 'merge-fails'), '');
  r = JSON.parse(whE('ship-merge').out);
  check('a merge GitHub refuses becomes a wait the watcher retries', r.action === 'wait' && L.loadState(sm, sid).merge_pending === true);
  fs.rmSync(path.join(sm, 'merge-fails'));
  fs.writeFileSync(path.join(sm, 'checks.json'), JSON.stringify([{ name: 'ci', bucket: 'fail' }]));
  check('checks exits 1 on red', whE('checks').code === 1);
  fs.writeFileSync(path.join(sm, 'checks.json'), JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
  check('checks reports green', JSON.parse(whE('checks').out).state === 'green');
  const conductor = fs.readFileSync(path.join(PLUGIN, 'agents', 'wh-conductor.md'), 'utf8');
  check('the conductor checks CI before presenting Ship', /WH checks --wait 15/.test(conductor));
  check('the shipper never merges over a red check and leaves the merge to ship-merge', /never merge over a red check/.test(fs.readFileSync(path.join(PLUGIN, 'agents', 'wh-shipper.md'), 'utf8')) && /wh\.js ship-merge/.test(fs.readFileSync(path.join(PLUGIN, 'agents', 'wh-shipper.md'), 'utf8')));
}

console.log('runs as LangSmith traces (0.5.2)');
{
  const T = require(path.join(PLUGIN, 'scripts', 'wh-trace.js'));
  const id1 = T.stableId('c1', 'root');
  check('trace ids are stable UUIDs per change and name', id1 === T.stableId('c1', 'root') && id1 !== T.stableId('c2', 'root') && /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id1), id1);
  check('the dotted-order stamp has microseconds', T.stamp(Date.parse('2026-10-13T08:52:00.123Z')) === '20261013T085200123000Z');
  check('a log row names its agent', T.agentOf('wh-designer | tier 2, 20 evals').agent === 'wh-designer' && T.agentOf('no agent here').agent === 'conductor');
  const log = [
    '2026-10-13T06:00:00.000Z | design | conductor | change created',
    '2026-10-13T06:20:00.000Z | design | wh-designer | brief written',
    '2026-10-13T06:50:00.000Z | build | conductor | resumed after approval',
    '2026-10-13T07:05:00.000Z | build | wh-builder | wave 1 folded',
  ].join('\n');
  const approvals = '## G2: approved\n\n- When: 2026-10-13T06:30:00.000Z\n';
  const now = Date.parse('2026-10-13T09:00:00Z');
  const runs = T.buildTrace(L, { id: 'c1', title: 'Fixture', tier: 1, version: '0.5.2', log, approvals, streams: [], now });
  const root = runs[0];
  const clock = L.computeClock({ log, approvals, state: { phase: 'done', tier: 1 }, profile: {} });
  check('the root carries the same minutes the clock computes', root.outputs.agent_minutes === clock.agent_minutes && root.outputs.waiting_minutes === clock.waiting_minutes && root.outputs.dead_minutes === clock.dead_minutes, JSON.stringify(root.outputs));
  const phases = runs.filter((r) => r.parent_run_id === root.id);
  check('one child per phase in order, each step under its phase', phases.map((p) => p.name).join(',') === 'design,build' && runs.filter((r) => phases.some((p) => p.id === r.parent_run_id)).length === 4);
  check('every run belongs to the root trace and extends its parent\'s dotted order', runs.every((r) => r.trace_id === root.id) && runs.filter((r) => r.parent_run_id).every((r) => r.dotted_order.startsWith(runs.find((p) => p.id === r.parent_run_id).dotted_order + '.')));
  const owner = runs.find((r) => r.name === 'owner');
  check('the approval is a step tagged waiting; the resume is tagged dead', owner && owner.tags.includes('waiting') && runs.some((r) => r.tags.includes('dead')));
  check('a recent change keeps its real times', root.start_time === '2026-10-13T06:00:00.000Z' && !root.tags.includes('replayed'));
  const old = T.buildTrace(L, { id: 'c1', title: 'Fixture', tier: 1, log, approvals, streams: [], now: now + 5 * 86400000 });
  check('an older change is replayed to end now with the same durations, and says so', old[0].end_time === new Date(now + 5 * 86400000).toISOString() && Date.parse(old[0].end_time) - Date.parse(old[0].start_time) === Date.parse(root.end_time) - Date.parse(root.start_time) && old[0].tags.includes('replayed') && old[0].extra.metadata.recorded_started_at === '2026-10-13T06:00:00.000Z');
  const long = log + '\n2026-10-14T07:05:00.000Z | build | conductor | finally';
  check('a change longer than LangSmith\'s window is not sent', T.buildTrace(L, { id: 'c1', log: long, approvals, now }).length === 0);
  const stream = [
    JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'wh-builder' } }] } }),
    JSON.stringify({ type: 'assistant', parent_tool_use_id: 't1', message: { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 7 }, content: [] } }),
    JSON.stringify({ type: 'result', total_cost_usd: 0.42 }),
  ].join('\n');
  const u = T.usageFromStreams([stream]);
  check('stream usage is split by the agent each Task call started', u.by_agent.conductor.output_tokens === 5 && u.by_agent['wh-builder'].input_tokens === 100 && u.by_agent['wh-builder'].cache_read_input_tokens === 7 && u.cost_usd === 0.42, JSON.stringify(u));
  const tr = path.join(tmp, 'trace');
  fs.mkdirSync(path.join(tr, 'docs', 'sdlc', '2026-10-13-fixture'), { recursive: true });
  const gt = (...a) => execFileSync('git', a, { cwd: tr, encoding: 'utf8' }).trim();
  gt('init', '-q'); gt('config', 'user.email', 'tester@example.com'); gt('config', 'user.name', 'Tester');
  fs.writeFileSync(path.join(tr, 'docs', 'sdlc', '2026-10-13-fixture', 'conductor-log.md'), log + '\n');
  gt('add', '.'); gt('commit', '-q', '-m', 'record');
  const noKey = { ...process.env }; delete noKey.LANGSMITH_API_KEY;
  const dry = spawnSync(process.execPath, [WH, 'trace', '--repo', tr, '--all', '--dry-run'], { cwd: tr, encoding: 'utf8', env: noKey });
  check('--dry-run shows the trace without a key', dry.status === 0 && JSON.parse(dry.stdout).traces[0].change_id === '2026-10-13-fixture', dry.stderr);
  const send = spawnSync(process.execPath, [WH, 'trace', '--repo', tr, '--all'], { cwd: tr, encoding: 'utf8', env: noKey });
  check('without LANGSMITH_API_KEY nothing is sent and it says why', send.status === 2 && /LANGSMITH_API_KEY is not set/.test(send.stderr));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
