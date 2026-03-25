import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  installPageAgentRuntime: vi.fn(),
}))

vi.mock('@agrune/build-core/runtime', () => ({
  installPageAgentRuntime: mocks.installPageAgentRuntime,
}))

function dispatchBridgeMessage(type: string, data: unknown) {
  const event = new MessageEvent('message', {
    data: {
      source: '__agrune_bridge__',
      payload: { type, data },
    },
  })
  Object.defineProperty(event, 'source', {
    configurable: true,
    value: window,
  })
  window.dispatchEvent(event)
}

describe('page runtime bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).agruneDom
  })

  it('defers init_runtime while busy and reapplies the latest manifest when runtime becomes idle', async () => {
    let busy = true
    ;(window as any).agruneDom = {
      isBusy: () => busy,
      isActive: () => true,
    }

    mocks.installPageAgentRuntime.mockImplementation((manifest: unknown, options: unknown) => {
      ;(window as any).agruneDom = {
        isBusy: () => false,
        isActive: () => false,
      }
      return { manifest, options }
    })

    const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)

    await import('../src/runtime/page-runtime')

    dispatchBridgeMessage('init_runtime', { manifest: { version: 1 }, options: { cursorName: 'a' } })
    dispatchBridgeMessage('init_runtime', { manifest: { version: 2 }, options: { cursorName: 'b' } })

    expect(mocks.installPageAgentRuntime).not.toHaveBeenCalled()

    busy = false
    await vi.advanceTimersByTimeAsync(50)

    expect(mocks.installPageAgentRuntime).toHaveBeenCalledTimes(1)
    expect(mocks.installPageAgentRuntime).toHaveBeenCalledWith(
      { version: 2 },
      { cursorName: 'b' },
    )
    expect(
      postMessageSpy.mock.calls.some(([message]) =>
        (message as { payload?: { type?: string } })?.payload?.type === 'runtime_ready'),
    ).toBe(true)

    postMessageSpy.mockRestore()
  })
})
