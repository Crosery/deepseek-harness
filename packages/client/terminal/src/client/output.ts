/**
 * The terminal plane's single output seam: every rendered byte routes
 * through here, so prompt redraws and (later) the status footer stay in one
 * place. Stateless by design — the session log owns the transcript, not the
 * renderer.
 * @module @deepseek-ai/dsh-client-terminal/output
 */

/** One line-writer bound to a stream (stdout for the terminal plane). */
export class TerminalWriter {
  /**
   * @param stream - the output stream (always stdout today).
   */
  constructor(private readonly stream: NodeJS.WriteStream) {}

  /** Whether the stream is an interactive terminal. */
  get isTTY(): boolean {
    return  this.stream.isTTY
  }

  /**
   * Write raw text (may contain newlines and ANSI escapes).
   * @param text - the text to write.
   */
  write(text: string): void {
    if (text === '') return
    this.stream.write(text)
  }

  /**
   * Write one complete line.
   * @param text - line content (no newline).
   */
  print(text = ''): void {
    this.stream.write(text + '\n')
  }

  /**
   * Write one transient status line (dimmed when the stream is a TTY).
   * @param text - status text.
   */
  status(text: string): void {
    if (!this.isTTY) {
      this.print(text)
      return
    }
    this.print('\u001b[2m' + text + '\u001b[0m')
  }

  /** Clear the current line (raw ANSI; no-op when the stream is not a TTY). */
  clearLine(): void {
    if (!this.isTTY) return
    this.stream.write('\r\u001b[K')
  }
}
