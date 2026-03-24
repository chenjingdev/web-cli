#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createServer as createNetServer, connect as netConnect, type Socket } from 'node:net'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const WEBCLI_HOME = join(homedir(), '.webcli-dom')
const PORT_FILE = join(WEBCLI_HOME, 'port')

if (args[0] === 'install') {
  const { runInstall } = await import('../src/install.js')
  const extensionIdArg = args.find(a => a.startsWith('--extension-id='))
  const extensionId = extensionIdArg?.split('=')[1]
  await runInstall({ extensionId })
  process.exit(0)
}

const { BACKEND_HOST, BACKEND_PORT } = await import('../src/backend-protocol.js')

if (args[0] === '--native-host') {
  // ============================================================
  // Mode: Native Messaging Host (launched by Chrome)
  // Reads Native Messaging from stdin, forwards to singleton backend via TCP
  // ============================================================
  const { createNativeMessagingTransport } = await import('../src/native-messaging.js')
  const nativeTransport = createNativeMessagingTransport(process.stdin, process.stdout)

  const port = readBackendPort()
  const sock = netConnect(port, BACKEND_HOST)
  let handshakeComplete = false

  let sockBuffer = ''
  sock.setEncoding('utf8')
  sock.on('connect', () => {
    sock.write(JSON.stringify({ type: 'backend_handshake', role: 'native-host' }) + '\n')
  })
  sock.on('data', (chunk) => {
    sockBuffer += chunk
    const lines = sockBuffer.split('\n')
    sockBuffer = lines.pop()!
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === 'backend_ready') {
            handshakeComplete = true
            process.stderr.write(`[webcli native-host] connected to backend on port ${port}\n`)
            continue
          }
          if (parsed.type === 'backend_error') {
            process.stderr.write(`[webcli native-host] backend error: ${parsed.message}\n`)
            continue
          }
          nativeTransport.send(parsed)
        } catch {}
      }
    }
  })

  sock.on('error', (err) => {
    process.stderr.write(`[webcli native-host] connection error: ${err.message}\n`)
  })

  nativeTransport.onMessage((msg) => {
    if (!handshakeComplete) {
      process.stderr.write('[webcli native-host] backend handshake not completed yet\n')
      return
    }
    sock.write(JSON.stringify(msg) + '\n')
  })

  process.stdin.resume()

} else if (args[0] === '--backend-daemon') {
  // ============================================================
  // Mode: Singleton backend daemon
  // Holds browser/native connection + shared sessions/commands
  // ============================================================
  const { WebCliBackend } = await import('../src/backend.js')
  const backend = new WebCliBackend()
  let nativeSocket: Socket | null = null

  const tcpServer = createNetServer((client) => {
    client.setEncoding('utf8')
    let buffer = ''
    let role: 'agent-client' | 'native-host' | null = null

    const detachNativeSocket = () => {
      if (nativeSocket === client) {
        nativeSocket = null
        backend.setNativeSender(null)
        process.stderr.write('[webcli-backend] native host disconnected\n')
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
            process.stderr.write('[webcli-backend] native host connected\n')
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
      process.stderr.write(`[webcli-backend] already running on ${BACKEND_HOST}:${BACKEND_PORT}\n`)
      process.exit(0)
    }
    throw error
  })

  await new Promise<void>((resolve, reject) => {
    tcpServer.once('error', reject)
    tcpServer.listen(BACKEND_PORT, BACKEND_HOST, () => {
      tcpServer.off('error', reject)
      mkdirSync(WEBCLI_HOME, { recursive: true })
      writeFileSync(PORT_FILE, String(BACKEND_PORT))
      process.stderr.write(`[webcli-backend] listening on ${BACKEND_HOST}:${BACKEND_PORT}\n`)
      resolve()
    })
  })

} else {
  // ============================================================
  // Mode: MCP frontend (launched by Claude Code / AI Agent)
  // Serves MCP protocol on stdin/stdout and proxies tool calls to backend
  // ============================================================
  await ensureBackendDaemon()

  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { createBackendClient } = await import('../src/backend-client.js')
  const { registerWebCliTools } = await import('../src/mcp-tools.js')

  const backendClient = createBackendClient({ host: BACKEND_HOST, port: readBackendPort() })
  const mcp = new McpServer(
    { name: 'webcli-dom', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  registerWebCliTools(mcp, (name, toolArgs) => backendClient.callTool(name, toolArgs))

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
    : new Error('Failed to start webcli backend daemon')
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
