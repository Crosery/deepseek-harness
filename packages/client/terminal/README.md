# @deepseek-ai/dsh-client-terminal

Terminal client plane kernel: the ANSI writer, the incremental markdown
renderer, raw-mode line input with serialized handlers, and the
`ctx.terminal` service every terminal feature plugin composes against.

The kernel renders nothing on its own: feature plugins register input
handlers and write through the shared writer, mirroring how the web shell
owns the render tree while ui-* plugins own their seats.

## Services

- `ctx.terminal`: `TerminalService` — `write`/`print`/`status`,
  `setPrompt`/`refreshPrompt`, `markdown` (shared incremental
  renderer), `onLine`/`onSigint`/`onClose`, `close`.

## Model Experience

No model interaction: presentation kernel only.

## Known Limitations and Deferred Work

- No persistent status footer yet (status lines print per batch); a footer
  seat is deferred to the status-features milestone.
- The markdown renderer covers headings, emphasis, inline code, fences,
  lists, blockquotes, and rules; tables degrade to pipe text.
