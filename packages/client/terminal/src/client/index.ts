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
import { dsBlue, dsDim } from './ansi.ts'

export { ansiEnabled, sgr, SGR, dsBlue, dsDim, rgb } from './ansi.ts'
export { AnsiMarkdown } from './markdown.ts'
export { subscribeCurrentSession } from './session-binding.ts'
export { renderBanner } from './welcome.ts'
export { argsPreview, describeToolCall } from './labels.ts'

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
  /**
   * Advance to the next line without clearing the current one (the blank-line
   * primitive: streaming deltas model their own newlines).
   */
  nextLine(): void
  /** Clear the current line in place (the cursor stays put). */
  clearLine(): void
  /**
   * Set the live command-hint provider: called on every current-line change;
   * a returned item list renders as a popup menu under the input, null clears
   * it. Both '/' and '\' begin a command line.
   * @param provider - the hint provider, or undefined to disable.
   */
  setHintProvider(provider: ((line: string) => readonly HintItem[] | null) | undefined): void
  /** Close input and restore the terminal. */
  close(): void
}

/** One entry of the live command-hint menu. */
export interface HintItem {
  /** The command label shown in the menu (e.g. '/help'). */
  label: string
  /** Optional one-line description shown dimmed next to the label. */
  description?: string
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

/** How many command rows the live hint menu shows before truncating. */
const MENU_MAX_ITEMS = 6
/** Fixed label column so rows align like omp's select-list. */
const MENU_LABEL_WIDTH = 22

/**
 * Layout the live hint menu: a blue cursor row, dimmed rows, and a dim
 * footer with the match count — omp's select-list look on one menu.
 * @param items - the filtered hint items.
 * @param termWidth - terminal columns (descriptions truncate to fit).
 * @returns the menu lines (each fully themed, never longer than termWidth).
 */
export function renderHintMenu(items: readonly HintItem[], termWidth: number): string[] {
  const shown = items.slice(0, MENU_MAX_ITEMS)
  const descBudget = Math.max(6, termWidth - MENU_LABEL_WIDTH - 4)
  const rows = shown.map((item, index) => {
    const label = item.label.padEnd(MENU_LABEL_WIDTH)
    const description = (item.description ?? '').slice(0, descBudget)
    const selected = index === 0
    return (selected ? dsBlue('>') : ' ') + ' ' + (selected ? dsBlue(label) : dsDim(label)) + ' ' + dsDim(description)
  })
  const count = (items.length > shown.length ? shown.length + '/' : '') + items.length
    + (items.length === 1 ? ' match' : ' matches')
  const footer = dsDim(count + ' · ⏎ run · type to filter')
  return [...rows, footer]
}

/**
 * Kernel plugin body: create the writer/reader pair and provide the
 * terminal service. Disposal closes input and restores the terminal.
 * @param ctx - terminal client cordis context.
 * @param config - kernel config.
 */
export function apply(ctx: Context, config: TerminalConfig): void {
  const writer = new TerminalWriter(process.stdout)
  const input = new InputReader(process.stdin, writer,  process.stdin.isTTY)
  const terminalWidth = process.stdout.columns || 80
  let currentPrompt = config.prompt
  let started = false
  const lineListeners = new Set<(line: string) => void | Promise<void>>()
  const nodeRenderers = new Map<string, (node: unknown) => void>()
  const commandHandlers = new Map<string, (args: string) => void | Promise<void>>()
  let commandBusy = 0
  let hintProvider: ((line: string) => readonly HintItem[] | null) | undefined
  let hintLines = 0
  let hintBufferDispose: (() => void) | undefined
  let promptDirty = false
  // The hint menu borrows omp's select-list look: a dim rounded box under the
  // input, a blue cursor on the first match, dim descriptions, and a dim
  // footer. Readline keeps owning the editor; the menu only ever previews.
  const clearHint = (): void => {
    if (hintLines === 0 || !writer.isTTY) return
    let bytes = '\u001b7\u001b[1B'
    for (let index = 0; index < hintLines; index += 1) bytes += '\r\u001b[K\u001b[1B'
    writer.raw(bytes + '\u001b8')
    hintLines = 0
  }
  const preLineHooks = new Set<(line: string) => void | Promise<void> | boolean | Promise<boolean>>()
  const service: TerminalService = {
    isTTY: writer.isTTY,
    width: terminalWidth,
    markdown: new AnsiMarkdown(),
    write: (text) => {
      promptDirty = true
      writer.write(text)
    },
    stream: (text) => {
      clearHint()
      promptDirty = true
      writer.writeStream(text)
    },
    print: (text) => {
      promptDirty = true
      writer.print(text)
    },
    status: (text) => {
      promptDirty = true
      writer.status(text)
    },
    nextLine: () => {
      clearHint()
      promptDirty = true
      writer.raw('\n')
    },
    clearLine: () => {
      clearHint()
      writer.clearLine()
    },
    setPrompt: (text) => {
      currentPrompt = text
      promptDirty = false
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
      // The prompt redraws only when output consumed its line since the last
      // draw — idle snapshot updates must not replay the prompt (no flicker,
      // no erase of the line below).
      if (!started || !promptDirty) return
      input.setPrompt(currentPrompt)
      promptDirty = false
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
    setHintProvider: (provider) => {
      hintProvider = provider
      if (hintBufferDispose === undefined) {
        hintBufferDispose = input.onBufferChange((line) => {
          const items = hintProvider?.(line) ?? null
          if (!writer.isTTY) return
          clearHint()
          if (items === null || items.length === 0) return
          const menu = renderHintMenu(items, terminalWidth)
          hintLines = menu.length
          let bytes = '\u001b7\u001b[1B'
          for (const menuLine of menu) {
            bytes += '\r\u001b[K' + menuLine + '\u001b[1B'
          }
          writer.raw(bytes + '\u001b8')
        })
      } else if (provider === undefined) {
        clearHint()
      }
    },
  }
  ctx.provide('terminal', service)
  ctx.effect(() => () => { input.close() }, 'terminal: input teardown')
}
