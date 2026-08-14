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

export { ansiEnabled, sgr, SGR, dsBlue, dsDim, rgb } from './ansi.ts'
export { AnsiMarkdown } from './markdown.ts'
export { subscribeCurrentSession } from './session-binding.ts'
export { renderBanner } from './welcome.ts'

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
   * Write streamed mid-line text: clears the current input line first so
   * the run never lands after the prompt (the caller redraws the prompt
   * after the batch).
   * @param text - the text to write.
   */
  stream(text: string): void
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
   * Register a renderer for one conversation node kind. The conversation
   * plugin dispatches finalized nodes here first; an unhandled kind falls
   * back to the conversation built-ins. This is the terminal plane's
   * slot mechanism: feature plugins compose into the shared transcript.
   * @param kind - the node kind (e.g. 'tool-result').
   * @param renderer - the renderer for that kind.
   * @returns disposer removing the renderer.
   */
  registerNodeRenderer(kind: string, renderer: (node: unknown) => void): () => void
  /**
   * Render one node through a registered renderer.
   * @param kind - the node kind.
   * @param node - the node.
   * @returns whether a renderer handled it.
   */
  renderNode(kind: string, node: unknown): boolean
  /**
   * Register a client-side slash command.
   * @param name - command name without the slash (e.g. 'help').
   * @param handler - the handler receiving the raw argument text.
   * @returns disposer removing the command.
   */
  registerCommand(name: string, handler: (args: string) => void | Promise<void>): () => void
  /**
   * Dispatch a slash-command line to a registered client command.
   * @param line - the raw input line starting with '/'.
   * @returns whether a client command handled it.
   */
  dispatchCommand(line: string): boolean
  /**
   * Register a pre-line hook: runs before the ordinary line handlers and
   * can consume the line (returning true). Attachment expansion is the
   * primary consumer.
   * @param hook - the hook; true means the line was fully handled.
   * @returns disposer removing the hook.
   */
  registerPreLineHook(hook: (line: string) => void | Promise<void> | boolean | Promise<boolean>): () => void
  /**
   * Whether any registered command handler is still running (the close
   * path waits for these before exiting).
   */
  busy(): boolean
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
  const input = new InputReader(process.stdin, writer,  process.stdin.isTTY)
  let currentPrompt = config.prompt
  let started = false
  const lineListeners = new Set<(line: string) => void | Promise<void>>()
  const nodeRenderers = new Map<string, (node: unknown) => void>()
  const commandHandlers = new Map<string, (args: string) => void | Promise<void>>()
  let commandBusy = 0
  const preLineHooks = new Set<(line: string) => void | Promise<void> | boolean | Promise<boolean>>()
  const service: TerminalService = {
    isTTY: writer.isTTY,
    width: process.stdout.columns || 80,
    markdown: new AnsiMarkdown(),
    write: (text) => { writer.write(text) },
    stream: (text) => { writer.writeStream(text) },
    print: (text) => { writer.print(text) },
    status: (text) => { writer.status(text) },
    setPrompt: (text) => {
      currentPrompt = text
      if (started) input.setPrompt(text)
    },
    registerNodeRenderer: (kind, renderer) => {
      if (nodeRenderers.has(kind)) {
        throw new Error('terminal: node renderer for ' + JSON.stringify(kind) + ' is already registered')
      }
      nodeRenderers.set(kind, renderer)
      return () => { nodeRenderers.delete(kind) }
    },
    renderNode: (kind, node) => {
      const renderer = nodeRenderers.get(kind)
      if (renderer === undefined) return false
      renderer(node)
      return true
    },
    registerCommand: (name, handler) => {
      if (commandHandlers.has(name)) {
        throw new Error('terminal: command /' + name + ' is already registered')
      }
      commandHandlers.set(name, handler)
      return () => { commandHandlers.delete(name) }
    },
    dispatchCommand: (line) => {
      const match = /^\/([A-Za-z0-9_-]+)(?:\s+(.*))?$/.exec(line.trim())
      if (match === null) return false
      const handler = commandHandlers.get(match[1] ?? '')
      if (handler === undefined) return false
      commandBusy += 1
      void Promise.resolve(handler(match[2] ?? '')).catch((error: unknown) => {
        writer.print(String(error))
      }).finally(() => {
        commandBusy -= 1
      })
      return true
    },
    busy: () => commandBusy > 0,
    refreshPrompt: () => {
      if (started) input.setPrompt(currentPrompt)
    },
    onLine: (listener) => {
      lineListeners.add(listener)
      if (!started) {
        started = true
        input.start(async (line) => {
          for (const hook of [...preLineHooks]) {
            const result = await hook(line)
            if (result === true) return
          }
          for (const registered of [...lineListeners]) {
            await registered(line)
          }
        })
      }
      return () => { lineListeners.delete(listener) }
    },
    registerPreLineHook: (hook) => {
      preLineHooks.add(hook)
      return () => { preLineHooks.delete(hook) }
    },
    onSigint: listener => input.onSigint(listener),
    onClose: listener => input.onClose(listener),
    close: () => { input.close() },
  }
  ctx.provide('terminal', service)
  ctx.effect(() => () => { input.close() }, 'terminal: input teardown')
}
