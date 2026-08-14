import { describe, expect, it } from 'vitest'
import { subscribeCurrentSession } from '../src/client/session-binding.ts'

interface SessionsDouble {
  list: { subscribe(cb: () => void): () => void; getSnapshot(): { current: string | undefined } }
  binding(id: string): { session: unknown } | undefined
  emit(): void
  setCurrent(next: string | undefined): void
}

function sessionsDouble(binding: (id: string) => { session: unknown } | undefined): SessionsDouble {
  let listener: (() => void) | undefined
  let current: string | undefined
  const double = {
    list: {
      subscribe: (cb: () => void) => { listener = cb; return () => { listener = undefined } },
      getSnapshot: () => ({ current }),
    },
    binding,
    emit: () => { listener?.() },
    setCurrent: (next: string | undefined) => { current = next },
  }
  return double
}

describe('subscribeCurrentSession', () => {
  it('binds the initial selection and follows changes', () => {
    const double = sessionsDouble(id => id === 's1' ? { session: { id: 'face-1' } } : undefined)
    const seen: unknown[] = []
    subscribeCurrentSession(double as never, (face) => { seen.push(face) })
    expect(seen).toEqual([undefined])
    double.setCurrent('s1')
    double.emit()
    expect(seen).toEqual([undefined, { id: 'face-1' }])
    double.setCurrent('s2')
    double.emit()
    expect(seen).toEqual([undefined, { id: 'face-1' }, undefined])
  })

  it('disposes the list subscription and the bound face listener', () => {
    const double = sessionsDouble(id => id === 's1' ? { session: { id: 'face-1' } } : undefined)
    double.setCurrent('s1')
    const seen: unknown[] = []
    const dispose = subscribeCurrentSession(double as never, (face) => { seen.push(face) })
    expect(seen).toEqual([{ id: 'face-1' }])
    dispose()
    double.setCurrent(undefined)
    double.emit()
    expect(seen).toEqual([{ id: 'face-1' }])
  })
})
