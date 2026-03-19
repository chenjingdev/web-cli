import http from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { parseJson, safeObject, stringifyError } from './http-utils.js'
import { getRequestOrigin, resolveAuthenticatedPageSession } from './page-auth.js'
import { sanitizePageSyncPayload } from './protocol.js'
import type { RuntimeStore } from './runtime-store.js'
import type { SessionRuntime } from './runtime-types.js'
import type { SessionManager } from './session-manager.js'

interface PageWsMessage {
  type?: string
  snapshot?: unknown
  completedCommands?: unknown
  timestamp?: unknown
}

export interface PageWsController {
  sendSessionSyncResult: (session: SessionRuntime) => void
  pushStatusUpdates: () => void
  handleUpgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void
  close: () => Promise<void>
}

interface PageWsOptions {
  host: string
  port: number
  store: RuntimeStore
  sessionManager: SessionManager
  signingSecret: Buffer
}

function toMessageText(raw: Buffer | Buffer[] | ArrayBuffer | string): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  return Buffer.from(raw).toString('utf8')
}

export function createPageWebSocketServer({
  host,
  port,
  store,
  sessionManager,
  signingSecret,
}: PageWsOptions): PageWsController {
  const pageWsServer = new WebSocketServer({ noServer: true })

  const sendSocketPayload = (socket: WebSocket, payload: unknown): void => {
    if (socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(payload))
    } catch (error) {
      store.addLog('error', 'failed to send websocket payload', {
        error: stringifyError(error),
      })
    }
  }

  const sendSessionSyncResult = (session: SessionRuntime): void => {
    const socket = sessionManager.getSocket(session.id)
    if (!socket) return
    sendSocketPayload(socket, {
      type: 'syncResult',
      ...sessionManager.buildPageSyncResponse(session),
    })
  }

  const pushStatusUpdates = (): void => {
    for (const session of sessionManager.listSessions()) {
      const socket = sessionManager.getSocket(session.id)
      if (!socket) continue
      sendSocketPayload(socket, {
        type: 'status',
        status: session.approvalStatus,
        active: sessionManager.isSessionActive(session),
        agentActive: sessionManager.isAgentActive(session),
        agentStopped: sessionManager.isAgentStopped(session),
        config: { ...store.persisted.config },
      })
      if (sessionManager.isSessionActive(session)) {
        const pendingCommands = sessionManager.collectPendingCommands(session)
        if (pendingCommands.length > 0) {
          sendSocketPayload(socket, {
            type: 'pendingCommands',
            status: session.approvalStatus,
            active: true,
            pendingCommands,
          })
        }
      }
    }
  }

  const handlePageWsSync = (sessionId: string, payload: PageWsMessage, socket: WebSocket): void => {
    sessionManager.pruneExpiredSessions(Date.now(), sessionId)
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      sendSocketPayload(socket, {
        type: 'error',
        code: 'unknown_session',
        message: 'Unknown sessionId',
      })
      try {
        socket.close(1008, 'unknown session')
      } catch {
        // noop
      }
      return
    }

    const syncPayload = sanitizePageSyncPayload(payload)
    if (!syncPayload) {
      sendSocketPayload(socket, {
        type: 'error',
        code: 'invalid_payload',
        message: 'Invalid websocket payload',
      })
      return
    }

    sessionManager.applyPageSyncPayload(session, syncPayload)
    sendSocketPayload(socket, {
      type: 'syncResult',
      ...sessionManager.buildPageSyncResponse(session),
    })
  }

  pageWsServer.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
    const wsUrl = new URL(req.url ?? '/', `http://${host}:${port}`)
    const sessionId = wsUrl.searchParams.get('sessionId')?.trim() ?? ''
    if (!sessionId) {
      socket.close(1008, 'sessionId required')
      return
    }

    const origin = getRequestOrigin(req)
    if (!origin) {
      socket.close(1008, 'origin header required')
      return
    }

    const sessionToken = wsUrl.searchParams.get('token')?.trim() ?? ''
    if (!sessionToken) {
      socket.close(1008, 'session token required')
      return
    }

    sessionManager.pruneExpiredSessions(Date.now(), sessionId)
    const session = resolveAuthenticatedPageSession({
      sessionManager,
      expectedSessionId: sessionId,
      origin,
      bearerToken: sessionToken,
      signingSecret,
    })
    if (!session) {
      socket.close(1008, 'invalid session token')
      return
    }

    const attachedSession = sessionManager.attachSocket(sessionId, socket)
    if (!attachedSession) {
      socket.close(1008, 'unknown session')
      return
    }
    sendSessionSyncResult(attachedSession)

    socket.on('message', (raw: Buffer | Buffer[] | ArrayBuffer | string) => {
      const parsed = parseJson(toMessageText(raw))
      const payload = safeObject(parsed) as PageWsMessage | undefined
      if (!payload) {
        sendSocketPayload(socket, {
          type: 'error',
          code: 'invalid_payload',
          message: 'Invalid websocket payload',
        })
        return
      }

      const type = typeof payload.type === 'string' ? payload.type : 'sync'
      if (type === 'sync') {
        handlePageWsSync(sessionId, payload, socket)
        return
      }

      if (type === 'ping') {
        sendSocketPayload(socket, { type: 'pong' })
        return
      }

      sendSocketPayload(socket, {
        type: 'error',
        code: 'unsupported_message_type',
        message: `Unsupported message type: ${type}`,
      })
    })

    socket.on('close', () => {
      sessionManager.detachSocket(sessionId, socket)
    })

    socket.on('error', (error: Error) => {
      store.addLog('error', 'session websocket error', {
        sessionId,
        error: stringifyError(error),
      })
    })
  })

  const handleUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    try {
      const upgradeUrl = new URL(req.url ?? '/', `http://${host}:${port}`)
      if (upgradeUrl.pathname !== '/page/ws') {
        socket.destroy()
        return
      }
      pageWsServer.handleUpgrade(req, socket, head, upgradedSocket => {
        pageWsServer.emit('connection', upgradedSocket, req)
      })
    } catch {
      socket.destroy()
    }
  }

  return {
    sendSessionSyncResult,
    pushStatusUpdates,
    handleUpgrade,
    close: async () => {
      await new Promise<void>(resolve => {
        pageWsServer.close(() => resolve())
      })
    },
  }
}
