/**
 * Welcome banner for the terminal plane: a pixel whale in DeepSeek blue,
 * printed once per blank interactive session (never in piped/print mode).
 * @module @deepseek-ai/dsh-client-terminal/welcome
 */

import { dsBlue, dsDim } from './ansi.ts'

const WHALE: readonly string[] = [
  '        \u2591\u2591',
  '       \u2591\u2591\u2591\u2591',
  '     \u2584\u2584\u2584\u2591\u2591\u2591\u2591',
  '   \u2584\u2588\u2588\u2588\u2588\u2588\u2584\u2584',
  ' \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584',
  '\u2588\u2588\u2588\u2580\u2580\u2580\u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2584\u2584',
  '\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584',
  '\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2584',
  ' \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580 \u2580\u2584',
  '   \u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580  \u2580\u2584',
  '                       \u2580\u2580',
]

const BRAND = 'DeepSeek Harness \u00b7 terminal CLI'

const HINT = 'type a task, or /help for commands \u00b7 /model to pick a model'

/**
 * Render the welcome banner lines (each line already themed).
 * @returns the banner lines.
 */
export function renderBanner(): string[] {
  return [...WHALE.map(line => dsBlue(line)), '', dsBlue('  ' + BRAND), dsDim('  ' + HINT)]
}
