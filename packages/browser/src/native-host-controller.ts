import type { NativeMessage, NativeHostStatus, NativeHostConnectionPhase } from '@agrune/core'

type NativeHostPhase = NativeHostConnectionPhase

const DEFAULT_HOST_NAME = 'com.agrune.agrune'

export interface NativeHostControllerOptions {
  hostName?: string
  api?: Pick<typeof chrome, 'runtime'>
  connectNative?: (hostName: string) => chrome.runtime.Port
  onMessage?: (msg: NativeMessage) => void
  onStatusChange?: (status: NativeHostStatus) => void
}

export interface NativeHostController {
  ensureConnected(): chrome.runtime.Port
  requestStatus(): boolean
  reconnect(): chrome.runtime.Port
  disconnect(): void
  postMessage(msg: NativeMessage): boolean
  getStatus(): NativeHostStatus
}

export function createNativeHostController(options: NativeHostControllerOptions = {}): NativeHostController {
  const hostName = options.hostName ?? DEFAULT_HOST_NAME
  const api = options.api ?? chrome
  const connectNative = options.connectNative ?? api.runtime.connectNative.bind(api.runtime)

  let nativePort: chrome.runtime.Port | null = null
  let status: NativeHostStatus = {
    hostName,
    phase: 'disconnected',
    connected: false,
    lastError: null,
  }

  const setStatus = (phase: NativeHostPhase, lastError: string | null = null): void => {
    status = {
      hostName,
      phase,
      connected: phase === 'connected',
      lastError,
    }
    options.onStatusChange?.(status)
  }

  const setStatusFromHost = (nextStatus: NativeHostStatus): void => {
    status = {
      ...status,
      ...nextStatus,
      hostName: nextStatus.hostName || hostName,
      phase: nextStatus.phase ?? 'connected',
      connected: nextStatus.connected ?? nextStatus.phase === 'connected',
      lastError: nextStatus.lastError ?? null,
    }
    options.onStatusChange?.(status)
  }

  const attachPort = (port: chrome.runtime.Port): void => {
    port.onMessage.addListener((msg: NativeMessage) => {
      if (msg.type === 'status_response') {
        setStatusFromHost(msg.status)
        return
      }

      options.onMessage?.(msg)
    })

    port.onDisconnect.addListener(() => {
      const error = api.runtime.lastError?.message ?? null
      nativePort = null
      setStatus(error ? 'error' : 'disconnected', error)
    })
  }

  const ensureConnected = (): chrome.runtime.Port => {
    if (nativePort) {
      return nativePort
    }

    setStatus('connecting')

    try {
      const port = connectNative(hostName)
      nativePort = port
      attachPort(port)
      setStatus('connected')
      port.postMessage({ type: 'get_status' } satisfies NativeMessage)
      return port
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      nativePort = null
      setStatus('error', message)
      throw error
    }
  }

  const disconnect = (): void => {
    if (!nativePort) {
      setStatus('disconnected')
      return
    }

    const port = nativePort
    nativePort = null
    try {
      port.disconnect()
    } finally {
      setStatus('disconnected')
    }
  }

  return {
    ensureConnected,
    requestStatus(): boolean {
      const wasConnected = nativePort != null
      const port = ensureConnected()
      if (wasConnected) {
        port.postMessage({ type: 'get_status' } satisfies NativeMessage)
      }
      return true
    },
    reconnect(): chrome.runtime.Port {
      disconnect()
      return ensureConnected()
    },
    disconnect,
    postMessage(msg: NativeMessage): boolean {
      ensureConnected().postMessage(msg)
      return true
    },
    getStatus(): NativeHostStatus {
      return status
    },
  }
}
