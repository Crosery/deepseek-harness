/**
 * Shared current-session binding for terminal feature plugins: tracks the
 * sessions list store's current selection and hands each change (and each
 * initial state) to the listener as a session face or undefined.
 * @module @deepseek-ai/dsh-client-terminal/session-binding
 */

import type { SessionFace, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client-node'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Subscribe to the current session selection.
 * @param sessions - the client sessions service.
 * @param listener - called with the bound face on every change; undefined when none.
 * @returns disposer removing the subscription.
 */
export function subscribeCurrentSession(
  sessions: SessionRuntime,
  listener: (face: SessionFace | undefined) => void,
): () => void {
  let currentId: SessionId | undefined
  let unsubscribe: (() => void) | undefined
  const bind = (id: SessionId | undefined): void => {
    if (unsubscribe !== undefined) {
      unsubscribe()
      unsubscribe = undefined
    }
    if (id === undefined) {
      listener(undefined)
      return
    }
    const binding = sessions.binding(id)
    if (binding === undefined) {
      listener(undefined)
      return
    }
    listener(binding.session)
  }
  const dispose = sessions.list.subscribe(() => {
    const next = sessions.list.getSnapshot().current
    if (next === currentId) return
    currentId = next
    bind(next)
  })
  currentId = sessions.list.getSnapshot().current
  bind(currentId)
  return () => {
    dispose()
    if (unsubscribe !== undefined) unsubscribe()
    unsubscribe = undefined
  }
}
