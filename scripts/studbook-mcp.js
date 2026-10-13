#!/usr/bin/env node
'use strict';
// Starts Studbook's record server (stdio MCP) for the agents in this plugin, so the designer and
// the discovery analyst can search earlier changes' records in every indexed repository.
//
// It finds a Studbook checkout (STUDBOOK_HOME, else a few usual places), runs that checkout's own
// virtualenv Python on `-m mcp_server`, and points it at the local record file
// (STUDBOOK_LOCAL_DB, default ~/.studbook/record.sqlite) so no database account is needed, with the
// reranker off and the models preloaded so a search takes milliseconds, not seconds. The
// answer tool stays off unless STUDBOOK_MCP_ASK_LIMIT is set: search costs nothing, and it is the
// only tool the agents list. If ~/.studbook/corpus.json exists, the record is refreshed in the
// background on start (only changed passages are re-embedded). With no checkout found it writes
// one line to stderr and exits 1; the agents treat a missing tool as "continue without it".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Returns the first directory that holds a Studbook checkout with mcp_server/, or null.
function findHome(env, home) {
  const candidates = [
    env.STUDBOOK_HOME,
    path.join(home, 'C.Projects', 'studbook'),
    path.join(home, 'Projects', 'studbook'),
    path.join(home, 'studbook'),
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'mcp_server', '__main__.py'))) || null;
}

// Returns the checkout's virtualenv interpreter (POSIX or Windows layout), or null.
function findPython(studbookHome) {
  const candidates = [
    path.join(studbookHome, '.venv', 'bin', 'python'),
    path.join(studbookHome, '.venv', 'Scripts', 'python.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Builds the server's environment: the local record unless a database URL was chosen, and the
// paid answer tool capped at zero calls unless the caller set its own cap.
function serverEnv(env, home) {
  const out = { ...env };
  if (!out.STUDBOOK_LOCAL_DB && !out.STUDBOOK_DATABASE_URL) {
    out.STUDBOOK_LOCAL_DB = path.join(home, '.studbook', 'record.sqlite');
  }
  if (out.STUDBOOK_MCP_ASK_LIMIT === undefined) out.STUDBOOK_MCP_ASK_LIMIT = '0';
  // Fast by default: the fused ranking without the CPU cross-encoder (about 3 s of a 3 s search),
  // and models loaded at start so even the first call is quick.
  if (out.STUDBOOK_MCP_RERANK === undefined) out.STUDBOOK_MCP_RERANK = 'off';
  if (out.STUDBOOK_MCP_PRELOAD === undefined) out.STUDBOOK_MCP_PRELOAD = '1';
  if (out.STUDBOOK_QUERY_ENCODER === undefined) out.STUDBOOK_QUERY_ENCODER = 'onnx';
  // One OpenMP thread: PyTorch's and OpenBLAS's idle worker threads otherwise compete with ONNX
  // Runtime's, which measured 93 ms per search against 40 ms with this set (4-core CPU).
  if (out.OMP_NUM_THREADS === undefined && out.STUDBOOK_MCP_RERANK === 'off') out.OMP_NUM_THREADS = '1';
  return out;
}

// Starts a detached refresh of the record from ~/.studbook/corpus.json; returns whether it did.
function refreshInBackground(python, studbookHome, env, home) {
  const corpus = path.join(home, '.studbook', 'corpus.json');
  if (env.STUDBOOK_AUTO_SYNC === '0' || !env.STUDBOOK_LOCAL_DB || !fs.existsSync(corpus)) return false;
  const logDir = path.join(home, '.studbook');
  const log = fs.openSync(path.join(logDir, 'sync.log'), 'a');
  const child = spawn(python, ['-m', 'localrecord.sync', '--corpus', corpus, '--all', '--db', env.STUDBOOK_LOCAL_DB], {
    cwd: studbookHome, env, detached: true, stdio: ['ignore', log, log],
  });
  child.unref();
  return true;
}

// Runs the server in the foreground on this process's stdio and exits with its code.
function main() {
  const home = os.homedir();
  const studbookHome = findHome(process.env, home);
  if (!studbookHome) {
    process.stderr.write('studbook-mcp: no Studbook checkout found; set STUDBOOK_HOME\n');
    return process.exit(1);
  }
  const python = findPython(studbookHome);
  if (!python) {
    process.stderr.write(`studbook-mcp: no .venv in ${studbookHome}; create it as its README says\n`);
    return process.exit(1);
  }
  const env = serverEnv(process.env, home);
  // The refresh embeds many passages at once and wants every core, so it does not inherit the
  // server's one-thread setting.
  const syncEnv = { ...process.env, STUDBOOK_LOCAL_DB: env.STUDBOOK_LOCAL_DB };
  refreshInBackground(python, studbookHome, syncEnv, home);
  const server = spawn(python, ['-m', 'mcp_server'], { cwd: studbookHome, env, stdio: 'inherit' });
  server.on('exit', (code, signal) => process.exit(signal ? 1 : code));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
}

if (require.main === module) main();

module.exports = { findHome, findPython, serverEnv };
