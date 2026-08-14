# @deepseek-ai/dsh-client-terminal-conversation

Terminal conversation plugin: binds the current session, renders finalized
conversation nodes and streaming assistant partials, and dispatches input
lines to `session.prompt` (plain text) or `session.command` (slash
commands).

It registers the shared conversation-node definitions and chat snapshot
builder (`registerConversationChat`) — the same business fold the web
renders from — and applies the one-shot startup flags: `task` (print mode),
`--model`, `--permission`.

## Model Experience

Renders model output verbatim: streaming text partials print incrementally,
finalized assistant messages render as markdown, tool results preview
dimmed (capped at 2000 characters), turn errors and token-limit notices
print as colored lines.

## Known Limitations and Deferred Work

- Tool-result previews are capped rather than paged; expandable tool cards
  arrive with the tool-features milestone.
- Markdown strong/emphasis markers inside the in-flight partial line render
  raw until the line completes.
