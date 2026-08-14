import { describe, expect, it } from 'vitest'
import { durationOf, viewBody } from '../src/client/index.ts'

function node(overrides: Record<string, unknown>): never {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 1000,
    callId: 'c1',
    call: { name: 'bash', argsRaw: '{}' },
    callTime: 500,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    ...overrides,
  } as never
}

describe('tool result rendering', () => {
  it('formats duration between call and result', () => {
    expect(durationOf(node({}))).toBe(' (0.5s)')
    expect(durationOf(node({ callTime: null }))).toBe('')
  })

  it('falls back to raw content without a result view', () => {
    expect(viewBody(node({ content: [{ type: 'text', text: 'raw out' }] }))).toBe('raw out')
  })

  it('renders a terminal view with exit code', () => {
    const view = { card: 'terminal', title: 'ls', output: 'a\nb', exitCode: 0 }
    expect(viewBody(node({ resultView: view }))).toBe('ls\na\nb')
    const failed = { card: 'terminal', title: 'ls', output: 'a', exitCode: 1 }
    expect(viewBody(node({ resultView: failed }))).toBe('ls\na exit 1')
  })

  it('renders a diff view as changed files', () => {
    const view = { card: 'diff', title: 'edit', diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }, { path: 'b.ts', oldText: null, newText: 'z' }] }
    expect(viewBody(node({ resultView: view }))).toBe('edit\na.ts\nb.ts (new)')
  })

  it('renders a path search view', () => {
    const view = { card: 'search', shape: 'paths', title: 'find', paths: ['p1', 'p2'] }
    expect(viewBody(node({ resultView: view }))).toBe('find\np1\np2')
  })

  it('renders a read view through its content blocks', () => {
    const view = { card: 'read', title: 'read', content: [{ type: 'text', text: 'file body' }] }
    expect(viewBody(node({ resultView: view }))).toBe('read\nfile body')
  })

  it('renders a web fetch view with url and status', () => {
    const view = { card: 'web', kind: 'fetch', title: 'get', url: 'https://example.com', statusCode: 200 }
    expect(viewBody(node({ resultView: view }))).toBe('get\nhttps://example.com (200)')
  })
})
