import { describe, expect, it } from 'vitest'
import { TerminalWriter } from '../src/client/output.ts'

function capture(isTTY = false): { writer: TerminalWriter; text: () => string } {
  let out = ''
  const stream = {
    write: (chunk: string) => { out += chunk; return true },
    isTTY,
  } as unknown as NodeJS.WriteStream
  return { writer: new TerminalWriter(stream), text: () => out }
}

describe('TerminalWriter', () => {
  it('prints lines with a newline', () => {
    const { writer, text } = capture()
    writer.print('a')
    writer.print()
    expect(text()).toBe('a\n\n')
  })

  it('writes raw text verbatim', () => {
    const { writer, text } = capture()
    writer.write('x\ny')
    expect(text()).toBe('x\ny')
  })

  it('clears the input line before every write on a TTY', () => {
    const { writer, text } = capture(true)
    writer.print('a')
    expect(text()).toBe('\r\u001b[Ka\n')
  })

  it('degrades status to a plain line without a TTY', () => {
    const { writer, text } = capture(false)
    writer.status('busy')
    expect(text()).toBe('busy\n')
  })

  it('wraps status in dim SGR on a TTY', () => {
    const { writer, text } = capture(true)
    writer.status('busy')
    expect(text()).toBe('\r\u001b[K\u001b[2mbusy\u001b[0m\n')
  })

  it('reports TTY-ness', () => {
    expect(capture(true).writer.isTTY).toBe(true)
    expect(capture(false).writer.isTTY).toBe(false)
  })
})
