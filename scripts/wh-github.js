'use strict';
// GitHub as the approval surface (0.4.0). When a gate is presented, the change branch is pushed
// and its pull request carries the gate document, so the person approving reads it where they
// already are, on any device, and answers in the PR conversation:
//
//   /approve                      accept every recommendation in the Decisions table
//   /approve D2: the alternative  accept the rest, override D2
//   /reject <what to change>      send the gate back with notes
//
// An approving review counts as /approve and "request changes" as /reject, from anyone listed in
// profile.github.approvers (default: the gh-authenticated user). A decision counts only if it
// was made after the gate was presented; a review also only if it was made on the commit that
// was presented. The decision is then recorded by `wh.js approve`, the same path a terminal
// approval takes, with the GitHub author and a link as the audit source.
//
// Everything here goes through the `gh` CLI with argument arrays. Every call is best effort: a
// missing gh, no network or no GitHub remote never fails a gate; the terminal path still works.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MARKER = '<!-- workhorse:gate -->';
const GATE_WORDS = { G2: 'Design', G4: 'Ship', G5: 'Deploy' };

function gh(root, args, input) {
  const r = spawnSync('gh', args, { cwd: root, encoding: 'utf8', input, timeout: 60000, windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() || (r.error ? r.error.message : '') };
}

function ghJson(root, args) {
  const r = gh(root, args);
  if (!r.ok) return null;
  try { return JSON.parse(r.out); } catch (e) { return null; }
}

/** GitHub approvals are on when the profile does not turn them off and origin is on GitHub. */
function enabled(L, root, profile) {
  const cfg = (profile && profile.github) || {};
  if (cfg.approvals === false) return false;
  const remote = L.git(root, ['config', '--get', 'remote.origin.url']) || '';
  return /github\.com[:/]/.test(remote);
}

let cachedLogin;
function currentLogin(root) {
  if (cachedLogin !== undefined) return cachedLogin;
  const r = gh(root, ['api', 'user', '--jq', '.login']);
  cachedLogin = r.ok ? r.out : null;
  return cachedLogin;
}

/** Who may approve: profile.github.approvers, else the gh-authenticated user. Lower-cased. */
function approvers(root, profile) {
  const list = (profile && profile.github && profile.github.approvers) || [];
  const names = (Array.isArray(list) ? list : [list]).map((s) => String(s).trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  if (names.length) return names;
  const me = currentLogin(root);
  return me ? [me.toLowerCase()] : [];
}

function defaultBranch(L, root) {
  const head = L.git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  return head ? head.replace(/^origin\//, '') : 'main';
}

function findPr(root, branch) {
  const list = ghJson(root, ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,isDraft,headRefOid', '--limit', '1']);
  return list && list[0] ? list[0] : null;
}

function tmpFile(text) {
  const f = path.join(os.tmpdir(), `wh-gh-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(f, text);
  return f;
}

/** The comment that tells the approver what to do, with the gate document's short version. */
function gateComment({ gate, title, tier, summary, decisions, packetPath, packetUrl, clock }) {
  const word = GATE_WORDS[gate] || gate;
  const rows = (decisions || []).map((d) => `- **${d.id}** ${d.decision}. Recommended: ${d.recommendation}`);
  return [
    MARKER,
    `### ${word} is waiting on you: ${title}`,
    '',
    // The link goes to the file on the change branch: the default branch does not have it yet.
    `Tier ${tier}. Read [\`${path.posix.basename(packetPath)}\`](${packetUrl || packetPath}), rendered.`,
    '',
    summary || '',
    '',
    rows.length ? `**Decisions** (each has a recommendation; \`/approve\` accepts them all):\n\n${rows.join('\n')}` : '',
    '',
    `Reply with **\`/approve\`** to continue, **\`/approve D2: <your choice>\`** to override a decision, or **\`/reject <what to change>\`** to send it back.`,
    '',
    clock ? `<sub>${clock}</sub>` : '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/**
 * Commit the change's documents, push the branch, make sure a pull request exists (a draft at
 * Design, ready for review at Ship), and post the gate comment. Returns { url, head } or
 * { skipped: reason }. Never throws.
 */
function presentOnGitHub(L, root, id, state, gate, info) {
  try {
    const profile = L.loadProfile(root);
    if (!enabled(L, root, profile)) return { skipped: 'GitHub approvals are off or origin is not on GitHub' };
    const branch = state.branch || L.git(root, ['branch', '--show-current']);
    if (!branch) return { skipped: 'no change branch' };
    const dirRel = path.relative(root, L.changeDir(root, id)).split(path.sep).join('/');
    L.git(root, ['add', '--', dirRel]);
    L.git(root, ['commit', '-q', '-m', `chore(sdlc): ${gate} packet for ${id}`, '--', dirRel]);
    const push = spawnSync('git', ['push', '-q', '-u', 'origin', branch], { cwd: root, encoding: 'utf8', timeout: 120000 });
    if (push.status !== 0) return { skipped: `push failed: ${(push.stderr || '').trim().split('\n').pop()}` };
    const head = L.git(root, ['rev-parse', 'HEAD']);
    let pr = findPr(root, branch);
    const word = GATE_WORDS[gate] || gate;
    if (!pr) {
      const body = tmpFile(`${info.summary || ''}\n\nWorkHorse change \`${id}\`. The gate document is \`${info.packetPath}\`.\n`);
      const args = ['pr', 'create', '--base', defaultBranch(L, root), '--head', branch, '--title', `${word}: ${state.title || id}`, '--body-file', body];
      if (gate === 'G2') args.push('--draft');
      const r = gh(root, args);
      fs.rmSync(body, { force: true });
      if (!r.ok) return { skipped: `could not open the pull request: ${r.err.split('\n').pop()}` };
      pr = findPr(root, branch);
      if (!pr) return { skipped: 'pull request created but not found' };
    } else if (gate !== 'G2' && pr.isDraft) {
      gh(root, ['pr', 'ready', String(pr.number)]);
      gh(root, ['pr', 'edit', String(pr.number), '--title', `${state.title || id}`]);
    }
    const repoUrl = String(pr.url).replace(/\/pull\/\d+.*$/, '');
    const packetUrl = `${repoUrl}/blob/${branch.split('/').map(encodeURIComponent).join('/')}/${info.packetPath}`;
    const c = tmpFile(gateComment({ gate, title: state.title || id, ...info, packetUrl }));
    const cr = gh(root, ['pr', 'comment', String(pr.number), '--body-file', c]);
    fs.rmSync(c, { force: true });
    return { url: pr.url, number: pr.number, head, commented: cr.ok };
  } catch (e) {
    return { skipped: `GitHub step failed: ${e.message}` };
  }
}

/**
 * The decision in a pull request's conversation, if any. Pure: takes the conversation and the
 * rules, returns the latest valid decision or null. Items are
 *   comments: { login, body, created_at, url }
 *   reviews:  { login, state, body, submitted_at, commit_id, url }
 */
function readDecision({ comments, reviews, presentedAt, presentedHead, approvers: allowed }) {
  const since = Date.parse(presentedAt || 0) || 0;
  const ok = (login) => allowed.includes(String(login || '').toLowerCase());
  const found = [];
  for (const c of comments || []) {
    const body = String(c.body || '');
    if (body.includes(MARKER) || !ok(c.login) || Date.parse(c.created_at) <= since) continue;
    const first = body.trim().split(/\r?\n/)[0];
    let m;
    if ((m = /^\/approve\b[:\s]*(.*)$/i.exec(first))) {
      found.push({ at: Date.parse(c.created_at), decision: 'approve', notes: (m[1] + '\n' + body.trim().split(/\r?\n/).slice(1).join('\n')).trim(), by: c.login, url: c.url });
    } else if ((m = /^\/reject\b[:\s]*(.*)$/i.exec(first))) {
      const notes = (m[1] + '\n' + body.trim().split(/\r?\n/).slice(1).join('\n')).trim();
      found.push({ at: Date.parse(c.created_at), decision: 'reject', notes: notes || 'Rejected on GitHub with no notes; see the pull request conversation.', by: c.login, url: c.url });
    }
  }
  for (const r of reviews || []) {
    if (!ok(r.login) || Date.parse(r.submitted_at) <= since) continue;
    if (presentedHead && r.commit_id && r.commit_id !== presentedHead) continue; // reviewed a different commit
    if (r.state === 'APPROVED') found.push({ at: Date.parse(r.submitted_at), decision: 'approve', notes: String(r.body || '').trim(), by: r.login, url: r.url });
    if (r.state === 'CHANGES_REQUESTED') found.push({ at: Date.parse(r.submitted_at), decision: 'reject', notes: String(r.body || '').trim() || 'Changes requested on GitHub; see the review.', by: r.login, url: r.url });
  }
  found.sort((a, b) => b.at - a.at);
  return found[0] || null;
}

/** Fetch a pull request's conversation in the shape readDecision takes. */
function fetchConversation(root, number) {
  const comments = ghJson(root, ['api', `repos/{owner}/{repo}/issues/${number}/comments`, '--paginate']) || [];
  const reviews = ghJson(root, ['api', `repos/{owner}/{repo}/pulls/${number}/reviews`, '--paginate']) || [];
  return {
    comments: comments.map((c) => ({ login: c.user && c.user.login, body: c.body, created_at: c.created_at, url: c.html_url })),
    reviews: reviews.map((r) => ({ login: r.user && r.user.login, state: r.state, body: r.body, submitted_at: r.submitted_at, commit_id: r.commit_id, url: r.html_url })),
  };
}

function postComment(root, number, text) {
  const f = tmpFile(`${MARKER}\n${text}`);
  const r = gh(root, ['pr', 'comment', String(number), '--body-file', f]);
  fs.rmSync(f, { force: true });
  return r.ok;
}

/** One state for a pull request's checks, from `gh pr checks --json name,bucket` rows:
 *  red (any failed or cancelled), pending (any still running), green, or none (no CI at all). */
function summarizeChecks(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const failing = list.filter((r) => r.bucket === 'fail' || r.bucket === 'cancel').map((r) => r.name);
  if (failing.length) return { state: 'red', failing };
  if (list.some((r) => r.bucket === 'pending')) return { state: 'pending', failing: [] };
  return { state: list.length ? 'green' : 'none', failing: [] };
}

/** The pull request's checks. gh exits non-zero while checks fail or run, so read stdout anyway. */
function prChecks(root, number) {
  const r = gh(root, ['pr', 'checks', String(number), '--json', 'name,bucket']);
  let rows = null;
  try { rows = JSON.parse(r.out); } catch (e) { rows = null; }
  if (!rows) return /no checks reported/i.test(r.err) ? { state: 'none', failing: [] } : { state: 'unknown', failing: [], error: r.err };
  return summarizeChecks(rows);
}

/** What to do with an approved pull request (0.5.1). Pure. A Ship approval is the owner saying
 *  "merge it", so WorkHorse merges as soon as CI is green, never over a red check. */
function mergeDecision({ prState, checks }) {
  if (prState === 'MERGED') return { action: 'merged', why: 'the pull request is already merged' };
  if (prState !== 'OPEN') return { action: 'refuse', why: `the pull request is ${String(prState || 'unknown').toLowerCase()}` };
  const c = checks || { state: 'unknown' };
  if (c.state === 'red') return { action: 'refuse', why: `CI is red: ${c.failing.join(', ')}` };
  if (c.state === 'pending') return { action: 'wait', why: 'CI is still running' };
  if (c.state === 'unknown') return { action: 'wait', why: 'CI state could not be read' };
  return { action: 'merge', why: c.state === 'none' ? 'no CI is configured' : 'CI is green' };
}

/** Squash-merge (or the profile's method) only if the head is still the commit that was checked. */
function mergePr(root, number, method, head) {
  const m = ['squash', 'merge', 'rebase'].includes(method) ? method : 'squash';
  const args = ['pr', 'merge', String(number), `--${m}`];
  if (head) args.push('--match-head-commit', head);
  return gh(root, args);
}

module.exports = { summarizeChecks, prChecks, mergeDecision, mergePr, MARKER, GATE_WORDS, enabled, approvers, currentLogin, findPr, presentOnGitHub, readDecision, fetchConversation, postComment, gateComment, gh };
