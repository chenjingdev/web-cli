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
    tabId: z.number().optional().describe('Tab ID (omit for active tab)'),
  }

  mcp.tool('agrune_sessions', 'List active browser sessions (tabs). Only call this when switching between multiple tabs. agrune_snapshot automatically uses the active tab.', {}, async () =>
    toMcpToolResult(await handleToolCall('agrune_sessions', {})),
  )

  mcp.tool(
    'agrune_snapshot',
    'Get page snapshot with actionable targets. Calling with outline mode (default) returns a group summary. To get targetIds for a specific group, specify groupId to expand it. To get all targets at once, use mode=full. Do not re-snapshot after actions — one snapshot per task is enough. Defaults: reason=ready, sensitive=false.',
    {
      groupId: z.string().optional().describe('Expand a group to get its targetIds'),
      groupIds: z.array(z.string()).optional().describe('Expand multiple groups'),
      mode: z.enum(['outline', 'full']).optional().describe('outline (default): group summary; full: all targets'),
      includeTextContent: z.boolean().optional().describe('Include text content'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_snapshot', args)),
  )

  mcp.tool(
    'agrune_act',
    'Perform an interaction (click, dblclick, contextmenu, hover, longpress) on a target element by targetId. Defaults to click. When ok:true is returned, do not re-snapshot to verify.',
    {
      targetId: z.string().describe('Target ID'),
      action: z.enum(['click', 'dblclick', 'contextmenu', 'hover', 'longpress']).optional().describe('Interaction type (default: click)'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_act', args)),
  )

  mcp.tool(
    'agrune_fill',
    'Fill an input/textarea with a value by targetId. When ok:true is returned, do not re-snapshot to verify.',
    {
      targetId: z.string().describe('Target ID'),
      value: z.string().describe('Value to fill'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_fill', args)),
  )

  mcp.tool(
    'agrune_drag',
    'Drag a source target to a destination. Destination can be another target (destinationTargetId) or coordinates (destinationCoords). For canvas groups, coords are in canvas space (auto-converted). Returns movedTarget with final position.',
    {
      sourceTargetId: z.string().describe('Source target ID'),
      destinationTargetId: z.string().optional().describe('Destination target ID'),
      destinationCoords: z.object({
        x: z.number().describe('X coordinate (canvas space for canvas groups, viewport otherwise)'),
        y: z.number().describe('Y coordinate'),
      }).optional().describe('Destination coordinates'),
      placement: z.enum(['before', 'inside', 'after']).optional().describe('Drop placement (only with destinationTargetId)'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_drag', args)),
  )

  mcp.tool(
    'agrune_pointer',
    'Execute a low-level pointer/wheel event sequence on an element. Use for canvas pan, zoom, freeform drawing, or any interaction requiring raw coordinates. Specify target element via targetId, selector, or coords (priority: targetId > selector > coords).',
    {
      targetId: z.string().optional().describe('Annotated target ID'),
      selector: z.string().optional().describe('CSS selector for target element'),
      coords: z.object({
        x: z.number().describe('Viewport X coordinate'),
        y: z.number().describe('Viewport Y coordinate'),
      }).optional().describe('Viewport coordinates to find element via elementFromPoint'),
      actions: z.array(z.discriminatedUnion('type', [
        z.object({
          type: z.literal('pointerdown'),
          x: z.number().describe('Viewport X'),
          y: z.number().describe('Viewport Y'),
          delayMs: z.number().optional().describe('Delay in ms after this action'),
        }),
        z.object({
          type: z.literal('pointermove'),
          x: z.number().describe('Viewport X'),
          y: z.number().describe('Viewport Y'),
          delayMs: z.number().optional().describe('Delay in ms after this action'),
        }),
        z.object({
          type: z.literal('pointerup'),
          x: z.number().describe('Viewport X'),
          y: z.number().describe('Viewport Y'),
          delayMs: z.number().optional().describe('Delay in ms after this action'),
        }),
        z.object({
          type: z.literal('wheel'),
          x: z.number().describe('Viewport X'),
          y: z.number().describe('Viewport Y'),
          deltaY: z.number().describe('Scroll delta (negative = zoom in)'),
          ctrlKey: z.boolean().optional().describe('Hold Ctrl (for pinch-zoom)'),
          delayMs: z.number().optional().describe('Delay in ms after this action'),
          steps: z.number().int().min(1).optional().describe('Split deltaY into N equal steps for smooth zoom'),
          durationMs: z.number().optional().describe('Total duration across all steps in ms'),
        }),
      ])).describe('Ordered sequence of pointer/wheel events'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_pointer', args)),
  )

  mcp.tool(
    'agrune_wait',
    'Wait for target state change.',
    {
      targetId: z.string().describe('Target ID'),
      state: z.enum(['visible', 'hidden', 'enabled', 'disabled']).describe('Desired state'),
      timeoutMs: z.number().optional().describe('Timeout ms (default: 10000)'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_wait', args)),
  )

  mcp.tool(
    'agrune_guide',
    'Highlight a target visually.',
    {
      targetId: z.string().describe('Target ID'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_guide', args)),
  )

  mcp.tool(
    'agrune_config',
    'Update visual config. Only call when user explicitly requests.',
    {
      pointerAnimation: z.boolean().optional(),
      auroraGlow: z.boolean().optional(),
      auroraTheme: z.enum(['dark', 'light']).optional(),
      clickDelayMs: z.number().optional(),
      pointerDurationMs: z.number().optional(),
      autoScroll: z.boolean().optional(),
      agentActive: z.boolean().optional().describe('Toggle agent visual presence'),
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_config', args)),
  )

  mcp.tool(
    'agrune_read',
    'Extract visible page content as structured markdown. Use selector to scope extraction to a specific area.',
    {
      selector: z.string().optional().describe('CSS selector to scope extraction (default: full page)'),
      ...optionalTabId,
    },
    async (args) => toMcpToolResult(await handleToolCall('agrune_read', args)),
  )
}
