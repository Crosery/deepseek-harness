/**
 * Terminal tool plugin: renders tool-result rows through the kernel's node
 * renderer registry (the terminal slot mechanism). Settled tool calls print
 * a status row with duration and exit outcome, then a dimmed preview of the
 * render-intent content (terminal output, diff hunks, search matches, read
 * content, web output, or the raw result).
 * @module @deepseek-ai/dsh-client-terminal-tool/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client-node'
import type { TerminalService } from '@deepseek-ai/dsh-client-terminal/client-node'
import { ansiEnabled, describeToolCall, dsBlue, dsDim, sgr, SGR } from '@deepseek-ai/dsh-client-terminal/client-node'

/** Stable Cordis plugin name. */
export const name = 'terminal-tool'

/** Required services. */
export const inject = ['terminal']

/** Cap for inline result preview characters (the session log keeps the full text). */
const PREVIEW_CHARS = 2000

/** Duration between paired call and result, formatted as omp-style meta. */
export function durationOf(node: ToolResultNode): string {
  if (node.callTime === null) return ''
  const seconds = (node.time - node.callTime) / 1000
  return seconds >= 0 ? ' · ' + seconds.toFixed(1) + 's' : ''
}

/** Text content of a content-block list (text blocks only). */
function textOf(blocks: readonly { type?: string; text?: unknown }[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => typeof block.text === 'string' ? block.text : '')
    .join('')
}

/** Preview one text body (dimmed, capped, indented by tree depth). */
function preview(terminal: TerminalService, text: string, indent: string): void {
  if (text.trim() === '') return
  const capped = text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) + ' …' : text
  for (const line of capped.split('\n')) {
    terminal.print(ansiEnabled ? sgr(SGR.dim, indent + '  ' + line) : indent + '  ' + line)
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

/**
 * Render one tool-call row, omp-style: a `✓ name: label · 0.5s` header
 * with a dim preview of the render-intent content, then any nested
 * subcalls indented below (the web renders the same recursive tree).
 * @param terminal - the output seam.
 * @param block - the running or settled call.
 * @param depth - nesting depth (root is 0).
 */
function renderCallRow(terminal: TerminalService, block: ToolCallBlock, depth: number): void {
  const indent = '  '.repeat(depth)
  if (!('kind' in block)) {
    // A running subcall inside a settled tree (interrupted run): pending marker.
    const label = describeToolCall(block.argsRaw, block.callView)
    const plain = indent + '… ' + block.name + (label === '' ? '' : ': ' + label)
    terminal.print(ansiEnabled ? dsDim(plain) : plain)
    return
  }
  const node = block
  const name = node.call?.name ?? 'tool'
  const label = describeToolCall(node.call?.argsRaw ?? '', node.callView)
  const head = indent + (node.isError ? '✗' : '✓') + ' ' + name + (label === '' ? '' : ': ' + label) + durationOf(node)
  terminal.print(ansiEnabled
    ? indent + (node.isError ? sgr(SGR.brightRed, '✗') : dsBlue('✓')) + ' ' + dsBlue(name)
      + (label === '' ? '' : ': ' + dsDim(label)) + dsDim(durationOf(node))
    : head)
  const error = node.error
  if (error !== undefined) {
    terminal.print(ansiEnabled ? dsDim(indent + '  (' + error.code + ')') : indent + '  (' + error.code + ')')
  }
  preview(terminal, viewBody(node), indent)
  for (const subCall of node.subCalls ?? []) {
    renderCallRow(terminal, subCall, depth + 1)
  }
}

/** Render one settled tool-result node (the root of its subcall tree). */
function renderToolResult(terminal: TerminalService, raw: unknown): void {
  renderCallRow(terminal, raw as ToolResultNode, 0)
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
      const command = node as {
        name?: string | null
        args?: string | null
        outcome?: { kind: 'success' | 'error'; text?: string } | null
      }
      terminal.status('⌘ /' + (command.name ?? 'command') + (command.args !== null && command.args !== undefined ? ' ' + command.args : ''))
      // The settled outcome renders like a tool row: the command's visible
      // result text (the web shows the same on its command card).
      const outcome = command.outcome
      if (outcome === null || outcome === undefined || outcome.text === undefined || outcome.text === '') return
      const line = (outcome.kind === 'error' ? '✗ ' : '✓ ') + outcome.text
      terminal.print(ansiEnabled
        ? (outcome.kind === 'error' ? sgr(SGR.brightRed, line) : dsDim(line))
        : line)
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
