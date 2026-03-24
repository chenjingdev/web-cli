import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTabBroadcaster } from '../../src/background/tab-broadcast'
import { createChromeMock } from './chrome-mock'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createTabBroadcaster', () => {
  it('broadcasts to all tabs and ignores per-tab send failures', async () => {
    const chrome = createChromeMock({
      tabs: [{ id: 1 }, { id: 2 }, { id: undefined }],
    })
    ;(chrome.chromeMock.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new Error('missing content script')))

    const broadcaster = createTabBroadcaster(chrome.chromeMock)
    broadcaster.broadcastToAllTabs({ type: 'ping' })

    await Promise.resolve()

    expect(chrome.chromeMock.tabs.query).toHaveBeenCalledWith({}, expect.any(Function))
    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2)
    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenNthCalledWith(1, 1, { type: 'ping' })
    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenNthCalledWith(2, 2, { type: 'ping' })
  })

  it('emits config and status fan-out messages', () => {
    const chrome = createChromeMock({ tabs: [{ id: 9 }] })
    const broadcaster = createTabBroadcaster(chrome.chromeMock)

    broadcaster.broadcastConfig({ pointerAnimation: true })
    broadcaster.broadcastAgentActivity(true)
    broadcaster.broadcastNativeHostStatus({
      hostName: 'com.runeai.rune',
      phase: 'connected',
      connected: true,
      lastError: null,
    })

    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenNthCalledWith(1, 9, {
      type: 'config_update',
      config: { pointerAnimation: true },
    })
    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenNthCalledWith(2, 9, {
      type: 'agent_activity',
      active: true,
    })
    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenNthCalledWith(3, 9, {
      type: 'native_host_status_changed',
      status: {
        hostName: 'com.runeai.rune',
        phase: 'connected',
        connected: true,
        lastError: null,
      },
    })
  })
})
