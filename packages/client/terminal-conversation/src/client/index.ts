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
import { ansiEnabled, dsBlue, dsDim, renderBanner, sgr, SGR } from '@deepseek-ai/dsh-client-terminal/client-node'


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

/** Reasoning content of a block list (reasoning blocks only). */
function reasoningOf(blocks: readonly TextCarrying[]): string {
  return blocks
    .filter(block => (block.type ?? block.kind) === 'reasoning')
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
        // A blue block marker keeps the transcript distinct from the raw
        // submitted echo on the prompt line above it.
        terminal.print((ansiEnabled ? dsBlue('▍ ') : '> ') + line)
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
        } else if (block.kind === 'reasoning') {
          // The settled reasoning renders dimmed, one · line per source line
          // (the live stream only ever showed the pulse, so nothing repeats).
          const reasoning = block.text.replace(/^\n+/, '').replace(/\n+$/, '')
          if (reasoning === '') return
          for (const line of reasoning.split('\n')) {
            terminal.print(ansiEnabled ? dsDim('· ' + line) : '· ' + line)
          }
        }
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

  // omp hides the reasoning stream behind a live pulse; the settled block
  // renders dimmed at finalize. The spinner owns one line and clears it when
  // visible text (or the settled state) takes over. Piped runs never animate.
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let spinnerOn = false
  let spinnerFrame = 0
  let spinnerTimer: ReturnType<typeof setInterval> | undefined
  const stopSpinner = (): void => {
    if (!spinnerOn) return
    spinnerOn = false
    if (spinnerTimer !== undefined) {
      clearInterval(spinnerTimer)
      spinnerTimer = undefined
    }
    terminal.clearLine()
  }
  const ensureSpinner = (): void => {
    if (spinnerOn || !terminal.isTTY) return
    spinnerOn = true
    const tick = (): void => {
      const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? '⠋'
      spinnerFrame += 1
      terminal.stream(dsBlue(frame) + ' ' + dsDim('thinking…'))
    }
    tick()
    spinnerTimer = setInterval(tick, 80)
  }

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
    if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
      // Both prefixes open a command line; normalize backslash to slash so
      // the client dispatcher and the host registry see one canonical form.
      const commandLine = trimmed.startsWith('\\') ? '/' + trimmed.slice(1) : trimmed
      // Client-side commands win; unknown ones fall through to the host
      // command registry (plan/goal/compact/permission/feedback/export).
      if (!terminal.dispatchCommand(commandLine)) {
        await face.command(commandLine)
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
      const reasoning = reasoningOf(snapshot.partial.blocks)
      if (text === '' && reasoning.trim() !== '') {
        ensureSpinner()
      } else {
        stopSpinner()
        const fresh = !text.startsWith(partialText)
        if (fresh) {
          if (partialText !== '') terminal.print()
          terminal.markdown.reset()
          for (const line of text.split('\n').slice(0, -1)) {
            if (line === '') terminal.nextLine()
            else terminal.print(terminal.markdown.renderLine(line))
          }
        } else {
          // The delta's first piece completes the line that was streaming;
          // print the whole line (previous tail + fragment), never the lone
          // fragment — the accumulated prefix must survive the rewrite.
          const pieces = text.slice(partialText.length).split('\n')
          if (pieces.length > 1) {
            const previousTail = partialText.slice(partialText.lastIndexOf('\n') + 1)
            const finished = previousTail + (pieces[0] ?? '')
            if (finished === '') terminal.nextLine()
            else terminal.print(terminal.markdown.renderLine(finished))
            for (const line of pieces.slice(1, -1)) {
              // Deltas model their own newlines: an empty completed line only
              // advances the cursor — no cleared blank row between fragments.
              if (line === '') terminal.nextLine()
              else terminal.print(terminal.markdown.renderLine(line))
            }
          }
        }
        // The tail is the full current line (never the raw delta fragment):
        // each rewrite replaces the line with the grown text in place.
        const tail = text.slice(text.lastIndexOf('\n') + 1)
        if (tail !== '') terminal.stream(tail)
        partialText = text
        streamed = { turn: snapshot.partial.turn, step: snapshot.partial.step, text }
      }
    } else {
      stopSpinner()
      if (partialText !== '') {
        partialText = ''
        terminal.print()
      }
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
    // The prompt redraws only at settle points: while a partial streams, the
    // input line stays hidden and the streamed run owns the line.
    if (snapshot.partial === null) terminal.refreshPrompt()
  }

  let bannerShown = false
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
    // The welcome box greets exactly one blank interactive session (never
    // piped or print-mode runs, whose transcript must stay clean). The model
    // line arrives with the catalog fetch, like omp's welcome lists the
    // active model; the box renders either way.
    if (!bannerShown && terminal.isTTY && startup.task === undefined) {
      bannerShown = true
      if (face.getSnapshot().composerPhase === 'blank') {
        const showBanner = (model: string | undefined): void => {
          for (const line of renderBanner(terminal.width, model)) terminal.print(line)
          terminal.print()
          terminal.refreshPrompt()
        }
        void connection.api.sessions.models({ sessionId: id }).then((response) => {
          if (!response.result.ok) {
            showBanner(undefined)
            return
          }
          const models = response.result.value
          const current = models.current
          const entry = models.groups
            .flatMap(group => group.models.map(item => ({ provider: group.id, item })))
            .find(candidate => candidate.provider === current.provider && candidate.item.id === current.model)
          showBanner(entry === undefined
            ? current.provider + ':' + current.model
            : current.provider + ':' + (entry.item.name === entry.item.id ? entry.item.id : entry.item.name))
        }).catch(() => { showBanner(undefined) })
      }
    }
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
    terminal.setPrompt(ansiEnabled ? dsBlue('❯ ') : '❯ ')
  }
}
