import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

function stubTerminal() {
  const prints: string[] = []
  const commands = new Map<string, (args: string) => void | Promise<void>>()
  return {
    prints,
    commands,
    terminal: {
      print: (text = '') => { prints.push(text) },
      setPrompt: () => {},
      registerCommand: (name: string, handler: (args: string) => void | Promise<void>) => {
        commands.set(name, handler)
        return () => { commands.delete(name) }
      },
      busy: () => false,
    } as never,
  }
}

function boot(modelsValue: unknown) {
  const ctx = new Context()
  const stub = stubTerminal()
  ctx.provide('terminal', stub.terminal)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: 'session-1' }) },
  } as never)
  ctx.provide('connection', {
    api: {
      sessions: {
        models: async () => ({ result: { ok: true, value: modelsValue } }),
        selectModel: async (input: { provider: string; model: string }) => ({ result: { ok: true, value: { selected: input } } }),
      },
    },
  } as never)
  apply(ctx)
  return { stub }
}

describe('terminal-model plugin', () => {
  it('lists provider/model entries with the current selection marked', async () => {
    const { stub } = boot({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [
        { id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }] },
        { id: 'p2', name: 'P2', models: [{ id: 'm3', name: 'm3' }] },
      ],
    })
    await stub.commands.get('model')?.('')
    const text = stub.prints.join('\n')
    expect(text).toContain('*   1. p1: m1  (M1)')
    expect(text).toContain('2. p1: m2  (M2)')
    expect(text).toContain('3. p2: m3')
  })

  it('applies a numbered choice', async () => {
    const { stub } = boot({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [{ id: 'p1', name: 'P1', models: [{ id: 'm2', name: 'M2' }] }],
    })
    await stub.commands.get('model')?.('')
    await stub.commands.get('model')?.('1')
    expect(stub.prints.at(-1)).toBe('model: p1: m2')
  })

  it('rejects non-numeric or out-of-range choices', async () => {
    const { stub } = boot({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [{ id: 'p1', name: 'P1', models: [{ id: 'm2', name: 'M2' }] }],
    })
    await stub.commands.get('model')?.('nope')
    expect(stub.prints.at(-1)).toBe('pick a number from /model')
  })
})
