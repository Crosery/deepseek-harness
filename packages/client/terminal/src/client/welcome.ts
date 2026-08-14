/**
 * Welcome screen for the terminal plane, borrowing omp's design: a dim
 * rounded box with a centered brand, the pixel whale in DeepSeek blue,
 * the active model, and recent sessions; a dim italic Tip line below.
 * Printed once per blank interactive session (never piped/print mode).
 * @module @deepseek-ai/dsh-client-terminal/welcome
 */

import { ansiEnabled, dsBlue, dsDim, sgr, SGR } from './ansi.ts'

const WHALE: readonly string[] = [
  '        \u2591\u2591',
  '       \u2591\u2591\u2591\u2591',
  '     \u2584\u2584\u2584\u2591\u2591\u2591\u2591',
  '   \u2584\u2588\u2588\u2588\u2588\u2588\u2584\u2584',
  ' \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584',
  '\u2588\u2588\u2588\u2580\u2580\u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2584\u2584',
  '\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584',
  '\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2584',
  ' \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580 \u2580\u2584',
  '   \u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580  \u2580\u2584',
  '                       \u2580\u2580',
]

const BRAND = 'DeepSeek Harness'

const HINT_LINES: readonly string[] = [
  'type a task, or /help for commands',
  '/model picks the model · / or \\ hints the commands',
]

const TIP = 'press / or \\ to preview commands — enter runs them'

/**
 * Render the welcome screen lines (each line already themed).
 * @param width - terminal columns; the box caps at 60.
 * @param model - active model as `provider:name`, or undefined to omit.
 * @param recent - recent session titles listed under the hints.
 * @returns the welcome lines.
 */
export function renderBanner(width: number, model?: string, recent: readonly string[] = []): string[] {
  const box = Math.min(60, Math.max(29, width - 2))
  const inner = box - 2
  const center = (text: string): string => {
    const pad = inner - text.length
    const left = Math.floor(pad / 2)
    return ' '.repeat(Math.max(0, left)) + text + ' '.repeat(Math.max(0, pad - left))
  }
  const padLine = (text: string): string => {
    const pad = Math.max(0, inner - text.length)
    return text + ' '.repeat(pad)
  }
  const border = (text: string): string => dsDim(text)
  const bold = (text: string): string => (ansiEnabled ? sgr(SGR.bold, text) : text)
  const lines: string[] = []
  lines.push(border('╭' + '─'.repeat(inner) + '╮'))
  lines.push(border('│') + dsBlue(bold(center(BRAND))) + border('│'))
  lines.push(border('│') + ' '.repeat(inner) + border('│'))
  for (const row of WHALE) lines.push(border('│') + dsBlue(center(row)) + border('│'))
  if (model !== undefined) {
    lines.push(border('│') + ' '.repeat(inner) + border('│'))
    lines.push(border('│') + dsDim(center(model)) + border('│'))
  }
  lines.push(border('├' + '─'.repeat(inner) + '┤'))
  for (const hint of HINT_LINES) {
    lines.push(border('│') + dsDim(padLine('  ' + hint)) + border('│'))
  }
  if (recent.length > 0) {
    lines.push(border('│') + ' '.repeat(inner) + border('│'))
    lines.push(border('│') + dsDim(padLine('  recent')) + border('│'))
    for (const title of recent) {
      const plain = title.length > inner - 6 ? title.slice(0, inner - 6) + '…' : title
      lines.push(border('│') + dsDim(padLine('  • ' + plain)) + border('│'))
    }
  }
  lines.push(border('╰' + '─'.repeat(inner) + '╯'))
  lines.push(ansiEnabled ? sgr(SGR.italic, dsDim(' Tip: ' + TIP)) : ' Tip: ' + TIP)
  return lines
}
