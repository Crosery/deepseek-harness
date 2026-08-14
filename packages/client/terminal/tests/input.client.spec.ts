import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { InputReader } from '../src/client/input.ts'
import { TerminalWriter } from '../src/client/output.ts'

function writer(): TerminalWriter {
  return new TerminalWriter({ write: () => true, isTTY: false } as unknown as NodeJS.WriteStream)
}

describe('InputReader', () => {
  it('delivers complete lines in order and serializes handlers', async () => {
    const stdin = new PassThrough()
    const reader = new InputReader(stdin as unknown as NodeJS.ReadStream, writer(), false)
    const received: string[] = []
    let resolveSlow: (() => void) | undefined
    const slow = new Promise<void>((resolve) => { resolveSlow = resolve })
    reader.start(async (line) => {
      if (line === 'slow') await slow
      received.push(line)
    })
    stdin.write('first\n')
    stdin.write('slow\n')
    stdin.write('third\n')
    // give the readline pump a tick
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    expect(received).toEqual(['first'])
    resolveSlow?.()
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    expect(received).toEqual(['first', 'slow', 'third'])
    reader.close()
  })

  it('fires onClose listeners when closed', async () => {
    const stdin = new PassThrough()
    const reader = new InputReader(stdin as unknown as NodeJS.ReadStream, writer(), false)
    const closed: number[] = []
    reader.onClose(() => {
      closed.push(1)
    })
    reader.start(() => {})
    reader.close()
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    expect(closed).toEqual([1])
  })

  it('rejects a second start', () => {
    const stdin = new PassThrough()
    const reader = new InputReader(stdin as unknown as NodeJS.ReadStream, writer(), false)
    reader.start(() => {
      // no-op handler
    })
    expect(() => {
      reader.start(() => {})
    }).toThrow(/already started/)
    reader.close()
  })
})
