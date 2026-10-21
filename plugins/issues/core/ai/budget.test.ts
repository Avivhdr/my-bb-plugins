import { describe, expect, it } from 'vitest'
import { AI_BUDGET_MS, HOST_DEADLINE_MS } from './budget'

// The per-transport ceilings are derived from AI_BUDGET_MS. These guard the arithmetic
// that keeps every attempt, retries included, inside the deadline.
describe('the Refine time budget', () => {
  it('leaves the host deadline room for the surrounding work', () => {
    expect(AI_BUDGET_MS).toBeLessThan(HOST_DEADLINE_MS)
  })

  it('keeps the dialog wait at 30 seconds', () => {
    expect(HOST_DEADLINE_MS).toBe(30_000)
  })

  // Groq splits the budget across a primary and a backup model. Both attempts have to
  // land inside it, or the fallback can never deliver and is pure cost.
  it('still fits when split across two attempts', () => {
    expect(Math.floor(AI_BUDGET_MS / 2) * 2).toBeLessThan(HOST_DEADLINE_MS)
  })
})
