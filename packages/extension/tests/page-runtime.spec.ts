import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

// CDP routing tests run first with a single shared import.
describe('page runtime bridge — CDP routing', () => {
  beforeAll(async () => {
    vi.clearAllMocks()
    await import('../src/runtime/page-runtime')
  })

  afterAll(() => {
    delete (window as any).agruneDom
  })

  it('routes cdp_response messages to runtime cdp handler', () => {
    const cdpEvents: CustomEvent[] = []
    const handler = (e: Event) => cdpEvents.push(e as CustomEvent)
    window.addEventListener('agrune:cdp', handler)

    dispatchBridgeMessage('cdp_response', { id: 42, result: { nodeId: 1 } })

    window.removeEventListener('agrune:cdp', handler)

    expect(cdpEvents).toHaveLength(1)
    expect(cdpEvents[0].detail).toEqual({ id: 42, result: { nodeId: 1 } })
  })

  it('routes cdp_event messages to runtime cdp handler', () => {
    const cdpEvents: CustomEvent[] = []
    const handler = (e: Event) => cdpEvents.push(e as CustomEvent)
    window.addEventListener('agrune:cdp', handler)

    dispatchBridgeMessage('cdp_event', { method: 'DOM.documentUpdated', params: {} })

    window.removeEventListener('agrune:cdp', handler)

    expect(cdpEvents).toHaveLength(1)
    expect(cdpEvents[0].detail).toEqual({ method: 'DOM.documentUpdated', params: {} })
  })
})

// init_runtime deferral test uses vi.resetModules() to get a fresh module instance.
// It runs after the CDP tests so the new import (which adds a message listener) is the
// only one that processes init_runtime — the CDP describe's beforeAll import also
// registered a listener, but that earlier module instance has its own pendingInitRuntime
// variable and will also call installPageAgentRuntime. To keep the call-count assertion
// correct we clear mocks here and ensure busy=false only after dispatching.
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

    // At this point neither listener should have called installPageAgentRuntime yet
    // (busy=true blocks all of them).
    expect(mocks.installPageAgentRuntime).not.toHaveBeenCalled()

    busy = false
    await vi.advanceTimersByTimeAsync(50)

    // Both the CDP-describe listener and this test's listener will flush their
    // pendingInitRuntime once the timer fires. The CDP-describe listener has its
    // own module scope with its own pendingInitRuntime set to { version: 2 }, so
    // installPageAgentRuntime will be called twice (once per module instance that
    // received the init_runtime messages). We only assert that our latest manifest
    // was used at least once and that runtime_ready was sent.
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
