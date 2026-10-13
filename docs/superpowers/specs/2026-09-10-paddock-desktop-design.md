# Paddock: the WorkHorse desktop

Date: 2026-09-10
Status: approved design, v1
Lives at: `WorkHorse/desk/` (same repository as the plugin, so one thing to move)

## 1. Purpose

Paddock is a desktop application that watches every repository running WorkHorse, drives runs
through the user's installed Claude, and is the place where gates are opened. It bundles the
WorkHorse plugin, so a fresh machine needs only the app, Node 18+, and a `claude` login.

Two audiences, one build. For the owner: a portable build reusing the existing `claude` login,
no API key. For a future customer: the same app with the backend switched to the Agent SDK and
an API key entered in Settings. v1 ships the first and keeps the seam for the second clean.

## 2. Screens

### 2.1 Fleet

Every registered repository as a card in a responsive grid. A card shows client name, repo
name, the active change title, phase, tier badge, verification state, and a `Waiting On` badge
that reads "You (G4)" in amber when a gate is blocked on a human. Cards are sorted with
human-blocked changes first, then active runs, then idle.

Each card carries an ASCII field (section 4.3) as its background layer. The field renders the
phase's glyph faintly and rises in density while a run is active in that repo.

Registering: drag a folder onto the window or use "Add repository". A folder without
`.workhorse/profile.yml` is accepted and shown as "not onboarded" with a button that starts
`/workhorse:onboard`.

### 2.2 Run

The centrepiece screen for one repository.

- The orb (section 3) is centred, 320 px.
- A ring of stations surrounds it at radius 240 px: `00 Onboard`, `01 Intent`, `G1`,
  `02 Spec`, `G2`, `03 Plan`, `G3`, `04 Build`, `05 Verify`, `06 Review`, `G4`, `07 Deploy`,
  `G5`, `08 Retro`. Reached stations are lit; gate stations are amber; the current station is
  emphasised. Hovering a lit station shows a tooltip naming its artifact; clicking opens it in
  the Gate screen's viewer.
- Agent satellites: each `agent:start` adds a small chip on an outer ring at radius 300 px
  labelled with the agent's short name (`builder`, `verifier`) and a live elapsed timer; each
  `agent:stop` retires it with a short fade. Up to twelve are shown; beyond that a "+N" chip.
- The primary action sits directly under the orb and depends on state:
  - no active change: **Start** (opens the prompt field: problem, arrow, outcome)
  - active, agents working: **Stop run**
  - stopped at a gate: **Approve Gx** and a secondary **Reject**
  - active, no run in progress: **Resume**
- Clicking the orb fans out a radial menu on the ring at four positions: Status, Packet, Log,
  Sync. Clicking outside closes it.
- A log rail on the right streams normalised events in mono: phase changes, agent starts and
  stops with duration, tool names, gate reached, result with cost. Auto-scrolls, pausable.
- A thin status strip at the bottom shows session id, backend, elapsed, and cost so far.

### 2.3 Gate

Opened from a station, the primary action, or a Fleet badge.

- Left: sticky index of the packet's six sections plus Approve / Reject.
- Centre: the packet rendered from markdown. Tables render as tables. Paths in the diff tour
  are links that open the file read-only in a side sheet.
- Approve: a notes field and a button labelled with the gate. Reject: the same with notes
  required. Both call `gate.approve` / `gate.reject`, which run `wh.js approve` in the repo,
  then the screen returns to Run and, if a backend is configured, resumes the run.
- The header shows tier, required human gates, and who approved earlier gates from
  `approvals.md`.

### 2.4 Settings

- Backend: `CLI (uses your claude login)` or `Agent SDK (API key)`. Choosing SDK reveals an
  API key field stored through `safeStorage`; the field never displays the stored value.
- Plugin: `Bundled (vX.Y.Z)` or a path. Shows the resolved path.
- Per-repo allowed tools: a text area seeded from the profile's commands, used as
  `--allowedTools` for the CLI backend and `allowedTools` for the SDK backend.
- Prerequisites panel: `node` and `claude` versions, with fix-it text when missing.
- Theme: dark only in v1, shown as a disabled control so the seam is visible.

### 2.5 First launch

If `node` or `claude` is missing, a setup screen explains what to install and where, with a
"Check again" button. Nothing else renders until both are present, except Settings.

## 3. The centrepiece

### 3.1 Orb

The `thinking-orbs` engine (MIT) supplies geometry, depth shading and motion, and the orb must
look and move the way libraries.dev/orbs shows it. Each frame,
`MODE_FRAMES[mode](size, t, opts)` returns dots and lines. Size 320 px, with `opts` the
library's full-size profile (the one its radii and counts were tuned for, a 300 pt frame)
carrying the 64 px preset's speed and per-state extras; `t` is page time, as in the library's
own component. (Revised 2026-09-15: the earlier 64 px preset scaled by guessed multipliers
rendered sparse and flat.)

State mapping, driven by the merged run state:

| Situation | Orb state | Speed | Ring |
|---|---|---|---|
| no active change | breathing | 1 | none |
| intent | composing | 1 | cyan |
| spec | weaving | 1 | cyan |
| plan | shaping | 1 | cyan |
| build | working | 1 | cyan, satellite count shown |
| verify | solving | 1 | cyan |
| review | searching | 1 | cyan |
| deploy | connecting | 1 | cyan |
| stopped at a gate | breathing | 1 | amber, pulsing |
| run error | breathing | 1 | coral, static |
| done | breathing | 1 | mint, fades after 5 s |

Palette painting keeps the engine's shading: its dark-theme ink (1 - `white`, so near dots are
bright and far dots dim) multiplies a two-stop gradient for the ring tone (cyan to violet while
running, amber to pink at a gate, coral to pink on error, mint to cyan when done), with the
engine's alpha and draw order unchanged. With no active change the orb is the engine's own
grey. The ring is a CSS circle at the orb's edge in the tone colour with a soft glow; at a gate
it pulses. `prefers-reduced-motion` freezes the orb on a still frame and stops the pulse.

### 3.2 Radial controls

The four menu items and the station ring share one polar layout helper:
`polar(cx, cy, r, angleDeg)`. Stations occupy 14 equal angular slots starting at the top and
running clockwise. Menu items open at 45°, 135°, 225°, 315° on the station radius, over the
stations, and close on outside click or Escape.

## 4. Visual identity

### 4.1 Palette

| Token | Value | Use |
|---|---|---|
The Dracula palette (revised 2026-09-15 from the original navy scheme).

| Token | Value | Use |
|---|---|---|
| `--ground` | `#21222c` | window background |
| `--panel` | `#282a36` | cards, rails, sheets |
| `--panel-2` | `#313442` | raised: hover, pills, stations |
| `--hairline` | `#3a3d4f` | borders and rules (`#44475a` at 55%) |
| `--hairline-strong` | `#44475a` | hovered borders |
| `--ink` | `#f8f8f2` | primary text |
| `--ink-soft` | `#c4c7d4` | secondary text |
| `--ink-faint` | `#6272a4` | labels, disabled (Dracula comment) |
| `--cyan` | `#8be9fd` | agents, activity, running |
| `--amber` | `#ffb86c` | human required, gates |
| `--mint` | `#50fa7b` | verification green, done |
| `--coral` | `#ff5555` | red, errors, destructive |
| `--violet` | `#bd93f9` | the accent: primary actions, focus, active nav; tier 3 |
| `--pink` | `#ff79c6` | second gradient stop |

Dark only. Every colour is a token; nothing is literal in components.

### 4.2 Type and devices

- UI: **Manrope** 400/500/600/700, loaded from a bundled woff2 (no network at runtime).
- Data, labels, ASCII: **JetBrains Mono** 400/500/700, bundled.
- Labels are uppercase mono at 0.68 rem with 0.1 em tracking. Numbers use tabular figures.
- Surfaces are continuous and rounded: panels 16 px, controls 12 px, badges are pills, the Run
  stage 24 px. A panel is a hairline border with a soft drop shadow; the one that wants
  attention takes an accent (or, for a card waiting on you, amber) border and glow.
- Navigation is a 60 px icon rail (Fleet, Run, Settings) under an accent logo tile, with a
  52 px top bar holding the breadcrumb and a "waiting on you" pill.
- A 24 px hairline grid is a faint texture inside the Run stage only.
- Metric bars: 2 px tall, `--hairline` track, colour fill.

### 4.3 ASCII field

A canvas component `AsciiField` with props `width`, `height`, `cell` (px, default 10),
`ramp` (default `" .:-=+*#%@"`), `color`, `density` (0 and up; the ramp clamps at 1), `mask` (optional
`(u, v) => number` in 0 to 1 giving the shape to reveal), `seed`, `speed`.

Each cell samples value noise (the orb engine's `vnoise` re-exported) at `(x / cell + t,
y / cell)`, multiplies by `density` and by `mask(u, v)` when present, and picks the ramp
character by that value. Cells are drawn with `fillText` in JetBrains Mono at `cell - 2` px.
The whole field redraws at 24 fps while visible and stops when offscreen
(`IntersectionObserver`). Hover on a Fleet card raises `density` by 0.25. Fleet composes its mask as
`max(0.45, glyph(u, v))`: a bare glyph mask confined the texture to one letter, and to a single
dot when a repo has no phase (measured: 25 of 59,840 pixels painted). Idle density is 0.7 and
running 1.0. Revised 2026-09-11 from measured pixel counts; the original 0.25 idle drew almost
nothing because noise times density rarely cleared the ramp's first step.

Masks provided: `glyph(char)` (rasterises a character into a mask via an offscreen canvas),
`disc(r)`, `none`.

### 4.4 Motion

Only three kinds: the orb, the ASCII fields, and 150 ms ease-out transitions on state changes
(station lighting, satellite fade, primary action swap). No page transitions, no parallax.
`prefers-reduced-motion` stops the first two and keeps the third.

## 5. Architecture

Electron 44, `electron-vite`, React 18, TypeScript strict, Zustand for renderer state.

```
desk/
  package.json                 scripts: dev, build, test, e2e, dist
  electron.vite.config.ts
  electron-builder.yml         portable win, dmg, AppImage; extraResources: resources/plugin
  scripts/sync-plugin.js       copies ../ (agents, skills, hooks, scripts, templates, .claude-plugin) into resources/plugin
  resources/plugin/            generated, gitignored
  resources/fonts/             Manrope, JetBrains Mono woff2
  src/shared/types.ts          the one file every process imports
  src/main/
    index.ts                   app lifecycle, window, CSP headers
    ipc.ts                     registers every handler in section 6
    registry.ts                repos.json read and write
    watcher.ts                 chokidar per repo -> digest -> event
    wh.ts                      spawn node <plugin>/scripts/wh.js in a repo
    syscheck.ts                node and claude on PATH
    settings.ts                settings.json + safeStorage for the key
    drivers/types.ts           RunDriver interface, RunEvent
    drivers/normalise.ts       stream-json message -> RunEvent[] (pure, tested)
    drivers/cli.ts             spawns claude -p
    drivers/sdk.ts             @anthropic-ai/claude-agent-sdk query()
  src/preload/index.ts         contextBridge.exposeInMainWorld('paddock', api)
  src/renderer/
    index.html                 CSP meta
    main.tsx, App.tsx
    theme.css                  tokens from 4.1, type, brackets, grid
    store.ts                   repos, digests, settings, run state per repo
    lib/polar.ts, lib/orbState.ts (pure, tested)
    components/Orb.tsx, AsciiField.tsx, Panel.tsx, Station.tsx, Satellite.tsx,
               RadialMenu.tsx, LogRail.tsx, Markdown.tsx, Badge.tsx, Button.tsx
    screens/Fleet.tsx, Run.tsx, Gate.tsx, Settings.tsx, Setup.tsx
  tests/                       vitest: normalise, orbState, polar, registry, asciiMask
  fixtures/stream-json/        recorded ndjson from real runs
  e2e/smoke.spec.ts            playwright-electron
```

### 5.1 Processes

- **Main** owns the filesystem, child processes, settings, and the API key. It never trusts
  renderer input for paths: every IPC call that touches a repo takes a `repoId` and resolves the
  path from the registry.
- **Preload** exposes a typed `window.paddock` object. No Node globals reach the renderer.
- **Renderer** is pure UI. It renders from the store; the store is fed by IPC events.

### 5.2 RunDriver

```ts
interface RunDriver {
  start(args: { repoPath: string; prompt: string; allowedTools: string[]; pluginPath: string }): RunHandle;
}
interface RunHandle {
  id: string;
  events: AsyncIterable<RunEvent>;
  stop(): Promise<void>;
}
```

`CliDriver.start` spawns:

```
claude -p "<prompt>" --output-format stream-json --verbose --include-hook-events
       --permission-mode acceptEdits --allowedTools "<list>" --plugin-dir "<pluginPath>"
       --max-turns 400
```

with `cwd = repoPath`, reads stdout line by line, and passes each JSON object to
`normalise()`. `stop()` sends SIGTERM and marks the run stopped.

`SdkDriver.start` calls `query({ prompt, options: { cwd, allowedTools, permissionMode:
'acceptEdits', plugins: [{ type: 'local', path }], hooks: { SubagentStart, SubagentStop },
maxTurns } })` with `ANTHROPIC_API_KEY` set from `safeStorage`, and passes each message to the
same `normalise()`. This is why the normaliser is a pure function over message objects.

### 5.3 Normalised events

```ts
type RunEvent =
  | { t: 'init'; sessionId: string; plugins: string[]; skills: string[] }
  | { t: 'agent:start'; agentId: string; agentType: string; at: number }
  | { t: 'agent:stop'; agentId: string; agentType: string; at: number }
  | { t: 'tool'; toolUseId: string; name: string; agentId?: string; at: number }
  | { t: 'text'; text: string; agentId?: string; at: number }
  | { t: 'result'; subtype: string; costUsd?: number; numTurns?: number; sessionId?: string }
  | { t: 'error'; message: string }
  | { t: 'exit'; code: number | null };
```

Phase and gate are **not** derived from the stream. They come from the watcher: whenever the
control state in the git common dir changes (`.git/workhorse/active`,
`.git/workhorse/changes/<id>/state.json`) or a `docs/sdlc` artifact changes, main runs
`wh.js digest` for that repo and emits `repo:digest`. The watcher watches the state root as a
second path because the repo tree prunes `.git`. The Run screen merges the digest (phase, gates, waiting_on, tier) with the live
stream (agents, tools, text). This keeps the orb correct even for runs started from a terminal.

`at` is `Date.now()` in main; the renderer computes elapsed from it.

### 5.4 Approvals

`gate.approve(repoId, gate, notes)` runs `node <plugin>/scripts/wh.js approve <gate> <notes>`
with `cwd = repoPath`, returns its JSON, and the watcher's next digest reflects the new gate
status. The subagent guard in `bash-guard.js` does not apply: Paddock is not a Claude tool call,
so no hook runs. Rejection requires notes; the UI enforces it before calling.

### 5.5 Plugin bundling

`scripts/sync-plugin.js` copies the plugin from the repository root into `resources/plugin`,
excluding `desk/`, `examples/`, `docs/`, `.git`, `node_modules`. `electron-builder.yml` lists
`resources/plugin` under `extraResources`. At runtime the bundled path is
`path.join(process.resourcesPath, 'plugin')` in production and `resources/plugin` in dev.
Settings may override with a custom path.

## 6. IPC contract (`window.paddock`)

```ts
interface PaddockApi {
  system: { check(): Promise<SysCheck> };
  repos: {
    list(): Promise<RepoRef[]>;
    add(path: string): Promise<RepoRef>;        // path comes from a native dialog or drop
    remove(id: string): Promise<void>;
    pickFolder(): Promise<string | null>;       // native dialog, main process
  };
  fleet: { digest(repoId: string): Promise<ChangeDigest[]> };
  artifact: { read(repoId: string, relPath: string): Promise<string> };  // relPath under docs/sdlc only
  run: {
    start(repoId: string, prompt: string): Promise<{ runId: string }>;
    resume(repoId: string): Promise<{ runId: string }>;
    stop(runId: string): Promise<void>;
    onEvent(cb: (e: { runId: string; repoId: string; event: RunEvent }) => void): () => void;
  };
  gate: {
    approve(repoId: string, gate: Gate, notes: string): Promise<ApproveResult>;
    reject(repoId: string, gate: Gate, notes: string): Promise<ApproveResult>;
  };
  settings: {
    get(): Promise<Settings>;                   // never includes the key
    set(patch: Partial<Settings>): Promise<Settings>;
    setApiKey(key: string): Promise<void>;
    hasApiKey(): Promise<boolean>;
    clearApiKey(): Promise<void>;
  };
  watch: { onDigest(cb: (e: { repoId: string; digests: ChangeDigest[] }) => void): () => void };
}
```

`ChangeDigest` is exactly the object `wh.js digest` prints. `Settings` is
`{ backend: 'cli' | 'sdk'; pluginPath: string | null; allowedTools: Record<repoId, string[]>; theme: 'dark' }`.

`artifact.read` rejects any `relPath` containing `..` or not starting with `docs/sdlc/`.

## 7. Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer.
- CSP on the renderer: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'`.
- No `shell.openExternal` on untrusted strings; packet links open in the in-app viewer.
- API key stored with `safeStorage.encryptString`, kept in `settings.key.bin`, decrypted only
  in main at spawn time, passed to the child via env, never logged.
- Child processes are spawned with explicit argument arrays, never a shell string.
- The app writes only to its user data folder and, through `wh.js`, to `docs/sdlc/` of a
  registered repo.
- No telemetry, no network calls from the renderer, no auto-update in v1.

## 8. Testing

- Vitest, run with `npm test` in `desk/`:
  - `normalise.test.ts` feeds every fixture in `fixtures/stream-json/` and asserts the
    event sequence, including `agent:start`/`agent:stop` pairs and the final `result`.
  - `orbState.test.ts` covers every row of the table in 3.1.
  - `polar.test.ts` covers the 14 slots and the 4 menu angles.
  - `registry.test.ts` add, remove, duplicate path, missing folder.
  - `asciiMask.test.ts` glyph mask has mass, disc mask is radial.
- Playwright-Electron smoke: launch, pass syscheck, register `examples/hello-service`, see it
  on Fleet with "not onboarded", open Settings. Runs with `npm run e2e`.
- Packaging is verified by building the portable Windows exe on this machine and launching it.

## 9. Out of scope for v1

Licensing, auto-update, installer onboarding flow, light theme, Notion inside the app, editing
artifacts in the app, multiple simultaneous runs per repo, macOS notarisation.

## 10. Prerequisites and packaging

- Runtime: Node 18+ on PATH (hooks are spawned as `node`), `claude` on PATH for the CLI backend.
- Build: `npm run dist` produces `dist/Paddock-<version>-portable.exe` on Windows, `.dmg` on
  macOS, `.AppImage` on Linux. The portable build keeps its user data next to the exe when a
  `portable` file exists beside it, so a USB copy carries its registry and settings.
