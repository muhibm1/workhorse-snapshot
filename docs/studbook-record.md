# The engineering record in the loop (Studbook)

**What it is.** WorkHorse's designer and discovery analyst can search the engineering record of
every repository you work in: earlier briefs, ship documents, retros, ADRs, changelogs and commit
messages. Before designing a change, the designer asks "what did we decide about these files
before, and what went wrong last time?" and gets the passages back, with where they came from.

**What it costs.** Nothing per search. Studbook's record server runs on your machine against a
local SQLite file; the embedding and reranking models run locally too. The one paid tool, a
cited answer from Anthropic's API (`ask_record`), is off unless you set `STUDBOOK_MCP_ASK_LIMIT`,
and no agent lists it.

## How it is wired

- The plugin registers the server itself (`.mcp.json` at the plugin root), so there is nothing to
  register by hand. The harness names its tool `mcp__plugin_workhorse_studbook__search_record`.
- `scripts/studbook-mcp.js` finds a Studbook checkout (`STUDBOOK_HOME`, else
  `~/C.Projects/studbook`, `~/Projects/studbook` or `~/studbook`), runs its virtualenv's Python
  on `-m mcp_server`, and points it at `~/.studbook/record.sqlite` (or `STUDBOOK_LOCAL_DB`).
- On start it refreshes the record in the background from `~/.studbook/corpus.json` (only
  changed passages are re-embedded; log in `~/.studbook/sync.log`). `STUDBOOK_AUTO_SYNC=0` turns
  that off.
- With no checkout or no virtualenv, the launcher exits 1 with one line, and the agents carry on
  without the tool, saying so in their report.

## Set up once

1. Clone `muhibm1/studbook` and create its virtualenv as its README says.
2. Write `~/.studbook/corpus.json`: `{"repos": {"workhorse": "/path/to/workhorse", ...}}`, one
   lowercase name per git checkout.
3. Build the record: `.venv/bin/python -m localrecord.sync --corpus ~/.studbook/corpus.json --all`
   from the Studbook checkout. The first build embeds everything (minutes on a laptop CPU);
   later refreshes take about a minute.

## Why it is fast

A search used to take about 3 seconds. Measured on 2026-10-13 (4-core cloud CPU, all six
repositories, 3,880 passages), 98% of that was the cross-encoder reranker, and it bought no
recall an agent needs: on Studbook's dev questions the fused top 10 holds a right passage as
often as the reranked top 8 (0.88, `studbook/docs/retrieval-ceiling.md`). So the launcher:

- turns the reranker off (`STUDBOOK_MCP_RERANK=off`) and the agents ask for ten passages and
  judge them themselves, which is what they are good at;
- encodes the question with ONNX Runtime (`STUDBOOK_QUERY_ENCODER=onnx`), the same model and the
  same vectors as PyTorch, in half the time;
- loads the models when the server starts (`STUDBOOK_MCP_PRELOAD=1`), so the first call is fast;
- runs the server with one OpenMP thread, which stops PyTorch's idle threads competing with ONNX
  Runtime's (93 ms per search without it, 40 ms with it).

| | per search, p50 | first call |
|---|---|---|
| before (reranker on, PyTorch) | 2,900 ms | 12,100 ms |
| now, measured over the 40 dev questions through the MCP protocol | **44 ms** | 90 ms |

`STUDBOOK_QUERY_ENCODER=onnx-int8` brings it to about 24 ms with slightly different vectors (9.5
of the top 10 agree with fp32 on average). Apple Silicon is expected to be faster than this cloud
CPU; the Mac's own number is in the change's PR once measured.
