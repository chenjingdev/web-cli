import { isCommandErrorCode } from '@webcli-dom/core'
import { safeObject } from './http-utils.js'
import type {
  CommandResult,
  CompanionConfig,
  PageSnapshot,
  PageSyncPayload,
} from './types.js'

export const COMPANION_VERSION = '0.1.0'
export const VERSION = COMPANION_VERSION

export class CompanionApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function sanitizeConfigPatch(input: unknown): Partial<CompanionConfig> {
  const payload = safeObject(input)
  if (!payload) return {}

  const patch: Partial<CompanionConfig> = {}
  if (payload.clickDelayMs !== undefined) {
    const parsed = Number(payload.clickDelayMs)
    if (Number.isFinite(parsed) && parsed >= 0) {
      patch.clickDelayMs = Math.floor(parsed)
    }
  }
  if (typeof payload.pointerAnimation === 'boolean') {
    patch.pointerAnimation = payload.pointerAnimation
  }
  if (typeof payload.autoScroll === 'boolean') {
    patch.autoScroll = payload.autoScroll
  }
  if (typeof payload.cursorName === 'string' && payload.cursorName.trim()) {
    patch.cursorName = payload.cursorName.trim()
  }
  if (typeof payload.auroraGlow === 'boolean') {
    patch.auroraGlow = payload.auroraGlow
  }
  if (payload.auroraTheme === 'light' || payload.auroraTheme === 'dark') {
    patch.auroraTheme = payload.auroraTheme
  }
  return patch
}

export function sanitizeSnapshot(input: unknown): PageSnapshot | null {
  const payload = safeObject(input)
  if (!payload) return null
  if (!Array.isArray(payload.targets) || !Array.isArray(payload.groups)) return null
  if (typeof payload.version !== 'number') return null
  if (typeof payload.url !== 'string' || typeof payload.title !== 'string') return null
  return payload as unknown as PageSnapshot
}

export function sanitizeCommandResults(input: unknown): CommandResult[] {
  if (!Array.isArray(input)) return []

  return input.flatMap(item => {
    const payload = safeObject(item)
    if (!payload || typeof payload.commandId !== 'string' || typeof payload.ok !== 'boolean') {
      return []
    }

    if (payload.ok) {
      return [payload as unknown as CommandResult]
    }

    const error = safeObject(payload.error)
    if (!error || !isCommandErrorCode(error.code) || typeof error.message !== 'string') {
      return []
    }

    return [payload as unknown as CommandResult]
  })
}

export function sanitizePageSyncPayload(input: unknown): PageSyncPayload | null {
  const payload = safeObject(input)
  if (!payload) return null

  const snapshot = sanitizeSnapshot(payload.snapshot)
  if (!snapshot) return null

  return {
    snapshot,
    completedCommands: sanitizeCommandResults(payload.completedCommands),
    timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
  }
}
