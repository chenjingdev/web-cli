import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BRIDGE_MESSAGE_KEY,
  createBridgeMessage,
  isBridgeMessage,
  setupBridge,
  sendToBridge,
} from '../src/content/bridge'

describe('createBridgeMessage', () => {
  it('produces correct envelope with source key', () => {
    const msg = createBridgeMessage('command', { foo: 1 })
    expect(msg).toEqual({
      source: BRIDGE_MESSAGE_KEY,
      payload: { type: 'command', data: { foo: 1 } },
    })
  })

  it('includes the constant bridge key as source', () => {
    const msg = createBridgeMessage('test', null)
    expect(msg.source).toBe('__rune_bridge__')
  })
})

describe('isBridgeMessage', () => {
  it('returns true for valid bridge MessageEvent', () => {
    const event = new MessageEvent('message', {
      data: { source: BRIDGE_MESSAGE_KEY, payload: { type: 'test', data: {} } },
      source: window,
    })
    expect(isBridgeMessage(event)).toBe(true)
  })

  it('returns false when source is not window', () => {
    const event = new MessageEvent('message', {
      data: { source: BRIDGE_MESSAGE_KEY, payload: { type: 'test', data: {} } },
      source: null,
    })
    expect(isBridgeMessage(event)).toBe(false)
  })

  it('returns false when data has wrong source key', () => {
    const event = new MessageEvent('message', {
      data: { source: 'other', payload: { type: 'test', data: {} } },
      source: window,
    })
    expect(isBridgeMessage(event)).toBe(false)
  })

  it('returns false when data is null', () => {
    const event = new MessageEvent('message', {
      data: null,
      source: window,
    })
    expect(isBridgeMessage(event)).toBe(false)
  })

  it('returns false for non-MessageEvent input', () => {
    expect(isBridgeMessage({ random: 'object' })).toBe(false)
    expect(isBridgeMessage(null)).toBe(false)
    expect(isBridgeMessage(undefined)).toBe(false)
  })
})

describe('setupBridge', () => {
  afterEach(() => {
    // Clean up all listeners between tests
    vi.restoreAllMocks()
  })

  it('receives messages posted to window', () => {
    const handler = vi.fn()
    const cleanup = setupBridge(handler)

    // Dispatch a MessageEvent directly (jsdom's postMessage doesn't set event.source)
    const event = new MessageEvent('message', {
      data: { source: BRIDGE_MESSAGE_KEY, payload: { type: 'ping', data: { val: 42 } } },
      source: window,
    })
    window.dispatchEvent(event)

    expect(handler).toHaveBeenCalledWith('ping', { val: 42 })

    cleanup()
  })

  it('ignores messages with wrong source key', () => {
    const handler = vi.fn()
    const cleanup = setupBridge(handler)

    const event = new MessageEvent('message', {
      data: { source: 'other', payload: { type: 'test', data: {} } },
      source: window,
    })
    window.dispatchEvent(event)

    expect(handler).not.toHaveBeenCalled()

    cleanup()
  })

  it('cleanup function removes the listener', () => {
    const handler = vi.fn()
    const cleanup = setupBridge(handler)
    cleanup()

    const event = new MessageEvent('message', {
      data: { source: BRIDGE_MESSAGE_KEY, payload: { type: 'test', data: {} } },
      source: window,
    })
    window.dispatchEvent(event)

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('sendToBridge', () => {
  it('posts message with correct format to window', () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage')

    sendToBridge('hello', { msg: 'world' })

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        source: BRIDGE_MESSAGE_KEY,
        payload: { type: 'hello', data: { msg: 'world' } },
      },
      '*',
    )

    postMessageSpy.mockRestore()
  })
})
