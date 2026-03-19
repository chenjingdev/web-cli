import type {
  ApprovalStatus,
  BootstrapSessionResponse,
  CommandRequest,
  CommandResult,
  PageSnapshot,
  PageSyncPayload,
  ServerWsMessage,
  SyncResponse,
} from '@webcli-dom/core'

export type {
  BootstrapSessionResponse,
  CommandRequest,
  CommandResult,
  PageSnapshot,
  PageSyncPayload,
  ServerWsMessage,
  SyncResponse,
} from '@webcli-dom/core'

export type BrowserClientStatusState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'pending'
  | 'denied'
  | 'unavailable'
  | 'stopped'

export type GuideReason =
  | 'companion-unavailable'
  | 'origin-pending'
  | 'origin-denied'
  | 'runtime-unavailable'

export interface PageRuntimeLike {
  getSnapshot: () => PageSnapshot
  act: (input: {
    commandId?: string
    targetId: string
    expectedVersion?: number
    config?: Record<string, unknown>
  }) => Promise<CommandResult>
  drag: (input: {
    commandId?: string
    sourceTargetId: string
    destinationTargetId: string
    placement?: 'before' | 'inside' | 'after'
    expectedVersion?: number
    config?: Record<string, unknown>
  }) => Promise<CommandResult>
  fill: (input: {
    commandId?: string
    targetId: string
    value: string
    expectedVersion?: number
    config?: Record<string, unknown>
  }) => Promise<CommandResult>
  wait: (input: {
    commandId?: string
    targetId: string
    state: 'visible' | 'hidden' | 'enabled' | 'disabled'
    timeoutMs?: number
  }) => Promise<CommandResult>
  guide?: (input: {
    commandId?: string
    targetId: string
    expectedVersion?: number
    config?: Record<string, unknown>
  }) => Promise<CommandResult>
}

export interface BrowserClientStatus {
  state: BrowserClientStatusState
  companionBaseUrl: string
  sessionId: string | null
  active: boolean
  lastError: string | null
  updatedAt: number
}

export interface InitializeBrowserClientOptions {
  appId: string
  companionBaseUrl?: string
  pollIntervalMs?: number
  onStatusChange?: (status: BrowserClientStatus) => void
  onGuideRequired?: (reason: GuideReason) => void
  fetchImpl?: typeof fetch
}

export interface BrowserClientHandle {
  stop: () => void
}

export interface SessionConnectionState {
  sessionId: string | null
  sessionToken: string | null
  tokenExpiresAt: number | null
  expectsSessionToken: boolean
}

export interface ApplyServerStatusOptions {
  sessionId: string | null
  status?: ApprovalStatus
  active: boolean
}

export type SyncPayload = PageSyncPayload
