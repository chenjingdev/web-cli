import { safeObject } from './http-utils.js'
import type { RuntimeStore } from './runtime-store.js'
import type { PendingResolver, SessionRuntime } from './runtime-types.js'
import type { CommandRequest, CommandResult } from './types.js'

export interface CallQueue {
  queueCommandForSession: (
    session: SessionRuntime,
    command: CommandRequest,
  ) => Promise<CommandResult>
  applyCompletedCommands: (session: SessionRuntime, completedCommands: unknown) => void
  removeSessionEntries: (sessionId: string, reason: string) => void
  close: (reason: string) => void
}

interface CreateCallQueueOptions {
  callTimeoutMs: number
  store: RuntimeStore
  onSessionSyncRequested: (session: SessionRuntime) => void
}

export function createCallQueue(options: CreateCallQueueOptions): CallQueue {
  const { callTimeoutMs, store, onSessionSyncRequested } = options
  const pendingResolvers = new Map<string, PendingResolver>()

  const queueCommandForSession: CallQueue['queueCommandForSession'] = (session, command) => {
    session.outbox.set(command.commandId, {
      commandId: command.commandId,
      command,
      createdAt: Date.now(),
    })

    store.addLog('api', 'command queued', {
      commandId: command.commandId,
      sessionId: session.id,
      kind: command.kind,
      targetId: 'targetId' in command ? command.targetId : undefined,
    })
    onSessionSyncRequested(session)

    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingResolvers.delete(command.commandId)
        session.outbox.delete(command.commandId)
        reject(new Error('command timed out'))
      }, callTimeoutMs)

      pendingResolvers.set(command.commandId, {
        resolve,
        reject,
        timer,
        sessionId: session.id,
      })
    })
  }

  const applyCompletedCommands: CallQueue['applyCompletedCommands'] = (session, completedCommands) => {
    if (!Array.isArray(completedCommands)) return

    for (const item of completedCommands) {
      const result = safeObject(item) as CommandResult | undefined
      if (!result || typeof result.commandId !== 'string') continue

      const pending = pendingResolvers.get(result.commandId)
      if (!pending) continue

      clearTimeout(pending.timer)
      pendingResolvers.delete(result.commandId)
      session.outbox.delete(result.commandId)
      pending.resolve(result)
    }
  }

  const removeSessionEntries = (sessionId: string, reason: string): void => {
    for (const [commandId, pending] of Array.from(pendingResolvers.entries())) {
      if (pending.sessionId !== sessionId) continue
      clearTimeout(pending.timer)
      pendingResolvers.delete(commandId)
      pending.reject(new Error(reason))
    }
  }

  const close = (reason: string): void => {
    for (const [commandId, pending] of pendingResolvers.entries()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
      pendingResolvers.delete(commandId)
    }
  }

  return {
    queueCommandForSession,
    applyCompletedCommands,
    removeSessionEntries,
    close,
  }
}
