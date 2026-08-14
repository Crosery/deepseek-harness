/**
 * Minimal incremental markdown-to-ANSI renderer for the terminal plane.
 * Line-oriented: each completed line is rendered independently with a small
 * persistent block-state machine, so streaming deltas render exactly like
 * replayed text. Unsupported constructs degrade to readable plain text.
 * @module @deepseek-ai/dsh-client-terminal/markdown
 */

import { ansiEnabled, sgr, SGR } from './ansi.ts'

/** Render one inline span: strong, emphasis, and inline code. */
function renderInline(text: string): string {
  if (!ansiEnabled) return text
  return text
    .replace(/\*\*([^*]+)\*\*/g, (_, body: string) => sgr(SGR.bold, body))
    .replace(/(^|[^*])\*([^*]+)\*/g, (_, lead: string, body: string) => lead + sgr(SGR.italic, body))
    .replace(/`([^`]+)`/g, (_, body: string) => sgr(SGR.cyan, body))
}

/** Persistent per-stream block state for the incremental renderer. */
interface BlockState {
  /** Whether the next line continues a fenced code block. */
  inFence: boolean
  /** The fence info string of the open block. */
  fenceInfo: string
}

/**
 * Incremental line renderer. Feed completed lines in order through
 * {@link renderLine}; the fence state survives across calls, so a streamed
 * document renders identically to a replayed one.
 */
export class AnsiMarkdown {
  private readonly state: BlockState = { inFence: false, fenceInfo: '' }

  /**
   * Render one completed source line.
   * @param line - one raw markdown line (no trailing newline).
   * @returns the ANSI rendering of that line.
   */
  renderLine(line: string): string {
    if (this.state.inFence) {
      if (/^s*```/.test(line)) {
        this.state.inFence = false
        this.state.fenceInfo = ''
        return ansiEnabled ? sgr(SGR.dim, '--') : ''
      }
      return ansiEnabled ? sgr(SGR.dim, line) : line
    }
    const fence = /^s*(```|~~~)(.*)$/.exec(line)
    if (fence !== null) {
      this.state.inFence = true
      this.state.fenceInfo = (fence[2] ?? '').trim()
      const label = this.state.fenceInfo === '' ? 'code' : this.state.fenceInfo
      return ansiEnabled ? sgr(SGR.dim, '-- ' + label) : '-- ' + label
    }
    const heading = /^(#{1,4})s+(.*)$/.exec(line)
    if (heading !== null) {
      return ansiEnabled ? sgr(SGR.bold, heading[2] ?? '') : (heading[2] ?? '')
    }
    if (/^s{0,3}([-*+])s+/.test(line)) {
      return '  • ' + renderInline(line.replace(/^s{0,3}[-*+]s+/, ''))
    }
    if (/^s*d+.s+/.test(line)) {
      return '  ' + renderInline(line.trim())
    }
    if (/^s*>/.test(line)) {
      return renderInline(line.replace(/^s*>s?/, '  │ '))
    }
    if (/^s{0,3}(---+|===+)s*$/.test(line)) {
      return ansiEnabled ? sgr(SGR.dim, '────────') : '--------'
    }
    return renderInline(line)
  }

  /** Reset the block state (new document or re-render from scratch). */
  reset(): void {
    this.state.inFence = false
    this.state.fenceInfo = ''
  }
}

/**
 * Convenience whole-text renderer (non-incremental).
 * @param text - complete markdown text.
 * @returns its ANSI rendering.
 */
export function renderMarkdown(text: string): string {
  const renderer = new AnsiMarkdown()
  return text.split('\n').map(line => renderer.renderLine(line)).join('\n')
}
