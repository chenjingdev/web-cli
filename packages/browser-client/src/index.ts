import { bootstrapSession } from './bootstrap'
import { getOrCreateClientId } from './client-id'
import { HttpError, postJson, syncViaHttp } from './http-fallback'
import {
  createCompletedCommandBuffer,
  processPendingCommands,
} from './pending-call-runner'
import { createStatusMachine } from './status-machine'
import type {
  BrowserClientHandle,
  BrowserClientStatus,
  InitializeBrowserClientOptions,
  PageRuntimeLike,
  SessionConnectionState,
  PageSyncPayload,
} from './types'
import { createWsTransport } from './ws-transport'

export type {
  BrowserClientHandle,
  BrowserClientStatus,
  InitializeBrowserClientOptions,
} from './types'

const CLIENT_VERSION = '0.1.0'
const DEFAULT_BASE_URL = 'http://127.0.0.1:9444'
const DEFAULT_POLL_INTERVAL_MS = 800

let activeHandle: BrowserClientHandle | null = null
let activeAgentController:
  | {
      start: () => Promise<BrowserClientStatus>
      stop: () => Promise<BrowserClientStatus>
    }
  | null = null
const statusListeners = new Set<(status: BrowserClientStatus) => void>()
let currentStatus: BrowserClientStatus = {
  state: 'idle',
  companionBaseUrl: DEFAULT_BASE_URL,
  sessionId: null,
  active: false,
  agentActive: false,
  agentStopped: false,
  lastError: null,
  updatedAt: Date.now(),
}

function getPageRuntime(): PageRuntimeLike | null {
  const win = window as Window & typeof globalThis & { webcliDom?: PageRuntimeLike }
  return win.webcliDom ?? null
}

function setStatus(
  next: Partial<BrowserClientStatus>,
  onStatusChange?: (status: BrowserClientStatus) => void,
) {
  currentStatus = {
    ...currentStatus,
    ...next,
    updatedAt: Date.now(),
  }
  onStatusChange?.(currentStatus)
  for (const listener of statusListeners) {
    listener(currentStatus)
  }
}

export function getBrowserClientStatus(): BrowserClientStatus {
  return { ...currentStatus }
}

export function subscribeBrowserClientStatus(
  listener: (status: BrowserClientStatus) => void,
): () => void {
  statusListeners.add(listener)
  listener(currentStatus)
  return () => {
    statusListeners.delete(listener)
  }
}

async function requestAgentControl(
  action: 'start' | 'stop',
): Promise<BrowserClientStatus> {
  if (!activeAgentController) {
    throw new Error('webcli browser client is not initialized')
  }
  return action === 'start'
    ? activeAgentController.start()
    : activeAgentController.stop()
}

export async function requestWebCliAgentStart(): Promise<BrowserClientStatus> {
  return requestAgentControl('start')
}

export async function requestWebCliAgentStop(): Promise<BrowserClientStatus> {
  return requestAgentControl('stop')
}

export function initializeBrowserClient(
  options: InitializeBrowserClientOptions,
): BrowserClientHandle {
  if (!options.appId || !options.appId.trim()) {
    throw new Error('appId is required')
  }

  activeHandle?.stop()

  const appId = options.appId.trim()
  const companionBaseUrl = (options.companionBaseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const onStatusChange = options.onStatusChange
  const windowRef = window
  const documentRef = document

  let stopped = false
  let inflight = false
  let serverAgentActivityActive = false
  const connection: SessionConnectionState = {
    sessionId: null,
    sessionToken: null,
    tokenExpiresAt: null,
    expectsSessionToken: false,
  }
  const clientId = getOrCreateClientId(appId)
  const completedCommands = createCompletedCommandBuffer()
  const statusMachine = createStatusMachine({
    companionBaseUrl,
    updateStatus(next) {
      setStatus(next, onStatusChange)
    },
    onGuideRequired: options.onGuideRequired,
  })

  const resetSessionToken = () => {
    connection.sessionToken = null
    connection.tokenExpiresAt = null
  }

  const discardConnection = () => {
    connection.sessionId = null
    resetSessionToken()
  }

  const syncServerAgentActivity = (
    runtime: PageRuntimeLike | null,
    nextActive: boolean | undefined,
  ) => {
    if (nextActive === undefined || !runtime) {
      return
    }

    if (nextActive && !serverAgentActivityActive) {
      runtime.beginAgentActivity?.()
      serverAgentActivityActive = true
      return
    }

    if (!nextActive && serverAgentActivityActive) {
      runtime.endAgentActivity?.()
      serverAgentActivityActive = false
    }
  }

  const clearServerAgentActivity = () => {
    const runtime = getPageRuntime()
    if (!runtime || !serverAgentActivityActive) {
      serverAgentActivityActive = false
      return
    }
    runtime.endAgentActivity?.()
    serverAgentActivityActive = false
  }

  const hasExpiredSessionToken = () =>
    connection.tokenExpiresAt !== null && connection.tokenExpiresAt <= Date.now()

  const hasUsableConnection = () => {
    if (!connection.sessionId) {
      return false
    }
    if (!connection.expectsSessionToken) {
      return true
    }
    if (!connection.sessionToken) {
      return false
    }
    return !hasExpiredSessionToken()
  }

  const buildSyncPayload = (runtime: PageRuntimeLike) => {
    const completedSnapshot = completedCommands.snapshot()
    const payload: PageSyncPayload = {
      snapshot: runtime.getSnapshot(),
      completedCommands: completedSnapshot,
      timestamp: Date.now(),
    }
    return { payload, completedCount: completedSnapshot.length }
  }

  const sendSocketSync = (runtime: PageRuntimeLike) => {
    const { payload, completedCount } = buildSyncPayload(runtime)
    const sent = transport.sendSync(payload)
    if (sent) {
      completedCommands.commit(completedCount)
    }
    return sent
  }

  const handlePendingCommandResults = async (pending: Parameters<typeof processPendingCommands>[0]) => {
    const runtime = getPageRuntime()
    if (!runtime) {
      statusMachine.setRuntimeUnavailable(connection.sessionId)
      return
    }

    await processPendingCommands(pending, runtime, completedCommands)
    if (completedCommands.hasEntries()) {
      void sendSocketSync(runtime)
    }
  }

  const transport = createWsTransport({
    windowRef,
    companionBaseUrl,
    getConnection() {
      return {
        sessionId: connection.sessionId,
        sessionToken: connection.sessionToken,
      }
    },
    onOpen() {
      if (stopped) {
        transport.close()
        return
      }
      statusMachine.resetGuide()
      const runtime = getPageRuntime()
      if (!runtime) {
        statusMachine.setRuntimeUnavailable(connection.sessionId)
        return
      }
      void sendSocketSync(runtime)
    },
    async onMessage(message) {
      if (typeof message.status === 'string') {
        statusMachine.applyServerStatus({
          sessionId: connection.sessionId,
          status: message.status,
          active: Boolean(message.active),
          agentActive: message.agentActive,
          agentStopped: message.agentStopped,
        })
      }

      const runtime = getPageRuntime()
      syncServerAgentActivity(runtime, message.agentActive)

      if (message.config && typeof message.config === 'object') {
        if (runtime && typeof (runtime as any).applyConfig === 'function') {
          ;(runtime as any).applyConfig(message.config)
        }
      }

      if (message.type === 'error') {
        clearServerAgentActivity()
        statusMachine.setCompanionUnavailable(
          connection.sessionId,
          message.message ?? 'websocket error',
        )
        return
      }

      if (!Array.isArray(message.pendingCommands) || message.pendingCommands.length === 0) {
        return
      }

      await handlePendingCommandResults(message.pendingCommands)
    },
    onAuthFailure(reason) {
      if (stopped) return
      clearServerAgentActivity()
      discardConnection()
      statusMachine.setConnecting(null, reason)
    },
    onTransportClose(reason, enabled) {
      if (stopped) return
      clearServerAgentActivity()
      if (enabled) {
        statusMachine.setConnecting(connection.sessionId, reason)
        return
      }
      statusMachine.setCompanionUnavailable(connection.sessionId, reason)
    },
  })

  const ensureSession = async () => {
    if (hasExpiredSessionToken()) {
      transport.close()
      resetSessionToken()
    }

    if (hasUsableConnection()) {
      return
    }

    statusMachine.setConnecting(connection.sessionId)
    const connectRes = await bootstrapSession({
      windowRef,
      fetchImpl,
      companionBaseUrl,
      appId,
      clientId,
      sessionId: connection.sessionId,
      origin: windowRef.location.origin,
      url: windowRef.location.href,
      title: documentRef.title,
      clientVersion: CLIENT_VERSION,
    })

    connection.sessionId = connectRes.sessionId
    connection.sessionToken = connectRes.sessionToken
    connection.tokenExpiresAt = connectRes.tokenExpiresAt
    connection.expectsSessionToken =
      connectRes.sessionToken !== null || connectRes.tokenExpiresAt !== null

    statusMachine.applyServerStatus({
      sessionId: connection.sessionId,
      status: connectRes.status,
      active: Boolean(connectRes.active),
      agentActive: false,
      agentStopped: false,
    })
  }

  const requestPageAgentActivity = async (
    action: 'start' | 'stop',
  ): Promise<BrowserClientStatus> => {
    if (stopped) {
      throw new Error('webcli browser client is stopped')
    }

    await ensureSession()
    if (!connection.sessionId) {
      throw new Error('webcli session is unavailable')
    }

    const response = (await postJson(
      fetchImpl,
      `${companionBaseUrl}/page/agent-activity/${action}`,
      { sessionId: connection.sessionId },
      {
        windowRef,
        headers: connection.sessionToken
          ? { authorization: `Bearer ${connection.sessionToken}` }
          : undefined,
      },
    )) as {
      status?: 'pending' | 'approved' | 'denied'
      active?: boolean
      agentActive?: boolean
      agentStopped?: boolean
    }

    statusMachine.applyServerStatus({
      sessionId: connection.sessionId,
      status: response.status,
      active: Boolean(response.active),
      agentActive: response.agentActive,
      agentStopped: response.agentStopped,
    })
    syncServerAgentActivity(getPageRuntime(), response.agentActive)
    return getBrowserClientStatus()
  }

  const runHttpSync = async (runtime: PageRuntimeLike) => {
    if (!connection.sessionId) {
      return
    }

    const { payload, completedCount } = buildSyncPayload(runtime)
    const syncRes = await syncViaHttp({
      windowRef,
      fetchImpl,
      companionBaseUrl,
      sessionId: connection.sessionId,
      sessionToken: connection.sessionToken,
      payload,
    })

    completedCommands.commit(completedCount)
    statusMachine.applyServerStatus({
      sessionId: connection.sessionId,
      status: syncRes.status,
      active: Boolean(syncRes.active),
      agentActive: syncRes.agentActive,
      agentStopped: syncRes.agentStopped,
    })

    if (syncRes.config && typeof syncRes.config === 'object') {
      if (typeof (runtime as any).applyConfig === 'function') {
        ;(runtime as any).applyConfig(syncRes.config)
      }
    }
    syncServerAgentActivity(runtime, syncRes.agentActive)

    if (Array.isArray(syncRes.pendingCommands) && syncRes.pendingCommands.length > 0) {
      await processPendingCommands(syncRes.pendingCommands, runtime, completedCommands)
    }
  }

  const tick = async () => {
    if (stopped || inflight) return
    inflight = true

    try {
      const runtime = getPageRuntime()
      if (!runtime) {
        statusMachine.setRuntimeUnavailable(connection.sessionId)
        return
      }

      await ensureSession()

      if (transport.isEnabled()) {
        transport.connect()
        if (!sendSocketSync(runtime)) {
          statusMachine.setConnecting(connection.sessionId)
        }
      } else {
        await runHttpSync(runtime)
      }
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        transport.close()
        clearServerAgentActivity()
        discardConnection()
        statusMachine.setConnecting(null, error.message)
        return
      }

      transport.close()
      clearServerAgentActivity()
      statusMachine.setCompanionUnavailable(
        connection.sessionId,
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      inflight = false
    }
  }

  const timer = windowRef.setInterval(() => {
    void tick()
  }, pollIntervalMs)

  const handle: BrowserClientHandle = {
    stop() {
      if (stopped) return
      stopped = true
      windowRef.clearInterval(timer)
      transport.close()
      clearServerAgentActivity()
      activeAgentController = null
      if (activeHandle === handle) {
        activeHandle = null
      }
      statusMachine.setStopped(connection.sessionId)
    },
  }

  activeAgentController = {
    start: () => requestPageAgentActivity('start'),
    stop: () => requestPageAgentActivity('stop'),
  }
  activeHandle = handle
  void tick()
  return handle
}

export const initializeWebCliBrowserClient = initializeBrowserClient
export const initializeWebCliCompanionClient = initializeBrowserClient
export const getWebCliBrowserStatus = getBrowserClientStatus
export const subscribeWebCliBrowserStatus = subscribeBrowserClientStatus
