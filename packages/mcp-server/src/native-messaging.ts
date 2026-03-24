import type { NativeMessage } from '@runeai/core'
import type { Readable, Writable } from 'node:stream'

/**
 * Encode a message using Chrome's Native Messaging protocol:
 * 4-byte little-endian length prefix + UTF-8 JSON payload.
 */
export function encodeMessage(msg: unknown): Buffer {
  const json = JSON.stringify(msg)
  const payload = Buffer.from(json, 'utf-8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  return Buffer.concat([header, payload])
}

/**
 * Decode one or more messages from a buffer.
 * Returns decoded messages and any remaining (incomplete) bytes.
 */
export function decodeMessages(
  buffer: Buffer<ArrayBufferLike>,
): { messages: NativeMessage[]; remaining: Buffer<ArrayBufferLike> } {
  const messages: NativeMessage[] = []
  let offset = 0

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)

    if (offset + 4 + length > buffer.length) {
      // Incomplete message — return what's left as remaining
      break
    }

    const json = buffer.subarray(offset + 4, offset + 4 + length).toString('utf-8')
    messages.push(JSON.parse(json) as NativeMessage)
    offset += 4 + length
  }

  return {
    messages,
    remaining: buffer.subarray(offset),
  }
}

export interface NativeMessagingTransport {
  send(msg: NativeMessage): void
  onMessage(listener: (msg: NativeMessage) => void): void
}

/**
 * Create a Native Messaging transport wrapping Node.js readable/writable streams.
 */
export function createNativeMessagingTransport(
  input: Readable,
  output: Writable,
): NativeMessagingTransport {
  const listeners: Array<(msg: NativeMessage) => void> = []
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  input.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    const { messages, remaining } = decodeMessages(buffer)
    buffer = remaining

    for (const msg of messages) {
      for (const listener of listeners) {
        listener(msg)
      }
    }
  })

  return {
    send(msg: NativeMessage): void {
      output.write(encodeMessage(msg))
    },
    onMessage(listener: (msg: NativeMessage) => void): void {
      listeners.push(listener)
    },
  }
}
