import type {
  NativeMessage,
  NativeHostConnectionPhase,
  NativeHostStatus,
} from '@runeai/core'
import type {
  ConfigBroadcastMessage,
  GetNativeHostStatusMessage,
  ReconnectNativeHostMessage,
} from '../shared/messages'

export type NativeHostPhase = NativeHostConnectionPhase
export type { NativeHostStatus }

export interface SessionOpenMessage {
  type: 'session_open'
  url: string
  title: string
}

export interface SnapshotMessage {
  type: 'snapshot'
  snapshot: unknown
}

export interface CommandResultMessage {
  type: 'command_result'
  commandId: string
  result: unknown
}

export interface NativeHostStatusChangedMessage {
  type: 'native_host_status_changed'
  status: NativeHostStatus
}

export type BackgroundRuntimeMessage =
  | ConfigBroadcastMessage
  | GetNativeHostStatusMessage
  | ReconnectNativeHostMessage
  | SessionOpenMessage
  | SnapshotMessage
  | CommandResultMessage

export type NativeHostInboundMessage = NativeMessage
