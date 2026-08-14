import { describe, expect, it } from 'vitest'
import { SGR, sgr } from '../src/client/ansi.ts'

describe('ansi', () => {
  it('wraps text with one SGR attribute and a reset', () => {
    expect(sgr(SGR.red, 'x')).toBe('\u001b[31mx\u001b[0m')
  })

  it('keeps attribute codes intact', () => {
    expect(SGR.bold).toBe(1)
    expect(SGR.dim).toBe(2)
    expect(SGR.gray).toBe(90)
  })
})
