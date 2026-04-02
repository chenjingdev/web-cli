import type { Readable, Writable } from 'node:stream'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { NativeMessage } from '@agrune/core'
import { AgruneBackend } from './backend.js'
import { createNativeMessagingTransport, type NativeMessagingTransport } from './native-messaging.js'
import { getToolDefinitions } from './tools.js'
import { registerAgruneTools } from './mcp-tools.js'
import { MCP_SERVER_VERSION } from './version.js'

export { AgruneBackend } from './backend.js'
export { SessionManager } from './session-manager.js'
export { CommandQueue } from './command-queue.js'
export { getToolDefinitions } from './tools.js'
export {
  encodeMessage,
  decodeMessages,
  createNativeMessagingTransport,
  type NativeMessagingTransport,
} from './native-messaging.js'

export function createMcpServer() {
  const backend = new AgruneBackend()
  let nativeTransport: NativeMessagingTransport | null = null

  const mcp = new McpServer(
    { name: 'agrune', version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  registerAgruneTools(mcp, (name, args) => backend.handleToolCall(name, args))

  function connectNativeMessaging(input: Readable, output: Writable) {
    nativeTransport = createNativeMessagingTransport(input, output)

    backend.setNativeSender((msg: NativeMessage) => {
      nativeTransport!.send(msg)
    })

    nativeTransport.onMessage((msg: NativeMessage) => {
      backend.handleNativeMessage(msg)
    })

    return nativeTransport
  }

  return {
    server: mcp,
    sessions: backend.sessions,
    commands: backend.commands,
    connectNativeMessaging,
    backend,
  }
}
