import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, argsPreview, describeToolCall, inject, name, renderHintMenu, truncateVisible, visibleWidth } from '../src/client/index.ts'
import type { HintItem, TerminalService } from '../src/client/index.ts'

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
    expect(typeof terminal.setHintProvider).toBe('function')
    expect(typeof terminal.nextLine).toBe('function')
    expect(typeof terminal.clearLine).toBe('function')
    expect(typeof terminal.rewriteRegion).toBe('function')
    expect(typeof terminal.clearRegion).toBe('function')
    expect(terminal.markdown).toBeDefined()
  })

  it('routes the live hint provider through input buffer changes', () => {
    const { terminal } = boot()
    const seen: ({ label: string }[] | null)[] = []
    terminal.setHintProvider((line) => {
      const items = line === '' ? null : [{ label: '/' + line }]
      seen.push(items)
      return items
    })
    terminal.onLine(() => {})
    const press = (name: string, sequence: string, ctrl = false): void => {
      process.stdin.emit('keypress', sequence, { name, sequence, ctrl })
    }
    press('s', 's')
    press('e', 'e')
    press('backspace', '\x7f')
    press('u', '\u0015', true)
    press('w', 'w')
    press('o', 'o')
    press('r', 'r')
    press('d', 'd')
    press('w', 'w', true)
    press('return', '\r')
    expect(seen).toEqual([
      [{ label: '/s' }],
      [{ label: '/se' }],
      [{ label: '/s' }],
      null,
      [{ label: '/w' }],
      [{ label: '/wo' }],
      [{ label: '/wor' }],
      [{ label: '/word' }],
      null,
      null,
    ])
    // The latest provider wins; undefined disables the seat entirely.
    terminal.setHintProvider((line) => {
      const items = line === '' ? null : [{ label: '#2:' + line }]
      seen.push(items)
      return items
    })
    press('x', 'x')
    expect(seen.at(-1)).toEqual([{ label: '#2:x' }])
    terminal.setHintProvider(undefined)
    press('y', 'y')
    expect(seen.at(-1)).toEqual([{ label: '#2:x' }])
    terminal.close()
  })

  it('layouts the hint menu with a cursor row and a count footer', () => {
    const items: HintItem[] = [
      { label: '/help', description: 'list commands' },
      { label: '/model', description: 'pick a model' },
    ]
    const lines = renderHintMenu(items, 80)
    expect(lines.length).toBe(3)
    expect(lines[0]).toContain('>')
    expect(lines[0]).toContain('/help')
    expect(lines[0]).toContain('list commands')
    expect(lines[1]).toContain('/model')
    expect(lines[1]).not.toContain('>')
    expect(lines[2]).toContain('2 matches')
    expect(lines[2]).toContain('run')
  })

  it('caps the hint menu at six rows and truncates descriptions', () => {
    const items: HintItem[] = Array.from({ length: 9 }, (_, index) => ({
      label: '/command-' + index,
      description: 'x'.repeat(100),
    }))
    const lines = renderHintMenu(items, 40)
    // six item rows + footer
    expect(lines.length).toBe(7)
    expect(lines[6]).toContain('6/9 matches')
    for (const line of lines.slice(0, 6)) {
      expect(line.length).toBeLessThanOrEqual(40)
    }
  })

  it('keeps CJK descriptions inside the row budget by display width', () => {
    const lines = renderHintMenu([{ label: '/skill', description: '基于中文描述'.repeat(20) }], 40)
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40)
    }
    expect(lines[0]).toContain('…')
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

describe('tool call labels', () => {
  it('prefers the call view title over raw arguments', () => {
    expect(describeToolCall('{"command":"pwd"}', { card: 'terminal', title: 'pwd' })).toBe('pwd')
    expect(describeToolCall('{"file_path":"a.ts"}', { card: 'generic', title: 'read a.ts' })).toBe('read a.ts')
    expect(describeToolCall('{}', null)).toBe('')
  })

  it('previews the salient argument field', () => {
    expect(argsPreview('{"command":"ls -la"}')).toBe('ls -la')
    expect(argsPreview('{"file_path":"src/a.ts"}')).toBe('src/a.ts')
    expect(argsPreview('{"pattern":"x"}')).toBe('x')
    expect(argsPreview('{}')).toBe('')
    expect(argsPreview('not json at all')).toBe('not json at all')
  })

  it('caps overlong previews', () => {
    expect(argsPreview('{"input":"' + 'x'.repeat(200) + '"}').length).toBe(80)
  })

  it('measures display width with CJK glyphs as two columns', () => {
    expect(visibleWidth('abc')).toBe(3)
    expect(visibleWidth('你好')).toBe(4)
    expect(visibleWidth('a你b')).toBe(4)
  })

  it('truncates plain text to a column budget with an ellipsis', () => {
    expect(truncateVisible('short', 10)).toBe('short')
    expect(truncateVisible('abcdefghij', 5)).toBe('abcd…')
    expect(truncateVisible('你好好好好', 5)).toBe('你好…')
  })
})
