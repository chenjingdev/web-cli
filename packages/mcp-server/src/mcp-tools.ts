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

export function registerAgagruneTools(
  mcp: McpServer,
  handleToolCall: ToolHandler,
): void {
  const optionalTabId = {
    tabId: z.number().optional().describe('Tab ID. Omit to use the most recent active tab.'),
  }

  mcp.tool('agrune_sessions', 'List active browser sessions (tabs). Only needed when switching between multiple tabs — agrune_snapshot already targets the active tab automatically.', {}, async () =>
    toMcpToolResult(await handleToolCall('agrune_sessions', {})),
  )

  mcp.tool(
    'agrune_snapshot',
    'Get the current page snapshot with actionable targets. Automatically uses the active tab — no need to call agrune_sessions first. Use mode=full to get all targets with their targetIds for acting. Use outline mode (default) only when you need a high-level overview of available groups. One snapshot call before acting is sufficient — do not re-snapshot after every action. Omitted fields use defaults: reason=ready, sensitive=false.',
    {
      groupId: z.string().optional().describe('Expand a single group by groupId'),
      groupIds: z.array(z.string()).optional().describe('Expand multiple groups by groupId'),
      mode: z.enum(['outline', 'full']).optional().describe('full returns all targets with targetIds (use this before acting); outline returns group summary only'),
      includeTextContent: z.boolean().optional().describe('Include visible text content of each target element'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_snapshot', args)),
  )

  mcp.tool(
    'agrune_act',
    'Click an annotated target element. After a successful click, do NOT call agrune_snapshot to verify — trust the ok:true result and move on to the next action. Only re-snapshot if you need targets for a completely different task.',
    {
      targetId: z.string().describe('The target ID to click'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_act', args)),
  )

  mcp.tool(
    'agrune_fill',
    'Fill an input/textarea with a value. Trust the ok:true result — do not re-snapshot to verify.',
    {
      targetId: z.string().describe('The target ID to fill'),
      value: z.string().describe('The value to fill'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_fill', args)),
  )

  mcp.tool(
    'agrune_drag',
    'Drag one target to another. Trust the ok:true result — do not re-snapshot to verify.',
    {
      sourceTargetId: z.string().describe('Source target ID'),
      destinationTargetId: z.string().describe('Destination target ID'),
      placement: z.enum(['before', 'inside', 'after']).optional().describe('Drop placement'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_drag', args)),
  )

  mcp.tool(
    'agrune_wait',
    'Wait for a target to reach a specific state',
    {
      targetId: z.string().describe('The target ID to wait for'),
      state: z.enum(['visible', 'hidden', 'enabled', 'disabled']).describe('Desired state'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds (default: 10000)'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_wait', args)),
  )

  mcp.tool(
    'agrune_guide',
    'Visually highlight a target element without executing an action',
    {
      targetId: z.string().describe('The target ID to highlight'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_guide', args)),
  )

  mcp.tool(
    'agrune_config',
    'Update runtime visual configuration. Do NOT call this unless the user explicitly asks to change these settings. The defaults are already optimized.',
    {
      pointerAnimation: z.boolean().optional().describe('Enable/disable pointer animation'),
      auroraGlow: z.boolean().optional().describe('Enable/disable aurora glow effect'),
      auroraTheme: z.enum(['dark', 'light']).optional().describe('Aurora color theme'),
      clickDelayMs: z.number().optional().describe('Delay before click execution in ms'),
      pointerDurationMs: z.number().optional().describe('Pointer animation duration in ms'),
      autoScroll: z.boolean().optional().describe('Auto-scroll to target before action'),
      agentActive: z
        .boolean()
        .optional()
        .describe('Activate/deactivate agent visual presence (aurora glow persists until explicitly deactivated)'),
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_config', args)),
  )
}
