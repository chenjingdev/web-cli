import type {
  CommandResult,
  CommandRequest,
  NativeHostStatus,
  PageSnapshot,
  AgruneRuntimeConfig,
} from '@agrune/core'

export interface ConfigBroadcastMessage {
  type: 'config_broadcast'
  config: Partial<AgruneRuntimeConfig>
}

export interface GetNativeHostStatusMessage {
  type: 'get_native_host_status'
}

export interface ReconnectNativeHostMessage {
  type: 'reconnect_native_host'
}

export interface NativeHostStatusChangedMessage {
  type: 'native_host_status_changed'
  status: NativeHostStatus
}

export type ExtensionMessage =
  | { type: 'snapshot'; tabId: number; snapshot: PageSnapshot }
  | { type: 'command'; tabId: number; commandId: string; command: CommandRequest }
  | { type: 'command_result'; tabId: number; commandId: string; result: CommandResult }
  | { type: 'session_open'; tabId: number; url: string; title: string }
  | { type: 'session_close'; tabId: number }
  | { type: 'config_update'; config: Partial<AgruneRuntimeConfig> }
  | ConfigBroadcastMessage
  | GetNativeHostStatusMessage
  | ReconnectNativeHostMessage
  | NativeHostStatusChangedMessage
