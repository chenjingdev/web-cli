declare const __MCP_SERVER_VERSION__: string

export const MCP_SERVER_VERSION: string = typeof __MCP_SERVER_VERSION__ !== 'undefined'
  ? __MCP_SERVER_VERSION__
  : '0.0.0'
