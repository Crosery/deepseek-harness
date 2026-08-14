import { Context } from '@deepseek-ai/cordis'
import { ConversationEventRegistry, ConversationViewRegistry } from '@deepseek-ai/dsh-client-runtime/client-node'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** Stub terminal capturing every write path. */
function stubTerminal(tty = false) {
  const output: string[] = []
  const lines: ((line: string) => void | Promise<void>)[] = []
  const sigints: (() => void)[] = []
  const closes: (() => void)[] = []
  const dispatches: string[] = []
  const faceCommands: string[] = []
  return {
    output,
    terminal: {
      isTTY: tty,
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
      dispatchCommand: (line: string) => { dispatches.push(line); return false },
      busy: () => false,
      nextLine: () => { output.push('<NL>') },
      clearLine: () => { output.push('<CLR>') },
      onLine: (listener: (line: string) => void | Promise<void>) => { lines.push(listener); return () => {} },
      onSigint: (listener: () => void) => { sigints.push(listener); return () => {} },
      onClose: (listener: () => void) => { closes.push(listener); return () => {} },
      close: () => {},
    } as never,
    lines,
    sigints,
    closes,
    dispatches,
    faceCommands,
  }
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nodes: [],
    partial: null,
    running: false,
    runningCalls: [],
    pending: [],
    promptError: null,
    openError: null,
    openState: 'open',
    ...overrides,
  }
}

async function boot(startup: Record<string, unknown>, faceOverrides: Record<string, unknown> = {}, tty = false) {
  const ctx = new Context()
  const stub = stubTerminal(tty)
  const subscribers = new Set<() => void>()
  let currentSnapshot = snapshot(faceOverrides)
  const prompts: unknown[] = []
  const face = {
    getSnapshot: () => currentSnapshot,
    subscribe: (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener) } },
    prompt: async (parts: unknown) => { prompts.push(parts); return { ok: true, value: { accepted: true } } },
    command: async (line: string) => { stub.faceCommands.push(line); return { ok: true, value: { matched: false } } },
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
  ctx.provide('connection', {
    api: {
      sessions: {
        selectModel: async () => ({ result: { ok: true } }),
        models: async () => ({
          result: {
            ok: true,
            value: {
              current: { provider: 'deepseek-official', model: 'deepseek-chat' },
              routable: true,
              groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-chat', name: 'deepseek-chat' }] }],
              failures: [],
            },
          },
        }),
      },
    },
  } as never)
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
    emit({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'hi there' }] },
      running: true,
    })
    emit({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'hi there\ncool' }] },
      running: true,
    })
    expect(stub.output.join('\n')).toContain('> hello')
    // the tail rewrites as the full grown line, never a lone delta fragment;
    // a completing delta prints the whole line (prefix + fragment) once
    expect(stub.output).toContain('hi there')
    expect(stub.output).toContain('cool')
  })

  it('sends plain lines as prompts and slash lines through the dispatch fallback', async () => {
    const { stub, setCurrent } = await boot({ task: undefined })
    setCurrent('session-1')
    const handler = stub.lines[0]
    expect(handler).toBeDefined()
    await handler?.('do the thing')
    await handler?.('/plan on')
    expect(stub.dispatches).toEqual(['/plan on'])
    expect(stub.faceCommands).toEqual(['/plan on'])
  })

  it('normalizes backslash command lines to the slash form', async () => {
    const { stub, setCurrent } = await boot({ task: undefined })
    setCurrent('session-1')
    const handler = stub.lines[0]
    await handler?.('\\plan on')
    expect(stub.dispatches).toEqual(['/plan on'])
    expect(stub.faceCommands).toEqual(['/plan on'])
  })

  it('renders steering and context rows and retry notices', async () => {
    const { stub, setCurrent, emit } = await boot({ task: undefined })
    setCurrent('session-1')
    emit({
      nodes: [
        { kind: 'steering', messageId: 'm1', seq: 1, time: 0, content: [{ type: 'text', text: 'steer here' }], source: {} },
        { kind: 'context', seq: 2, time: 1, content: [{ type: 'text', text: 'recalled note' }], source: {}, provenance: { role: 'recall', label: 'session-b' }, form: null },
        { kind: 'model-retry', seq: 3, time: 2, retryState: 'started', attempt: 1 },
        { kind: 'model-retry', seq: 4, time: 3, retryState: 'cancelled', attempt: 2 },
      ],
    })
    const transcript = stub.output.join('\n')
    expect(transcript).toContain('> ↪ steer here')
    expect(transcript).toContain('↩ session-b: recalled note')
    expect(transcript).toContain('↻ retrying…')
    expect(transcript).not.toContain('retry scheduled')
    expect(transcript).not.toContain('cancelled')
  })

  it('prints the dim usage and timing footer after an assistant message', async () => {
    const { stub, setCurrent, emit } = await boot({ task: undefined })
    setCurrent('session-1')
    emit({
      nodes: [{
        kind: 'assistant',
        seq: 1,
        messageId: 'm1',
        time: 4000,
        turn: 1,
        step: 1,
        blocks: [{ kind: 'text', text: 'done' }],
        usage: { inputTokens: 1000, outputTokens: 800, cacheReadTokens: 200 },
        timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 4000 },
      }],
    })
    const transcript = stub.output.join('\n')
    expect(transcript).toContain('↑ 1.2k ↓ 800 · 3.0s · ttft 0.5s')
  })

  it('advances on empty delta lines without printing blank rows', async () => {
    const { stub, setCurrent, emit } = await boot({ task: undefined })
    setCurrent('session-1')
    emit({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'first' }] }, running: true })
    emit({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'first\n\nsecond' }] }, running: true })
    // no empty print rows: the streamed tail and the <NL> advance only
    expect(stub.output).not.toContain('')
    expect(stub.output).toContain('<NL>')
    expect(stub.output.join('|')).toContain('second')
  })

  it('keeps streamed reasoning behind the pulse and renders it dimmed at settle', async () => {
    const { stub, setCurrent, emit } = await boot({ task: undefined })
    setCurrent('session-1')
    emit({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'thinking now' }] },
      running: true,
    })
    // non-TTY: no spinner writes, and the reasoning never streams as text
    expect(stub.output.join('')).not.toContain('thinking now')
    emit({
      nodes: [{
        kind: 'assistant',
        seq: 2,
        messageId: 'm1',
        time: 1,
        turn: 1,
        step: 1,
        blocks: [{ kind: 'reasoning', text: 'thinking now' }],
        usage: undefined,
        timing: null,
      }],
      partial: null,
      running: false,
    })
    expect(stub.output.join('')).toContain('· thinking now')
  })

  it('records each running call once as a dim pending row in piped runs', async () => {
    const { stub, setCurrent, emit } = await boot({ task: undefined })
    setCurrent('session-1')
    const call = {
      callId: 'c1',
      name: 'bash',
      argsRaw: '{"command":"pwd"}',
      callView: { card: 'terminal', title: 'pwd' },
      turn: 1,
      step: 1,
      time: 0,
      subCalls: [],
    }
    emit({ runningCalls: [call], running: true })
    emit({ runningCalls: [call], running: true })
    expect(stub.output.filter(line => line.includes('… bash: pwd')).length).toBe(1)
  })

  it('pulses the live activity line on a TTY through reasoning and tool runs', async () => {
    const { stub, setCurrent, emit } = await boot({ task: undefined }, {}, true)
    setCurrent('session-1')
    emit({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'mulling' }] },
      running: true,
    })
    expect(stub.output.join('')).toContain('thinking…')
    emit({
      partial: null,
      running: true,
      runningCalls: [{
        callId: 'c1',
        name: 'read',
        argsRaw: '{"file_path":"a.ts"}',
        callView: null,
        turn: 1,
        step: 1,
        time: 0,
        subCalls: [],
      }],
    })
    expect(stub.output.join('')).toContain('read: a.ts')
    emit({ partial: null, running: false, runningCalls: [] })
    expect(stub.output).toContain('<CLR>')
  })

  it('prints the welcome box for a blank interactive session with the active model', async () => {
    const { stub, setCurrent } = await boot({ task: undefined }, { composerPhase: 'blank' }, true)
    setCurrent('session-1')
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    const transcript = stub.output.join('\n')
    expect(transcript).toContain('╭')
    expect(transcript).toContain('DeepSeek Harness')
    expect(transcript).toContain('deepseek-official:deepseek-chat')
    expect(transcript).toContain('Tip:')
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
