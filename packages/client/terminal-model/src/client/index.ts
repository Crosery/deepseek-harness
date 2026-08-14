/**
 * Terminal model plugin: the /model picker. Lists the llm catalog as a flat
 * numbered menu (provider: model per line) and applies the chosen entry to
 * the current session through the wire selectModel RPC.
 * @module @deepseek-ai/dsh-client-terminal-model/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client-node'
import type { SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client-node'
import { ansiEnabled, sgr, SGR } from '@deepseek-ai/dsh-client-terminal/client-node'

/** Stable Cordis plugin name. */
export const name = 'terminal-model'

/** Required services. */
export const inject = ['terminal', 'sessions', 'connection']

/** One flat catalog entry the numbered menu resolves back to. */
interface CatalogEntry {
  provider: string
  model: string
  name: string
}

/**
 * Model plugin body: register /model.
 * @param ctx - terminal client cordis context.
 */
export function apply(ctx: Context): void {
  const terminal = ctx.terminal
  const sessions = ctx.get('sessions') as SessionRuntime
  const connection = ctx.get('connection') as ConnectionHandle
  let entries: CatalogEntry[] = []

  ctx.effect(() => terminal.registerCommand('model', async (args) => {
    const current = sessions.list.getSnapshot().current
    if (current === undefined) {
      terminal.print('no session open yet')
      return
    }
    const trimmed = args.trim()
    if (trimmed === '') {
      const response = await connection.api.sessions.models({ sessionId: current })
      if (!response.result.ok) {
        terminal.print('model catalog failed: ' + response.result.error.message)
        return
      }
      const models = response.result.value
      entries = models.groups.flatMap(group =>
        group.models.map(entry => ({ provider: group.id, model: entry.id, name: entry.name })),
      )
      if (entries.length === 0) {
        terminal.print('no models in the catalog')
        return
      }
      entries.forEach((entry, index) => {
        const marker = models.current.provider === entry.provider && models.current.model === entry.model ? '*' : ' '
        const reason = entry.name === entry.model ? '' : '  (' + entry.name + ')'
        terminal.print(marker + ' ' + String(index + 1).padStart(3) + '. ' + entry.provider + ': ' + entry.model + reason)
      })
      terminal.print(ansiEnabled ? sgr(SGR.dim, 'apply with /model <n>') : 'apply with /model <n>')
      return
    }
    const index = Number(trimmed)
    const entry = entries[index - 1]
    if (!Number.isInteger(index) || entry === undefined) {
      terminal.print('pick a number from /model')
      return
    }
    const response = await connection.api.sessions.selectModel({
      sessionId: current,
      provider: entry.provider,
      model: entry.model,
    })
    if (!response.result.ok) {
      terminal.print('model selection failed: ' + response.result.error.message)
      return
    }
    terminal.print('model: ' + entry.provider + ': ' + entry.model)
  }), 'terminal-model: /model')
}
