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
   * Write raw text (may contain newlines and ANSI escapes). On a TTY the
   * current input line clears first, so output never lands after the prompt.
   * @param text - the text to write.
   */
  write(text: string): void {
    if (text === '') return
    if (this.isTTY) this.stream.write('\r\u001b[K')
    this.stream.write(text)
  }

  /**
   * Write one complete line.
   * @param text - line content (no newline).
   */
  print(text = ''): void {
    this.write(text + '\n')
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

  /**
   * Write raw control bytes without the automatic current-line clear. The
   * hint-line cursor save/restore dance is one atomic sequence and must not
   * clear the input line it departs from.
   * @param text - the raw control sequence.
   */
  raw(text: string): void {
    if (text === '') return
    this.stream.write(text)
  }

  /** Clear the current line (raw ANSI; no-op when the stream is not a TTY). */
  clearLine(): void {
    if (!this.isTTY) return
    this.stream.write('\r\u001b[K')
  }

  /**
   * Write streamed mid-line text: clears the current input line first so the
   * streamed run never lands after the prompt, then writes the text. The
   * caller redraws the prompt afterwards.
   * @param text - the text to write.
   */
  writeStream(text: string): void {
    // Identical clearing semantics to write(); the separate method documents
    // the streaming call site's contract (the caller redraws the prompt).
    this.write(text)
  }
}
