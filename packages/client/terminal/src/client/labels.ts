/**
 * Shared tool-call labeling for the terminal plane: one-line call/result
 * headers mirroring the call intent the web renders (the view title for
 * terminal/diff/generic cards, or a compact preview of the salient JSON
 * argument).
 * @module @deepseek-ai/dsh-client-terminal/labels
 */

/** The argument fields a preview prefers, in order. */
const PREVIEW_FIELDS = ['command', 'input', 'file_path', 'path', 'pattern', 'query', 'prompt', 'url', 'message'] as const

/** Cap for one previewed argument (the session log keeps the full text). */
const PREVIEW_CHARS = 80

/**
 * Compact preview of the salient call argument: a preferred string field
 * (command, input, path, pattern, …) or the raw argument text, capped.
 * @param argsRaw - the JSON-encoded call arguments.
 * @returns the preview, or an empty string when nothing is worth showing.
 */
export function argsPreview(argsRaw: string): string {
  const trimmed = argsRaw.trim()
  if (trimmed === '' || trimmed === '{}') return ''
  let parsed: unknown = trimmed
  try { parsed = JSON.parse(trimmed) } catch { /* raw text — preview as-is */ }
  if (typeof parsed === 'string') return cap(parsed)
  if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>
    for (const field of PREVIEW_FIELDS) {
      const value = record[field]
      if (typeof value === 'string' && value !== '') return cap(value)
    }
  }
  return cap(trimmed)
}

function cap(text: string): string {
  return text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS - 1) + '…' : text
}

/**
 * One-line label for a tool call or result header: the call view title
 * (terminal command, diff header, generic label) or the argument preview.
 * @param argsRaw - the JSON-encoded call arguments.
 * @param callView - the host-computed call intent, or null.
 * @returns the label, or an empty string when nothing describes the call.
 */
export function describeToolCall(
  argsRaw: string,
  callView: { card: string; title?: string; description?: string } | null,
): string {
  const title = callView?.title
  if (title !== undefined && title !== '') return title
  return argsPreview(argsRaw)
}
