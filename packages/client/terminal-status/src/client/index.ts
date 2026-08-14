/**
 * Terminal status plugin: prints the live session status line — goal phase
 * and objective, plan mode, background jobs, and subagent count — after each
 * snapshot or list change. All facts come from host projections and the
 * sessions list store, so this plugin issues no RPC of its own.
 * @module @deepseek-ai/dsh-client-terminal-status/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionRuntime, SessionFace } from '@deepseek-ai/dsh-client-runtime/client-node'
import { subscribeCurrentSession } from '@deepseek-ai/dsh-client-terminal/client-node'

/** Stable Cordis plugin name. */
export const name = 'terminal-status'

/** Required services. */
export const inject = ['terminal', 'sessions']

/** Goal projection snapshot (the durable subset the UI reads). */
interface GoalSnapshot {
  phase: string
  objective?: string
  blockedReason?: { code: string; message: string }
}

/** Plan projection snapshot. */
interface PlanSnapshot {
  active: boolean
}

/** Job view from the sessions list mirror. */
interface JobView {
  id: string
  kind: string
  label: string
  status: string
  detail?: string
}

/** Subagent mirror entry. */
interface SubagentMirrorEntry {
  mode?: string
  label?: string
}

/**
 * Status plugin body: bind the current session and print the status line.
 * @param ctx - terminal client cordis context.
 */
export function apply(ctx: Context): void {
  const terminal = ctx.terminal
  const sessions = ctx.get('sessions') as SessionRuntime
  let lastLine: string | undefined
  let unsubscribe: (() => void) | undefined

  const statusLine = (face: SessionFace): string => {
    const parts: string[] = []
    const goal = face.projections.faceOf('goal').getSnapshot() as GoalSnapshot | null | undefined
    if (goal !== null && goal !== undefined && typeof goal.phase === 'string' && goal.phase !== 'idle' && goal.phase !== 'complete') {
      parts.push('goal: ' + goal.phase + (typeof goal.objective === 'string' ? ' "' + goal.objective.slice(0, 60) + '"' : ''))
      if (goal.blockedReason !== undefined) parts.push('blocked: ' + goal.blockedReason.code)
    }
    const plan = face.projections.faceOf('plan').getSnapshot() as PlanSnapshot | null | undefined
    if (plan !== null && plan !== undefined &&  plan.active) parts.push('plan mode')
    const snapshot = sessions.list.getSnapshot()
    const jobs = (snapshot.jobsBySession as Record<string, readonly JobView[]>)[String(face.sessionId)] ?? []
    if (jobs.length > 0) {
      const running = jobs.filter(job => job.status === 'running').length
      parts.push('jobs: ' + String(running) + ' running / ' + String(jobs.length) + ' total')
    }
    const subagentMap = snapshot.subagentsByParent as unknown as Record<string, readonly SubagentMirrorEntry[]>
    const subagents = subagentMap[String(face.sessionId)] ?? []
    if (subagents.length > 0) parts.push('subagents: ' + String(subagents.length))
    return parts.join('  |  ')
  }

  const refresh = (face: SessionFace): void => {
    const line = statusLine(face)
    if (line === lastLine) return
    lastLine = line
    if (line !== '') terminal.status(line)
  }

  const disposeBinding = subscribeCurrentSession(sessions, (face) => {
    if (unsubscribe !== undefined) {
      unsubscribe()
      unsubscribe = undefined
    }
    lastLine = undefined
    if (face === undefined) return
    unsubscribe = face.subscribe(() => { refresh(face) })
    void face.projections.faceOf('goal').subscribe(() => { refresh(face) })
    void face.projections.faceOf('plan').subscribe(() => { refresh(face) })
    refresh(face)
  })
  const disposeList = sessions.list.subscribe(() => {
    const id = sessions.list.getSnapshot().current
    if (id === undefined) return
    const binding = sessions.binding(id)
    if (binding !== undefined) refresh(binding.session)
  })
  ctx.effect(() => () => {
    disposeList()
    disposeBinding()
  }, 'terminal-status: bindings')
}
