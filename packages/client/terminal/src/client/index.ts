/**
 * Terminal client plane kernel: owns stdout, stdin, the ANSI markdown
 * renderer, and prompt refresh, and provides the `ctx.terminal` service
 * every terminal feature plugin composes against. The kernel renders
 * nothing on its own — feature plugins register input handlers and write
 * through the shared writer, mirroring how the web shell owns the render
 * tree while ui-* plugins own their seats.
 * @module @deepseek-ai/dsh-client-terminal/client
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AnsiMarkdown } from './markdown.ts'
import { TerminalWriter } from './output.ts'
import { InputReader } from './input.ts'

export { ansiEnabled, sgr, SGR } from './ansi.ts'
export { AnsiMarkdown } from './markdown.ts'
export { subscribeCurrentSession } from './session-binding.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The terminal plane's shared presentation seam. */
    terminal: TerminalService
  }
}

/** The ctx.terminal service: the single output seam plus line input. */
export interface TerminalService {
  /** Whether output is an interactive terminal (colors and prompts on). */
  readonly isTTY: boolean
  /** Terminal columns (fallback 80). */
  readonly width: number
  /** The incremental markdown renderer shared by all feature plugins. */
  readonly markdown: AnsiMarkdown
  /**
   * Write raw text (newlines and ANSI escapes allowed).
   * @param text - the text to write.
   */
  write(text: string): void
  /**
   * Write one complete line.
   * @param text - line content.
   */
  print(text?: string): void
  /**
   * Write one transient dimmed status line.
   * @param text - status text.
   */
  status(text: string): void
  /**
   * Set the input prompt and redraw the current line.
   * @param text - the new prompt.
   */
  setPrompt(text: string): void
  /** Redraw the input prompt after a batch of output. */
  refreshPrompt(): void
  /**
   * Register a line handler (started lazily on the first registration).
   * @param listener - the handler; runs serially per line.
   * @returns disposer removing the handler.
   */
  onLine(listener: (line: string) => void | Promise<void>): () => void
  /**
   * Register a SIGINT handler.
   * @param listener - the handler.
   * @returns disposer removing the handler.
   */
  onSigint(listener: () => void): () => void
  /**
   * Register a listener fired once input closed (terminal restored).
   * @param listener - the listener.
   * @returns disposer removing the listener.
   */
  onClose(listener: () => void): () => void
  /** Close input and restore the terminal. */
  close(): void
}

/** Stable Cordis plugin name. */
export const name = 'terminal'

/** Required services: none (the wire root of the terminal plane). */
export const inject: string[] = []

/** Kernel configuration. */
export interface TerminalConfig {
  /** The input prompt. */
  prompt: string
}

export const Config: z<TerminalConfig> = z.object({
  prompt: z.string().default('❯ '),
})

/**
 * Kernel plugin body: create the writer/reader pair and provide the
 * terminal service. Disposal closes input and restores the terminal.
 * @param ctx - terminal client cordis context.
 * @param config - kernel config.
 */
export function apply(ctx: Context, config: TerminalConfig): void {
  const writer = new TerminalWriter(process.stdout)
  const input = new InputReader(process.stdin, writer, process.stdin.isTTY === true)
  let currentPrompt = config.prompt
  let started = false
  const lineListeners = new Set<(line: string) => void | Promise<void>>()
  const service: TerminalService = {
    isTTY: writer.isTTY,
    width: process.stdout.columns ?? 80,
    markdown: new AnsiMarkdown(),
    write: text => writer.write(text),
    print: text => writer.print(text),
    status: text => writer.status(text),
    setPrompt: (text) => {
      currentPrompt = text
      if (started) input.setPrompt(text)
    },
    refreshPrompt: () => {
      if (started) input.setPrompt(currentPrompt)
    },
    onLine: (listener) => {
      lineListeners.add(listener)
      if (!started) {
        started = true
        input.start(async (line) => {
          for (const registered of [...lineListeners]) {
            await registered(line)
          }
        })
      }
      return () => { lineListeners.delete(listener) }
    },
    onSigint: listener => input.onSigint(listener),
    onClose: listener => input.onClose(listener),
    close: () => input.close(),
  }
  ctx.provide('terminal', service)
  ctx.effect(() => () => { input.close() }, 'terminal: input teardown')
}
