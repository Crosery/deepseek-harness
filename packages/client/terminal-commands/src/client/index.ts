/**
 * Terminal commands plugin: the client-side slash command surface. Host
 * commands (plan/goal/compact/permission/feedback/export) pass through the
 * conversation plugin to the host registry; the commands here need client
 * state or terminal UI: /help, /sessions, /new, /quit.
 * @module @deepseek-ai/dsh-client-terminal-commands/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client-node'
import type { SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client-node'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ansiEnabled, sgr, SGR, type HintItem } from '@deepseek-ai/dsh-client-terminal/client-node'

/** Stable Cordis plugin name. */
export const name = 'terminal-commands'

/** Required services. */
export const inject = ['terminal', 'sessions', 'connection', 'remote']

/** The messageFeedback remote namespace slice the rating commands use. */
interface MessageFeedbackRemote {
  messageFeedback: {
    put(input: { sessionId: SessionId; messageId: unknown; rating: 'good' | 'bad'; note?: string }): Promise<unknown>
  }
}

/** Client-side command directory, one entry per command. */
interface CommandHelp {
  /** One-line description shown by /help. */
  summary: string
}

/**
 * Commands plugin body: register the client command directory.
 * @param ctx - terminal client cordis context.
 */
export function apply(ctx: Context): void {
  const terminal = ctx.terminal
  const sessions = ctx.get('sessions') as unknown as SessionRuntime
  const connection = ctx.get('connection') as ConnectionHandle

  const help: Record<string, CommandHelp> = {
    help: { summary: 'list commands' },
    sessions: { summary: 'list sessions and switch to one (/sessions <id>)' },
    new: { summary: 'start a new session' },
    model: { summary: 'pick provider/model (/model, or /model <n> to apply the nth choice)' },
    skills: { summary: 'list the session skill catalog' },
    settings: { summary: 'list settings namespaces' },
    think: { summary: 'toggle thinking display (live tail ↔ full)' },
    memory: { summary: 'report process memory (RSS, heap, external)' },
    quit: { summary: 'exit the terminal session' },
  }

  const printHelp = (): void => {
    terminal.print('Commands:')
    for (const [name, entry] of Object.entries(help)) {
      terminal.print('  /' + name.padEnd(10) + entry.summary)
    }
    terminal.print(ansiEnabled ? sgr(SGR.dim, '  Host commands: /plan /goal /compact /permission /feedback /export /skill <name>') : '  Host commands: /plan /goal /compact /permission /feedback /export')
  }

  ctx.effect(() => terminal.registerCommand('help', printHelp), 'terminal-commands: /help')

  // Live command hints: typing '/' or '\' opens an omp-style menu under
  // the input — client commands, host commands, and the session's skills,
  // filtered by prefix as the user types.
  const HOST_COMMANDS: readonly HintItem[] = [
    { label: '/plan', description: 'enter plan mode' },
    { label: '/goal', description: 'create or resume a goal' },
    { label: '/compact', description: 'compact the context window' },
    { label: '/permission', description: 'choose the permission mode' },
    { label: '/feedback', description: 'rate the last answer' },
    { label: '/export', description: 'export the session log' },
    { label: '/skill', description: 'run a skill by name' },
  ]
  let skillItems: HintItem[] = []
  let skillsLoading = false
  ctx.effect(() => {
    terminal.setHintProvider((line) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('/') && !trimmed.startsWith('\\')) return null
      const query = trimmed.slice(1).toLowerCase()
      if (query === '' && skillItems.length === 0 && !skillsLoading) {
        const current = sessions.list.getSnapshot().current
        if (current !== undefined) {
          skillsLoading = true
          void Promise.resolve()
            .then(() => connection.api.skills.list({ sessionId: current }))
            .then((response) => {
              if (response.result.ok) {
                skillItems = response.result.value.skills.map(skill => ({
                  label: '/' + skill.name,
                  description: skill.description,
                }))
              }
            })
            .catch(() => {
              // The catalog is optional hint garnish: keep client and host
              // commands in the menu when it fails or never arrives.
            })
            .finally(() => { skillsLoading = false })
        }
      }
      const candidates: HintItem[] = [
        ...Object.entries(help).map(([name, entry]) => ({ label: '/' + name, description: entry.summary })),
        ...HOST_COMMANDS,
        ...skillItems,
      ]
      // First item wins on a duplicate label (client commands shadow hosts).
      const matches = [...new Map(candidates.map(item => [item.label, item])).values()]
        .filter(item => item.label.slice(1).startsWith(query))
      return matches.length === 0 ? null : matches.slice(0, 10)
    })
    return () => { terminal.setHintProvider(undefined) }
  }, 'terminal-commands: slash hints')

  ctx.effect(() => terminal.registerCommand('sessions', (args) => {
    const snapshot = sessions.list.getSnapshot()
    const rows = Object.values(snapshot.byId)
    if (args.trim() !== '') {
      const match = rows.find(row => row.id.startsWith(args.trim()))
      if (match === undefined) {
        terminal.print('no session matches ' + JSON.stringify(args.trim()))
        return
      }
      sessions.open(match.id)
      return
    }
    if (rows.length === 0) {
      terminal.print('no sessions yet')
      return
    }
    for (const row of rows) {
      const marker = row.id === snapshot.current ? '*' : ' '
      terminal.print(marker + ' ' + row.displayTitle + '  ' + row.id + (row.running ? '  (running)' : ''))
    }
    terminal.print(ansiEnabled ? sgr(SGR.dim, 'switch with /sessions <id-prefix>') : 'switch with /sessions <id-prefix>')
  }), 'terminal-commands: /sessions')

  ctx.effect(() => terminal.registerCommand('new', () => {
    void sessions.create().then((id) => {
      sessions.open(id)
    })
  }), 'terminal-commands: /new')

  const feedback = (rating: 'good' | 'bad') => (note: string): void => {
    const current = sessions.list.getSnapshot().current
    if (current === undefined) {
      terminal.print('no session open yet')
      return
    }
    const binding = sessions.binding(current)
    if (binding === undefined) return
    const nodes = binding.session.getSnapshot().nodes
    const last = [...nodes].reverse().find(node => node.kind === 'assistant' && node.messageId !== undefined)
    if (last === undefined || last.kind !== 'assistant') {
      terminal.print('no assistant message to rate yet')
      return
    }
    const remote = ctx.get('remote') as unknown as MessageFeedbackRemote
    void remote.messageFeedback.put({
      sessionId: current,
      messageId: last.messageId,
      rating,
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    }).then(() => {
      terminal.print('feedback recorded')
    }).catch((error: unknown) => {
      terminal.print(String(error))
    })
  }

  ctx.effect(() => terminal.registerCommand('like', feedback('good')), 'terminal-commands: /like')
  ctx.effect(() => terminal.registerCommand('dislike', feedback('bad')), 'terminal-commands: /dislike')

  ctx.effect(() => terminal.registerCommand('skills', async () => {
    const current = sessions.list.getSnapshot().current
    if (current === undefined) {
      terminal.print('no session open yet')
      return
    }
    const response = await connection.api.skills.list({ sessionId: current })
    if (!response.result.ok) {
      terminal.print('skill catalog failed: ' + response.result.error.message)
      return
    }
    const skills = response.result.value.skills
    if (skills.length === 0) {
      terminal.print('no skills in the catalog')
      return
    }
    for (const skill of skills) {
      const marker = skill.modelInvocable ? ' ' : '*'
      terminal.print(marker + ' /' + skill.name + '  ' + skill.description)
    }
    terminal.print(ansiEnabled ? sgr(SGR.dim, '* user-invoked only; reference a skill with /name in a prompt') : '* user-invoked only')
  }), 'terminal-commands: /skills')

  ctx.effect(() => terminal.registerCommand('settings', async () => {
    const response = await connection.api.settings.describe({})
    if (!response.result.ok) {
      terminal.print('settings failed: ' + response.result.error.message)
      return
    }
    const described = response.result.value
    for (const namespace of described.namespaces) {
      terminal.print(namespace.ns + (described.writable ? '' : ' (read-only)'))
    }
    terminal.print(ansiEnabled ? sgr(SGR.dim, 'edit the document with /feedback-free host tooling or $DSH_HOME/settings.yaml') : 'edit $DSH_HOME/settings.yaml')
  }), 'terminal-commands: /settings')

  ctx.effect(() => terminal.registerCommand('memory', () => {
    const usage = process.memoryUsage()
    const toMb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1) + ' MB'
    terminal.print('rss ' + toMb(usage.rss) + '  heap ' + toMb(usage.heapUsed) + '/' + toMb(usage.heapTotal) + '  external ' + toMb(usage.external) + '  arrayBuffers ' + toMb(usage.arrayBuffers))
  }), 'terminal-commands: /memory')

  ctx.effect(() => terminal.registerCommand('quit', () => {
    terminal.close()
  }), 'terminal-commands: /quit')
}
