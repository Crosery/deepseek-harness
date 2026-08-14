/**
 * Raw-mode line input for the terminal plane. Serializes handler execution
 * so a slow handler (a prompt in flight) never drops or reorders lines, and
 * routes SIGINT to a pluggable handler (cancel the run, or exit when idle).
 * @module @deepseek-ai/dsh-client-terminal/input
 */

import readline from 'node:readline'
import type { TerminalWriter } from './output.ts'

/** One line reader bound to stdin, redrawing its prompt through the writer. */
export class InputReader {
  private rl: readline.Interface | undefined
  private readonly sigintListeners = new Set<() => void>()
  private readonly closeListeners = new Set<() => void>()
  private closed = false

  /** Serialized handler chain: each line waits for the previous handler. */
  private chain: Promise<void> = Promise.resolve()

  /**
   * @param stdin - the input stream.
   * @param writer - the output writer (prompt redraws route through it).
   * @param isTTY - whether stdin is interactive (no raw mode otherwise).
   */
  constructor(
    private readonly stdin: NodeJS.ReadStream,
    private readonly writer: TerminalWriter,
    private readonly isTTY: boolean,
  ) {}

  /**
   * Start reading lines; each completed line runs the handler in order.
   * @param onLine - the line handler.
   */
  start(onLine: (line: string) => void | Promise<void>): void {
    if (this.closed) throw new Error('terminal: input reader already closed')
    const rl = readline.createInterface({
      input: this.stdin,
      output: this.writer.isTTY ? process.stdout : undefined,
      terminal: this.isTTY,
      historySize: 0,
      prompt: '',
    })
    this.rl = rl
    rl.on('close', () => {
      for (const listener of [...this.closeListeners]) {
        try {
          listener()
        } catch (error) {
          this.writer.print(String(error))
        }
      }
    })
    rl.on('line', (line) => {
      this.chain = this.chain.then(() => onLine(line)).catch((error: unknown) => {
        this.writer.print(String(error))
      })
    })
    rl.on('SIGINT', () => {
      for (const listener of [...this.sigintListeners]) {
        try {
          listener()
        } catch (error) {
          this.writer.print(String(error))
        }
      }
    })
  }

  /**
   * Register a SIGINT handler (cancel-the-run is the primary consumer).
   * @param listener - the handler.
   * @returns disposer removing the handler.
   */
  onSigint(listener: () => void): () => void {
    this.sigintListeners.add(listener)
    return () => { this.sigintListeners.delete(listener) }
  }

  /**
   * Register a listener fired once the reader closed (terminal restored).
   * @param listener - the listener.
   * @returns disposer removing the listener.
   */
  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => { this.closeListeners.delete(listener) }
  }

  /**
   * Update the prompt and redraw the current input line.
   * @param text - the new prompt.
   */
  setPrompt(text: string): void {
    const rl = this.rl
    if (rl === undefined) return
    rl.setPrompt(text)
    if (this.isTTY) rl.prompt(true)
  }

  /** Close the reader and restore the terminal. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.rl?.close()
    this.rl = undefined
  }
}
