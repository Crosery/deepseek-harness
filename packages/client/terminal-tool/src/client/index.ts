/**
 * Terminal tool plugin: renders tool-result rows through the kernel's node
 * renderer registry (the terminal slot mechanism). Settled tool calls print
 * a status row with duration and exit outcome, then a dimmed preview of the
 * render-intent content (terminal output, diff hunks, search matches, read
 * content, web output, or the raw result).
 * @module @deepseek-ai/dsh-client-terminal-tool/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client-node'
import type { TerminalService } from '@deepseek-ai/dsh-client-terminal/client-node'
import { ansiEnabled, sgr, SGR } from '@deepseek-ai/dsh-client-terminal/client-node'

/** Stable Cordis plugin name. */
export const name = 'terminal-tool'

/** Required services. */
export const inject = ['terminal']

/** Cap for inline result preview characters (the session log keeps the full text). */
const PREVIEW_CHARS = 2000

/** Duration between paired call and result, formatted as seconds. */
export function durationOf(node: ToolResultNode): string {
  if (node.callTime === null) return ''
  const seconds = (node.time - node.callTime) / 1000
  return seconds >= 0 ? ' (' + seconds.toFixed(1) + 's)' : ''
}

/** Text content of a content-block list (text blocks only). */
function textOf(blocks: readonly { type?: string; text?: unknown }[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => typeof block.text === 'string' ? block.text : '')
    .join('')
}

/** Preview one text body (dimmed, capped). */
function preview(terminal: TerminalService, text: string): void {
  if (text.trim() === '') return
  const capped = text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) + ' …' : text
  for (const line of capped.split('\n')) {
    terminal.print(ansiEnabled ? sgr(SGR.dim, '  ' + line) : '  ' + line)
  }
}

/** The rendered body for one render-intent view, falling back to raw content. */
export function viewBody(node: ToolResultNode): string {
  const view = node.resultView
  if (view !== null) {
    switch (view.card) {
      case 'terminal': {
        const exit = view.exitCode === undefined ? '' : view.exitCode === 0 ? '' : ' exit ' + String(view.exitCode)
        return (view.title ?? '') + (view.output === undefined ? '' : '\n' + view.output) + exit
      }
      case 'diff': {
        const files = view.diffs.map(diff => diff.path + (diff.oldText === null ? ' (new)' : '')).join('\n')
        return (view.title ?? '') + (files === '' ? '' : '\n' + files)
      }
      case 'search': {
        const lines = view.shape === 'paths'
          ? view.paths
          : view.files.flatMap(file => [file.path, ...file.matches.map(match => '  ' + String(match.lineNumber) + ': ' + match.line)])
        return (view.title ?? '') + (lines.length === 0 ? '' : '\n' + lines.join('\n'))
      }
      case 'read': {
        return (view.title ?? '') + (view.content === undefined ? '' : '\n' + textOf(view.content))
      }
      case 'web': {
        if (view.kind === 'fetch') {
          return (view.title ?? '') + '\n' + view.url + ' (' + String(view.statusCode) + ')'
        }
        const sources = view.sources.slice(0, 5).map(source => source.url).join('\n')
        return (view.title ?? '') + (view.answer === undefined ? '' : '\n' + view.answer) + (sources === '' ? '' : '\n' + sources) + (view.truncated ? '\n(truncated)' : '')
      }
      case 'generic': {
        return (view.title ?? '') + (view.content === undefined ? '' : '\n' + textOf(view.content))
      }
    }
  }
  return textOf(node.content)
}

/** Render one settled tool-result node. */
function renderToolResult(terminal: TerminalService, raw: unknown): void {
  const node = raw as ToolResultNode
  const name = node.call?.name ?? 'tool'
  const status = node.isError ? ' ✗' : ' ✓'
  const head = '⚙ ' + name + status + durationOf(node)
  terminal.print(ansiEnabled
    ? sgr(SGR.gray, '⚙ ' + name) + (node.isError ? ' ' + sgr(SGR.brightRed, '✗') : ' ' + sgr(SGR.green, '✓')) + sgr(SGR.gray, durationOf(node))
    : head)
  preview(terminal, viewBody(node))
}

/**
 * Tool plugin body: register the tool-row renderers with the kernel.
 * @param ctx - terminal client cordis context.
 */
export function apply(ctx: Context): void {
  const terminal = ctx.terminal
  ctx.effect(
    () => terminal.registerNodeRenderer('tool-result', (node) => { renderToolResult(terminal, node) }),
    'terminal-tool: result renderer',
  )
  ctx.effect(
    () => terminal.registerNodeRenderer('command', (node) => {
      const command = node as { name?: string | null; args?: string | null }
      terminal.status('⌘ /' + (command.name ?? 'command') + (command.args !== null && command.args !== undefined ? ' ' + command.args : ''))
    }),
    'terminal-tool: command renderer',
  )
  ctx.effect(
    () => terminal.registerNodeRenderer('compaction', () => {
      terminal.status('↻ context compacted')
    }),
    'terminal-tool: compaction renderer',
  )
}
