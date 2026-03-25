import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeHostController } from '../../src/background/native-host-controller'
import { createChromeMock } from './chrome-mock'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createNativeHostController', () => {
  it('reuses the same native port until disconnected', () => {
    const chrome = createChromeMock()
    const controller = createNativeHostController({
      api: chrome.chromeMock,
      connectNative: chrome.chromeMock.runtime.connectNative,
      onMessage: vi.fn(),
      onStatusChange: vi.fn(),
    })

    const first = controller.ensureConnected()
    const second = controller.ensureConnected()

    expect(chrome.chromeMock.runtime.connectNative).toHaveBeenCalledTimes(1)
    expect(chrome.port.postMessage).toHaveBeenCalledWith({ type: 'get_status' })
    expect(first).toBe(second)
    expect(controller.getStatus()).toMatchObject({
      hostName: 'com.agrune.agrune',
      phase: 'connected',
      connected: true,
      lastError: null,
    })
  })

  it('transitions to disconnected on clean disconnect and reconnects on demand', () => {
    const chrome = createChromeMock()
    const controller = createNativeHostController({
      api: chrome.chromeMock,
      connectNative: chrome.chromeMock.runtime.connectNative,
      onMessage: vi.fn(),
      onStatusChange: vi.fn(),
    })

    controller.ensureConnected()
    chrome.emitPortDisconnect()

    expect(controller.getStatus()).toMatchObject({
      phase: 'disconnected',
      connected: false,
      lastError: null,
    })

    controller.reconnect()

    expect(chrome.chromeMock.runtime.connectNative).toHaveBeenCalledTimes(2)
    expect(chrome.port.postMessage).toHaveBeenLastCalledWith({ type: 'get_status' })
    expect(controller.getStatus()).toMatchObject({
      phase: 'connected',
      connected: true,
    })
  })

  it('records disconnect errors and exposes them via status', () => {
    const chrome = createChromeMock()
    const controller = createNativeHostController({
      api: chrome.chromeMock,
      connectNative: chrome.chromeMock.runtime.connectNative,
      onMessage: vi.fn(),
      onStatusChange: vi.fn(),
    })

    controller.ensureConnected()
    chrome.emitPortDisconnect('native messaging host not found')

    expect(controller.getStatus()).toMatchObject({
      phase: 'error',
      connected: false,
      lastError: 'native messaging host not found',
    })
  })

  it('forwards host messages to the supplied callback', () => {
    const chrome = createChromeMock()
    const onMessage = vi.fn()
    const controller = createNativeHostController({
      api: chrome.chromeMock,
      connectNative: chrome.chromeMock.runtime.connectNative,
      onMessage,
      onStatusChange: vi.fn(),
    })

    controller.ensureConnected()
    chrome.emitPortMessage({ type: 'agent_activity', active: true })

    expect(onMessage).toHaveBeenCalledWith({ type: 'agent_activity', active: true })
  })

  it('updates cached status from host status responses and allows explicit refresh', () => {
    const chrome = createChromeMock()
    const controller = createNativeHostController({
      api: chrome.chromeMock,
      connectNative: chrome.chromeMock.runtime.connectNative,
      onMessage: vi.fn(),
      onStatusChange: vi.fn(),
    })

    controller.ensureConnected()
    chrome.emitPortMessage({
      type: 'status_response',
      status: {
        hostName: 'com.agrune.agrune',
        phase: 'connected',
        connected: true,
        sessionCount: 2,
        mcpConnected: true,
      },
    })

    expect(controller.getStatus()).toMatchObject({
      phase: 'connected',
      connected: true,
      sessionCount: 2,
      mcpConnected: true,
    })

    controller.requestStatus()
    expect(chrome.port.postMessage).toHaveBeenLastCalledWith({ type: 'get_status' })
  })
})
