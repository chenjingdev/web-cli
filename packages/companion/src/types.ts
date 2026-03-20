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
  agentActive: boolean
  agentStopped: boolean
  approvals: Record<ApprovalStatus, number>
  config: CompanionConfig
}

export interface PageSessionPayload {
  snapshot?: PageSnapshot
  completedCommands?: CommandResult[]
}

export type SnapshotViewMode = 'base' | 'overlay'

export interface SnapshotSummaryGroup {
  groupId: string
  groupName?: string
  groupDesc?: string
  description: string
  actionableCount: number
}

export interface SnapshotSummaryPayload {
  sessionId: string
  approvalStatus: ApprovalStatus
  version: number | null
  capturedAt: number | null
  url: string | null
  title: string | null
  mode: SnapshotViewMode | null
  groups: SnapshotSummaryGroup[]
}

export interface SnapshotTargetsPayload {
  sessionId: string
  approvalStatus: ApprovalStatus
  version: number | null
  capturedAt: number | null
  url: string | null
  title: string | null
  mode: SnapshotViewMode | null
  groupId: string
  groupName?: string
  groupDesc?: string
  description: string
  targets: PageTarget[]
}
