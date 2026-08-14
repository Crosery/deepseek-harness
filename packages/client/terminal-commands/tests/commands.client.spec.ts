import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** Stub terminal that captures prints and exposes registered commands. */
function stubTerminal() {
  const prints: string[] = []
  const commands = new Map<string, (args: string) => void | Promise<void>>()
  return {
    prints,
    commands,
    terminal: {
      print: (text = '') => { prints.push(text) },
      status: (text: string) => { prints.push(text) },
      setPrompt: () => {},
      markdown: { renderLine: (line: string) => line, reset: () => {} },
      registerCommand: (name: string, handler: (args: string) => void | Promise<void>) => {
        commands.set(name, handler)
        return () => { commands.delete(name) }
      },
      dispatchCommand: () => false,
      busy: () => false,
      registerNodeRenderer: () => () => {},
      renderNode: () => false,
      registerPreLineHook: () => () => {},
      onLine: () => () => {},
      onSigint: () => () => {},
      onClose: () => () => {},
      close: () => {},
      write: () => {},
      refreshPrompt: () => {},
      isTTY: false,
      width: 80,
    } as never,
  }
}

function sessionsDouble() {
  let current: string | undefined
  let listener: (() => void) | undefined
  const rows = [
    { id: 'session-a', displayTitle: 'first', running: false },
    { id: 'session-b', displayTitle: 'second', running: true },
  ]
  return {
    setCurrent(next: string | undefined) {
      current = next
      listener?.()
    },
    emit: () => { listener?.() },
    sessions: {
      list: {
        subscribe: (cb: () => void) => { listener = cb; return () => { listener = undefined } },
        getSnapshot: () => ({ current, byId: Object.fromEntries(rows.map(row => [row.id, row])), ids: rows.map(row => row.id) }),
      },
      binding: () => undefined,
      create: async () => 'session-c' as never,
      open: (id: string) => { current = id; listener?.() },
    } as never,
  }
}

function boot() {
  const ctx = new Context()
  const stub = stubTerminal()
  const sessions = sessionsDouble()
  ctx.provide('terminal', stub.terminal)
  ctx.provide('sessions', sessions.sessions)
  ctx.provide('connection', { api: {} })
  ctx.provide('remote', { messageFeedback: { put: async () => ({}) } })
  apply(ctx)
  return { stub, sessions, ctx }
}

describe('terminal-commands plugin', () => {
  it('prints the help directory', async () => {
    const { stub } = boot()
    await stub.commands.get('help')?.('')
    expect(stub.prints.some(line => line.includes('/help'))).toBe(true)
    expect(stub.prints.some(line => line.includes('/model'))).toBe(true)
  })

  it('lists sessions and switches by id prefix', async () => {
    const { stub, sessions } = boot()
    sessions.setCurrent('session-a')
    await stub.commands.get('sessions')?.('')
    expect(stub.prints.some(line => line.includes('first'))).toBe(true)
    expect(stub.prints.some(line => line.includes('second'))).toBe(true)
    await stub.commands.get('sessions')?.('session-b')
    expect((sessions.sessions as unknown as { list: { getSnapshot(): { current: string | undefined } } }).list.getSnapshot().current).toBe('session-b')
  })

  it('reports process memory', async () => {
    const { stub } = boot()
    await stub.commands.get('memory')?.('')
    expect(stub.prints.some(line => /rss [\d.]+ MB/.test(line))).toBe(true)
  })
})
