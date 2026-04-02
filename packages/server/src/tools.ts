export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
}

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'agrune_sessions',
      description: 'List active browser sessions (tabs) being managed by agrune.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'agrune_snapshot',
      description:
        'Get the current active-context snapshot for a browser tab. By default returns a group outline only; use groupId/groupIds or mode="full" to expand actionable targets. Targets only include actionable elements. Omitted fields use defaults: visible=true, enabled=true.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Browser tab ID. Defaults to the first active session.' },
          groupId: { type: 'string', description: 'Expand a single group by its groupId.' },
          groupIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Expand multiple groups by groupId.',
          },
          mode: {
            type: 'string',
            enum: ['outline', 'full'],
            description: 'outline returns groups only; full returns all actionable targets in the active context.',
          },
          includeTextContent: {
            type: 'boolean',
            description: 'Include visible text content of each target element. Default: false.',
          },
        },
      },
    },
    {
      name: 'agrune_act',
      description: 'Perform an interaction (click, dblclick, contextmenu, hover, longpress) on a target element. Defaults to click. A target may support multiple actions — check actionKinds in the snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Browser tab ID. Defaults to the first active session.' },
          targetId: { type: 'string', description: 'The target element ID from the page snapshot.' },
          action: {
            type: 'string',
            enum: ['click', 'dblclick', 'contextmenu', 'hover', 'longpress'],
            description: 'Interaction type to perform on the target. Defaults to click.',
          },
        },
        required: ['targetId'],
      },
    },
    {
      name: 'agrune_fill',
      description: 'Fill an input element with a value. The element is identified by its targetId from the page snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Browser tab ID. Defaults to the first active session.' },
          targetId: { type: 'string', description: 'The target input element ID from the page snapshot.' },
          value: { type: 'string', description: 'The value to fill into the input element.' },
        },
        required: ['targetId', 'value'],
      },
    },
    {
      name: 'agrune_drag',
      description: 'Drag an element and drop it onto another element.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Browser tab ID. Defaults to the first active session.' },
          sourceTargetId: { type: 'string', description: 'The source element ID to drag.' },
          destinationTargetId: { type: 'string', description: 'The destination element ID to drop onto.' },
          placement: {
            type: 'string',
            enum: ['before', 'after', 'inside'],
            description: 'Drop placement relative to the destination element.',
          },
        },
        required: ['sourceTargetId', 'destinationTargetId'],
      },
    },
    {
      name: 'agrune_wait',
      description: 'Wait for a target element to reach a specific state (e.g., visible, hidden, enabled, disabled).',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Browser tab ID. Defaults to the first active session.' },
          targetId: { type: 'string', description: 'The target element ID from the page snapshot.' },
          state: {
            type: 'string',
            enum: ['visible', 'hidden', 'enabled', 'disabled'],
            description: 'The state to wait for.',
          },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds. Defaults to 30000.' },
        },
        required: ['targetId', 'state'],
      },
    },
    {
      name: 'agrune_guide',
      description: 'Visually highlight a target element on the page to guide the user.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Browser tab ID. Defaults to the first active session.' },
          targetId: { type: 'string', description: 'The target element ID to highlight.' },
        },
        required: ['targetId'],
      },
    },
    {
      name: 'agrune_config',
      description: 'Update the page runtime configuration (pointer animation, aurora glow, etc.).',
      inputSchema: {
        type: 'object',
        properties: {
          pointerAnimation: { type: 'boolean', description: 'Enable or disable pointer animation.' },
          auroraGlow: { type: 'boolean', description: 'Enable or disable aurora glow effect.' },
          auroraTheme: { type: 'string', description: 'Aurora glow theme name.' },
          clickDelayMs: { type: 'number', description: 'Delay in milliseconds before click execution.' },
          pointerDurationMs: { type: 'number', description: 'Pointer animation duration in milliseconds.' },
          autoScroll: { type: 'boolean', description: 'Enable or disable automatic scrolling to target.' },
        },
      },
    },
    {
      name: 'agrune_read',
      description: 'Extract visible page content as structured markdown.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Browser tab ID. Defaults to the first active session.' },
          selector: { type: 'string', description: 'CSS selector to scope extraction. Defaults to document.body.' },
        },
      },
    },
  ]
}
