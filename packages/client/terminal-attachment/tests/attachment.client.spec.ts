import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'dsh-attachment-'))
const imagePath = join(dir, 'pic.png')
writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function boot() {
  const ctx = new Context()
  const hooks: ((line: string) => Promise<void> | boolean)[] = []
  const prompts: unknown[] = []
  ctx.provide('terminal', {
    print: () => {},
    registerPreLineHook: (hook: (line: string) => Promise<void> | boolean) => {
      hooks.push(hook)
      return () => {}
    },
  } as never)
  let current: string | undefined
  let listener: (() => void) | undefined
  ctx.provide('sessions', {
    list: {
      subscribe: (cb: () => void) => { listener = cb; return () => { listener = undefined } },
      getSnapshot: () => ({ current }),
    },
    binding: () => ({ session: { prompt: async (parts: unknown) => { prompts.push(parts) } } }),
  } as never)
  apply(ctx)
  const setCurrent = (id: string | undefined) => {
    current = id
    listener?.()
  }
  return { hooks, prompts, setCurrent }
}

describe('terminal-attachment plugin', () => {
  it('expands an @image path into an image prompt part', async () => {
    const { hooks, prompts, setCurrent } = boot()
    setCurrent('session-1')
    const hook = hooks[0]!
    expect(hook).toBeDefined()
    const handled = await hook('look at this @' + imagePath)
    expect(handled).toBe(true)
    expect(prompts.length).toBe(1)
    const parts = prompts[0] as Array<{ type: string; mediaType?: string; text?: string }>
    expect(parts[0]).toMatchObject({ type: 'image', mediaType: 'image/png' })
    expect(parts[1]).toEqual({ type: 'text', text: 'look at this' })
  })

  it('passes plain lines through untouched', async () => {
    const { hooks, prompts, setCurrent } = boot()
    setCurrent('session-1')
    const handled = await hooks[0]!('no attachment here')
    expect(handled).toBe(false)
    expect(prompts.length).toBe(0)
  })

  it('ignores @refs that are not images', async () => {
    const { hooks, prompts, setCurrent } = boot()
    setCurrent('session-1')
    const handled = await hooks[0]!('see @README.md')
    expect(handled).toBe(false)
    expect(prompts.length).toBe(0)
  })
})
