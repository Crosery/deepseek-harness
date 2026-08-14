/**
 * Terminal attachment plugin: expands `@path/to/image.png` references in
 * input lines into image prompt parts (the terminal equivalent of the web
 * composer's image attach). Non-image paths pass through as plain text.
 * @module @deepseek-ai/dsh-client-terminal-attachment/client
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client-node'
import type { PromptContentPart } from '@deepseek-ai/dsh-client-connection/client-node'
import { subscribeCurrentSession } from '@deepseek-ai/dsh-client-terminal/client-node'

/** Stable Cordis plugin name. */
export const name = 'terminal-attachment'

/** Required services. */
export const inject = ['terminal', 'sessions']

/** Image media types the wire accepts, keyed by file extension. */
const MEDIA_TYPES: Readonly<Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Attachment plugin body: register the pre-line expansion hook.
 * @param ctx - terminal client cordis context.
 */
export function apply(ctx: Context): void {
  const terminal = ctx.terminal
  const sessions = ctx.get('sessions') as unknown as SessionRuntime
  let currentId: SessionId | undefined

  const disposeBinding = subscribeCurrentSession(sessions, () => {
    currentId = sessions.list.getSnapshot().current
  })
  ctx.effect(() => disposeBinding, 'terminal-attachment: binding')

  ctx.effect(() => terminal.registerPreLineHook(async (line) => {
    const matches = [...line.matchAll(/@([^\s@]+)/g)]
    const imagePaths = matches
      .map(match => match[1] ?? '')
      .filter(path => MEDIA_TYPES[extname(path).toLowerCase()] !== undefined)
    if (imagePaths.length === 0 || currentId === undefined) return false
    const binding = sessions.binding(currentId)
    if (binding === undefined) return false
    const parts: PromptContentPart[] = imagePaths.map((path) => {
      let data: string
      try {
        data = readFileSync(path).toString('base64')
      } catch (error) {
        terminal.print('cannot read ' + JSON.stringify(path) + ': ' + String(error))
        return { type: 'text', text: '' }
      }
      const mediaType = MEDIA_TYPES[extname(path).toLowerCase()] ?? 'image/png'
      return { type: 'image', mediaType, data, name: path }
    })
    const text = line.replace(/@([^\s@]+)/g, '').trim()
    if (text !== '') parts.push({ type: 'text', text })
    await binding.session.prompt(parts, 'queue')
    return true
  }), 'terminal-attachment: pre-line expansion')
}
