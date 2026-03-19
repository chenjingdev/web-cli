import http from 'node:http'
import { parseJson, readBody, safeObject, writeJson } from './http-utils.js'
import {
  getPageBearerToken,
  getRequestOrigin,
  resolveAuthenticatedPageSession,
  withPageCors,
  writePageOriginRequired,
} from './page-auth.js'
import type { SessionManager } from './session-manager.js'
import { sanitizePageSyncPayload } from './protocol.js'
import { issuePageSessionToken } from './tokens.js'

interface PageConnectRequest {
  sessionId?: string
  clientId?: string
  appId?: string
  origin?: string
  url?: string
  title?: string
  clientVersion?: string
}

export interface PageRoutes {
  handlePageConnect: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>
  handlePageSync: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>
  handlePageAgentActivity: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    action: 'start' | 'stop',
  ) => Promise<void>
}

interface PageRoutesOptions {
  sessionManager: SessionManager
  pollIntervalMs: number
  signingSecret: Buffer
}

export function createPageRoutes({
  sessionManager,
  pollIntervalMs,
  signingSecret,
}: PageRoutesOptions): PageRoutes {
  const handlePageConnect = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    withPageCors(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'Method Not Allowed' })
      return
    }

    const body = parseJson(await readBody(req))
    const payload = safeObject(body) as PageConnectRequest | undefined
    if (!payload) {
      writeJson(res, 400, { error: 'Invalid JSON body' })
      return
    }

    const origin = getRequestOrigin(req)
    if (!origin) {
      writePageOriginRequired(res)
      return
    }

    const appId = typeof payload.appId === 'string' ? payload.appId.trim() : ''
    const url = typeof payload.url === 'string' ? payload.url.trim() : ''
    const title = typeof payload.title === 'string' ? payload.title.trim() : ''
    const clientVersion =
      typeof payload.clientVersion === 'string' ? payload.clientVersion.trim() : 'unknown'
    const clientId = typeof payload.clientId === 'string' ? payload.clientId.trim() : ''
    const requestedSessionId =
      typeof payload.sessionId === 'string' ? payload.sessionId.trim() : undefined
    const bearerToken = getPageBearerToken(req)

    if (!appId || !clientId) {
      writeJson(res, 400, { error: 'appId and clientId are required' })
      return
    }

    const existingSession = bearerToken
      ? resolveAuthenticatedPageSession({
          sessionManager,
          expectedSessionId: requestedSessionId,
          origin,
          bearerToken,
          signingSecret,
        })
      : null
    if (bearerToken && !existingSession) {
      writeJson(res, 401, { error: 'Invalid page session token' })
      return
    }

    const session = sessionManager.connectSession({
      sessionId: existingSession?.id,
      clientId,
      appId,
      origin,
      url,
      title,
      clientVersion,
    })

    writeJson(res, 200, {
      sessionId: session.id,
      sessionToken: issuePageSessionToken(signingSecret, session),
      status: session.approvalStatus,
      active: sessionManager.isSessionActive(session),
      pollIntervalMs,
    })
  }

  const handlePageSync = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    withPageCors(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'Method Not Allowed' })
      return
    }

    const body = parseJson(await readBody(req))
    const payload = safeObject(body)
    if (!payload) {
      writeJson(res, 400, { error: 'Invalid JSON body' })
      return
    }

    const origin = getRequestOrigin(req)
    if (!origin) {
      writePageOriginRequired(res)
      return
    }

    const bearerToken = getPageBearerToken(req)
    if (!bearerToken) {
      writeJson(res, 401, { error: 'Bearer token is required' })
      return
    }

    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
    if (!sessionId) {
      writeJson(res, 400, { error: 'sessionId is required' })
      return
    }

    sessionManager.pruneExpiredSessions(Date.now(), sessionId)
    const session = resolveAuthenticatedPageSession({
      sessionManager,
      expectedSessionId: sessionId,
      origin,
      bearerToken,
      signingSecret,
    })
    if (!session) {
      writeJson(res, 401, { error: 'Invalid page session token' })
      return
    }

    const syncPayload = sanitizePageSyncPayload(payload)
    if (!syncPayload) {
      writeJson(res, 400, { error: 'Invalid page sync payload' })
      return
    }

    sessionManager.applyPageSyncPayload(session, syncPayload)
    writeJson(res, 200, sessionManager.buildPageSyncResponse(session))
  }

  const handlePageAgentActivity = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    action: 'start' | 'stop',
  ) => {
    withPageCors(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'Method Not Allowed' })
      return
    }

    const body = parseJson(await readBody(req))
    const payload = safeObject(body)
    if (!payload) {
      writeJson(res, 400, { error: 'Invalid JSON body' })
      return
    }

    const origin = getRequestOrigin(req)
    if (!origin) {
      writePageOriginRequired(res)
      return
    }

    const bearerToken = getPageBearerToken(req)
    if (!bearerToken) {
      writeJson(res, 401, { error: 'Bearer token is required' })
      return
    }

    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
    if (!sessionId) {
      writeJson(res, 400, { error: 'sessionId is required' })
      return
    }

    sessionManager.pruneExpiredSessions(Date.now(), sessionId)
    const session = resolveAuthenticatedPageSession({
      sessionManager,
      expectedSessionId: sessionId,
      origin,
      bearerToken,
      signingSecret,
    })
    if (!session) {
      writeJson(res, 401, { error: 'Invalid page session token' })
      return
    }

    if (action === 'start') {
      sessionManager.beginAgentActivity(session)
    } else {
      sessionManager.stopAgentActivity(session)
    }

    writeJson(res, 200, sessionManager.buildPageSyncResponse(session))
  }

  return {
    handlePageConnect,
    handlePageSync,
    handlePageAgentActivity,
  }
}
