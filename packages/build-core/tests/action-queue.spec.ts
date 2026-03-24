import { describe, expect, it, vi } from 'vitest'
import {
  ActionQueue,
  createAnimationBlock,
  createDelayBlock,
  type Block,
} from '../src/runtime/action-queue'

function delayBlock(ms: number, spy?: () => void): Block {
  return {
    type: 'delay',
    execute: () =>
      new Promise<void>(resolve => {
        spy?.()
        setTimeout(resolve, ms)
      }),
  }
}

describe('ActionQueue', () => {
  describe('basic FIFO processing', () => {
    it('processes a single block and push() resolves', async () => {
      const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
      const spy = vi.fn()

      await queue.push(delayBlock(0, spy))

      expect(spy).toHaveBeenCalledOnce()
    })

    it('processes blocks in FIFO order', async () => {
      const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
      const order: number[] = []

      const p1 = queue.push(delayBlock(0, () => order.push(1)))
      const p2 = queue.push(delayBlock(0, () => order.push(2)))
      const p3 = queue.push(delayBlock(0, () => order.push(3)))

      await Promise.all([p1, p2, p3])

      expect(order).toEqual([1, 2, 3])
    })

    it('reports correct length', () => {
      const queue = new ActionQueue({ idleTimeoutMs: 5_000 })

      expect(queue.length).toBe(0)

      queue.push(delayBlock(10_000))
      queue.push(delayBlock(10_000))

      expect(queue.length).toBe(1)
      expect(queue.processing).toBe(true)

      queue.dispose()
    })

    it('push() resolves only when its specific block completes', async () => {
      vi.useFakeTimers()

      try {
        const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
        let firstDone = false
        let secondDone = false

        const p1 = queue.push(delayBlock(100)).then(() => {
          firstDone = true
        })
        const p2 = queue.push(delayBlock(100)).then(() => {
          secondDone = true
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(firstDone).toBe(true)
        expect(secondDone).toBe(false)

        await vi.advanceTimersByTimeAsync(100)
        expect(secondDone).toBe(true)

        await Promise.all([p1, p2])
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('idle timer', () => {
    it('calls onDeactivate after idle timeout when queue drains', async () => {
      vi.useFakeTimers()

      try {
        const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
        const onDeactivate = vi.fn()
        queue.onDeactivate = onDeactivate

        queue.push(delayBlock(0))
        await vi.advanceTimersByTimeAsync(0)

        expect(onDeactivate).not.toHaveBeenCalled()

        vi.advanceTimersByTime(4_999)
        expect(onDeactivate).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(onDeactivate).toHaveBeenCalledOnce()
        expect(queue.active).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('resets idle timer when new block is pushed during idle period', async () => {
      vi.useFakeTimers()

      try {
        const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
        const onDeactivate = vi.fn()
        queue.onDeactivate = onDeactivate

        queue.push(delayBlock(0))
        await vi.advanceTimersByTimeAsync(0)

        vi.advanceTimersByTime(3_000)
        expect(onDeactivate).not.toHaveBeenCalled()

        queue.push(delayBlock(0))
        await vi.advanceTimersByTimeAsync(0)

        vi.advanceTimersByTime(3_000)
        expect(onDeactivate).not.toHaveBeenCalled()

        vi.advanceTimersByTime(2_000)
        expect(onDeactivate).toHaveBeenCalledOnce()
      } finally {
        vi.useRealTimers()
      }
    })

    it('calls onActivate only on first push (not on subsequent pushes)', () => {
      const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
      const onActivate = vi.fn()
      queue.onActivate = onActivate

      queue.push(delayBlock(10_000))
      queue.push(delayBlock(10_000))

      expect(onActivate).toHaveBeenCalledOnce()

      queue.dispose()
    })
  })

  describe('pause / resume (agent lock)', () => {
    it('does not process blocks while paused', async () => {
      const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
      const spy = vi.fn()

      queue.pause()
      queue.push(delayBlock(0, spy))

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(spy).not.toHaveBeenCalled()
      expect(queue.length).toBe(1)

      queue.dispose()
    })

    it('resumes processing after resume()', async () => {
      const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
      const spy = vi.fn()

      queue.pause()
      const promise = queue.push(delayBlock(0, spy))

      expect(spy).not.toHaveBeenCalled()

      queue.resume()
      await promise

      expect(spy).toHaveBeenCalledOnce()
    })

    it('starts idle timer on resume when queue is empty', async () => {
      vi.useFakeTimers()

      try {
        const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
        const onDeactivate = vi.fn()
        queue.onDeactivate = onDeactivate

        queue.push(delayBlock(0))
        await vi.advanceTimersByTimeAsync(0)

        queue.pause()
        vi.advanceTimersByTime(10_000)
        expect(onDeactivate).not.toHaveBeenCalled()

        queue.resume()
        vi.advanceTimersByTime(5_000)
        expect(onDeactivate).toHaveBeenCalledOnce()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not start idle timer while paused even if queue is empty', async () => {
      vi.useFakeTimers()

      try {
        const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
        const onDeactivate = vi.fn()
        queue.onDeactivate = onDeactivate

        let release: (() => void) | null = null
        queue.push({
          type: 'delay',
          execute: () =>
            new Promise<void>(resolve => {
              release = resolve
            }),
        })
        queue.pause()
        release?.()
        await Promise.resolve()
        vi.advanceTimersByTime(10_000)
        expect(onDeactivate).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('dispose', () => {
    it('clears blocks and cancels idle timer', () => {
      vi.useFakeTimers()

      try {
        const queue = new ActionQueue({ idleTimeoutMs: 5_000 })
        const onDeactivate = vi.fn()
        queue.onDeactivate = onDeactivate

        queue.push(delayBlock(10_000))
        queue.push(delayBlock(10_000))
        queue.dispose()

        expect(queue.length).toBe(0)
        expect(queue.active).toBe(false)

        vi.advanceTimersByTime(10_000)
        expect(onDeactivate).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

describe('block factories', () => {
  it('createDelayBlock waits for specified duration', async () => {
    vi.useFakeTimers()

    try {
      const block = createDelayBlock(1_000)

      expect(block.type).toBe('delay')

      let resolved = false
      const promise = block.execute().then(() => {
        resolved = true
      })

      await vi.advanceTimersByTimeAsync(999)
      expect(resolved).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      expect(resolved).toBe(true)

      await promise
    } finally {
      vi.useRealTimers()
    }
  })

  it('createAnimationBlock stores target coords and runs callback', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const block = createAnimationBlock({ x: 320, y: 480 }, spy)

    expect(block.type).toBe('animation')
    expect(block.target).toEqual({ x: 320, y: 480 })

    await block.execute()

    expect(spy).toHaveBeenCalledOnce()
  })
})
