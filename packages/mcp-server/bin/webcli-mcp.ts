#!/usr/bin/env node
import { createServer as createNetServer, connect as netConnect } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const SOCKET_PATH = join(homedir(), '.webcli-dom', 'webcli.sock')

if (args[0] === 'install') {
  const { runInstall } = await import('../src/install.js')
  const extensionIdArg = args.find(a => a.startsWith('--extension-id='))
  const extensionId = extensionIdArg?.split('=')[1]
  await runInstall({ extensionId })
  process.exit(0)
}

if (args[0] === '--native-host') {
  // ============================================================
  // Mode: Native Messaging Host (launched by Chrome)
  // Reads Native Messaging from stdin, forwards to MCP server via Unix socket
  // ============================================================
  const { createNativeMessagingTransport } = await import('../src/native-messaging.js')
  const nativeTransport = createNativeMessagingTransport(process.stdin, process.stdout)

  // Connect to MCP server's Unix socket
  const sock = netConnect(SOCKET_PATH)

  let sockBuffer = ''
  sock.on('data', (chunk) => {
    // Receive JSON messages from MCP server, forward to Extension
    sockBuffer += chunk.toString()
    const lines = sockBuffer.split('\n')
    sockBuffer = lines.pop()!
    for (const line of lines) {
      if (line.trim()) {
        try {
          nativeTransport.send(JSON.parse(line))
        } catch {}
      }
    }
  })

  sock.on('error', (err) => {
    process.stderr.write(`[webcli native-host] socket error: ${err.message}\n`)
    process.stderr.write(`[webcli native-host] Is the MCP server running? Start Claude Code or run webcli-mcp first.\n`)
  })

  sock.on('connect', () => {
    process.stderr.write(`[webcli native-host] connected to MCP server\n`)
  })

  // Forward Extension messages to MCP server via socket
  nativeTransport.onMessage((msg) => {
    sock.write(JSON.stringify(msg) + '\n')
  })

  process.stdin.resume()

} else {
  // ============================================================
  // Mode: MCP Server (launched by Claude Code / AI Agent)
  // Serves MCP protocol on stdin/stdout, listens for Native Host on Unix socket
  // ============================================================
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { createMcpServer } = await import('../src/index.js')
  const { server, sessions, commands } = createMcpServer()

  // 1. Start Unix socket server for Native Host connections
  if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH)

  const socketServer = createNetServer((client) => {
    process.stderr.write(`[webcli-mcp] native host connected\n`)

    let buffer = ''
    client.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'session_open') sessions.openSession(msg.tabId, msg.url, msg.title)
          else if (msg.type === 'session_close') sessions.closeSession(msg.tabId)
          else if (msg.type === 'snapshot_update') sessions.updateSnapshot(msg.tabId, msg.snapshot)
          else if (msg.type === 'command_result') commands.resolve(msg.commandId, msg.result)
        } catch {}
      }
    })

    // Send commands to Extension via Native Host
    commands.setSender((msg) => {
      client.write(JSON.stringify(msg) + '\n')
    })

    client.on('close', () => {
      process.stderr.write(`[webcli-mcp] native host disconnected\n`)
    })
  })

  socketServer.listen(SOCKET_PATH, () => {
    process.stderr.write(`[webcli-mcp] listening on ${SOCKET_PATH}\n`)
  })

  // Cleanup on exit
  process.on('exit', () => {
    try { unlinkSync(SOCKET_PATH) } catch {}
  })
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))

  // 2. Start MCP transport for AI Agent communication
  const transport = new StdioServerTransport()
  await server.server.connect(transport)
}
