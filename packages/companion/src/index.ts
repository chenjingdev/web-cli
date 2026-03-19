import http from 'node:http'
import { createApiRoutes } from './api-routes.js'
import { createCallQueue } from './call-queue.js'
import { stringifyError, writeJson } from './http-utils.js'
import { createPageRoutes } from './page-routes.js'
import { createPageWebSocketServer } from './page-ws.js'
import { VERSION } from './protocol.js'
import { createRuntimeStore } from './runtime-store.js'
import { createSessionManager } from './session-manager.js'
import {
  ensureAgentToken,
  ensureCompanionHome,
  loadPersistedState,
  resolveCompanionPaths,
} from './state-store.js'
import { createSigningSecret } from './tokens.js'
import type { CompanionPaths, CompanionServerHandle, CompanionServerOptions } from './types.js'

export type {
  ApprovalStatus,
  CommandRequest,
  CommandResult,
  CompanionConfig,
  PageSnapshot,
  SessionSnapshot,
} from './types.js'
export type { CompanionPaths, CompanionServerHandle, CompanionServerOptions } from './types.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9444
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5_000
const DEFAULT_CALL_TIMEOUT_MS = 15_000
const DEFAULT_POLL_INTERVAL_MS = 800
const STALE_SESSION_GRACE_MULTIPLIER = 3
const WS_DISCONNECT_REMOVE_DELAY_MS = 2_000
const LOG_LIMIT = 400

export interface CompanionRuntimeInfo {
  paths: CompanionPaths
  endpoint: string
  tokenPath: string
}

export function getCompanionRuntimeInfo(options: CompanionServerOptions = {}): CompanionRuntimeInfo {
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT
  const paths = resolveCompanionPaths(options.homeDir)
  return {
    paths,
    endpoint: `http://${host}:${port}`,
    tokenPath: paths.tokenPath,
  }
}

export async function startCompanionServer(
  options: CompanionServerOptions = {},
): Promise<CompanionServerHandle> {
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const logger = options.logger ?? ((message: string) => console.error(`[companion] ${message}`))

  const paths = resolveCompanionPaths(options.homeDir)
  ensureCompanionHome(paths)
  const agentToken = ensureAgentToken(paths)
  const persisted = loadPersistedState(paths)
  const store = createRuntimeStore({ paths, persisted, logger, logLimit: LOG_LIMIT })
  const signingSecret = createSigningSecret()

  let sessionManager!: ReturnType<typeof createSessionManager>
  let pageWs: ReturnType<typeof createPageWebSocketServer> | null = null
  const callQueue = createCallQueue({
    store,
    callTimeoutMs,
    onSessionSyncRequested: session => pageWs?.sendSessionSyncResult(session),
  })
  sessionManager = createSessionManager({
    store,
    callQueue,
    heartbeatTimeoutMs,
    pollIntervalMs,
    staleSessionGraceMultiplier: STALE_SESSION_GRACE_MULTIPLIER,
    wsDisconnectRemoveDelayMs: WS_DISCONNECT_REMOVE_DELAY_MS,
    onStatusChanged: () => pageWs?.pushStatusUpdates(),
  })
  if (store.persisted.activeSessionId && !sessionManager.getSession(store.persisted.activeSessionId)) {
    sessionManager.setActiveSession(null)
  }
  const pageRoutes = createPageRoutes({
    sessionManager,
    pollIntervalMs,
    signingSecret,
  })
  pageWs = createPageWebSocketServer({
    host,
    port,
    store,
    sessionManager,
    signingSecret,
  })
  const apiRoutes = createApiRoutes({
    host,
    port,
    paths,
    agentToken,
    store,
    sessionManager,
    callQueue,
    onConfigChanged: () => pageWs?.pushStatusUpdates(),
  })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`)

    try {
      if (url.pathname === '/page/connect') {
        await pageRoutes.handlePageConnect(req, res)
        return
      }

      if (url.pathname === '/page/sync') {
        await pageRoutes.handlePageSync(req, res)
        return
      }

      if (url.pathname === '/page/agent-activity/start') {
        await pageRoutes.handlePageAgentActivity(req, res, 'start')
        return
      }

      if (url.pathname === '/page/agent-activity/stop') {
        await pageRoutes.handlePageAgentActivity(req, res, 'stop')
        return
      }

      if (await apiRoutes.handleApi(req, res, url)) {
        return
      }

      if (url.pathname === '/healthz') {
        writeJson(res, 200, { ok: true, version: VERSION })
        return
      }

      writeJson(res, 404, { error: 'Not found' })
    } catch (error) {
      store.addLog('error', 'unhandled request error', { error: stringifyError(error) }, true)
      writeJson(res, 500, { error: 'Internal Server Error' })
    }
  })

  server.on('upgrade', (req, socket, head) => {
    pageWs.handleUpgrade(req, socket, head)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  store.addLog('system', 'companion started', {
    host,
    port,
    homeDir: paths.homeDir,
  })

  return {
    endpoint: `http://${host}:${port}`,
    tokenPath: paths.tokenPath,
    paths,
    async close() {
      await sessionManager.close('companion closed')
      await pageWs?.close()
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}
