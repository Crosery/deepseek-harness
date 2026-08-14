/**
 * Terminal client plane wire: provides `ctx.connection` over the in-process
 * gateway. The cli runner composes the host `apiProxy` into a pure fetch
 * handler and provides it as `ctx.cliTransport` before this plugin mounts
 * unary calls, both SSE event streams, and the respond channel all travel
 * through that one handler — no socket, no listener, no network.
 * @module @deepseek-ai/dsh-client-terminal-connection/client
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  RpcId,
  serverResponseSchema,
  type ClientRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { InProcessApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import {
  ConnectionController,
  type ClientConnectionRpc,
  type ConnectionHandle,
  type HostDescription,
} from '@deepseek-ai/dsh-client-connection/client-node'

/** Internal authority for the in-process handler (pathname is all it reads). */
const INTERNAL_BASE = 'http://dsh.internal'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The composed host fetch handler (`apiProxy` gateway plus host
     * connection channels), provided by the cli runner into the client
     * context root before client plugins mount.
     */
    cliTransport: { fetch: typeof fetch }
  }
}

/** Stable Cordis plugin name. */
export const name = 'terminal-connection'

/** Required service: the cli runner's in-process transport. */
export const inject = ['cliTransport']

/**
 * Build the generic logical-RPC caller over the in-process fetch handler.
 * @param handler - the composed host fetch handler from {@link Context.cliTransport}.
 * @returns caller that owns request correlation and response-envelope validation.
 */
function createInProcessRpc(handler: { fetch: typeof fetch }): ClientConnectionRpc {
  return {
    async call(channel, endpoint, payload, signal) {
      const rpcId = RpcId(randomUUID())
      const message: ClientRequest = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      const response = await handler.fetch(
        new URL(`${channel}/${endpoint}`, INTERNAL_BASE),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
          ...(signal === undefined ? {} : { signal }),
        },
      )
      if (!response.ok) {
        throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
      }
      const full = serverResponseSchema.parse(await response.json())
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
  }
}

/**
 * Client plugin body: wrap the in-process handler in the protocol client and
 * provide `ctx.connection` exactly like the web wire does. The runtime
 * object layer owns the pump loop through {@link ConnectionHandle.start}.
 * @param ctx - terminal client cordis context.
 */
export function apply(ctx: Context): void {
  const handler = ctx.cliTransport
  const api = new InProcessApiClient(handler)
  const rpc = createInProcessRpc(handler)
  let started = false
  let description: HostDescription | undefined
  const descriptionListeners = new Set<() => void>()
  const publishDescription = (next: HostDescription | undefined): void => {
    if (Object.is(description, next)) return
    description = next
    for (const listener of [...descriptionListeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[terminal-connection] host-description listener threw:', error)
      }
    }
  }
  const handle: ConnectionHandle = {
    api,
    isLoopback: true,
    hostDescription: {
      getSnapshot: () => description,
      subscribe: (listener) => {
        descriptionListeners.add(listener)
        return () => { descriptionListeners.delete(listener) }
      },
    },
    rpc,
    start(sinks, config) {
      if (started) throw new Error('connection: the stream loop is already owned by another consumer')
      started = true
      const controller = new ConnectionController(api, {
        ...sinks,
        onConnected: (next) => {
          publishDescription(next)
          if (!Object.is(description, next)) return
          sinks.onConnected?.(next)
        },
        onStateChange: (state) => {
          if (state === 'reconnecting') publishDescription(undefined)
          sinks.onStateChange?.(state)
        },
      }, config ?? {})
      controller.start()
      return {
        stop: () => {
          controller.stop()
          publishDescription(undefined)
        },
      }
    },
  }
  ctx.provide('connection', handle)
}
