import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/client/index.ts'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client-node'

/** Minimal in-process gateway: SSE streams that stay open plus unary echoes. */
function fakeGateway(): { fetch: typeof fetch } {
  return {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (request.method === 'GET' && (url.pathname === '/api/events.mux' || url.pathname === '/api/events.host')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(': connected\n\n'))
          },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
      }
      const body = await request.json() as { rpcId: string; method: string; payload: unknown }
      if (body.method === 'host.describe') {
        return Response.json({
          type: 'server-response',
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: { version: 'test', cwd: '/tmp', attachedSessions: 0, canOpenPath: false },
          },
        })
      }
      if (body.method === 'session.cancel') {
        return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { accepted: true } } })
      }
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: body.payload } })
    },
  }
}

function boot(): { ctx: Context; handle: ConnectionHandle } {
  const ctx = new Context()
  ctx.provide('cliTransport', fakeGateway())
  apply(ctx)
  const handle = ctx.get('connection') as unknown as ConnectionHandle
  return { ctx, handle }
}

describe('terminal-connection plugin', () => {
  it('declares its plugin face', () => {
    expect(name).toBe('terminal-connection')
    expect(inject).toEqual(['cliTransport'])
  })

  it('round-trips a unary RPC through the in-process handler', async () => {
    const { handle } = boot()
    const result = await handle.api.sessions.cancel({ sessionId: 'session-x' as never })
    expect(result.result).toEqual({ ok: true, value: { accepted: true } })
  })

  it('runs the generic logical RPC over the same handler', async () => {
    const { handle } = boot()
    const result = await handle.rpc.call('/api', 'host.describe', {})
    expect(result).toEqual({
      ok: true,
      value: { version: 'test', cwd: '/tmp', attachedSessions: 0, canOpenPath: false },
    })
  })

  it('starts the pump once and reports host description', async () => {
    const { handle } = boot()
    const connected: unknown[] = []
    const stopped = handle.start({
      onConnected: (description) => { connected.push(description) },
    })
    await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
    expect(handle.hostDescription.getSnapshot()).toEqual({
      version: 'test', cwd: '/tmp', attachedSessions: 0, canOpenPath: false,
    })
    expect(connected.length).toBe(1)
    expect(() => handle.start({})).toThrow(/already owned/)
    stopped.stop()
  })

  it('reports loopback and publishes description changes through subscribe', async () => {
    const { handle } = boot()
    expect(handle.isLoopback).toBe(true)
    const seen: unknown[] = []
    const unsubscribe = handle.hostDescription.subscribe(() => {
      seen.push(handle.hostDescription.getSnapshot())
    })
    const stopped = handle.start({})
    await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
    expect(seen.length).toBe(1)
    expect(seen[0]).toEqual({
      version: 'test', cwd: '/tmp', attachedSessions: 0, canOpenPath: false,
    })
    unsubscribe()
    stopped.stop()
  })

  it('surfaces rpcId mismatch as an error', async () => {
    const ctx = new Context()
    let captured: { rpcId: string } | undefined
    ctx.provide('cliTransport', {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        captured = await request.json()
        return Response.json({ type: 'server-response', rpcId: 'other', result: { ok: true, value: null } })
      },
    } as unknown as { fetch: typeof fetch })
    apply(ctx)
    const handle = ctx.get('connection') as unknown as ConnectionHandle
    await expect(handle.rpc.call('/api', 'any', {})).rejects.toThrow(/rpcId mismatch/)
    expect(captured).toBeDefined()
  })
})
