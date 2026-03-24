import { describe, it, expect, vi } from 'vitest'
import { encodeMessage, decodeMessages, createNativeMessagingTransport } from '../src/native-messaging'
import type { NativeMessage } from '@runeai/core'
import { PassThrough } from 'node:stream'

describe('encodeMessage', () => {
  it('encodes JSON with 4-byte LE length prefix', () => {
    const msg = { type: 'session_open', tabId: 1, url: 'https://example.com', title: 'Test' }
    const encoded = encodeMessage(msg)

    // First 4 bytes are the length prefix (little-endian)
    const jsonStr = JSON.stringify(msg)
    const expectedLength = Buffer.byteLength(jsonStr, 'utf-8')

    expect(encoded.length).toBe(4 + expectedLength)
    expect(encoded.readUInt32LE(0)).toBe(expectedLength)

    // The rest is the JSON payload
    const payload = encoded.subarray(4).toString('utf-8')
    expect(JSON.parse(payload)).toEqual(msg)
  })
})

describe('decodeMessages', () => {
  it('decodes a single message from buffer', () => {
    const msg: NativeMessage = { type: 'session_open', tabId: 1, url: 'https://example.com', title: 'Test' }
    const encoded = encodeMessage(msg)

    const { messages, remaining } = decodeMessages(encoded)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(msg)
    expect(remaining.length).toBe(0)
  })

  it('handles partial messages (returns remaining buffer)', () => {
    const msg: NativeMessage = { type: 'session_close', tabId: 2 }
    const encoded = encodeMessage(msg)

    // Chop off the last 3 bytes to simulate a partial message
    const partial = encoded.subarray(0, encoded.length - 3)

    const { messages, remaining } = decodeMessages(partial)

    expect(messages).toHaveLength(0)
    expect(remaining.length).toBe(partial.length)
  })

  it('handles buffer with only partial length prefix', () => {
    // Only 2 bytes — not enough for even the 4-byte header
    const partial = Buffer.alloc(2)

    const { messages, remaining } = decodeMessages(partial)

    expect(messages).toHaveLength(0)
    expect(remaining.length).toBe(2)
  })

  it('decodes multiple messages from a single buffer', () => {
    const msg1: NativeMessage = { type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A' }
    const msg2: NativeMessage = { type: 'session_close', tabId: 1 }
    const msg3: NativeMessage = { type: 'config_update', config: {} }

    const encoded = Buffer.concat([encodeMessage(msg1), encodeMessage(msg2), encodeMessage(msg3)])

    const { messages, remaining } = decodeMessages(encoded)

    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual(msg1)
    expect(messages[1]).toEqual(msg2)
    expect(messages[2]).toEqual(msg3)
    expect(remaining.length).toBe(0)
  })

  it('decodes complete messages and returns leftover as remaining', () => {
    const msg1: NativeMessage = { type: 'session_open', tabId: 1, url: 'https://a.com', title: 'A' }
    const msg2: NativeMessage = { type: 'session_close', tabId: 1 }

    const encoded1 = encodeMessage(msg1)
    const encoded2 = encodeMessage(msg2)

    // Concatenate both but chop off last 5 bytes of msg2
    const combined = Buffer.concat([encoded1, encoded2])
    const partial = combined.subarray(0, combined.length - 5)

    const { messages, remaining } = decodeMessages(partial)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(msg1)
    expect(remaining.length).toBe(encoded2.length - 5)
  })
})

describe('createNativeMessagingTransport', () => {
  it('sends encoded messages to output stream', () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createNativeMessagingTransport(input, output)

    const msg: NativeMessage = { type: 'session_close', tabId: 1 }
    transport.send(msg)

    const written = output.read() as Buffer
    expect(written).not.toBeNull()

    const { messages } = decodeMessages(written)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(msg)
  })

  it('receives decoded messages from input stream', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createNativeMessagingTransport(input, output)

    const received: NativeMessage[] = []
    transport.onMessage((msg) => received.push(msg))

    const msg: NativeMessage = { type: 'session_open', tabId: 42, url: 'https://test.com', title: 'Hi' }
    input.write(encodeMessage(msg))

    // Give the stream a tick to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(msg)
  })

  it('handles chunked data across multiple writes', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createNativeMessagingTransport(input, output)

    const received: NativeMessage[] = []
    transport.onMessage((msg) => received.push(msg))

    const msg: NativeMessage = { type: 'session_close', tabId: 7 }
    const encoded = encodeMessage(msg)

    // Split into two chunks
    const mid = Math.floor(encoded.length / 2)
    input.write(encoded.subarray(0, mid))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(received).toHaveLength(0) // not yet complete

    input.write(encoded.subarray(mid))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(msg)
  })
})
