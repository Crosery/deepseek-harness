# Terminal Client Plane

Status: implemented (M1 vertical slice)
Date: 2026-08-14

## What

A second client platform for DeepSeek Harness: `dsh cli` boots a
Node-resident terminal client plane over the same host composition the web
uses, with zero sockets — the "everything is a plugin" composition model
applies to the terminal UI exactly as it does to the browser UI.

## Why

The web surface costs a browser tab plus a React/Vite frontend. A terminal
surface with the same agent capabilities fits one Node process with an
in-process transport, cutting idle memory to a fraction and keeping full
feature parity (conversation, tools, approvals, subagents, workflows, goals,
plan mode, skills, commands, jobs, attachments, feedback, model selection,
session resume) by sharing the host plane and the React-free data layer.

## How

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
  MAINs to empty host halves; the browser's module system maps names to
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
the `chat` view builder. The web registers it in ui-conversation's apply;
the terminal registers it in terminal-conversation's apply. One fold, two
renderers.

## Key mechanics learned (do not relearn)

- `Context.extend` prototype-chains, so `reflect`/service stores are
  shared per tree; services provided by any plugin are visible via
  `ctx.get` at the root once the providing fiber is ACTIVE.
- The host `createSharedFetchHandler` expects a WHATWG `Request`; the
  in-process client hands `(URL, init)` — normalize with
  `new Request(input, init)` before dispatch.
- `loader.await()` + the ACTIVE-fiber sweep is the fail-loud boot gate;
  mount entries by `/client-node` subpath.
- The mux/host event streams and the unary carrier all ride
  `InProcessApiClient`'s single `doFetch` seam — no webserver listener is
  ever bound (the webserver row exists only for the route registry the
  host connection channels need).
