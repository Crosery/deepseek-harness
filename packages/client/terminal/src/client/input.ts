/**
 * Raw-mode line input for the terminal plane. Serializes handler execution
 * so a slow handler (a prompt in flight) never drops or reorders lines, and
 * routes SIGINT to a pluggable handler (cancel the run, or exit when idle).
 * @module @deepseek-ai/dsh-client-terminal/input
 */

import readline from 'node:readline'
import type { TerminalWriter } from './output.ts'

/** The keypress event fields the buffer tracker reads. */
interface Key {
  name?: string
  sequence?: string
  ctrl?: boolean
}

/** One line reader bound to stdin, redrawing its prompt through the writer. */
export class InputReader {
  private rl: readline.Interface | undefined
  private readonly sigintListeners = new Set<() => void>()
  private readonly closeListeners = new Set<() => void>()
  private readonly bufferListeners = new Set<(line: string) => void>()
  private keypressHandler: ((chunk: string, key: Key) => void) | undefined
  private started = false
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
    if (this.started) throw new Error('terminal: input reader already started')
    if (this.closed) throw new Error('terminal: input reader already closed')
    this.started = true
    // Keypress tracking feeds the live slash-hint line; the Interface keeps
    // owning the line editor, both consume the same stream.
    readline.emitKeypressEvents(this.stdin)
    let buffer = ''
    this.keypressHandler = (_chunk, key) => {
      const sequence = key.sequence ?? ''
      if (key.ctrl && key.name === 'c') {
        buffer = ''
        this.emitBuffer(buffer)
        return
      }
      if (key.name === 'return' || sequence === '\r' || sequence === '\n') {
        buffer = ''
        this.emitBuffer(buffer)
        return
      }
      if (key.name === 'backspace' || sequence === '\x7f' || sequence === '\b') {
        buffer = buffer.slice(0, -1)
        this.emitBuffer(buffer)
        return
      }
      if (key.ctrl && key.name === 'u') {
        buffer = ''
        this.emitBuffer(buffer)
        return
      }
      if (key.ctrl && key.name === 'w') {
        buffer = buffer.replace(/\S+\s*$/, '')
        this.emitBuffer(buffer)
        return
      }
      // Arrow keys, escapes, and control sequences never reach the buffer.
      if (sequence.length === 1 && sequence >= ' ') {
        buffer += sequence
        this.emitBuffer(buffer)
      }
    }
    this.stdin.on('keypress', this.keypressHandler)
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
   * Register a listener fired on every current-line buffer change (the live
   * slash-hint seat).
   * @param listener - the listener receiving the in-progress line.
   * @returns disposer removing the listener.
   */
  onBufferChange(listener: (line: string) => void): () => void {
    this.bufferListeners.add(listener)
    return () => { this.bufferListeners.delete(listener) }
  }

  private emitBuffer(line: string): void {
    for (const listener of [...this.bufferListeners]) {
      try {
        listener(line)
      } catch (error) {
        this.writer.print(String(error))
      }
    }
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
    if (this.keypressHandler !== undefined) {
      this.stdin.off('keypress', this.keypressHandler)
      this.keypressHandler = undefined
    }
    this.rl?.close()
    this.rl = undefined
  }
}
