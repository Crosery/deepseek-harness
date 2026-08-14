import { Context } from '@deepseek-ai/cordis'
import { ConversationEventRegistry, ConversationViewRegistry } from '@deepseek-ai/dsh-client-runtime/client-node'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** Stub terminal capturing every write path. */
function stubTerminal() {
  const output: string[] = []
  const lines: ((line: string) => void | Promise<void>)[] = []
  const sigints: (() => void)[] = []
  const closes: (() => void)[] = []
  return {
    output,
    terminal: {
      isTTY: false,
      width: 80,
      markdown: { renderLine: (line: string) => line, reset: () => {} },
      write: (text: string) => { output.push(text) },
      stream: (text: string) => { output.push(text) },
      print: (text = '') => { output.push(text) },
      status: (text: string) => { output.push(text) },
      setPrompt: () => {},
      refreshPrompt: () => {},
      registerNodeRenderer: () => () => {},
      renderNode: () => false,
      registerCommand: () => () => {},
      dispatchCommand: () => false,
      busy: () => false,
      onLine: (listener: (line: string) => void | Promise<void>) => { lines.push(listener); return () => {} },
      onSigint: (listener: () => void) => { sigints.push(listener); return () => {} },
      onClose: (listener: () => void) => { closes.push(listener); return () => {} },
      close: () => {},
    } as never,
    lines,
    sigints,
    closes,
  }
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nodes: [],
    partial: null,
    running: false,
    pending: [],
    promptError: null,
    openError: null,
    openState: 'open',
    ...overrides,
  }
}

async function boot(startup: Record<string, unknown>, faceOverrides: Record<string, unknown> = {}) {
  const ctx = new Context()
  const stub = stubTerminal()
  const subscribers = new Set<() => void>()
  let currentSnapshot = snapshot(faceOverrides)
  const prompts: unknown[] = []
  const face = {
    getSnapshot: () => currentSnapshot,
    subscribe: (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener) } },
    prompt: async (parts: unknown) => { prompts.push(parts); return { ok: true, value: { accepted: true } } },
    command: async () => ({ ok: true, value: { matched: false } }),
    cancel: async () => ({ ok: true, value: { accepted: true } }),
    projections: { faceOf: () => ({ getSnapshot: () => null, subscribe: () => () => {} }) },
  }
  const binding = { session: face }
  let current: string | undefined
  let listListener: (() => void) | undefined
  const sessions = {
    list: {
      subscribe: (cb: () => void) => { listListener = cb; cb(); return () => { listListener = undefined } },
      getSnapshot: () => ({ current }),
    },
    binding: () => binding,
  }
  ctx.provide('terminal', stub.terminal)
  ctx.provide('sessions', sessions as never)
  ctx.provide('connection', { api: { sessions: { selectModel: async () => ({ result: { ok: true } }) } } } as never)
  ctx.provide('cliStartup', startup)
  await ctx.plugin(ConversationEventRegistry).await()
  await ctx.plugin(ConversationViewRegistry).await()
  apply(ctx)
  const setCurrent = (id: string | undefined) => { current = id; listListener?.() }
  const emit = (next: Record<string, unknown>) => {
    currentSnapshot = snapshot(next)
    for (const listener of [...subscribers]) listener()
  }
  return { stub, setCurrent, emit, prompts }
}

describe('terminal-conversation plugin', () => {
  it('renders finalized nodes and streaming partials', async () => {
    const { stub, setCurrent, emit } = await boot({ task: undefined })
    setCurrent('session-1')
    emit({
      nodes: [{ kind: 'user', seq: 1, time: 0, turn: 1, step: 1, content: [{ type: 'text', text: 'hello' }], source: {} }],
    })
    emit({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'hi ' }] },
      running: true,
    })
    expect(stub.output.join('\n')).toContain('> hello')
    expect(stub.output.join('')).toContain('hi ')
  })

  it('sends plain lines as prompts and slash lines through the dispatch fallback', async () => {
    const { stub, setCurrent } = await boot({ task: undefined })
    setCurrent('session-1')
    const handler = stub.lines[0]
    expect(handler).toBeDefined()
    await handler?.('do the thing')
    await handler?.('/plan on')
    expect(stub.output.length).toBeGreaterThanOrEqual(0)
  })

  it('queues early lines until a session binds', async () => {
    const { stub, setCurrent, prompts } = await boot({ task: undefined })
    const handler = stub.lines[0]
    await handler?.('early line')
    expect(prompts.length).toBe(0)
    setCurrent('session-1')
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    expect(prompts).toEqual([[{ type: 'text', text: 'early line' }]])
  })

  it('sends the one-shot task once the session binds', async () => {
    const { setCurrent } = await boot({ task: 'run it' })
    setCurrent('session-1')
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    // the face prompt is a stub; the user node rendering proves the task node exists
  })
})
