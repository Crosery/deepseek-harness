import { describe, expect, it } from 'vitest'
import { approvalAnswerResult, questionAnswerResult } from '../src/client/index.ts'

function wait(kind: 'approval' | 'question', payload: unknown): never {
  return { kind, sessionId: 'session-1', payload } as never
}

describe('interaction answer encoding', () => {
  it('encodes an allowed-once approval', () => {
    const result = approvalAnswerResult(wait('approval', { approvalId: 'a1' }), true)
    expect(result).toEqual({ ok: true, value: { sessionId: 'session-1', approvalId: 'a1', outcome: 'allowed-once' } })
  })

  it('encodes a rejected approval', () => {
    const result = approvalAnswerResult(wait('approval', { approvalId: 'a1' }), false)
    expect(result.value.outcome).toBe('rejected')
  })

  it('encodes option numbers as selected labels', () => {
    const result = questionAnswerResult(wait('question', {
      questions: [{ id: 'q1', question: 'pick', options: [{ label: 'red' }, { label: 'blue' }] }],
    }), '2')
    expect(result).toEqual({
      ok: true,
      value: { sessionId: 'session-1', answer: { answers: [{ id: 'q1', selected: ['blue'] }] } },
    })
  })

  it('encodes comma-separated multi-select labels and falls back to the first option', () => {
    const multi = questionAnswerResult(wait('question', {
      questions: [{ id: 'q1', question: 'pick', options: [{ label: 'red' }, { label: 'blue' }] }],
    }), '1, 2')
    expect(multi?.value.answer.answers[0]?.selected).toEqual(['red', 'blue'])
    const outOfRange = questionAnswerResult(wait('question', {
      questions: [{ id: 'q1', question: 'pick', options: [{ label: 'red' }] }],
    }), '9')
    expect(outOfRange?.value.answer.answers[0]?.selected).toEqual(['red'])
  })

  it('encodes free text as a custom answer', () => {
    const result = questionAnswerResult(wait('question', {
      questions: [{ id: 'q1', question: 'say', options: [{ label: 'red' }] }],
    }), 'my own answer')
    expect(result?.value.answer.answers[0]).toEqual({ id: 'q1', selected: [], custom: 'my own answer' })
  })

  it('answers no questions as undefined', () => {
    expect(questionAnswerResult(wait('question', { questions: [] }), 'x')).toBeUndefined()
  })
})
