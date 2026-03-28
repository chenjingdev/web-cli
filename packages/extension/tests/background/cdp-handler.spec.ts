import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCdpHandler, CdpAttachError } from '../../src/background/cdp-handler'
import { createChromeMock } from './chrome-mock'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createCdpHandler', () => {
  it('lazy-attaches on first CDP request', async () => {
    const { chromeMock } = createChromeMock()
    const handler = createCdpHandler({ api: chromeMock })
    handler.register()

    await handler.handleRequest(42, 'DOM.getDocument', {})

    expect(chromeMock.debugger.attach).toHaveBeenCalledWith({ tabId: 42 }, '1.3')
  })

  it('reuses existing attachment on subsequent requests', async () => {
    const { chromeMock } = createChromeMock()
    const handler = createCdpHandler({ api: chromeMock })
    handler.register()

    await handler.handleRequest(42, 'DOM.getDocument', {})
    await handler.handleRequest(42, 'DOM.getDocument', {})

    expect(chromeMock.debugger.attach).toHaveBeenCalledTimes(1)
  })

  it('forwards CDP method to chrome.debugger.sendCommand', async () => {
    const { chromeMock } = createChromeMock()
    const handler = createCdpHandler({ api: chromeMock })
    handler.register()

    const params = { depth: 3 }
    await handler.handleRequest(42, 'DOM.getDocument', params)

    expect(chromeMock.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 42 }, 'DOM.getDocument', params)
  })

  it('detaches on tab removal', async () => {
    const mock = createChromeMock()
    const handler = createCdpHandler({ api: mock.chromeMock })
    handler.register()

    await handler.handleRequest(42, 'DOM.getDocument', {})
    mock.emitTabRemoved(42)

    expect(mock.chromeMock.debugger.detach).toHaveBeenCalledWith({ tabId: 42 })
    expect(handler.isAttached(42)).toBe(false)
  })

  it('cleans up on debugger detach event', async () => {
    const mock = createChromeMock()
    const handler = createCdpHandler({ api: mock.chromeMock })
    handler.register()

    await handler.handleRequest(42, 'DOM.getDocument', {})
    expect(handler.isAttached(42)).toBe(true)

    mock.emitDebuggerDetach({ tabId: 42 })

    expect(handler.isAttached(42)).toBe(false)
  })

  it('throws CdpAttachError when attach fails', async () => {
    const { chromeMock } = createChromeMock()
    const attachMock = chromeMock.debugger.attach as ReturnType<typeof vi.fn>
    attachMock.mockRejectedValueOnce(new Error('Cannot attach to target'))

    const handler = createCdpHandler({ api: chromeMock })
    handler.register()

    const rejection = handler.handleRequest(42, 'DOM.getDocument', {})
    await expect(rejection).rejects.toThrow(CdpAttachError)
    await expect(rejection).rejects.toThrow('CDP attach failed: Cannot attach to target')
  })

  it('relays Input.dragIntercepted events to tab', async () => {
    const mock = createChromeMock()
    const handler = createCdpHandler({ api: mock.chromeMock })
    handler.register()

    const dragParams = { data: { items: [] } }
    mock.emitDebuggerEvent({ tabId: 42 }, 'Input.dragIntercepted', dragParams)

    expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: 'cdp_event',
      method: 'Input.dragIntercepted',
      params: dragParams,
    })
  })

  it('does not relay non-dragIntercepted events to tab', () => {
    const mock = createChromeMock()
    const handler = createCdpHandler({ api: mock.chromeMock })
    handler.register()

    mock.emitDebuggerEvent({ tabId: 42 }, 'Network.responseReceived', {})

    expect(mock.chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('exposes ensureAttached that attaches debugger without sending a command', async () => {
    const { chromeMock } = createChromeMock()
    const handler = createCdpHandler({ api: chromeMock })
    handler.register()

    await handler.ensureAttached(42)

    expect(chromeMock.debugger.attach).toHaveBeenCalledWith({ tabId: 42 }, '1.3')
    expect(chromeMock.debugger.sendCommand).not.toHaveBeenCalled()
    expect(handler.isAttached(42)).toBe(true)
  })

  it('ensureAttached is idempotent — second call does not re-attach', async () => {
    const { chromeMock } = createChromeMock()
    const handler = createCdpHandler({ api: chromeMock })
    handler.register()

    await handler.ensureAttached(42)
    await handler.ensureAttached(42)

    expect(chromeMock.debugger.attach).toHaveBeenCalledTimes(1)
  })
})
