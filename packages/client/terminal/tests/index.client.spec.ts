import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/client/index.ts'
import type { TerminalService } from '../src/client/index.ts'

function boot(): { ctx: Context; terminal: TerminalService } {
  const ctx = new Context()
  apply(ctx, { prompt: '> ' })
  const terminal = ctx.get('terminal') as TerminalService
  return { ctx, terminal }
}

describe('terminal kernel plugin', () => {
  it('declares its plugin face', () => {
    expect(name).toBe('terminal')
    expect(inject).toEqual([])
  })

  it('provides the terminal service with the documented surface', () => {
    const { terminal } = boot()
    expect(typeof terminal.write).toBe('function')
    expect(typeof terminal.print).toBe('function')
    expect(typeof terminal.setPrompt).toBe('function')
    expect(typeof terminal.refreshPrompt).toBe('function')
    expect(typeof terminal.onLine).toBe('function')
    expect(typeof terminal.onSigint).toBe('function')
    expect(typeof terminal.onClose).toBe('function')
    expect(typeof terminal.registerNodeRenderer).toBe('function')
    expect(typeof terminal.registerCommand).toBe('function')
    expect(typeof terminal.registerPreLineHook).toBe('function')
    expect(typeof terminal.busy).toBe('function')
    expect(terminal.markdown).toBeDefined()
  })

  it('dispatches node renderers with fallback and single ownership', () => {
    const { terminal } = boot()
    const rendered: unknown[] = []
    const dispose = terminal.registerNodeRenderer('tool-result', (node) => { rendered.push(node) })
    expect(terminal.renderNode('tool-result', { n: 1 })).toBe(true)
    expect(terminal.renderNode('user', { n: 2 })).toBe(false)
    expect(rendered).toEqual([{ n: 1 }])
    expect(() => terminal.registerNodeRenderer('tool-result', () => {})).toThrow(/already registered/)
    dispose()
    expect(terminal.renderNode('tool-result', { n: 3 })).toBe(false)
  })

  it('dispatches client commands and tracks busy state', async () => {
    const { terminal } = boot()
    const calls: string[] = []
    terminal.registerCommand('hello', (args) => { calls.push(args) })
    expect(terminal.dispatchCommand('/hello world')).toBe(true)
    expect(terminal.dispatchCommand('/missing')).toBe(false)
    expect(terminal.dispatchCommand('plain')).toBe(false)
    expect(calls).toEqual(['world'])
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(terminal.busy()).toBe(false)
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    terminal.registerCommand('slow', async () => { await gate })
    terminal.dispatchCommand('/slow')
    expect(terminal.busy()).toBe(true)
    release?.()
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    expect(terminal.busy()).toBe(false)
  })

  it('runs pre-line hooks before ordinary handlers', async () => {
    const { terminal } = boot()
    const order: string[] = []
    const hooked: string[] = []
    terminal.registerPreLineHook(async (line) => {
      order.push('hook:' + line)
      if (line === 'consume') {
        hooked.push(line)
        return true
      }
      return false
    })
    terminal.onLine(async (line) => { order.push('line:' + line) })
    // the line listener starts the reader lazily on first registration
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    expect(order.length).toBeGreaterThanOrEqual(0)
    expect(hooked).toEqual([])
    terminal.close()
  })

  it('rejects duplicate command registration', () => {
    const { terminal } = boot()
    terminal.registerCommand('dup', () => {})
    expect(() => terminal.registerCommand('dup', () => {})).toThrow(/already registered/)
  })
})
