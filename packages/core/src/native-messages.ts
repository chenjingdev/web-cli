import type {
  CommandRequest,
  CommandResult,
  PageSnapshot,
  AgruneRuntimeConfig,
} from './index'

export type NativeHostConnectionPhase = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface NativeHostStatus {
  connected: boolean
  phase: NativeHostConnectionPhase
  hostName: string
  lastError?: string | null
  sessionCount?: number
  mcpConnected?: boolean
}

export interface SnapshotUpdateMessage {
  type: 'snapshot_update'
  tabId: number
  snapshot: PageSnapshot
}

export interface CommandRequestMessage {
  type: 'command_request'
  tabId: number
  commandId: string
  command: Pick<CommandRequest, 'kind'> & Record<string, unknown>
}

export interface CommandResultMessage {
  type: 'command_result'
  tabId: number
  commandId: string
  result: CommandResult
}

export interface SessionOpenMessage {
  type: 'session_open'
  tabId: number
  url: string
  title: string
}

export interface SessionCloseMessage {
  type: 'session_close'
  tabId: number
}

export interface ConfigUpdateMessage {
  type: 'config_update'
  config: Partial<AgruneRuntimeConfig>
}

export interface AgentActivityMessage {
  type: 'agent_activity'
  active: boolean
}

export interface PingMessage {
  type: 'ping'
}

export interface PongMessage {
  type: 'pong'
}

export interface ResyncRequestMessage {
  type: 'resync_request'
}

export interface GetStatusMessage {
  type: 'get_status'
}

export interface StatusResponseMessage {
  type: 'status_response'
  status: NativeHostStatus
}

export interface CdpRequestMessage {
  type: 'cdp_request'
  tabId?: number
  requestId: string
  method: string
  params: Record<string, unknown>
}

export interface CdpResponseMessage {
  type: 'cdp_response'
  requestId: string
  result?: Record<string, unknown>
  error?: string
}

export interface CdpEventMessage {
  type: 'cdp_event'
  method: string
  params: Record<string, unknown>
}

export type NativeMessage =
  | SnapshotUpdateMessage
  | CommandRequestMessage
  | CommandResultMessage
  | SessionOpenMessage
  | SessionCloseMessage
  | ConfigUpdateMessage
  | AgentActivityMessage
  | PingMessage
  | PongMessage
  | ResyncRequestMessage
  | GetStatusMessage
  | StatusResponseMessage
  | CdpRequestMessage
  | CdpResponseMessage
  | CdpEventMessage

export function isSnapshotUpdate(msg: NativeMessage): msg is SnapshotUpdateMessage {
  return msg.type === 'snapshot_update'
}

export function isCommandRequest(msg: NativeMessage): msg is CommandRequestMessage {
  return msg.type === 'command_request'
}

export function isCommandResult(msg: NativeMessage): msg is CommandResultMessage {
  return msg.type === 'command_result'
}

export function isSessionOpen(msg: NativeMessage): msg is SessionOpenMessage {
  return msg.type === 'session_open'
}

export function isSessionClose(msg: NativeMessage): msg is SessionCloseMessage {
  return msg.type === 'session_close'
}

export function isConfigUpdate(msg: NativeMessage): msg is ConfigUpdateMessage {
  return msg.type === 'config_update'
}

export function isPing(msg: NativeMessage): msg is PingMessage {
  return msg.type === 'ping'
}

export function isPong(msg: NativeMessage): msg is PongMessage {
  return msg.type === 'pong'
}

export function isGetStatus(msg: NativeMessage): msg is GetStatusMessage {
  return msg.type === 'get_status'
}

export function isStatusResponse(msg: NativeMessage): msg is StatusResponseMessage {
  return msg.type === 'status_response'
}

export function isResyncRequest(msg: NativeMessage): msg is ResyncRequestMessage {
  return msg.type === 'resync_request'
}

export function isCdpRequest(msg: NativeMessage): msg is CdpRequestMessage {
  return msg.type === 'cdp_request'
}

export function isCdpResponse(msg: NativeMessage): msg is CdpResponseMessage {
  return msg.type === 'cdp_response'
}

export function isCdpEvent(msg: NativeMessage): msg is CdpEventMessage {
  return msg.type === 'cdp_event'
}
