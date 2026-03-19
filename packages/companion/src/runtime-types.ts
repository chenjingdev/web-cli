import type { ApprovalStatus, CommandRequest, CommandResult, PageSnapshot } from './types.js'

export interface SessionRuntime {
  id: string
  clientId: string
  appId: string
  origin: string
  url: string
  title: string
  clientVersion: string
  connectedAt: number
  lastSeenAt: number
  approvalStatus: ApprovalStatus
  manualAgentActivity: boolean
  manualAgentStopped: boolean
  snapshot: PageSnapshot | null
  outbox: Map<string, OutboxCommand>
}

export interface OutboxCommand {
  commandId: string
  command: CommandRequest
  createdAt: number
  lastDispatchedAt?: number
}

export interface PendingResolver {
  resolve: (result: CommandResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  sessionId: string
}
