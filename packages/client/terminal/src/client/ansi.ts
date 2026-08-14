/**
 * SGR helpers for the terminal plane. All color output routes through these
 * wrappers so non-TTY streams degrade to plain text in one place.
 * @module @deepseek-ai/dsh-client-terminal/ansi
 */

/** ANSI Select Graphic Rendition codes the terminal plane uses. */
export const SGR = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
} as const

/**
 * Wrap text in one SGR attribute plus a reset.
 * @param code - the SGR parameter (an ANSI color or attribute number).
 * @param text - the text the attribute applies to.
 * @returns the wrapped text.
 */
export function sgr(code: number, text: string): string {
  return '\u001b[' + code + 'm' + text + '\u001b[0m'
}

/** Whether ANSI output is enabled for this process. */
export const ansiEnabled = process.stdout.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb'
