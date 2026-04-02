import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityBlockStack } from '../src/activity-tracker.js'

describe('ActivityBlockStack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps active state while any guard or timed block remains', async () => {
    const transitions: boolean[] = []
    const stack = new ActivityBlockStack((active) => {
      transitions.push(active)
    })

    const guardId = stack.pushGuard('terminal')
    stack.pushTimed('snapshot:tail', 5_000)

    expect(stack.hasActiveBlocks()).toBe(true)
    expect(transitions).toEqual([true])

    stack.release(guardId)
    expect(stack.hasActiveBlocks()).toBe(true)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(stack.hasActiveBlocks()).toBe(false)
    expect(transitions).toEqual([true, false])
  })
})
