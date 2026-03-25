export const COMMAND_ERROR_CODES = [
  'STALE_SNAPSHOT',
  'TARGET_NOT_FOUND',
  'NOT_VISIBLE',
  'DISABLED',
  'FLOW_BLOCKED',
  'TIMEOUT',
  'SESSION_NOT_ACTIVE',
  'AGENT_STOPPED',
  'INVALID_TARGET',
  'INVALID_COMMAND',
] as const

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number]

export type ActionKind = 'click' | 'fill' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress'
export type DragPlacement = 'before' | 'inside' | 'after'
export type WaitState = 'visible' | 'hidden' | 'enabled' | 'disabled'
export type CommandKind = 'act' | 'drag' | 'fill' | 'wait' | 'guide' | 'read'
export type AuroraTheme = 'dark' | 'light'
export type PageTargetReason =
  | 'ready'
  | 'hidden'
  | 'offscreen'
  | 'covered'
  | 'disabled'
  | 'sensitive'

export interface AgagruneRuntimeConfig {
  clickDelayMs: number
  pointerDurationMs: number
  pointerAnimation: boolean
  autoScroll: boolean
  cursorName: string
  auroraGlow: boolean
  auroraTheme: AuroraTheme
}

export const DEFAULT_RUNTIME_CONFIG: AgagruneRuntimeConfig = {
  clickDelayMs: 300,
  pointerDurationMs: 600,
  pointerAnimation: true,
  autoScroll: true,
  cursorName: 'default',
  auroraGlow: true,
  auroraTheme: 'light',
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
  reason: PageTargetReason
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
  config?: Partial<AgagruneRuntimeConfig>
}

export interface ActCommandRequest extends BaseCommandRequest {
  kind: 'act'
  targetId: string
  action?: 'click' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress'
  expectedVersion?: number
}

export interface GuideCommandRequest extends BaseCommandRequest {
  kind: 'guide'
  targetId: string
  expectedVersion?: number
}

export interface DragCommandRequest extends BaseCommandRequest {
  kind: 'drag'
  sourceTargetId: string
  destinationTargetId: string
  placement?: DragPlacement
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

export interface ReadCommandRequest extends BaseCommandRequest {
  kind: 'read'
  selector?: string
  expectedVersion?: number
}

export type CommandRequest =
  | ActCommandRequest
  | DragCommandRequest
  | GuideCommandRequest
  | FillCommandRequest
  | WaitCommandRequest
  | ReadCommandRequest

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

export function mergeRuntimeConfig(
  base: AgagruneRuntimeConfig,
  patch?: Partial<AgagruneRuntimeConfig> | null,
): AgagruneRuntimeConfig {
  if (!patch) {
    return { ...base }
  }

  return normalizeRuntimeConfig({
    clickDelayMs: patch.clickDelayMs ?? base.clickDelayMs,
    pointerDurationMs: patch.pointerDurationMs ?? base.pointerDurationMs,
    pointerAnimation: patch.pointerAnimation ?? base.pointerAnimation,
    autoScroll: patch.autoScroll ?? base.autoScroll,
    cursorName: patch.cursorName ?? base.cursorName,
    auroraGlow: patch.auroraGlow ?? base.auroraGlow,
    auroraTheme: patch.auroraTheme ?? base.auroraTheme,
  })
}

export function normalizeRuntimeConfig(
  input: Partial<AgagruneRuntimeConfig> | undefined,
): AgagruneRuntimeConfig {
  const clickDelayMs = Number(input?.clickDelayMs ?? DEFAULT_RUNTIME_CONFIG.clickDelayMs)
  const pointerDurationMs = Number(input?.pointerDurationMs ?? DEFAULT_RUNTIME_CONFIG.pointerDurationMs)

  return {
    clickDelayMs:
      Number.isFinite(clickDelayMs) && clickDelayMs >= 0
        ? Math.floor(clickDelayMs)
        : DEFAULT_RUNTIME_CONFIG.clickDelayMs,
    pointerDurationMs:
      Number.isFinite(pointerDurationMs) && pointerDurationMs >= 0
        ? Math.floor(pointerDurationMs)
        : DEFAULT_RUNTIME_CONFIG.pointerDurationMs,
    pointerAnimation:
      typeof input?.pointerAnimation === 'boolean'
        ? input.pointerAnimation
        : DEFAULT_RUNTIME_CONFIG.pointerAnimation,
    autoScroll:
      typeof input?.autoScroll === 'boolean'
        ? input.autoScroll
        : DEFAULT_RUNTIME_CONFIG.autoScroll,
    cursorName:
      typeof input?.cursorName === 'string' && input.cursorName.trim()
        ? input.cursorName.trim()
        : DEFAULT_RUNTIME_CONFIG.cursorName,
    auroraGlow:
      typeof input?.auroraGlow === 'boolean'
        ? input.auroraGlow
        : DEFAULT_RUNTIME_CONFIG.auroraGlow,
    auroraTheme:
      input?.auroraTheme === 'light' || input?.auroraTheme === 'dark'
        ? input.auroraTheme
        : DEFAULT_RUNTIME_CONFIG.auroraTheme,
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

export * from './native-messages'
