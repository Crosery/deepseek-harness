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
  return `\u001b[${code}m${text}\u001b[0m`
}

/** Whether ANSI output is enabled for this process. */
export const ansiEnabled =  process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb'

/** The DeepSeek brand blue (RGB): accents, cursors, and the prompt. */
export const DEEPSEEK_BLUE = { r: 77, g: 107, b: 254 } as const

/** A muted slate gray for secondary/dimmed text, following omp's muted tone. */
export const DEEPSEEK_GRAY = { r: 136, g: 144, b: 164 } as const

/** A lighter reading blue kept for blue-adjacent secondary accents. */
export const DEEPSEEK_BLUE_SOFT = { r: 128, g: 148, b: 255 } as const

/** Success green for ✓ rows and positive outcomes. */
export const DEEPSEEK_GREEN = { r: 74, g: 222, b: 128 } as const

/** Error red for ✗ rows and failures. */
export const DEEPSEEK_RED = { r: 248, g: 113, b: 113 } as const

/**
 * Wrap text in a truecolor foreground.
 * @param r - red channel (0-255).
 * @param g - green channel (0-255).
 * @param b - blue channel (0-255).
 * @param text - the text the color applies to.
 * @returns the wrapped text.
 */
export function rgb(r: number, g: number, b: number, text: string): string {
  return '\u001b[38;2;' + r + ';' + g + ';' + b + 'm' + text + '\u001b[0m'
}

/**
 * Wrap text in the DeepSeek brand blue when colors are on.
 * @param text - the text to color.
 * @returns the colored text (or the plain text without a TTY).
 */
export function dsBlue(text: string): string {
  return ansiEnabled ? rgb(DEEPSEEK_BLUE.r, DEEPSEEK_BLUE.g, DEEPSEEK_BLUE.b, text) : text
}

/**
 * Wrap text in the muted slate gray when colors are on (secondary text:
 * thinking, context, footers, borders — anything that should recede).
 * @param text - the text to color.
 * @returns the colored text (or the plain text without a TTY).
 */
export function dsDim(text: string): string {
  return ansiEnabled ? rgb(DEEPSEEK_GRAY.r, DEEPSEEK_GRAY.g, DEEPSEEK_GRAY.b, text) : text
}

/**
 * Wrap text in the soft DeepSeek blue when colors are on.
 * @param text - the text to color.
 * @returns the colored text (or the plain text without a TTY).
 */
export function dsSoftBlue(text: string): string {
  return ansiEnabled ? rgb(DEEPSEEK_BLUE_SOFT.r, DEEPSEEK_BLUE_SOFT.g, DEEPSEEK_BLUE_SOFT.b, text) : text
}

/**
 * Wrap text in the success green when colors are on.
 * @param text - the text to color.
 * @returns the colored text (or the plain text without a TTY).
 */
export function dsGreen(text: string): string {
  return ansiEnabled ? rgb(DEEPSEEK_GREEN.r, DEEPSEEK_GREEN.g, DEEPSEEK_GREEN.b, text) : text
}

/**
 * Wrap text in the error red when colors are on.
 * @param text - the text to color.
 * @returns the colored text (or the plain text without a TTY).
 */
export function dsRed(text: string): string {
  return ansiEnabled ? rgb(DEEPSEEK_RED.r, DEEPSEEK_RED.g, DEEPSEEK_RED.b, text) : text
}
