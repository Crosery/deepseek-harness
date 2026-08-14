/**
 * Terminal conversation plugin: binds the current session, renders finalized
 * conversation nodes and streaming assistant deltas to the terminal, and
 * dispatches input lines to the session (plain prompts and slash commands).
 * The one-shot print mode sends the startup task once the session opens.
 * @module @deepseek-ai/dsh-client-terminal-conversation/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CliStartupValues } from '@deepseek-ai/dsh-cli-app/startup'
import {
  registerConversationChat,
  type SessionFace,
  type SessionRuntime,
  type ConversationSnapshot,
  type ConversationNode,
} from '@deepseek-ai/dsh-client-runtime/client-node'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client-node'
import type { TerminalService } from '@deepseek-ai/dsh-client-terminal/client-node'
import { ansiEnabled, sgr, SGR } from '@deepseek-ai/dsh-client-terminal/client-node'


/** Stable Cordis plugin name. */
export const name = 'terminal-conversation'

/** Required services. */
export const inject = ['terminal', 'sessions', 'connection', 'cliStartup', 'conversationEvents', 'conversationViews']

/** A block-shaped value that may carry text (ContentBlock or AssistantBlock). */
type TextCarrying = { type?: string; kind?: string; text?: unknown }

/** Text content of a block list (text blocks only). */
function textOf(blocks: readonly TextCarrying[]): string {
  return blocks
    .filter(block => (block.type ?? block.kind) === 'text')
    .map(block => typeof block.text === 'string' ? block.text : '')
    .join('')
}

/** Render one text block as markdown lines. */
function renderBlock(terminal: TerminalService, text: string): void {
  for (const line of text.split('\n')) {
    terminal.print(terminal.markdown.renderLine(line))
  }
}

/** Streamed-partial bookkeeping for duplicate suppression. */
interface StreamedState {
  turn: number
  step: number
  text: string
}

/** Render one finalized conversation node. */
function renderNode(terminal: TerminalService, node: ConversationNode, streamed?: StreamedState): void {
  // Feature plugins own their node kinds (the terminal slot mechanism)
  // the built-ins below render whatever remains.
  if (terminal.renderNode(node.kind, node)) return
  switch (node.kind) {
    case 'user': {
      const text = textOf(node.content)
      if (text.trim() === '') return
      for (const line of text.split('\n')) {
        terminal.print((ansiEnabled ? sgr(SGR.green, '❯ ') : '> ') + line)
      }
      return
    }
    case 'assistant': {
      for (const block of node.blocks) {
        if (block.kind === 'text') {
          // Skip the prefix already streamed as a partial (the model text
          // prints once, not twice).
          let text = block.text
          if (streamed !== undefined && node.turn === streamed.turn && node.step === streamed.step && text.startsWith(streamed.text)) {
            text = text.slice(streamed.text.length)
          }
          if (text !== '') renderBlock(terminal, text)
        } else if (block.kind === 'reasoning') renderBlock(terminal, (ansiEnabled ? sgr(SGR.dim, '· ') : '· ') + block.text)
      }
      return
    }
    case 'tool-result': {
      // Fallback when no tool plugin registered a renderer.
      const name = node.call?.name ?? 'tool'
      terminal.print('⚙ ' + name + (node.isError ? ' ✗' : ' ✓'))
      return
    }
    case 'turn-error': {
      terminal.print(ansiEnabled ? sgr(SGR.brightRed, '✗ ' + node.message) : '✗ ' + node.message)
      return
    }
    case 'turn-max-tokens': {
      terminal.print(ansiEnabled ? sgr(SGR.brightYellow, '⚠ output token limit reached') : '⚠ output token limit reached')
      return
    }
    case 'compaction': {
      terminal.status('↻ context compacted')
      return
    }
    case 'command': {
      terminal.status('⌘ /' + (node.name ?? 'command') + (node.args !== null ? ' ' + node.args : ''))
      return
    }
    case 'context':
    case 'steering':
    case 'model-retry':
    case 'unknown': {
      return
    }
    default: {
      return
    }
  }
}

/**
 * Conversation plugin body: bind the current session, render deltas, and
 * dispatch input. Input handlers register only in interactive mode; print
 * mode sends the startup task and leaves exit to the cli runner.
 * @param ctx - terminal client cordis context.
 */
export function apply(ctx: Context): void {
  const terminal = ctx.terminal
  const sessions = ctx.get('sessions') as SessionRuntime
  const connection = ctx.get('connection') as ConnectionHandle
  const startup = ctx.get('cliStartup') as CliStartupValues

  // The shared business fold: the same event→node definitions and chat
  // snapshot builder the web renders from, registered by the terminal
  // platform too (the registries live in the React-free data layer).
  registerConversationChat(ctx)

  let currentId: SessionId | undefined
  let unsubscribe: (() => void) | undefined
  let printedNodes = 0
  let partialText = ''
  let streamed: StreamedState | undefined
  let lastRunning = false
  let taskSent = false
  let overridesApplied = false
  const earlyLines: string[] = []
  let closing = false
  let workPending = false

  const maybeExit = (): void => {
    if (!closing) return
    if (terminal.busy()) {
      // A client command (e.g. the model picker) is still running; re-check
      // once it settles.
      setTimeout(maybeExit, 50)
      return
    }
    if (currentId === undefined || workPending) return
    const binding = sessions.binding(currentId)
    if (binding === undefined) return
    if (binding.session.getSnapshot().running) return
    process.exit(0)
  }

  const handleLine = async (line: string): Promise<void> => {
    if (currentId === undefined) {
      earlyLines.push(line)
      return
    }
    const binding = sessions.binding(currentId)
    if (binding === undefined) {
      earlyLines.push(line)
      return
    }
    const face = binding.session
    // Answer mode: the interaction plugin owns the line while a host wait
    // (approval or question) is pending.
    if (face.getSnapshot().pending.length > 0) return
    const trimmed = line.trim()
    if (trimmed === '') return
    if (trimmed.startsWith('/')) {
      // Client-side commands win; unknown ones fall through to the host
      // command registry (plan/goal/compact/permission/feedback/export).
      if (!terminal.dispatchCommand(line)) {
        await face.command(line)
      }
    } else {
      workPending = true
      await face.prompt([{ type: 'text', text: line }], 'queue')
    }
  }

  const applyStartupOverrides = (id: SessionId, face: SessionFace): void => {
    if (overridesApplied) return
    overridesApplied = true
    if (startup.permission !== undefined) {
      void face.command('/permission ' + startup.permission)
    }
    if (startup.model !== undefined) {
      const slash = startup.model.indexOf('/')
      const provider = slash >= 0 ? startup.model.slice(0, slash) : 'deepseek-official'
      const model = slash >= 0 ? startup.model.slice(slash + 1) : startup.model
      void connection.api.sessions.selectModel({ sessionId: id, provider, model })
    }
  }

  const renderDelta = (face: SessionFace): void => {
    const snapshot: ConversationSnapshot = face.getSnapshot()
    const nodes = snapshot.nodes
    for (let index = printedNodes; index < nodes.length; index += 1) {
      renderNode(terminal, nodes[index] as ConversationNode, streamed)
    }
    printedNodes = nodes.length
    if (snapshot.partial === null && partialText === '' && streamed !== undefined) streamed = undefined
    if (snapshot.partial !== null) {
      const text = textOf(snapshot.partial.blocks)
      if (text.startsWith(partialText)) {
        const delta = text.slice(partialText.length)
        const lines = delta.split('\n')
        for (const line of lines.slice(0, -1)) {
          terminal.print(terminal.markdown.renderLine(line))
        }
        const tail = lines[lines.length - 1] ?? ''
        if (tail !== '') terminal.write(tail)
      } else {
        if (partialText !== '') terminal.print()
        terminal.markdown.reset()
        for (const line of text.split('\n').slice(0, -1)) {
          terminal.print(terminal.markdown.renderLine(line))
        }
        const tail = text.split('\n').at(-1) ?? ''
        if (tail !== '') terminal.write(tail)
      }
      partialText = text
      streamed = { turn: snapshot.partial.turn, step: snapshot.partial.step, text }
    } else if (partialText !== '') {
      partialText = ''
      terminal.print()
    }
    if (snapshot.running) workPending = false
    if (snapshot.promptError !== null) workPending = false
    if (!snapshot.running && lastRunning) {
      terminal.print()
      if (snapshot.promptError !== null) {
        terminal.print(ansiEnabled ? sgr(SGR.brightRed, '✗ ' + snapshot.promptError.error.message) : '✗ ' + snapshot.promptError.error.message)
      }
      maybeExit()
    }
    lastRunning = snapshot.running
    terminal.refreshPrompt()
  }

  const bindSession = (id: SessionId | undefined): void => {
    if (unsubscribe !== undefined) {
      unsubscribe()
      unsubscribe = undefined
    }
    printedNodes = 0
    partialText = ''
    lastRunning = false
    terminal.markdown.reset()
    if (id === undefined) return
    const binding = sessions.binding(id)
    if (binding === undefined) return
    const face: SessionFace = binding.session
    unsubscribe = face.subscribe(() => { renderDelta(face) })
    renderDelta(face)
    applyStartupOverrides(id, face)
    if (startup.task !== undefined && !taskSent) {
      taskSent = true
      void face.prompt([{ type: 'text', text: startup.task }], 'queue')
    }
    // Lines that arrived before the session bound (piped input, fast typing)
    // replay once a face exists.
    while (earlyLines.length > 0) {
      void handleLine(earlyLines.shift() as string)
    }
    maybeExit()
  }

  sessions.list.subscribe(() => {
    const next = sessions.list.getSnapshot().current
    if (next === currentId) return
    currentId = next
    bindSession(next)
  })
  bindSession(sessions.list.getSnapshot().current)

  if (startup.task === undefined) {
    terminal.onLine(line => handleLine(line))
    terminal.onSigint(() => {
      if (currentId === undefined) return
      const binding = sessions.binding(currentId)
      if (binding === undefined) return
      const face = binding.session
      if (face.getSnapshot().running) {
        void face.cancel()
      } else {
        terminal.close()
      }
    })
    // EOF (piped stdin) or the idle-SIGINT close path: exit once the
    // session bound and any in-flight run quiesced (readline already
    // restored the terminal).
    terminal.onClose(() => {
      closing = true
      maybeExit()
    })
    terminal.setPrompt('❯ ')
  }
}
