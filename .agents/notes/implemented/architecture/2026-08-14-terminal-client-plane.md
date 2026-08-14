# Agent Note: Terminal client plane

Status: implemented

## Problem

The web surface costs a browser tab plus a React/Vite frontend. A terminal
surface with the same agent capabilities can fit one Node process with an
in-process transport, cutting idle memory to a fraction while keeping full
feature parity (conversation, tools, approvals, subagents, workflows,
goals, plan mode, skills, commands, jobs, attachments, feedback, model
selection, session resume).

## Decision

A second client platform: `dsh cli` boots a Node-resident terminal client
plane over the same host composition the web uses, with zero sockets — the
"everything is a plugin" composition model applies to the terminal UI
exactly as it does to the browser UI.

- New packages under `packages/client/`:
  - `terminal-connection` — provides `ctx.connection` (the web wire shape)
    over `InProcessApiClient(toFetchHandler(ctx.apiProxy))`: unary calls and
    both SSE event streams travel through one fetch-shaped handler. Zero
    sockets, zero listeners.
  - `terminal` — the presentation kernel: ANSI writer, incremental
    markdown renderer, raw-mode line input, `ctx.terminal` service.
  - `terminal-conversation` — binds the current session, renders finalized
    conversation nodes plus streaming partials, dispatches input lines to
    `session.prompt`/`session.command`, handles SIGINT cancel, and applies
    the one-shot `--model`/`--permission`/`task` startup flags.
- New bundle `packages/bundle/cli-app` (`@deepseek-ai/dsh-cli-app`): the
  terminal patch layer over `dsh-base` plus the in-process runner. It scans
  the composed loader entries for `dsh.client` packages declaring the
  `terminal` platform, boots a second cordis context (Loader-managed) in the
  same process, provides `cliTransport`/`cliStartup` into it, and mounts
  each roster package's `/client-node` subpath (Node resolves package
  MAINs to empty host halves; the browser module system maps names to
  client bundles, so the terminal plane needs the explicit subpath).
- Profile template `cli` = `@deepseek-ai/dsh-base` +
  `@deepseek-ai/dsh-cli-app`; `dsh cli` is a hardcoded alias like
  `dsh web`; `dsh cli "<task>"` runs one task and prints it (the
  verification harness), bare `dsh cli` is interactive.

## Shared platform declarations

`dsh.client` gains an optional `platforms` array (legacy `platform`
kept). Packages whose client half serves both platforms declare
`["web", "terminal"]`: typert-registry, api-remotes, client-runtime,
api-gateway. The web modules scanner reads the array; packages get a
`./client-node` export pointing at the tsc emit
(`lib/types/client/index.js`), which is plain Node ESM.

## Shared business fold

The conversation-node definitions and chat snapshot builder moved from
`packages/client/ui-conversation/src/client/conversation-nodes` into
`packages/client/runtime/src/client/chat` (the React-free data layer):
`registerConversationChat(ctx)` registers the event→node state machines and
the `chat` view builder. The web registers it in ui-conversation apply;
the terminal registers it in terminal-conversation apply. One fold, two
renderers.

## Feature parity (all web agent features, terminal-rendered)

- conversation (streaming markdown in place, a thinking pulse while
  reasoning streams, settled dim reasoning rows, queue replay, resume)
- live command hints: typing / or \ opens a filtered menu under the input
  (client commands, host commands, session skills), cursor on the first
  match, descriptions beside each row; both prefixes dispatch identically
- tool cards (render-intent views: terminal/diff/search/read/web/generic)
- approvals + ask_user_question inline prompts (answer-mode input)
- slash commands: client /help /sessions /new /model /like /dislike /memory
  /quit; host /plan /goal /compact /permission /feedback /export pass
  through
- goal bar, plan chip, jobs and subagent status line (host projections)
- image attachments via `@path/to/image.png` expansion
- session resume (`--session`), model selection, permission presets

## Display: omp-style line rendering

The transcript is line-oriented, not a full-screen TUI: the kernel owns the
single output seam and the input line. Design borrows omp presentation
without its alternate screen: a bordered welcome box (whale, active model,
hints, Tip line), a braille pulse while reasoning streams (the settled
block prints once, dimmed with a · per source line), and an omp
select-list-shaped hint menu drawn under the input through the
cursor-save/restore dance (`\x1b7 … \x1b8`).

`ctx.terminal.setHintProvider((line) => HintItem[] | null)` is the hint
seat: the kernel re-renders the menu on every buffer change (replaceable
provider, one registered listener, `undefined` disables), `renderHintMenu`
lays out the rows. The prompt redraws only when output consumed its line
since the last draw (a `promptDirty` flag in the kernel), so idle snapshot
updates do not replay the prompt.

Streaming partials rewrite in place: the streamed tail is always the full
current line, and a delta first piece completes the previous line as
`previousTail + piece` — never the lone fragment, which would erase the
accumulated prefix on the next clear. Empty delta lines advance the cursor
without printing a cleared blank row.

## Memory and startup (measured, macOS arm64, Node 24)

- `dsh cli` idle (session open, no turn): RSS ~158 MB with
  `NODE_OPTIONS=--max-old-space-size=256 --optimize-for-size`, ~223 MB with
  default V8 settings; heap capped ~70 MB.
- During a live turn with tool output: RSS ~163 MB (nearly flat).
- Startup to first streamed output incl. a full model round-trip: ~1.6 s.
- The cli profile disables the session-telemetry-otel row (the terminal
  surface uploads no telemetry); the web keeps its default-disabled
  exporter.

## Key mechanics

- `Context.extend` prototype-chains, so `reflect`/service stores are
  shared per tree; services provided by any plugin are visible via
  `ctx.get` at the root once the providing fiber is ACTIVE.
- The host `createSharedFetchHandler` expects a WHATWG `Request`; the
  in-process client hands `(URL, init)` — normalize with
  `new Request(input, init)` before dispatch.
- `loader.await()` + the ACTIVE-fiber sweep is the fail-loud boot gate;
  mount entries by `/client-node` subpath.
- The mux/host event streams and the unary carrier all ride
  `InProcessApiClient` single `doFetch` seam — no webserver listener is
  ever bound (the webserver row exists only for the route registry the
  host connection channels need).

## Alternatives considered

- **Full-screen TUI with an alternate screen** (ratatui/Ink-style, as omp
  itself uses): loses to a line-oriented transcript over readline. The
  alternate screen needs differential diffing, resize handling, and mouse
  routing for nothing the CLI needs; readline keeps boot and memory lower
  while the streaming transcript, prompt, and hint menu still deliver
  omp presentation.
- **A real socket between the client and host planes** (boot the webserver
  locally and connect): loses to the in-process fetch-shaped handler. A
  listener adds a port, a browser-grade security surface, and startup cost
  for nothing the terminal plane consumes.
- **Reuse the web frontend for the terminal** (render the web GUI headless
  or through a terminal browser): loses to the native terminal plane. The
  web shell is React/Vite bound; sharing it carries the bundle and the
  browser machinery into a process whose point is a small footprint.

## Consequences

- The transcript is append/rewrite-based, not a differential frame: every
  write clears the current line first, so all writers route through the
  kernel seam and prompt redraws stay gated by `promptDirty`.
- The hint menu previews only (no arrow-key selection): readline keeps
  owning the editor, matching omp look without its editor widget.
- TTY-only draw branches (menu render, cursor dance, spinner) run only
  under a pty; unit tests cover the state logic and the scripted live
  capture verifies the rendering.
- Piped/print-mode transcripts stay clean: banners, spinners, and colors
  degrade away when stdin/stdout are not a TTY.
