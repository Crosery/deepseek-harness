# @deepseek-ai/dsh-client-terminal-connection

Terminal client plane wire: provides `ctx.connection` (the same service the
web wire provides) over an in-process transport.

`new InProcessApiClient(toFetchHandler(ctx.apiProxy))` carries unary calls,
both SSE event streams, and the respond channel through one fetch-shaped
handler — zero sockets, zero listeners, zero network.

The cli runner composes the host handler (apiProxy gateway plus the host
connection's logical RPC channels) and provides it as `ctx.cliTransport`
before client plugins mount.

## Services

- `ctx.connection`: `ConnectionHandle` (api client, rpc caller,
  host-description source, pump starter).

## Model Experience

No model interaction: this package is a transport adapter.

## Known Limitations and Deferred Work

- The generic logical-RPC caller validates no channel/endpoint segments
  (typed same-process boundary); the web carrier's regexes stay web-side.
