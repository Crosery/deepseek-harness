# @deepseek-ai/dsh-cli-app

The dsh terminal-surface bundle: the cli patch layer over `dsh-base` plus
the in-process client-plane runner.

`dsh cli` boots the host composition (same agent core, tools, sandbox,
persistence as every surface), composes the gateway into one fetch-shaped
handler, boots a Node-resident terminal client context over it, and opens or
resumes the session. `dsh cli "<task>"` prints one run and exits;
bare `dsh cli` is interactive.

The bundle patch keeps every agent-plane row the base ships enabled (the
headless criterion: single-session, process-wide composition) and mounts the
terminal roster instead of the browser roster.

## Model Experience

The persona and model defaults are the shared `dsh-base` ones; the bundle
adds no model-visible surface beyond the shared system prompt restatement.

## Known Limitations and Deferred Work

- The terminal roster scans composed loader entries; user-patched terminal
  plugins join it automatically, but their packages must declare
  `dsh.client.platforms: ["terminal"]` and export `./client-node`.
- The webserver row exists only for the route registry the host connection
  channels need; no listener is ever bound.
