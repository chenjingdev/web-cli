import type {
  ApprovalStatus,
  CommandRequest,
  CommandResult,
  CompanionConfig,
  DragPlacement,
  PageSnapshot,
  PageTarget,
  PageSyncPayload,
  SessionSnapshot,
} from '@webcli-dom/core'

export type {
  ApprovalStatus,
  CommandRequest,
  CommandResult,
  CompanionConfig,
  DragPlacement,
  PageSnapshot,
  PageTarget,
  PageSyncPayload,
  SessionSnapshot,
} from '@webcli-dom/core'

export interface CompanionLogEntry {
  id: number
  at: number
  kind: 'system' | 'page' | 'api' | 'error'
  message: string
  meta?: unknown
}

export interface PersistedState {
  approvals: Record<string, ApprovalStatus>
  activeSessionId: string | null
  config: CompanionConfig
}

export interface CompanionPaths {
  homeDir: string
  statePath: string
  tokenPath: string
  pidPath: string
}

export interface CompanionServerOptions {
  host?: string
  port?: number
  homeDir?: string
  heartbeatTimeoutMs?: number
  callTimeoutMs?: number
  pollIntervalMs?: number
  logger?: (message: string) => void
}

export interface CompanionServerHandle {
  endpoint: string
  tokenPath: string
  paths: CompanionPaths
  close: () => Promise<void>
}

export interface CompanionStatusPayload {
  endpoint: string
  homeDir: string
  tokenPath: string
  pidPath: string
  sessionCount: number
  activeSessionId: string | null
  approvals: Record<ApprovalStatus, number>
  config: CompanionConfig
}

export interface PageSessionPayload {
  snapshot?: PageSnapshot
  completedCommands?: CommandResult[]
}
