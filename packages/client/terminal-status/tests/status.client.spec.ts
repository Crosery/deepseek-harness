import { describe, expect, it } from 'vitest'
import { statusParts } from '../src/client/index.ts'

describe('status line parts', () => {
  it('is empty for idle state', () => {
    expect(statusParts(null, null, [], [])).toEqual([])
  })

  it('shows an active goal with a truncated objective', () => {
    expect(statusParts({ phase: 'active', objective: 'build the cli' }, null, [], [])).toEqual(['goal: active "build the cli"'])
  })

  it('ignores idle and complete goals', () => {
    expect(statusParts({ phase: 'idle' }, null, [], [])).toEqual([])
    expect(statusParts({ phase: 'complete' }, null, [], [])).toEqual([])
  })

  it('shows a blocked reason', () => {
    expect(statusParts({ phase: 'blocked', blockedReason: { code: 'NO_KEY', message: 'm' } }, null, [], [])).toEqual(['goal: blocked', 'blocked: NO_KEY'])
  })

  it('shows plan mode', () => {
    expect(statusParts(null, { active: true }, [], [])).toEqual(['plan mode'])
    expect(statusParts(null, { active: false }, [], [])).toEqual([])
  })

  it('shows job and subagent counts', () => {
    const jobs = [{ id: 'j1', kind: 'bash', label: 'x', status: 'running' }, { id: 'j2', kind: 'bash', label: 'y', status: 'completed' }]
    expect(statusParts(null, null, jobs, [{ label: 's1' }])).toEqual(['jobs: 1 running / 2 total', 'subagents: 1'])
  })
})
