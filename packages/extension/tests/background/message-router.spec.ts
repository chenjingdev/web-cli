import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgagruneRuntimeConfig } from '@agrune/core'
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
        hostName: 'com.agrune.agrune',
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
        hostName: 'com.agrune.agrune',
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
        hostName: 'com.agrune.agrune',
        phase: 'disconnected',
        connected: false,
        lastError: null,
      },
    })
    expect(controller.requestStatus).toHaveBeenCalledTimes(1)
    expect(controller.reconnect).toHaveBeenCalledTimes(1)
    expect(reconnectResponse).toHaveBeenCalledWith({
      status: {
        hostName: 'com.agrune.agrune',
        phase: 'disconnected',
        connected: false,
        lastError: null,
      },
    })
    expect(broadcaster.broadcastConfig).toHaveBeenCalledWith({ autoScroll: false })
    expect(chrome.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'config_update',
      config: { autoScroll: false },
    })
  })

  it('forwards tab lifecycle events and native host fan-out messages', async () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.agrune.agrune',
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
    const persistConfig = vi.fn(async (config: Partial<AgagruneRuntimeConfig>): Promise<AgagruneRuntimeConfig> => ({
      autoScroll: true,
      auroraGlow: true,
      auroraTheme: 'light',
      clickDelayMs: 300,
      pointerDurationMs: 600,
      cursorName: 'default',
      pointerAnimation: false,
      ...config,
    }))

    const router = createBackgroundMessageRouter({
      api: chrome.chromeMock,
      controller,
      broadcaster,
      persistConfig,
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
    await Promise.resolve()

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
    expect(persistConfig).toHaveBeenCalledWith({ pointerAnimation: true })
    expect(broadcaster.broadcastConfig).toHaveBeenCalledWith({
      autoScroll: true,
      auroraGlow: true,
      auroraTheme: 'light',
      clickDelayMs: 300,
      pointerDurationMs: 600,
      cursorName: 'default',
      pointerAnimation: true,
    })
    expect(chrome.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'config_update',
      config: {
        autoScroll: true,
        auroraGlow: true,
        auroraTheme: 'light',
        clickDelayMs: 300,
        pointerDurationMs: 600,
        cursorName: 'default',
        pointerAnimation: true,
      },
    })
    expect(broadcaster.broadcastAgentActivity).toHaveBeenCalledWith(true)
  })

  it('forwards snapshots to subscribed devtools panels', () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.agrune.agrune',
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
    const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
    router.register()
    const conn = chrome.emitConnect('devtools-inspector')
    conn.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })
    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'resync' })
    chrome.emitRuntimeMessage(
      { type: 'snapshot', snapshot: { version: 1, targets: [] } },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )
    expect(conn.port.postMessage).toHaveBeenCalledWith({
      type: 'devtools_snapshot',
      tabId: 42,
      snapshot: { version: 1, targets: [] },
    })
    expect(controller.postMessage).toHaveBeenCalledWith({
      type: 'snapshot_update',
      tabId: 42,
      snapshot: { version: 1, targets: [] },
    })
  })

  it('cleans up devtools subscription on port disconnect', () => {
    const chrome = createChromeMock()
    const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
    const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }
    const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
    router.register()
    const conn = chrome.emitConnect('devtools-inspector')
    conn.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })
    conn.emitDisconnect()
    chrome.emitRuntimeMessage(
      { type: 'snapshot', snapshot: { version: 2 } },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )
    expect(conn.port.postMessage).not.toHaveBeenCalled()
  })

  it('cleans up devtools subscription on tab removal', () => {
    const chrome = createChromeMock()
    const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
    const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }
    const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
    router.register()
    const conn = chrome.emitConnect('devtools-inspector')
    conn.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })
    chrome.emitTabRemoved(42)
    chrome.emitRuntimeMessage(
      { type: 'snapshot', snapshot: { version: 3 } },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )
    expect(conn.port.postMessage).not.toHaveBeenCalled()
  })

  it('forwards snapshots to all subscribers for the same tabId', () => {
    const chrome = createChromeMock()
    const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
    const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }
    const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
    router.register()
    const conn1 = chrome.emitConnect('devtools-inspector')
    conn1.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })
    const conn2 = chrome.emitConnect('devtools-inspector')
    conn2.emitMessage({ type: 'subscribe_snapshot', tabId: 42 })
    chrome.emitRuntimeMessage(
      { type: 'snapshot', snapshot: { version: 1 } },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )
    expect(conn1.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'devtools_snapshot', tabId: 42 }))
    expect(conn2.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'devtools_snapshot', tabId: 42 }))
  })

  it('relays highlight_target from devtools port to content script via tabs.sendMessage', () => {
    const chrome = createChromeMock()
    const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
    const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }
    const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
    router.register()
    const conn = chrome.emitConnect('devtools-inspector')
    conn.emitMessage({ type: 'highlight_target', tabId: 42, targetId: 't-1', selector: '[data-agrune-key="login"]' })
    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      { type: 'highlight_target', tabId: 42, targetId: 't-1', selector: '[data-agrune-key="login"]' },
    )
  })

  it('relays clear_highlight from devtools port to content script via tabs.sendMessage', () => {
    const chrome = createChromeMock()
    const controller = { postMessage: vi.fn(), requestStatus: vi.fn(), reconnect: vi.fn(), getStatus: vi.fn(() => ({ hostName: 'com.agrune.agrune', phase: 'connected' as NativeHostPhase, connected: true, lastError: null })) }
    const broadcaster = { broadcastToAllTabs: vi.fn(), sendToTab: vi.fn(), broadcastConfig: vi.fn(), broadcastAgentActivity: vi.fn(), broadcastNativeHostStatus: vi.fn() }
    const router = createBackgroundMessageRouter({ api: chrome.chromeMock, controller, broadcaster })
    router.register()
    const conn = chrome.emitConnect('devtools-inspector')
    conn.emitMessage({ type: 'clear_highlight', tabId: 42 })
    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      { type: 'clear_highlight', tabId: 42 },
    )
  })

  it('routes cdp_request from content script to cdp handler', async () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.agrune.agrune',
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
    const cdpHandler = {
      handleRequest: vi.fn(() => Promise.resolve({ frameId: 0 })),
      detach: vi.fn(),
      detachAll: vi.fn(),
      isAttached: vi.fn(() => false),
      register: vi.fn(),
    }

    const router = createBackgroundMessageRouter({
      api: chrome.chromeMock,
      controller,
      broadcaster,
      cdpHandler,
    })
    router.register()

    chrome.emitRuntimeMessage(
      { type: 'cdp_request', requestId: 'req-1', method: 'Page.enable', params: {} },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )

    expect(cdpHandler.handleRequest).toHaveBeenCalledWith(42, 'Page.enable', {})
  })

  it('routes cdp_response back to content script tab', async () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.agrune.agrune',
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
    const cdpHandler = {
      handleRequest: vi.fn(() => Promise.resolve({ frameId: 0 })),
      detach: vi.fn(),
      detachAll: vi.fn(),
      isAttached: vi.fn(() => false),
      register: vi.fn(),
    }

    const router = createBackgroundMessageRouter({
      api: chrome.chromeMock,
      controller,
      broadcaster,
      cdpHandler,
    })
    router.register()

    chrome.emitRuntimeMessage(
      { type: 'cdp_request', requestId: 'req-2', method: 'Page.enable', params: {} },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )

    await Promise.resolve()

    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: 'cdp_response',
      requestId: 'req-2',
      result: { frameId: 0 },
    })
  })

  it('routes cdp_request error as cdp_response with error', async () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.agrune.agrune',
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
    const cdpHandler = {
      handleRequest: vi.fn(() => Promise.reject(new Error('CDP failed'))),
      detach: vi.fn(),
      detachAll: vi.fn(),
      isAttached: vi.fn(() => false),
      register: vi.fn(),
    }

    const router = createBackgroundMessageRouter({
      api: chrome.chromeMock,
      controller,
      broadcaster,
      cdpHandler,
    })
    router.register()

    chrome.emitRuntimeMessage(
      { type: 'cdp_request', requestId: 'req-3', method: 'Page.enable', params: {} },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    )

    // Two microtask flushes: one for the rejection, one for the catch handler
    await Promise.resolve()
    await Promise.resolve()

    expect(chrome.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: 'cdp_response',
      requestId: 'req-3',
      error: 'CDP failed',
    })
  })

  it('broadcasts resync to all tabs when receiving resync_request from native host', () => {
    const chrome = createChromeMock()
    const controller = {
      postMessage: vi.fn(),
      requestStatus: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => ({
        hostName: 'com.agrune.agrune',
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

    router.handleNativeHostMessage({ type: 'resync_request' } as never)

    expect(broadcaster.broadcastToAllTabs).toHaveBeenCalledWith({ type: 'resync' })
  })
})
