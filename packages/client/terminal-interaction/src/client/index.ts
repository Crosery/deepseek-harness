/**
 * Terminal interaction plugin: renders pending host waits (approval requests
 * and ask_user_question prompts) as inline prompts and switches the input
 * line into answer mode until every wait settles. The conversation plugin
 * yields input while a wait is pending (cooperative protocol).
 * @module @deepseek-ai/dsh-client-terminal-interaction/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client-node'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client-node'
import {
  subscribeCurrentSession,
  ansiEnabled, dsBlue, dsDim, sgr, SGR,
} from '@deepseek-ai/dsh-client-terminal/client-node'
import type { TerminalService } from '@deepseek-ai/dsh-client-terminal/client-node'
import type { SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client-node'

/** Stable Cordis plugin name. */
export const name = 'terminal-interaction'

/** Required services. */
export const inject = ['terminal', 'sessions']

/** One rendered prompt line (option list marker). */
function promptLine(terminal: TerminalService, text: string, accent: boolean): void {
  terminal.print(accent && ansiEnabled ? dsBlue('⏸ ' + text) : '⏸ ' + text)
}

/** Render one pending wait's prompt. */
function renderWait(terminal: TerminalService, wait: PendingInteraction): void {
  if (wait.kind === 'approval') {
    const tool = wait.payload.toolName
    const reason = wait.payload.reason ?? ''
    promptLine(terminal, 'Allow ' + tool + (reason === '' ? '' : ' — ' + reason) + '?', true)
    terminal.print(ansiEnabled ? dsDim('  [y] allow once   [n] reject') : '  [y] allow once   [n] reject')
    return
  }
  const questions = wait.payload.questions
  for (const question of questions) {
    promptLine(terminal, question.question, true)
    if (question.options !== undefined && question.options.length > 0) {
      question.options.forEach((option, index) => {
        const label = String(index + 1) + '. ' + option.label
        terminal.print(ansiEnabled ? sgr(SGR.dim, '  ' + label) : '  ' + label)
      })
      terminal.print(ansiEnabled ? sgr(SGR.dim, '  answer: <number>, comma-separated for multi-select, or free text') : '  answer: <number>, comma-separated for multi-select, or free text')
    } else {
      terminal.print(ansiEnabled ? sgr(SGR.dim, '  answer: free text') : '  answer: free text')
    }
  }
}

/** The domain wire result one approval answer encodes. */
export interface ApprovalAnswerResult {
  ok: true
  value: {
    sessionId: PendingInteraction['sessionId']
    approvalId: string
    outcome: 'allowed-once' | 'rejected'
  }
}

/**
 * Encode an approval answer in the domain wire shape (pure).
 * @param wait - the pending approval wait.
 * @param allowed - whether the user allowed the request.
 * @returns the respond() result shell.
 */
export function approvalAnswerResult(wait: PendingInteraction & { kind: 'approval' }, allowed: boolean): ApprovalAnswerResult {
  return {
    ok: true,
    value: {
      sessionId: wait.sessionId,
      approvalId: wait.payload.approvalId,
      outcome: allowed ? 'allowed-once' : 'rejected',
    },
  }
}

/** The domain wire result one question answer encodes, or undefined without questions. */
export interface QuestionAnswerResult {
  ok: true
  value: {
    sessionId: PendingInteraction['sessionId']
    answer: { answers: { id: string; selected: string[]; custom?: string }[] }
  }
}

/**
 * Encode a question answer in the domain wire shape (pure).
 * @param wait - the pending question wait.
 * @param line - the raw answer line.
 * @returns the respond() result shell, or undefined when the wait carries no questions.
 */
export function questionAnswerResult(wait: PendingInteraction & { kind: 'question' }, line: string): QuestionAnswerResult | undefined {
  const questions = wait.payload.questions
  const first = questions[0]
  if (first === undefined) return undefined
  const trimmed = line.trim()
  let selected: string[] = []
  let custom: string | undefined
  if (first.options !== undefined && first.options.length > 0 && /^\d+(\s*,\s*\d+)*$/.test(trimmed)) {
    // The wire answer carries selected option LABELS, not indexes.
    selected = trimmed.split(',').map(part => part.trim()).map((index) => {
      const option = first.options?.[Number(index) - 1]
      return option === undefined ? '' : option.label
    }).filter(label => label !== '')
    if (selected.length === 0) selected = [first.options[0]?.label ?? '']
  } else {
    custom = line
  }
  return {
    ok: true,
    value: {
      sessionId: wait.sessionId,
      answer: { answers: [{ id: first.id, selected, ...(custom === undefined ? {} : { custom }) }] },
    },
  }
}

/**
 * Encode an approval answer and send it through the wait.
 * @param wait - the pending approval wait.
 * @param allowed - whether the user allowed the request.
 */
function approvalAnswer(wait: PendingInteraction & { kind: 'approval' }, allowed: boolean): void {
  void wait.respond(approvalAnswerResult(wait, allowed))
}

/**
 * Encode a question answer and send it through the wait.
 * @param wait - the pending question wait.
 * @param line - the raw answer line.
 */
function questionAnswer(wait: PendingInteraction & { kind: 'question' }, line: string): void {
  const result = questionAnswerResult(wait, line)
  if (result !== undefined) void wait.respond(result)
}

/**
 * Interaction plugin body: bind the current session, render pending waits,
 * and own the input line while any wait is open.
 * @param ctx - terminal client cordis context.
 */
export function apply(ctx: Context): void {
  const terminal = ctx.terminal
  const sessions = ctx.get('sessions') as SessionRuntime
  let unsubscribe: (() => void) | undefined
  let pending: readonly PendingInteraction[] = []

  const refresh = (face: SessionFace): void => {
    const snapshot = face.getSnapshot()
    const next = snapshot.pending
    if (next === pending) return
    pending = next
    if (next.length > 0) {
      for (const wait of next) renderWait(terminal, wait)
      terminal.setPrompt(ansiEnabled ? dsBlue('⏸ ') : '> ')
    } else {
      terminal.setPrompt('❯ ')
    }
  }

  const disposeBinding = subscribeCurrentSession(sessions, (face) => {
    if (unsubscribe !== undefined) {
      unsubscribe()
      unsubscribe = undefined
    }
    pending = []
    if (face === undefined) return
    unsubscribe = face.subscribe(() => { refresh(face) })
    refresh(face)
  })

  terminal.onLine((line) => {
    const wait = pending[0]
    if (wait === undefined) return
    if (wait.kind === 'approval') {
      approvalAnswer(wait, /^y(es)?$/i.test(line.trim()))
    } else {
      questionAnswer(wait, line)
    }
  })

  ctx.effect(() => disposeBinding, 'terminal-interaction: session binding')
}
