import { connect as netConnect } from 'node:net'
import {
  BACKEND_HOST,
  BACKEND_PORT,
  type AgentToolCallResponse,
  type BackendControlMessage,
  type BackendReadyMessage,
} from './backend-protocol.js'
import type { ToolHandlerResult } from './mcp-tools.js'

interface BackendClientOptions {
  host?: string
  port?: number
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 3_000

function nextRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createBackendClient(options: BackendClientOptions = {}) {
  const host = options.host ?? BACKEND_HOST
  const port = options.port ?? BACKEND_PORT
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async ping(): Promise<void> {
      await withAgentConnection(host, port, timeoutMs, async ({ socket }) => {
        socket.end()
      })
    },

    async callTool(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<ToolHandlerResult> {
      return withAgentConnection(host, port, timeoutMs, ({ socket, readNextMessage }) => {
        const requestId = nextRequestId()

        socket.write(JSON.stringify({ type: 'agent_request', requestId, name, args }) + '\n')

        return new Promise<ToolHandlerResult>((resolve, reject) => {
          let settled = false

          const finish = (callback: () => void) => {
            if (settled) return
            settled = true
            callback()
          }

          readNextMessage((message) => {
            if (message.type === 'backend_error') {
              finish(() => reject(new Error(message.message)))
              return
            }

            if (message.type !== 'agent_response' || message.requestId !== requestId) {
              return
            }

            finish(() => {
              socket.end()
              resolve({ text: message.text, ...(message.isError ? { isError: true } : {}) })
            })
          })

          socket.once('close', () => {
            finish(() => reject(new Error('Backend connection closed before tool response')))
          })
        })
      })
    },
  }
}

async function withAgentConnection<T>(
  host: string,
  port: number,
  timeoutMs: number,
  effect: (input: {
    socket: ReturnType<typeof netConnect>
    readNextMessage: (listener: (message: BackendControlMessage) => void) => void
  }) => Promise<T> | T,
): Promise<T> {
  const socket = netConnect(port, host)
  let buffer = ''
  let messageListener: ((message: BackendControlMessage) => void) | null = null

  const readNextMessage = (listener: (message: BackendControlMessage) => void) => {
    messageListener = listener
  }

  const deliver = (message: BackendControlMessage) => {
    messageListener?.(message)
  }

  socket.setEncoding('utf8')

  const handshakeReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for backend handshake'))
      socket.destroy()
    }, timeoutMs)

    socket.once('connect', () => {
      socket.write(JSON.stringify({ type: 'backend_handshake', role: 'agent-client' }) + '\n')
    })

    socket.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue

        let message: BackendControlMessage
        try {
          message = JSON.parse(line) as BackendControlMessage
        } catch {
          continue
        }

        if (message.type === 'backend_ready') {
          clearTimeout(timer)
          resolveHandshake(message, resolve, reject)
          continue
        }

        if (message.type === 'backend_error') {
          clearTimeout(timer)
          reject(new Error(message.message))
          socket.destroy()
          return
        }

        deliver(message)
      }
    })

    socket.once('error', (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  await handshakeReady
  return effect({ socket, readNextMessage })
}

function resolveHandshake(
  message: BackendReadyMessage,
  resolve: () => void,
  reject: (error: Error) => void,
): void {
  if (message.role !== 'agent-client') {
    reject(new Error(`Unexpected backend role: ${message.role}`))
    return
  }
  resolve()
}
