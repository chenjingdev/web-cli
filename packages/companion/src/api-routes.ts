import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readBearerToken } from './tokens.js'
import { parseJson, readBody, safeObject, writeJson } from './http-utils.js'
import { CompanionApiError, sanitizeConfigPatch } from './protocol.js'
import {
  buildSnapshotSummaryPayload,
  buildSnapshotTargetsPayload,
} from './snapshot-views.js'
import type { CallQueue } from './call-queue.js'
import type { RuntimeStore } from './runtime-store.js'
import type { SessionManager } from './session-manager.js'
import type { CompanionConfig, CompanionPaths } from './types.js'

export interface ApiRoutes {
  handleApi: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<boolean>
}

interface ApiRoutesOptions {
  host: string
  port: number
  paths: CompanionPaths
  agentToken: string
  store: RuntimeStore
  sessionManager: SessionManager
  callQueue: CallQueue
  onConfigChanged?: () => void
}

function isAuthorized(req: http.IncomingMessage, agentToken: string): boolean {
  return readBearerToken(req) === agentToken
}

function parseBooleanSearchParam(value: string | null): boolean {
  return value === 'true'
}

export function createApiRoutes({
  host,
  port,
  paths,
  agentToken,
  store,
  sessionManager,
  callQueue,
  onConfigChanged,
}: ApiRoutesOptions): ApiRoutes {
  const requireRunnableSession = (): ReturnType<SessionManager['getActiveApprovedSession']> => {
    const session = sessionManager.getActiveApprovedSession()
    if (sessionManager.isAgentStopped(session)) {
      throw new CompanionApiError(
        409,
        '에이전트가 수동 정지되었습니다. 먼저 재개하세요.',
        'AGENT_STOPPED',
      )
    }
    return session
  }

  const handleApi = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<boolean> => {
    if (!url.pathname.startsWith('/api/')) return false
    if (!isAuthorized(req, agentToken)) {
      writeJson(res, 401, { error: 'Unauthorized' })
      return true
    }

    sessionManager.pruneExpiredSessions()
    const pathname = url.pathname

    const handleError = (error: unknown) => {
      if (error instanceof CompanionApiError) {
        writeJson(res, error.status, {
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        })
        return
      }
      writeJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    try {
      if (req.method === 'GET' && pathname === '/api/status') {
        const activeSession = store.persisted.activeSessionId
          ? sessionManager.getSession(store.persisted.activeSessionId)
          : undefined
        writeJson(res, 200, {
          endpoint: `http://${host}:${port}`,
          homeDir: paths.homeDir,
          tokenPath: paths.tokenPath,
          pidPath: paths.pidPath,
          sessionCount: sessionManager.countSessions(),
          activeSessionId: store.persisted.activeSessionId,
          agentActive: activeSession ? sessionManager.isAgentActive(activeSession) : false,
          agentStopped: activeSession ? sessionManager.isAgentStopped(activeSession) : false,
          approvals: sessionManager.getApprovalCounts(),
          config: store.persisted.config,
        })
        return true
      }

      if (req.method === 'GET' && pathname === '/api/sessions') {
        writeJson(res, 200, { sessions: sessionManager.listSessionSnapshots() })
        return true
      }

      if (req.method === 'POST' && pathname === '/api/sessions/activate') {
        const payload = safeObject(parseJson(await readBody(req)))
        const sessionId =
          payload?.sessionId === null
            ? null
            : typeof payload?.sessionId === 'string'
              ? payload.sessionId.trim()
              : undefined

        if (sessionId === undefined) {
          writeJson(res, 400, { error: 'sessionId must be string or null' })
          return true
        }
        if (sessionId) {
          const session = sessionManager.getSession(sessionId)
          if (!session) {
            writeJson(res, 404, { error: 'session not found' })
            return true
          }
          if (session.approvalStatus !== 'approved') {
            writeJson(res, 409, { error: 'session origin is not approved' })
            return true
          }
        }
        sessionManager.setActiveSession(sessionId)
        writeJson(res, 200, { ok: true, activeSessionId: store.persisted.activeSessionId })
        return true
      }

      if (req.method === 'GET' && pathname === '/api/snapshot') {
        const sessionId = url.searchParams.get('sessionId')?.trim() ?? null
        const session = sessionManager.getSessionForSnapshot(sessionId)
        writeJson(res, 200, {
          sessionId: session.id,
          approvalStatus: session.approvalStatus,
          snapshot: session.snapshot,
        })
        return true
      }

      if (req.method === 'GET' && pathname === '/api/snapshot/summary') {
        const sessionId = url.searchParams.get('sessionId')?.trim() ?? null
        const session = sessionManager.getSessionForSnapshot(sessionId)
        writeJson(
          res,
          200,
          buildSnapshotSummaryPayload({
            approvalStatus: session.approvalStatus,
            options: {
              includeBackground: parseBooleanSearchParam(
                url.searchParams.get('includeBackground'),
              ),
            },
            sessionId: session.id,
            snapshot: session.snapshot,
          }),
        )
        return true
      }

      if (req.method === 'GET' && pathname === '/api/snapshot/targets') {
        const sessionId = url.searchParams.get('sessionId')?.trim() ?? null
        const groupId = url.searchParams.get('groupId')?.trim() ?? ''
        if (!groupId) {
          writeJson(res, 400, { error: 'groupId is required' })
          return true
        }
        const session = sessionManager.getSessionForSnapshot(sessionId)
        writeJson(
          res,
          200,
          buildSnapshotTargetsPayload({
            approvalStatus: session.approvalStatus,
            groupId,
            options: {
              includeBackground: parseBooleanSearchParam(
                url.searchParams.get('includeBackground'),
              ),
              includeBlocked: parseBooleanSearchParam(
                url.searchParams.get('includeBlocked'),
              ),
              query: url.searchParams.get('query') ?? undefined,
            },
            sessionId: session.id,
            snapshot: session.snapshot,
          }),
        )
        return true
      }

      if (req.method === 'GET' && pathname === '/api/config') {
        writeJson(res, 200, store.persisted.config)
        return true
      }

      if (req.method === 'PUT' && pathname === '/api/config') {
        const payload = parseJson(await readBody(req))
        const next = store.updateConfig(sanitizeConfigPatch(payload))
        onConfigChanged?.()
        writeJson(res, 200, next)
        return true
      }

      if (req.method === 'GET' && pathname === '/api/origins') {
        writeJson(res, 200, { origins: sessionManager.listOrigins() })
        return true
      }

      if (req.method === 'POST' && pathname === '/api/origins/approve') {
        const payload = safeObject(parseJson(await readBody(req)))
        const origin = typeof payload?.origin === 'string' ? payload.origin.trim() : ''
        if (!origin) {
          writeJson(res, 400, { error: 'origin is required' })
          return true
        }
        sessionManager.applyOriginApproval(origin, 'approved')
        writeJson(res, 200, { ok: true })
        return true
      }

      if (req.method === 'POST' && pathname === '/api/origins/revoke') {
        const payload = safeObject(parseJson(await readBody(req)))
        const origin = typeof payload?.origin === 'string' ? payload.origin.trim() : ''
        if (!origin) {
          writeJson(res, 400, { error: 'origin is required' })
          return true
        }
        sessionManager.applyOriginApproval(origin, 'pending')
        writeJson(res, 200, { ok: true })
        return true
      }

      if (req.method === 'GET' && pathname === '/api/logs') {
        const limitRaw = Number(url.searchParams.get('limit') ?? 100)
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100
        writeJson(res, 200, { logs: store.listLogs(limit) })
        return true
      }

      if (req.method === 'POST' && pathname === '/api/commands/act') {
        const payload = safeObject(parseJson(await readBody(req)))
        const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : ''
        if (!targetId) {
          writeJson(res, 400, { error: 'targetId is required' })
          return true
        }
        const session = requireRunnableSession()
        const commandConfig = payload?.config && typeof payload.config === 'object'
          ? payload.config as Partial<CompanionConfig>
          : store.persisted.config
        const result = await callQueue.queueCommandForSession(session, {
          commandId: randomUUID(),
          kind: 'act',
          targetId,
          ...(typeof payload?.expectedVersion === 'number'
            ? { expectedVersion: payload.expectedVersion }
            : {}),
          config: commandConfig,
        })
        writeJson(res, 200, result)
        return true
      }

      if (req.method === 'POST' && pathname === '/api/commands/guide') {
        const payload = safeObject(parseJson(await readBody(req)))
        const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : ''
        if (!targetId) {
          writeJson(res, 400, { error: 'targetId is required' })
          return true
        }
        const session = requireRunnableSession()
        const commandConfig = payload?.config && typeof payload.config === 'object'
          ? payload.config as Partial<CompanionConfig>
          : store.persisted.config
        const result = await callQueue.queueCommandForSession(session, {
          commandId: randomUUID(),
          kind: 'guide',
          targetId,
          ...(typeof payload?.expectedVersion === 'number'
            ? { expectedVersion: payload.expectedVersion }
            : {}),
          config: commandConfig,
        })
        writeJson(res, 200, result)
        return true
      }

      if (req.method === 'POST' && pathname === '/api/commands/drag') {
        const payload = safeObject(parseJson(await readBody(req)))
        const sourceTargetId =
          typeof payload?.sourceTargetId === 'string' ? payload.sourceTargetId.trim() : ''
        const destinationTargetId =
          typeof payload?.destinationTargetId === 'string'
            ? payload.destinationTargetId.trim()
            : ''
        const placement =
          payload?.placement === 'before' ||
          payload?.placement === 'inside' ||
          payload?.placement === 'after'
            ? payload.placement
            : undefined
        if (!sourceTargetId) {
          writeJson(res, 400, { error: 'sourceTargetId is required' })
          return true
        }
        if (!destinationTargetId) {
          writeJson(res, 400, { error: 'destinationTargetId is required' })
          return true
        }
        const session = requireRunnableSession()
        const commandConfig = payload?.config && typeof payload.config === 'object'
          ? payload.config as Partial<CompanionConfig>
          : store.persisted.config
        const result = await callQueue.queueCommandForSession(session, {
          commandId: randomUUID(),
          kind: 'drag',
          sourceTargetId,
          destinationTargetId,
          ...(placement ? { placement } : {}),
          ...(typeof payload?.expectedVersion === 'number'
            ? { expectedVersion: payload.expectedVersion }
            : {}),
          config: commandConfig,
        })
        writeJson(res, 200, result)
        return true
      }

      if (req.method === 'POST' && pathname === '/api/commands/fill') {
        const payload = safeObject(parseJson(await readBody(req)))
        const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : ''
        const value = typeof payload?.value === 'string' ? payload.value : ''
        if (!targetId) {
          writeJson(res, 400, { error: 'targetId is required' })
          return true
        }
        const session = requireRunnableSession()
        const commandConfig = payload?.config && typeof payload.config === 'object'
          ? payload.config as Partial<CompanionConfig>
          : store.persisted.config
        const result = await callQueue.queueCommandForSession(session, {
          commandId: randomUUID(),
          kind: 'fill',
          targetId,
          value,
          ...(typeof payload?.expectedVersion === 'number'
            ? { expectedVersion: payload.expectedVersion }
            : {}),
          config: commandConfig,
        })
        writeJson(res, 200, result)
        return true
      }

      if (req.method === 'POST' && pathname === '/api/commands/wait') {
        const payload = safeObject(parseJson(await readBody(req)))
        const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : ''
        const state = typeof payload?.state === 'string' ? payload.state : ''
        if (!targetId || !state) {
          writeJson(res, 400, { error: 'targetId and state are required' })
          return true
        }
        const session = requireRunnableSession()
        const result = await callQueue.queueCommandForSession(session, {
          commandId: randomUUID(),
          kind: 'wait',
          targetId,
          state: state as 'visible' | 'hidden' | 'enabled' | 'disabled',
          ...(typeof payload?.timeoutMs === 'number' ? { timeoutMs: payload.timeoutMs } : {}),
        })
        writeJson(res, 200, result)
        return true
      }

      if (req.method === 'POST' && pathname === '/api/agent-activity/start') {
        const session = sessionManager.getActiveApprovedSession()
        sessionManager.beginAgentActivity(session)
        writeJson(res, 200, {
          ok: true,
          sessionId: session.id,
          agentActive: true,
          agentStopped: false,
        })
        return true
      }

      if (req.method === 'POST' && pathname === '/api/agent-activity/end') {
        const session = sessionManager.getActiveApprovedSession()
        sessionManager.endAgentActivity(session)
        writeJson(res, 200, {
          ok: true,
          sessionId: session.id,
          agentActive: false,
          agentStopped: false,
        })
        return true
      }

      if (req.method === 'POST' && pathname === '/api/agent-activity/stop') {
        const session = sessionManager.getActiveApprovedSession()
        sessionManager.stopAgentActivity(session)
        writeJson(res, 200, {
          ok: true,
          sessionId: session.id,
          agentActive: false,
          agentStopped: true,
        })
        return true
      }
    } catch (error) {
      handleError(error)
      return true
    }

    writeJson(res, 404, { error: 'Not found' })
    return true
  }

  return { handleApi }
}
