import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'
import { CompanionApiError, sanitizePageSyncPayload } from './protocol.js'
import type { CallQueue } from './call-queue.js'
import type { RuntimeStore } from './runtime-store.js'
import type { SessionRuntime } from './runtime-types.js'
import type {
  ApprovalStatus,
  CompanionConfig,
  CommandRequest,
  PageSyncPayload,
  SessionSnapshot,
} from './types.js'

export interface PageSessionConnectInput {
  sessionId?: string
  clientId: string
  appId: string
  origin: string
  url: string
  title: string
  clientVersion: string
}

export interface SessionManager {
  getSession: (sessionId: string) => SessionRuntime | undefined
  listSessions: () => SessionRuntime[]
  listSessionSnapshots: () => SessionSnapshot[]
  countSessions: () => number
  isSessionActive: (session: SessionRuntime) => boolean
  isAgentStopped: (session: SessionRuntime) => boolean
  collectPendingCommands: (session: SessionRuntime) => CommandRequest[]
  isAgentActive: (session: SessionRuntime) => boolean
  beginAgentActivity: (session: SessionRuntime) => void
  endAgentActivity: (session: SessionRuntime) => void
  stopAgentActivity: (session: SessionRuntime) => void
  buildPageSyncResponse: (
    session: SessionRuntime,
  ) => {
    status: ApprovalStatus
    active: boolean
    agentActive: boolean
    agentStopped: boolean
    pendingCommands: CommandRequest[]
    config: CompanionConfig
  }
  connectSession: (input: PageSessionConnectInput) => SessionRuntime
  applyPageSyncPayload: (session: SessionRuntime, payload: PageSyncPayload) => void
  pruneExpiredSessions: (now?: number, preserveSessionId?: string) => void
  getActiveApprovedSession: () => SessionRuntime
  getSessionForSnapshot: (sessionId?: string | null) => SessionRuntime
  setActiveSession: (sessionId: string | null) => void
  applyOriginApproval: (origin: string, status: ApprovalStatus) => void
  listOrigins: () => Array<{ origin: string; status: ApprovalStatus }>
  getApprovalCounts: () => Record<ApprovalStatus, number>
  scheduleDisconnectedSessionRemoval: (sessionId: string) => void
  clearDisconnectedSessionRemoval: (sessionId: string) => void
  getSocket: (sessionId: string) => WebSocket | undefined
  attachSocket: (sessionId: string, socket: WebSocket) => SessionRuntime | undefined
  detachSocket: (sessionId: string, socket: WebSocket) => void
  close: (reason: string) => Promise<void>
}

interface CreateSessionManagerOptions {
  heartbeatTimeoutMs: number
  pollIntervalMs: number
  staleSessionGraceMultiplier?: number
  wsDisconnectRemoveDelayMs: number
  store: RuntimeStore
  callQueue: CallQueue
  onStatusChanged: () => void
}

export function createSessionManager(options: CreateSessionManagerOptions): SessionManager {
  const {
    heartbeatTimeoutMs,
    pollIntervalMs,
    staleSessionGraceMultiplier,
    wsDisconnectRemoveDelayMs,
    store,
    callQueue,
    onStatusChanged,
  } = options
  const staleSessionTimeoutMs = Math.max(
    heartbeatTimeoutMs * (staleSessionGraceMultiplier ?? 3),
    pollIntervalMs * (staleSessionGraceMultiplier ?? 3),
  )

  const sessions = new Map<string, SessionRuntime>()
  const sessionByClient = new Map<string, string>()
  const sessionSockets = new Map<string, WebSocket>()
  const disconnectedSessionTimers = new Map<string, NodeJS.Timeout>()

  const isSessionStale = (session: SessionRuntime, now = Date.now()): boolean =>
    now - session.lastSeenAt > staleSessionTimeoutMs

  const chooseFallbackActiveSession = (): string | null => {
    const approvedSessions = Array.from(sessions.values())
      .filter(session => session.approvalStatus === 'approved' && !isSessionStale(session))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    return approvedSessions[0]?.id ?? null
  }

  const setActiveSession = (sessionId: string | null): void => {
    store.setActiveSessionId(sessionId)
    for (const session of sessions.values()) {
      if (session.id !== sessionId) {
        session.manualAgentActivity = false
      }
    }
    onStatusChanged()
  }

  const isSessionActive = (session: SessionRuntime): boolean =>
    store.persisted.activeSessionId === session.id && session.approvalStatus === 'approved'

  const isAgentActive = (session: SessionRuntime): boolean =>
    session.manualAgentActivity && !session.manualAgentStopped

  const isAgentStopped = (session: SessionRuntime): boolean => session.manualAgentStopped

  const beginAgentActivity = (session: SessionRuntime): void => {
    session.manualAgentStopped = false
    session.manualAgentActivity = true
    onStatusChanged()
  }

  const endAgentActivity = (session: SessionRuntime): void => {
    session.manualAgentActivity = false
    onStatusChanged()
  }

  const stopAgentActivity = (session: SessionRuntime): void => {
    session.manualAgentActivity = false
    session.manualAgentStopped = true
    session.outbox.clear()
    callQueue.removeSessionEntries(session.id, 'agent manually stopped')
    onStatusChanged()
  }

  const collectPendingCommands = (session: SessionRuntime): CommandRequest[] => {
    if (!isSessionActive(session)) return []
    const pendingCommands: CommandRequest[] = []
    const now = Date.now()
    for (const entry of session.outbox.values()) {
      if (!entry.lastDispatchedAt || now - entry.lastDispatchedAt > 1_500) {
        entry.lastDispatchedAt = now
        pendingCommands.push(entry.command)
      }
    }
    return pendingCommands
  }

  const buildPageSyncResponse = (session: SessionRuntime) => ({
    status: session.approvalStatus,
    active: isSessionActive(session),
    agentActive: isSessionActive(session) && isAgentActive(session),
    agentStopped: isSessionActive(session) && isAgentStopped(session),
    pendingCommands: isAgentStopped(session) ? [] : collectPendingCommands(session),
    config: { ...store.persisted.config },
  })

  const removeSession = (sessionId: string, reason: string): boolean => {
    const session = sessions.get(sessionId)
    if (!session) return false

    const disconnectedTimer = disconnectedSessionTimers.get(sessionId)
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer)
      disconnectedSessionTimers.delete(sessionId)
    }

    sessions.delete(sessionId)
    if (sessionByClient.get(session.clientId) === sessionId) {
      sessionByClient.delete(session.clientId)
    }

    callQueue.removeSessionEntries(sessionId, reason)

    const socket = sessionSockets.get(sessionId)
    if (socket) {
      sessionSockets.delete(sessionId)
      try {
        socket.close(1000, reason.slice(0, 120))
      } catch {
        // noop
      }
    }

    if (store.persisted.activeSessionId === sessionId) {
      setActiveSession(chooseFallbackActiveSession())
    }

    store.addLog('system', 'session removed', {
      sessionId,
      clientId: session.clientId,
      origin: session.origin,
      reason,
    })

    return true
  }

  const scheduleDisconnectedSessionRemoval = (sessionId: string): void => {
    const existingTimer = disconnectedSessionTimers.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      disconnectedSessionTimers.delete(sessionId)
      if (sessionSockets.has(sessionId)) return
      removeSession(sessionId, 'session websocket disconnected')
    }, wsDisconnectRemoveDelayMs)

    disconnectedSessionTimers.set(sessionId, timer)
  }

  const clearDisconnectedSessionRemoval = (sessionId: string): void => {
    const timer = disconnectedSessionTimers.get(sessionId)
    if (!timer) return
    clearTimeout(timer)
    disconnectedSessionTimers.delete(sessionId)
  }

  const pruneExpiredSessions = (now = Date.now(), preserveSessionId?: string): void => {
    for (const session of Array.from(sessions.values())) {
      if (preserveSessionId && session.id === preserveSessionId) continue
      if (isSessionStale(session, now)) {
        removeSession(session.id, 'session heartbeat expired')
      }
    }
  }

  const connectSession = (input: PageSessionConnectInput): SessionRuntime => {
    const {
      sessionId: requestedSessionId,
      clientId,
      appId,
      origin,
      url,
      title,
      clientVersion,
    } = input
    pruneExpiredSessions()

    const approval = store.ensureApprovalTracked(origin)
    let sessionId = requestedSessionId
    if (!sessionId || !sessions.has(sessionId)) {
      const existingSessionId = sessionByClient.get(clientId)
      if (existingSessionId && sessions.has(existingSessionId)) {
        sessionId = existingSessionId
      } else {
        sessionId = randomUUID()
      }
    }

    const now = Date.now()
    const existing = sessions.get(sessionId)
    const session: SessionRuntime = existing ?? {
      id: sessionId,
      clientId,
      appId,
      origin,
      url,
      title,
      clientVersion,
      connectedAt: now,
      lastSeenAt: now,
      approvalStatus: approval,
      manualAgentActivity: false,
      manualAgentStopped: false,
      snapshot: null,
      outbox: new Map(),
    }

    session.clientId = clientId
    session.appId = appId
    session.origin = origin
    session.url = url
    session.title = title
    session.clientVersion = clientVersion || 'unknown'
    session.lastSeenAt = now
    session.approvalStatus = store.persisted.approvals[origin] ?? approval

    sessions.set(session.id, session)
    sessionByClient.set(clientId, session.id)

    if (session.approvalStatus === 'approved' && !store.persisted.activeSessionId) {
      setActiveSession(session.id)
    }

    store.addLog('page', 'session connected', {
      sessionId: session.id,
      appId,
      origin,
      approval: session.approvalStatus,
    })

    return session
  }

  const toSessionSnapshot = (session: SessionRuntime): SessionSnapshot => ({
    id: session.id,
    appId: session.appId,
    origin: session.origin,
    url: session.url,
    title: session.title,
    clientVersion: session.clientVersion,
    connectedAt: session.connectedAt,
    lastSeenAt: session.lastSeenAt,
    approvalStatus: session.approvalStatus,
    active: store.persisted.activeSessionId === session.id,
    agentActive: isSessionActive(session) && isAgentActive(session),
    agentStopped: isSessionActive(session) && isAgentStopped(session),
    targetCount: session.snapshot?.targets.length ?? 0,
    pendingCommandCount: session.outbox.size,
    snapshotVersion: session.snapshot?.version ?? null,
  })

  const applyPageSyncPayload = (session: SessionRuntime, payload: PageSyncPayload): void => {
    session.lastSeenAt = Date.now()
    session.approvalStatus =
      store.persisted.approvals[session.origin] ?? store.ensureApprovalTracked(session.origin)
    const sanitized = sanitizePageSyncPayload(payload)
    if (!sanitized) {
      return
    }
    session.snapshot = sanitized.snapshot
    callQueue.applyCompletedCommands(session, sanitized.completedCommands)
  }

  const listSessionSnapshots = (): SessionSnapshot[] =>
    Array.from(sessions.values())
      .map(toSessionSnapshot)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)

  const getActiveApprovedSession = (): SessionRuntime => {
    const activeId = store.persisted.activeSessionId
    if (!activeId) {
      throw new CompanionApiError(404, '활성 세션이 없습니다.')
    }

    const session = sessions.get(activeId)
    if (!session) {
      throw new CompanionApiError(404, '활성 세션이 존재하지 않습니다.')
    }

    if (session.approvalStatus !== 'approved') {
      throw new CompanionApiError(409, '활성 세션 origin이 승인되지 않았습니다.')
    }

    if (Date.now() - session.lastSeenAt > heartbeatTimeoutMs) {
      throw new CompanionApiError(409, '활성 세션 heartbeat가 만료되었습니다.')
    }

    return session
  }

  const getSessionForSnapshot = (sessionId?: string | null): SessionRuntime => {
    if (sessionId) {
      const direct = sessions.get(sessionId)
      if (!direct) {
        throw new CompanionApiError(404, '세션을 찾을 수 없습니다.')
      }
      return direct
    }
    return getActiveApprovedSession()
  }

  const applyOriginApproval = (origin: string, status: ApprovalStatus): void => {
    store.setOriginApproval(origin, status)
    for (const session of sessions.values()) {
      if (session.origin === origin) {
        session.approvalStatus = status
      }
    }

    const activeSession = store.persisted.activeSessionId
      ? sessions.get(store.persisted.activeSessionId)
      : null
    if (!activeSession || activeSession.approvalStatus !== 'approved') {
      setActiveSession(chooseFallbackActiveSession())
      return
    }

    onStatusChanged()
  }

  const getApprovalCounts = (): Record<ApprovalStatus, number> => {
    const counts: Record<ApprovalStatus, number> = {
      pending: 0,
      approved: 0,
      denied: 0,
    }

    for (const { status } of store.listOrigins()) {
      counts[status] += 1
    }

    return counts
  }

  return {
    getSession: sessionId => sessions.get(sessionId),
    listSessions: () => Array.from(sessions.values()),
    listSessionSnapshots,
    countSessions: () => sessions.size,
    isSessionActive,
    isAgentStopped,
    isAgentActive,
    beginAgentActivity,
    endAgentActivity,
    stopAgentActivity,
    collectPendingCommands,
    buildPageSyncResponse,
    connectSession,
    applyPageSyncPayload,
    pruneExpiredSessions,
    getActiveApprovedSession,
    getSessionForSnapshot,
    setActiveSession,
    applyOriginApproval,
    listOrigins: () => store.listOrigins(),
    getApprovalCounts,
    scheduleDisconnectedSessionRemoval,
    clearDisconnectedSessionRemoval,
    getSocket: sessionId => sessionSockets.get(sessionId),
    attachSocket: (sessionId, socket) => {
      const session = sessions.get(sessionId)
      if (!session) return undefined
      clearDisconnectedSessionRemoval(sessionId)
      const previous = sessionSockets.get(sessionId)
      if (previous && previous !== socket) {
        try {
          previous.close(1000, 'replaced by newer websocket')
        } catch {
          // noop
        }
      }
      sessionSockets.set(sessionId, socket)
      return session
    },
    detachSocket: (sessionId, socket) => {
      const current = sessionSockets.get(sessionId)
      if (current === socket) {
        sessionSockets.delete(sessionId)
        scheduleDisconnectedSessionRemoval(sessionId)
      }
    },
    async close(reason: string) {
      for (const socket of sessionSockets.values()) {
        try {
          socket.close(1001, reason.slice(0, 120))
        } catch {
          // noop
        }
      }
      sessionSockets.clear()
      for (const timer of disconnectedSessionTimers.values()) {
        clearTimeout(timer)
      }
      disconnectedSessionTimers.clear()
      callQueue.close(reason)
    },
  }
}
