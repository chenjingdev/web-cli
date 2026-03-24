import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackgroundMessageRouter } from '../../src/background/message-router'
import { createChromeMock } from './chrome-mock'
import type { NativeHostPhase } from '../../src/background/messages'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createBackgroundMessageRouter', () => {
  it('forwards content-script messages to the native host', () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.runeai.rune',
        phase: 'connected' as NativeHostPhase,
        connected: true,
        lastError: null,
      })),
    }
    const broadcaster = {
      broadcastToAllTabs: vi.fn(),
      sendToTab: vi.fn(),
      broadcastConfig: vi.fn(),
      broadcastAgentActivity: vi.fn(),
      broadcastNativeHostStatus: vi.fn(),
    }

    const router = createBackgroundMessageRouter({
      api: chrome.chromeMock,
      controller,
      broadcaster,
    })
    router.register()

    chrome.emitRuntimeMessage(
      { type: 'session_open', url: 'https://example.com', title: 'Example' },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )
    chrome.emitRuntimeMessage(
      { type: 'snapshot', snapshot: { version: 1 } },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )
    chrome.emitRuntimeMessage(
      { type: 'command_result', commandId: 'cmd-1', result: { ok: true } },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )

    expect(controller.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'session_open',
      tabId: 42,
      url: 'https://example.com',
      title: 'Example',
    })
    expect(controller.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'snapshot_update',
      tabId: 42,
      snapshot: { version: 1 },
    })
    expect(controller.postMessage).toHaveBeenNthCalledWith(3, {
      type: 'command_result',
      tabId: 42,
      commandId: 'cmd-1',
      result: { ok: true },
    })
  })

  it('handles popup status queries, reconnect requests, and config broadcasts', () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.runeai.rune',
        phase: 'disconnected' as NativeHostPhase,
        connected: false,
        lastError: null,
      })),
    }
    const broadcaster = {
      broadcastToAllTabs: vi.fn(),
      sendToTab: vi.fn(),
      broadcastConfig: vi.fn(),
      broadcastAgentActivity: vi.fn(),
      broadcastNativeHostStatus: vi.fn(),
    }

    const router = createBackgroundMessageRouter({
      api: chrome.chromeMock,
      controller,
      broadcaster,
    })
    router.register()

    const statusResponse = chrome.emitRuntimeMessage({ type: 'get_native_host_status' }, {})
    const reconnectResponse = chrome.emitRuntimeMessage({ type: 'reconnect_native_host' }, {})
    chrome.emitRuntimeMessage({ type: 'config_broadcast', config: { autoScroll: false } }, {})

    expect(statusResponse).toHaveBeenCalledWith({
      status: {
        hostName: 'com.runeai.rune',
        phase: 'disconnected',
        connected: false,
        lastError: null,
      },
    })
    expect(controller.requestStatus).toHaveBeenCalledTimes(1)
    expect(controller.reconnect).toHaveBeenCalledTimes(1)
    expect(reconnectResponse).toHaveBeenCalledWith({
      status: {
        hostName: 'com.runeai.rune',
        phase: 'disconnected',
        connected: false,
        lastError: null,
      },
    })
    expect(broadcaster.broadcastConfig).toHaveBeenCalledWith({ autoScroll: false })
  })

  it('forwards tab lifecycle events and native host fan-out messages', () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.runeai.rune',
        phase: 'connected' as NativeHostPhase,
        connected: true,
        lastError: null,
      })),
    }
    const broadcaster = {
      broadcastToAllTabs: vi.fn(),
      sendToTab: vi.fn(),
      broadcastConfig: vi.fn(),
      broadcastAgentActivity: vi.fn(),
      broadcastNativeHostStatus: vi.fn(),
    }

    const router = createBackgroundMessageRouter({
      api: chrome.chromeMock,
      controller,
      broadcaster,
    })
    router.register()

    chrome.emitTabRemoved(7)
    chrome.emitTabUpdated(11, { url: 'https://updated.example', title: 'Updated' })
    router.handleNativeHostMessage({
      type: 'command_request',
      tabId: 13,
      commandId: 'cmd-7',
      command: { kind: 'act' },
    } as never)
    router.handleNativeHostMessage({ type: 'config_update', config: { pointerAnimation: true } } as never)
    router.handleNativeHostMessage({ type: 'agent_activity', active: true } as never)

    expect(controller.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'session_close',
      tabId: 7,
    })
    expect(controller.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'session_open',
      tabId: 11,
      url: 'https://updated.example',
      title: 'Updated',
    })
    expect(broadcaster.sendToTab).toHaveBeenCalledWith(
      13,
      expect.objectContaining({ type: 'command_request', tabId: 13, commandId: 'cmd-7' }),
    )
    expect(broadcaster.broadcastConfig).toHaveBeenCalledWith({ pointerAnimation: true })
    expect(broadcaster.broadcastAgentActivity).toHaveBeenCalledWith(true)
  })
})
