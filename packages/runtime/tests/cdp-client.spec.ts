// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCdpClient } from '../src/runtime/cdp-client'

function dispatchCdpEvent(detail: unknown) {
  window.dispatchEvent(new CustomEvent('agrune:cdp', { detail }))
}

describe('CdpClient', () => {
  let postMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    postMessage = vi.fn()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends cdp_request via postMessage and resolves on response', async () => {
    const client = createCdpClient(postMessage)

    const promise = client.sendCdpEvent('DOM.getDocument', { depth: 1 })

    // postMessage should have been called with cdp_request
    expect(postMessage).toHaveBeenCalledOnce()
    const [type, data] = postMessage.mock.calls[0] as [string, { requestId: string; method: string; params: Record<string, unknown> }]
    expect(type).toBe('cdp_request')
    expect(data.method).toBe('DOM.getDocument')
    expect(data.params).toEqual({ depth: 1 })
    expect(typeof data.requestId).toBe('string')

    // Simulate response from content script
    dispatchCdpEvent({
      type: 'cdp_response',
      requestId: data.requestId,
      result: { root: { nodeId: 1 } },
    })

    const result = await promise
    expect(result).toEqual({ root: { nodeId: 1 } })

    client.dispose()
  })

  it('rejects on error response', async () => {
    const client = createCdpClient(postMessage)

    const promise = client.sendCdpEvent('DOM.getDocument', {})

    const [, data] = postMessage.mock.calls[0] as [string, { requestId: string }]

    dispatchCdpEvent({
      type: 'cdp_response',
      requestId: data.requestId,
      error: 'No such node',
    })

    await expect(promise).rejects.toThrow('No such node')

    client.dispose()
  })

  it('rejects on timeout (5s)', async () => {
    const client = createCdpClient(postMessage)

    const promise = client.sendCdpEvent('DOM.getDocument', {})

    // Advance time by 5 seconds to trigger timeout
    vi.advanceTimersByTime(5000)

    await expect(promise).rejects.toThrow('CDP request timed out: DOM.getDocument')

    client.dispose()
  })

  it('handles cdp_event for dragIntercepted', () => {
    const client = createCdpClient(postMessage)

    expect(client.getPendingDragData()).toBeNull()

    dispatchCdpEvent({
      type: 'cdp_event',
      method: 'Input.dragIntercepted',
      params: { data: { items: [{ mimeType: 'text/plain', data: 'hello' }] } },
    })

    expect(client.getPendingDragData()).toEqual({
      items: [{ mimeType: 'text/plain', data: 'hello' }],
    })

    client.clearPendingDragData()
    expect(client.getPendingDragData()).toBeNull()

    client.dispose()
  })

  it('cleans up pending map on dispose', async () => {
    const client = createCdpClient(postMessage)

    const promise = client.sendCdpEvent('DOM.getDocument', {})

    client.dispose()

    await expect(promise).rejects.toThrow('CDP client disposed')
  })
})
