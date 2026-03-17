export const COMMAND_ERROR_CODES = [
  'STALE_SNAPSHOT',
  'TARGET_NOT_FOUND',
  'NOT_VISIBLE',
  'DISABLED',
  'TIMEOUT',
  'SESSION_NOT_ACTIVE',
  'INVALID_TARGET',
  'INVALID_COMMAND',
] as const

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number]

export type ApprovalStatus = 'pending' | 'approved' | 'denied'
export type ActionKind = 'click' | 'fill'
export type WaitState = 'visible' | 'hidden' | 'enabled' | 'disabled'
export type CommandKind = 'act' | 'fill' | 'wait' | 'guide'

export interface CompanionConfig {
  clickDelayMs: number
  pointerAnimation: boolean
  autoScroll: boolean
}

export const DEFAULT_COMPANION_CONFIG: CompanionConfig = {
  clickDelayMs: 0,
  pointerAnimation: false,
  autoScroll: true,
}

export interface PageSnapshotGroup {
  groupId: string
  groupName?: string
  groupDesc?: string
  targetIds: string[]
}

export interface PageTarget {
  targetId: string
  groupId: string
  groupName?: string
  groupDesc?: string
  name: string
  description: string
  actionKind: ActionKind
  selector: string
  visible: boolean
  inViewport: boolean
  enabled: boolean
  covered: boolean
  actionableNow: boolean
  overlay: boolean
  sensitive: boolean
  textContent?: string
  valuePreview?: string | null
  sourceFile: string
  sourceLine: number
  sourceColumn: number
}

export interface PageSnapshot {
  version: number
  capturedAt: number
  url: string
  title: string
  groups: PageSnapshotGroup[]
  targets: PageTarget[]
}

export interface CommandErrorShape {
  code: CommandErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface BaseCommandRequest {
  commandId: string
  config?: Partial<CompanionConfig>
}

export interface ActCommandRequest extends BaseCommandRequest {
  kind: 'act'
  targetId: string
  expectedVersion?: number
}

export interface GuideCommandRequest extends BaseCommandRequest {
  kind: 'guide'
  targetId: string
  expectedVersion?: number
}

export interface FillCommandRequest extends BaseCommandRequest {
  kind: 'fill'
  targetId: string
  value: string
  expectedVersion?: number
}

export interface WaitCommandRequest extends BaseCommandRequest {
  kind: 'wait'
  targetId: string
  state: WaitState
  timeoutMs?: number
}

export type CommandRequest = ActCommandRequest | GuideCommandRequest | FillCommandRequest | WaitCommandRequest

export interface CommandExecutionMetadata {
  snapshotVersion?: number
  snapshot?: PageSnapshot
}

export interface CommandResultSuccess extends CommandExecutionMetadata {
  commandId: string
  ok: true
  result?: Record<string, unknown>
}

export interface CommandResultFailure extends CommandExecutionMetadata {
  commandId: string
  ok: false
  error: CommandErrorShape
}

export type CommandResult = CommandResultSuccess | CommandResultFailure

export interface SessionSnapshot {
  id: string
  appId: string
  origin: string
  url: string
  title: string
  clientVersion: string
  connectedAt: number
  lastSeenAt: number
  approvalStatus: ApprovalStatus
  active: boolean
  targetCount: number
  pendingCommandCount: number
  snapshotVersion: number | null
}

export interface BootstrapSessionResponse {
  sessionId: string
  sessionToken: string | null
  tokenExpiresAt: number | null
  status?: ApprovalStatus
  active?: boolean
  pollIntervalMs?: number
}

export interface PageSyncPayload {
  snapshot: PageSnapshot
  completedCommands: CommandResult[]
  timestamp: number
}

export interface SyncResponse {
  status?: ApprovalStatus
  active?: boolean
  pendingCommands?: CommandRequest[]
}

export interface ServerWsMessage {
  type?: string
  status?: ApprovalStatus
  active?: boolean
  pendingCommands?: CommandRequest[]
  message?: string
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

export function mergeCompanionConfig(
  base: CompanionConfig,
  patch?: Partial<CompanionConfig> | null,
): CompanionConfig {
  if (!patch) {
    return { ...base }
  }

  return normalizeCompanionConfig({
    clickDelayMs: patch.clickDelayMs ?? base.clickDelayMs,
    pointerAnimation: patch.pointerAnimation ?? base.pointerAnimation,
    autoScroll: patch.autoScroll ?? base.autoScroll,
  })
}

export function normalizeCompanionConfig(
  input: Partial<CompanionConfig> | undefined,
): CompanionConfig {
  const clickDelayMs = Number(input?.clickDelayMs ?? DEFAULT_COMPANION_CONFIG.clickDelayMs)

  return {
    clickDelayMs:
      Number.isFinite(clickDelayMs) && clickDelayMs >= 0
        ? Math.floor(clickDelayMs)
        : DEFAULT_COMPANION_CONFIG.clickDelayMs,
    pointerAnimation:
      typeof input?.pointerAnimation === 'boolean'
        ? input.pointerAnimation
        : DEFAULT_COMPANION_CONFIG.pointerAnimation,
    autoScroll:
      typeof input?.autoScroll === 'boolean'
        ? input.autoScroll
        : DEFAULT_COMPANION_CONFIG.autoScroll,
  }
}

export function createCommandError(
  code: CommandErrorCode,
  message: string,
  details?: Record<string, unknown>,
): CommandErrorShape {
  return { code, message, details }
}

export function isCommandErrorCode(value: unknown): value is CommandErrorCode {
  return typeof value === 'string' && COMMAND_ERROR_CODES.includes(value as CommandErrorCode)
}

export function isCommandResultOk(result: CommandResult): result is CommandResultSuccess {
  return result.ok
}
