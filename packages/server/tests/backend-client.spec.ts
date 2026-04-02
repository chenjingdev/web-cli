import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { once } from 'node:events'
import { createBackendClient } from '../src/backend-client'
import { BACKEND_HOST } from '../src/backend-protocol'

const sockets = new Set<Socket>()
let server: Server | null = null

afterEach(async () => {
  for (const socket of sockets) {
    socket.destroy()
  }
  sockets.clear()

  if (server) {
    server.close()
    await once(server, 'close')
    server = null
  }
})

describe('createBackendClient', () => {
  it('handshakes and sends tool calls to the backend', async () => {
    server = createServer((socket) => {
      sockets.add(socket)
      socket.setEncoding('utf8')

      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const msg = JSON.parse(line) as Record<string, unknown>

          if (msg.type === 'backend_handshake') {
            socket.write(JSON.stringify({ type: 'backend_ready', role: 'agent-client' }) + '\n')
            continue
          }

          if (msg.type === 'agent_request') {
            socket.write(JSON.stringify({
              type: 'agent_response',
              requestId: msg.requestId,
              text: JSON.stringify({ name: msg.name, args: msg.args }),
            }) + '\n')
          }
        }
      })
    })

    server.listen(0, BACKEND_HOST)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP server address')
    }

    const client = createBackendClient({ host: BACKEND_HOST, port: address.port, timeoutMs: 500 })
    await expect(client.ping()).resolves.toBeUndefined()
    await expect(client.callTool('agrune_sessions', { tabId: 7 })).resolves.toEqual({
      text: JSON.stringify({ name: 'agrune_sessions', args: { tabId: 7 } }),
    })
  })

  it('surfaces backend errors as rejected promises', async () => {
    server = createServer((socket) => {
      sockets.add(socket)
      socket.setEncoding('utf8')

      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const msg = JSON.parse(line) as Record<string, unknown>

          if (msg.type === 'backend_handshake') {
            socket.write(JSON.stringify({ type: 'backend_ready', role: 'agent-client' }) + '\n')
            continue
          }

          if (msg.type === 'agent_request') {
            socket.write(JSON.stringify({
              type: 'agent_response',
              requestId: msg.requestId,
              text: 'backend exploded',
              isError: true,
            }) + '\n')
          }
        }
      })
    })

    server.listen(0, BACKEND_HOST)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP server address')
    }

    const client = createBackendClient({ host: BACKEND_HOST, port: address.port, timeoutMs: 500 })
    await expect(client.callTool('agrune_snapshot')).resolves.toEqual({
      text: 'backend exploded',
      isError: true,
    })
  })
})
