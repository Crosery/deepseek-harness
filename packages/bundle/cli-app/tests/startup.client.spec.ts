import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/startup.ts'

function boot(argv: string[]): Context {
  const ctx = new Context()
  ctx.provide('cmdlineArgs', {
    get: () => argv,
  } as never)
  ctx.provide('appExit', () => {})
  apply(ctx)
  return ctx
}

describe('cli-app startup', () => {
  it('declares its plugin face', () => {
    expect(name).toBe('cli-startup')
    expect(inject).toEqual(['cmdlineArgs'])
  })

  it('parses a bare interactive invocation', () => {
    const ctx = boot([])
    expect(ctx.get('cliStartup')).toEqual({})
  })

  it('parses a one-shot task positional', () => {
    const ctx = boot(['run the tests'])
    expect(ctx.get('cliStartup')).toEqual({ task: 'run the tests' })
  })

  it('parses the flag family', () => {
    const ctx = boot(['--cwd', '/tmp/x', '--session', 'session-1', '--model', 'p/m', '--permission', 'read-only', 'hi'])
    expect(ctx.get('cliStartup')).toEqual({
      cwd: '/tmp/x',
      sessionId: 'session-1',
      model: 'p/m',
      permission: 'read-only',
      task: 'hi',
    })
  })
})
