#!/usr/bin/env node
const args = process.argv.slice(2)

if (args[0] === 'install') {
  const { runInstall } = await import('../src/install.js')
  const extensionIdArg = args.find(a => a.startsWith('--extension-id='))
  const extensionId = extensionIdArg?.split('=')[1]
  await runInstall({ extensionId })
  process.exit(0)
}

if (args[0] === '--native-host') {
  // Running as native messaging host — connect stdin/stdout for Chrome Native Messaging
  const { createMcpServer } = await import('../src/index.js')
  const { connectNativeMessaging } = createMcpServer()
  connectNativeMessaging(process.stdin, process.stdout)
  // Keep process alive while native messaging connection is open
  process.stdin.resume()
} else {
  // Default: running as MCP server over stdio
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { createMcpServer } = await import('../src/index.js')
  const { server } = createMcpServer()
  const transport = new StdioServerTransport()
  await server.server.connect(transport)
}
