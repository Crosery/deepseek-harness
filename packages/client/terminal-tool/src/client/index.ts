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
import { ansiEnabled, describeToolCall, dsBlue, dsDim, dsGreen, dsRed, truncateVisible, visibleWidth } from '@deepseek-ai/dsh-client-terminal/client-node'

/** Stable Cordis plugin name. */
export const name = 'terminal-tool'

/** Required services. */
export const inject = ['terminal']

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

/** One box row: dim borders, content padded to the inner width. */
function boxRow(inner: number, themed: string, plain: string): string {
  const content = ansiEnabled ? themed : plain
  return dsDim('│ ') + content + ' '.repeat(Math.max(0, inner - 2 - visibleWidth(content))) + dsDim(' │')
}

/**
 * Render one tool-call row inside the card frame, omp-style: the tool
 * name sits on the top border, the row carries the status icon, the
 * flattened one-line label, and the duration; the render-intent preview
 * follows dim, then any nested subcalls indent deeper (the web renders
 * the same recursive tree).
 * @param terminal - the output seam.
 * @param block - the running or settled call.
 * @param depth - nesting depth (root is 0).
 * @param inner - the box inner width in columns.
 */
function renderCallRow(terminal: TerminalService, block: ToolCallBlock, depth: number, inner: number): void {
  const indent = '  '.repeat(depth)
  if (!('kind' in block)) {
    // A running subcall inside a settled tree (interrupted run): pending marker.
    const budget = Math.max(10, inner - visibleWidth(indent) - 4)
    const label = truncateVisible(describeToolCall(block.argsRaw, block.callView), budget)
    const plain = indent + '… ' + block.name + (label === '' ? '' : ': ' + label)
    terminal.print(boxRow(inner, dsDim(plain), plain))
    return
  }
  const node = block
  const name = node.call?.name ?? 'tool'
  const budget = Math.max(10, inner - visibleWidth(indent) - visibleWidth(name) - 16)
  const label = truncateVisible(describeToolCall(node.call?.argsRaw ?? '', node.callView), budget)
  const plainHead = indent + (node.isError ? '✗' : '✓') + ' ' + name + (label === '' ? '' : ': ' + label) + durationOf(node)
  const themedHead = indent + (node.isError ? dsRed('✗') : dsGreen('✓')) + ' ' + dsBlue(name)
    + (label === '' ? '' : ': ' + dsDim(label)) + dsDim(durationOf(node))
  terminal.print(boxRow(inner, themedHead, plainHead))
  const error = node.error
  if (error !== undefined) {
    const plain = indent + '  (' + error.code + ')'
    terminal.print(boxRow(inner, dsDim(plain), plain))
  }
  const contentBudget = Math.max(10, inner - visibleWidth(indent) - 2)
  for (const line of viewBody(node).split('\n')) {
    if (line.trim() === '') continue
    const plain = indent + '  ' + truncateVisible(line, contentBudget)
    terminal.print(boxRow(inner, dsDim(plain), plain))
  }
  for (const subCall of node.subCalls ?? []) {
    renderCallRow(terminal, subCall, depth + 1, inner)
  }
}

/** The box inner width: terminal columns minus borders, capped like omp. */
const BOX_MAX = 96

/** Render one settled tool-result node as a framed card (omp output block). */
function renderToolResult(terminal: TerminalService, raw: unknown): void {
  const node = raw as ToolResultNode
  const name = node.call?.name ?? 'tool'
  const inner = Math.min(BOX_MAX, terminal.width - 2) - 2
  const nameBudget = Math.max(6, inner - 6)
  const title = truncateVisible(name, nameBudget)
  const top = dsDim('╭─ ') + title + dsDim(' ' + '─'.repeat(Math.max(0, inner - 3 - visibleWidth(title))) + '╮')
  terminal.print(top)
  renderCallRow(terminal, node, 0, inner)
  terminal.print(dsDim('╰' + '─'.repeat(inner) + '╯'))
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
        ? (outcome.kind === 'error' ? dsRed(line) : dsGreen(line))
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
