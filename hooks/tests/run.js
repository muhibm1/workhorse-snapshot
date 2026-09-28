#!/usr/bin/env node
// Hook and CLI tests. Builds a throwaway repo under the OS temp dir, feeds each hook sample
// JSON on stdin, and asserts the decision. Run: node hooks/tests/run.js
'use strict';
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
  check('recognises Claude Code isolation worktrees', L.isInsideWorktree('C:\\repo\\.claude\\worktrees\\agent-abc'));
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
  let r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop' });
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
  check('present prints the gate name, the packet and the commands', pres.code === 0 && /Design \(G2\) is waiting on you/.test(pres.out) && /approve G2 --accept-all/.test(pres.out), pres.err || pres.out);
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
  // names: the hook reads the plan from the main checkout (client-style app, run 3 of 0.3.4).
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
