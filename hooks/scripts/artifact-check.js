#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): hold every change document to a size a person can read,
// and refuse a Ship document that still carries a blocker. Prompt guidance alone did not hold:
// live runs wrote a 2,279-line spec and a 1,124-line eval plan for a personal website, every
// later agent read all of it, and the human approved with the note "none". This hook measures
// after every write; when a file is over its limit, or the Ship document has an unresolved
// high or medium finding, it returns decision "block", which feeds the reason back to the
// writing agent. The write itself stands; the agent is told to fix it.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

// Line limits by tier. Tier 3 keeps a limit too: the human still has to read it.
const by = (t01, t2, t3) => (tier) => (tier <= 1 ? t01 : tier === 2 ? t2 : t3);
const LIMITS = {
  'brief.md': by(80, 120, 160),
  'ship.md': by(100, 150, 200),
  'spec.md': by(120, 250, 400),
  'plan.md': by(120, 200, 300),
  'evals.md': by(150, 300, 500),
  'verification.md': by(120, 150, 200),
  'release.md': () => 150,
  'intent.md': () => 190, // legacy changes only
};
// Eval cases are also counted: every case is a test someone runs, and 180-row manual checklists
// were never filled in. Only rows with an id in the first cell count (E1, GC12, AD-3, ...).
const EVAL_CASES = by(15, 40, 80);
const CASE_ROW_RE = /^\|\s*[A-Z]{1,3}-?\d+\s*\|/;
// Reviewer reports live in docs/sdlc/<id>/reviews/<name>.md so the fixer and the shipper read
// them and a cut-off run does not lose them.
const REVIEW_LIMIT = by(60, 80, 100);

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root) return L.emit({});
const file = L.toolFilePath(input);
if (!file) return L.emit({});
const rel = L.relToRoot(ctx.root, file);
if (rel === null) return L.emit({});
const m = /^docs\/sdlc\/[^/]+\/(?:(reviews)\/[^/]+\.md|([a-z-]+\.md))$/.exec(rel);
if (!m) return L.emit({});

let text;
try {
  text = fs.readFileSync(path.join(ctx.root, rel), 'utf8');
} catch (e) {
  return L.emit({});
}
const lines = text.trimEnd().split('\n').length;
const tier = L.effectiveTier(ctx.state);
const cut = 'Cut it and write the file again: a section that does not apply becomes one "Not applicable: reason" line, cite the brief, profile and codebase map instead of restating them, and move detail only a builder needs into an ADR.';

if (m[1] === 'reviews') {
  const limit = REVIEW_LIMIT(tier);
  if (lines > limit) {
    return L.emit({ decision: 'block', reason: `[workhorse] ${rel} is ${lines} lines; a reviewer report is at most ${limit} at tier ${tier}. Keep one row per finding with severity, file:line, the failure scenario and the fix; drop narrative.` });
  }
  return L.emit({});
}

const name = m[2];
const limit = LIMITS[name] ? LIMITS[name](tier) : null;
if (limit !== null && lines > limit) {
  return L.emit({ decision: 'block', reason: `[workhorse] ${rel} is ${lines} lines; the limit for ${name} at tier ${tier} is ${limit}. A person reads it. ${cut}` });
}

if (name === 'evals.md') {
  const cases = text.split('\n').filter((l) => CASE_ROW_RE.test(l)).length;
  const max = EVAL_CASES(tier);
  if (cases > max) {
    return L.emit({ decision: 'block', reason: `[workhorse] ${rel} has ${cases} cases; the limit at tier ${tier} is ${max}. Keep the cases that would change a decision if they failed, merge near-duplicates, and drop any case a machine cannot run.` });
  }
}

if (name === 'ship.md' && L.packetComplete(text)) {
  const blockers = L.shipBlockers(text, ctx.state);
  if (blockers.length) {
    return L.emit({ decision: 'block', reason: `[workhorse] ${rel} cannot be presented: ${blockers.join('; ')}. Fix and re-verify first, then write the resolution into the findings table; never present a defect the pipeline can fix.` });
  }
}

L.emit({});
