import type { Readable, Writable } from 'node:stream'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgruneRuntimeConfig, NativeMessage } from '@agrune/core'
import { ExtensionDriver, createNativeMessagingTransport } from '@agrune/browser'
import type { NativeMessagingTransport } from '@agrune/browser'
import { registerAgruneTools } from './mcp-tools.js'
import type { ToolHandlerResult } from './mcp-tools.js'
import { toPublicCommandResult, toPublicSession, toPublicSnapshot } from './public-shapes.js'
import type { PublicSnapshotOptions } from './public-shapes.js'

declare const __MCP_SERVER_VERSION__: string

export { registerAgruneTools } from './mcp-tools.js'
export { getToolDefinitions } from './tools.js'
export { createNativeMessagingTransport, ExtensionDriver } from '@agrune/browser'
export type { NativeMessagingTransport } from '@agrune/browser'

export function createMcpServer() {
  const driver = new ExtensionDriver()

  const mcp = new McpServer(
    { name: 'agrune', version: typeof __MCP_SERVER_VERSION__ !== 'undefined' ? __MCP_SERVER_VERSION__ : '0.0.0' },
    { capabilities: { tools: {} } },
  )

  const handleToolCall = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolHandlerResult> => {
    driver.onActivity?.()

    if (name !== 'agrune_config') {
      const readyError = await driver.ensureReady()
      if (readyError) return { text: readyError, isError: true }
    }

    const tabId = driver.resolveTabId(args.tabId as number | undefined)

    switch (name) {
      case 'agrune_sessions': {
        const sessions = driver.sessions.getSessions()
        return { text: JSON.stringify(sessions.map(toPublicSession), null, 2) }
      }
      case 'agrune_snapshot': {
        if (tabId == null) return { text: 'No active sessions.', isError: true }
        const snapshot = driver.getSnapshot(tabId)
        if (!snapshot) return { text: `No snapshot available for tab ${tabId}.`, isError: true }
        return { text: JSON.stringify(toPublicSnapshot(snapshot, resolveSnapshotOptions(args)), null, 2) }
      }
      case 'agrune_act':
      case 'agrune_fill':
      case 'agrune_drag':
      case 'agrune_pointer':
      case 'agrune_wait':
      case 'agrune_guide':
      case 'agrune_read': {
        if (tabId == null) return { text: 'No active sessions.', isError: true }
        const command: Record<string, unknown> & { kind: string } = {
          kind: name.replace('agrune_', ''), ...args,
        }
        delete command.tabId
        const result = await driver.execute(tabId, command)
        return { text: JSON.stringify(toPublicCommandResult(result), null, 2) }
      }
      case 'agrune_config': {
        const config: Partial<AgruneRuntimeConfig> = {}
        if (typeof args.pointerAnimation === 'boolean') config.pointerAnimation = args.pointerAnimation
        if (typeof args.auroraGlow === 'boolean') config.auroraGlow = args.auroraGlow
        if (typeof args.auroraTheme === 'string') config.auroraTheme = args.auroraTheme as AgruneRuntimeConfig['auroraTheme']
        if (typeof args.clickDelayMs === 'number') config.clickDelayMs = args.clickDelayMs
        if (typeof args.pointerDurationMs === 'number') config.pointerDurationMs = args.pointerDurationMs
        if (typeof args.autoScroll === 'boolean') config.autoScroll = args.autoScroll
        if (Object.keys(config).length > 0) driver.sendRaw({ type: 'config_update', config } as NativeMessage)
        return { text: 'Configuration updated.' }
      }
      default:
        return { text: `Unknown tool: ${name}`, isError: true }
    }
  }

  registerAgruneTools(mcp, handleToolCall)

  function connectNativeMessaging(input: Readable, output: Writable): NativeMessagingTransport {
    const transport = createNativeMessagingTransport(input, output)
    driver.setNativeSender(transport.send)
    transport.onMessage((msg) => driver.handleNativeMessage(msg))
    return transport
  }

  return { server: mcp, driver, handleToolCall, connectNativeMessaging }
}

function resolveSnapshotOptions(args: Record<string, unknown>): PublicSnapshotOptions {
  const groupIds = new Set<string>()
  if (typeof args.groupId === 'string' && args.groupId.trim()) groupIds.add(args.groupId.trim())
  if (Array.isArray(args.groupIds)) {
    for (const value of args.groupIds) {
      if (typeof value === 'string' && value.trim()) groupIds.add(value.trim())
    }
  }
  return {
    mode: args.mode === 'full' ? 'full' : 'outline',
    ...(groupIds.size > 0 ? { groupIds: [...groupIds] } : {}),
    ...(args.includeTextContent === true ? { includeTextContent: true } : {}),
  }
}
