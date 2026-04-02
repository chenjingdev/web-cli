#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createServer as createNetServer, connect as netConnect, type Socket } from 'node:net'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { MCP_SERVER_VERSION } from '../src/version.js'

const args = process.argv.slice(2)
const AGRUNE_HOME = join(homedir(), '.agrune')
const PORT_FILE = join(AGRUNE_HOME, 'port')

const { BACKEND_HOST, BACKEND_PORT } = await import('../src/backend-protocol.js')

if (args[0] === '--native-host') {
  // ============================================================
  // Mode: Native Messaging Host (launched by Chrome)
  // Reads Native Messaging from stdin, forwards to singleton backend via TCP
  // Reconnects automatically when backend restarts
  // ============================================================
  const { createNativeMessagingTransport } = await import('../src/native-messaging.js')
  const nativeTransport = createNativeMessagingTransport(process.stdin, process.stdout)

  let sock: Socket | null = null
  let handshakeComplete = false
  let sockBuffer = ''
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const RECONNECT_INTERVAL_MS = 2_000

  function connectToBackend() {
    const port = readBackendPort()
    handshakeComplete = false
    sockBuffer = ''

    const newSock = netConnect(port, BACKEND_HOST)
    sock = newSock
    newSock.setEncoding('utf8')

    newSock.on('connect', () => {
      newSock.write(JSON.stringify({ type: 'backend_handshake', role: 'native-host' }) + '\n')
    })

    newSock.on('data', (chunk) => {
      sockBuffer += chunk
      const lines = sockBuffer.split('\n')
      sockBuffer = lines.pop()!
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line)
            if (parsed.type === 'backend_ready') {
              handshakeComplete = true
              process.stderr.write(`[agrune native-host] connected to backend on port ${port}\n`)
              continue
            }
            if (parsed.type === 'backend_error') {
              process.stderr.write(`[agrune native-host] backend error: ${parsed.message}\n`)
              continue
            }
            nativeTransport.send(parsed)
          } catch {}
        }
      }
    })

    newSock.on('error', (err) => {
      process.stderr.write(`[agrune native-host] connection error: ${err.message}\n`)
    })

    newSock.on('close', () => {
      process.stderr.write('[agrune native-host] disconnected from backend, reconnecting...\n')
      handshakeComplete = false
      sock = null
      scheduleReconnect()
    })
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectToBackend()
    }, RECONNECT_INTERVAL_MS)
  }

  nativeTransport.onMessage((msg) => {
    if (!handshakeComplete || !sock) {
      process.stderr.write('[agrune native-host] backend not ready, dropping message\n')
      return
    }
    sock.write(JSON.stringify(msg) + '\n')
  })

  connectToBackend()
  process.stdin.resume()

} else if (args[0] === '--backend-daemon') {
  // ============================================================
  // Mode: Singleton backend daemon
  // Holds browser/native connection + shared sessions/commands
  // ============================================================
  const { AgruneBackend } = await import('../src/backend.js')
  const backend = new AgruneBackend()
  let nativeSocket: Socket | null = null

  const tcpServer = createNetServer((client) => {
    client.setEncoding('utf8')
    let buffer = ''
    let role: 'agent-client' | 'native-host' | null = null

    const detachNativeSocket = () => {
      if (nativeSocket === client) {
        nativeSocket = null
        backend.setNativeSender(null)
        process.stderr.write('[agrune-backend] native host disconnected\n')
      }
    }

    client.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }

        if (!role) {
          if (
            parsed.type !== 'backend_handshake' ||
            (parsed.role !== 'agent-client' && parsed.role !== 'native-host')
          ) {
            client.write(JSON.stringify({ type: 'backend_error', message: 'backend handshake required' }) + '\n')
            client.destroy()
            return
          }

          role = parsed.role
          client.write(JSON.stringify({ type: 'backend_ready', role }) + '\n')

          if (role === 'native-host') {
            if (nativeSocket && nativeSocket !== client) {
              nativeSocket.destroy()
            }
            nativeSocket = client
            backend.setNativeSender((msg) => {
              if (!client.destroyed) {
                client.write(JSON.stringify(msg) + '\n')
              }
            })
            process.stderr.write('[agrune-backend] native host connected\n')
          }
          continue
        }

        if (role === 'native-host') {
          backend.handleNativeMessage(parsed as never)
          continue
        }

        if (parsed.type !== 'agent_request' || typeof parsed.requestId !== 'string' || typeof parsed.name !== 'string') {
          client.write(JSON.stringify({ type: 'backend_error', message: 'invalid agent request' }) + '\n')
          continue
        }

        void backend.handleToolCall(parsed.name, asRecord(parsed.args)).then((result) => {
          if (!client.destroyed) {
            client.write(JSON.stringify({
              type: 'agent_response',
              requestId: parsed.requestId,
              ...result,
            }) + '\n')
          }
        }).catch((error) => {
          if (!client.destroyed) {
            client.write(JSON.stringify({
              type: 'agent_response',
              requestId: parsed.requestId,
              text: error instanceof Error ? error.message : String(error),
              isError: true,
            }) + '\n')
          }
        })
      }
    })

    client.on('close', detachNativeSocket)
    client.on('error', detachNativeSocket)
  })

  tcpServer.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      process.stderr.write(`[agrune-backend] already running on ${BACKEND_HOST}:${BACKEND_PORT}\n`)
      process.exit(0)
    }
    throw error
  })

  await new Promise<void>((resolve, reject) => {
    tcpServer.once('error', reject)
    tcpServer.listen(BACKEND_PORT, BACKEND_HOST, () => {
      tcpServer.off('error', reject)
      mkdirSync(AGRUNE_HOME, { recursive: true })
      writeFileSync(PORT_FILE, String(BACKEND_PORT))
      process.stderr.write(`[agrune-backend] listening on ${BACKEND_HOST}:${BACKEND_PORT}\n`)
      resolve()
    })
  })

  // Idle shutdown: exit after 10 minutes of no tool activity
  const IDLE_TIMEOUT_MS = 10 * 60 * 1000

  const shutdown = () => {
    process.stderr.write('[agrune-backend] idle timeout — shutting down\n')
    tcpServer.close()
    process.exit(0)
  }

  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT_MS)

  backend.onActivity = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT_MS)
  }

} else {
  // ============================================================
  // Mode: MCP frontend (launched by Claude Code / AI Agent)
  // Serves MCP protocol on stdin/stdout and proxies tool calls to backend
  // Backend daemon is started lazily on first tool call, not at startup.
  // ============================================================
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { createBackendClient } = await import('../src/backend-client.js')
  const { registerAgruneTools } = await import('../src/mcp-tools.js')

  const mcp = new McpServer(
    { name: 'agrune', version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  async function callToolWithReconnect(name: string, toolArgs: Record<string, unknown>) {
    try {
      const client = createBackendClient({ host: BACKEND_HOST, port: readBackendPort() })
      return await client.callTool(name, toolArgs)
    } catch {
      // Backend might be dead — try to respawn and retry once
      await ensureBackendDaemon()
      const client = createBackendClient({ host: BACKEND_HOST, port: readBackendPort() })
      return client.callTool(name, toolArgs)
    }
  }

  registerAgruneTools(mcp, callToolWithReconnect)

  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

function readBackendPort(): number {
  if (!existsSync(PORT_FILE)) {
    return BACKEND_PORT
  }

  const parsed = parseInt(readFileSync(PORT_FILE, 'utf-8').trim(), 10)
  return Number.isFinite(parsed) ? parsed : BACKEND_PORT
}

async function ensureBackendDaemon(): Promise<void> {
  const { createBackendClient } = await import('../src/backend-client.js')
  const backendClient = createBackendClient({ host: BACKEND_HOST, port: readBackendPort(), timeoutMs: 500 })

  try {
    await backendClient.ping()
    return
  } catch {
    spawnDetachedBackend()
  }

  const deadline = Date.now() + 5_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      await createBackendClient({ host: BACKEND_HOST, port: readBackendPort(), timeoutMs: 500 }).ping()
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to start agrune backend daemon')
}

function spawnDetachedBackend(): void {
  if (!process.argv[1]) {
    throw new Error('Cannot determine current script path for backend spawn')
  }

  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1], '--backend-daemon'],
    {
      detached: true,
      stdio: 'ignore',
    },
  )
  child.unref()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}
