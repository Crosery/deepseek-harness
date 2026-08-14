import { describe, expect, it } from 'vitest'
import { AnsiMarkdown, renderMarkdown } from '../src/client/markdown.ts'

describe('AnsiMarkdown', () => {
  it('renders headings as plain text (non-TTY path)', () => {
    const renderer = new AnsiMarkdown()
    expect(renderer.renderLine('# Title')).toBe('Title')
    expect(renderer.renderLine('#### Deep')).toBe('Deep')
  })

  it('renders bullets and ordered lists with indentation', () => {
    const renderer = new AnsiMarkdown()
    expect(renderer.renderLine('- item')).toBe('  • item')
    expect(renderer.renderLine('1. first')).toBe('  1. first')
  })

  it('tracks fenced code blocks across lines', () => {
    const renderer = new AnsiMarkdown()
    expect(renderer.renderLine('```ts')).toBe('-- ts')
    expect(renderer.renderLine('const x = 1')).toBe('const x = 1')
    expect(renderer.renderLine('```')).toBe('--')
    expect(renderer.renderLine('after')).toBe('after')
  })

  it('renders blockquotes and rules', () => {
    const renderer = new AnsiMarkdown()
    expect(renderer.renderLine('> quote')).toBe('  │ quote')
    expect(renderer.renderLine('---')).toBe('--------')
  })

  it('strips emphasis markers in plain mode', () => {
    const renderer = new AnsiMarkdown()
    expect(renderer.renderLine('**bold** and `code`')).toBe('bold and code')
  })

  it('resets the block state', () => {
    const renderer = new AnsiMarkdown()
    renderer.renderLine('```js')
    renderer.reset()
    expect(renderer.renderLine('text')).toBe('text')
  })

  it('renders a whole document through renderMarkdown', () => {
    expect(renderMarkdown('# Hi\n\n- one\n- two')).toBe('Hi\n\n  • one\n  • two')
  })
})
