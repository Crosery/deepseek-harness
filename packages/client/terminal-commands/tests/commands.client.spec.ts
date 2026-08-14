import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** Stub terminal that captures prints and exposes registered commands. */
function stubTerminal() {
  const prints: string[] = []
  const commands = new Map<string, (args: string) => void | Promise<void>>()
  let hintProvider: ((line: string) => readonly { label: string; description?: string }[] | null) | undefined
  return {
    prints,
    commands,
    get hint() { return hintProvider },
    terminal: {
      print: (text = '') => { prints.push(text) },
      status: (text: string) => { prints.push(text) },
      setPrompt: () => {},
      markdown: { renderLine: (line: string) => line, reset: () => {} },
      registerCommand: (name: string, handler: (args: string) => void | Promise<void>) => {
        commands.set(name, handler)
        return () => { commands.delete(name) }
      },
      setHintProvider: (provider: typeof hintProvider) => { hintProvider = provider },
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
      stream: () => {},
      nextLine: () => {},
      clearLine: () => {},
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
  const skills = {
    list: async () => ({
      result: { ok: true, value: { skills: [{ name: 'math-helper', description: 'solves math', modelInvocable: true }] } },
    }),
  }
  ctx.provide('terminal', stub.terminal)
  ctx.provide('sessions', sessions.sessions)
  ctx.provide('connection', { api: { skills } })
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

  it('hints the command menu for slash and backslash lines', () => {
    const { stub } = boot()
    expect(stub.hint).toBeDefined()
    expect(stub.hint?.('plain text')).toBeNull()
    const all = stub.hint?.('/') ?? []
    const labels = all.map(item => item.label)
    expect(labels).toContain('/help')
    expect(labels).toContain('/model')
    expect(labels).toContain('/plan')
    expect(all.length).toBeLessThanOrEqual(10)
    expect(all.find(item => item.label === '/help')?.description).toContain('list commands')
    const skillPick = stub.hint?.('/sk') ?? []
    expect(skillPick.map(item => item.label)).toEqual(['/skills', '/skill'])
    const filtered = stub.hint?.('/se') ?? []
    expect(filtered.map(item => item.label)).toEqual(['/sessions', '/settings'])
    expect(stub.hint?.('\\se')).toEqual(filtered)
    expect(stub.hint?.('/zzz')).toBeNull()
  })

  it('adds session skills to the hint menu once the catalog resolves', async () => {
    const { stub, sessions } = boot()
    sessions.setCurrent('session-a')
    stub.hint?.('/')
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    const math = stub.hint?.('/m') ?? []
    const labels = math.map(item => item.label)
    expect(labels).toContain('/math-helper')
    expect(labels).toContain('/memory')
    expect(labels).toContain('/model')
    expect(math.find(item => item.label === '/math-helper')?.description).toContain('solves math')
  })
})
