import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export interface ToolHandlerResult {
  text: string
  isError?: boolean
}

export type ToolHandler = (
  name: string,
  args: Record<string, unknown>,
) => Promise<ToolHandlerResult>

export function toMcpToolResult(result: ToolHandlerResult) {
  return {
    content: [{ type: 'text' as const, text: result.text }],
    ...(result.isError ? { isError: true } : {}),
  }
}

export function registerWebCliTools(
  mcp: McpServer,
  handleToolCall: ToolHandler,
): void {
  const optionalTabId = {
    tabId: z.number().optional().describe('Tab ID. Omit to use the most recent active tab.'),
  }

  mcp.tool('webcli_sessions', 'List active browser sessions (tabs) with rune annotations', {}, async () =>
    toMcpToolResult(await handleToolCall('webcli_sessions', {})),
  )

  mcp.tool(
    'webcli_snapshot',
    'Get the current active-context snapshot. By default returns a group outline; expand groups or request full mode to inspect actionable targets.',
    {
      groupId: z.string().optional().describe('Expand a single group by groupId'),
      groupIds: z.array(z.string()).optional().describe('Expand multiple groups by groupId'),
      mode: z.enum(['outline', 'full']).optional().describe('outline returns groups only; full returns all active-context targets'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('webcli_snapshot', args)),
  )

  mcp.tool(
    'webcli_act',
    'Click an annotated target element',
    {
      targetId: z.string().describe('The target ID to click'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('webcli_act', args)),
  )

  mcp.tool(
    'webcli_fill',
    'Fill an input/textarea with a value',
    {
      targetId: z.string().describe('The target ID to fill'),
      value: z.string().describe('The value to fill'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('webcli_fill', args)),
  )

  mcp.tool(
    'webcli_drag',
    'Drag one target to another',
    {
      sourceTargetId: z.string().describe('Source target ID'),
      destinationTargetId: z.string().describe('Destination target ID'),
      placement: z.enum(['before', 'inside', 'after']).optional().describe('Drop placement'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('webcli_drag', args)),
  )

  mcp.tool(
    'webcli_wait',
    'Wait for a target to reach a specific state',
    {
      targetId: z.string().describe('The target ID to wait for'),
      state: z.enum(['visible', 'hidden', 'enabled', 'disabled']).describe('Desired state'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds (default: 10000)'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('webcli_wait', args)),
  )

  mcp.tool(
    'webcli_guide',
    'Visually highlight a target element without executing an action',
    {
      targetId: z.string().describe('The target ID to highlight'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('webcli_guide', args)),
  )

  mcp.tool(
    'webcli_config',
    'Update runtime configuration (pointer animation, aurora glow, etc.)',
    {
      pointerAnimation: z.boolean().optional(),
      auroraGlow: z.boolean().optional(),
      auroraTheme: z.enum(['dark', 'light']).optional(),
      clickDelayMs: z.number().optional(),
      autoScroll: z.boolean().optional(),
      agentActive: z
        .boolean()
        .optional()
        .describe('Activate/deactivate agent visual presence (aurora glow persists until explicitly deactivated)'),
    },
    async (args) => toMcpToolResult(await handleToolCall('webcli_config', args)),
  )
}
