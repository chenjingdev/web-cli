import { vi } from 'vitest'

type Listener<T> = (payload: T) => void

interface MockPort {
  name?: string
  postMessage: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  onMessage: { addListener(listener: Listener<unknown>): void }
  onDisconnect: { addListener(listener: Listener<void>): void }
}

export interface ChromeMockOptions {
  tabs?: Array<{ id?: number }>
}

export interface ConnectHandle {
  port: MockPort
  emitMessage(message: unknown): void
  emitDisconnect(): void
}

export interface ChromeMockBundle {
  chromeMock: typeof chrome
  port: {
    postMessage: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    onMessage: { addListener(listener: Listener<unknown>): void }
    onDisconnect: { addListener(listener: Listener<void>): void }
  }
  emitPortMessage(message: unknown): void
  emitPortDisconnect(lastErrorMessage?: string): void
  emitRuntimeMessage(
    message: unknown,
    sender?: chrome.runtime.MessageSender,
  ): ReturnType<typeof vi.fn>
  emitTabRemoved(tabId: number): void
  emitTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): void
  emitConnect(name: string): ConnectHandle
  emitDebuggerDetach(source: chrome.debugger.Debuggee): void
  emitDebuggerEvent(source: chrome.debugger.Debuggee, method: string, params?: object): void
}

export function createChromeMock(options: ChromeMockOptions = {}): ChromeMockBundle {
  let runtimeListener: ((msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | void) | null = null
  let removedListener: ((tabId: number) => void) | null = null
  let updatedListener: ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) | null = null
  let portMessageListener: Listener<unknown> | null = null
  let portDisconnectListener: Listener<void> | null = null
  let connectListener: ((port: chrome.runtime.Port) => void) | null = null
  let debuggerDetachListener: ((source: chrome.debugger.Debuggee, reason: string) => void) | null = null
  let debuggerEventListener: ((source: chrome.debugger.Debuggee, method: string, params?: object) => void) | null = null

  const port: ChromeMockBundle['port'] = {
    postMessage: vi.fn(),
    disconnect: vi.fn(() => {
      portDisconnectListener?.()
    }),
    onMessage: {
      addListener(listener: Listener<unknown>) {
        portMessageListener = listener
      },
    },
    onDisconnect: {
      addListener(listener: Listener<void>) {
        portDisconnectListener = listener
      },
    },
  }

  const chromeMock = {
    runtime: {
      lastError: null as { message: string } | null,
      connectNative: vi.fn(() => port as unknown as chrome.runtime.Port),
      sendMessage: vi.fn(() => Promise.resolve()),
      onMessage: {
        addListener(listener: typeof runtimeListener) {
          runtimeListener = listener ?? null
        },
      },
      onConnect: {
        addListener(listener: typeof connectListener) {
          connectListener = listener ?? null
        },
      },
    },
    tabs: {
      query: vi.fn((_query: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback((options.tabs ?? []) as chrome.tabs.Tab[])
      }),
      sendMessage: vi.fn(() => Promise.resolve()),
      onRemoved: {
        addListener(listener: typeof removedListener) {
          removedListener = listener ?? null
        },
      },
      onUpdated: {
        addListener(listener: typeof updatedListener) {
          updatedListener = listener ?? null
        },
      },
    },
    debugger: {
      attach: vi.fn(() => Promise.resolve()),
      detach: vi.fn(() => Promise.resolve()),
      sendCommand: vi.fn(() => Promise.resolve({})),
      onDetach: {
        addListener(listener: typeof debuggerDetachListener) {
          debuggerDetachListener = listener ?? null
        },
      },
      onEvent: {
        addListener(listener: typeof debuggerEventListener) {
          debuggerEventListener = listener ?? null
        },
      },
    },
  } as unknown as typeof chrome

  return {
    chromeMock,
    port,
    emitPortMessage(message: unknown) {
      portMessageListener?.(message)
    },
    emitPortDisconnect(lastErrorMessage?: string) {
      const runtime = chromeMock.runtime as { lastError: { message: string } | null }
      runtime.lastError = lastErrorMessage ? { message: lastErrorMessage } : null
      portDisconnectListener?.()
      runtime.lastError = null
    },
    emitRuntimeMessage(
      message: unknown,
      sender: chrome.runtime.MessageSender = {},
    ) {
      const sendResponse = vi.fn()
      runtimeListener?.(message, sender, sendResponse)
      return sendResponse
    },
    emitTabRemoved(tabId: number) {
      removedListener?.(tabId)
    },
    emitTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      updatedListener?.(tabId, changeInfo)
    },
    emitDebuggerDetach(source: chrome.debugger.Debuggee) {
      debuggerDetachListener?.(source, 'target_closed')
    },
    emitDebuggerEvent(source: chrome.debugger.Debuggee, method: string, params?: object) {
      debuggerEventListener?.(source, method, params)
    },
    emitConnect(name: string): ConnectHandle {
      let msgListener: Listener<unknown> | null = null
      let disconnectListener: Listener<void> | null = null
      const mockPort: MockPort = {
        name,
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onMessage: {
          addListener(listener: Listener<unknown>) {
            msgListener = listener
          },
        },
        onDisconnect: {
          addListener(listener: Listener<void>) {
            disconnectListener = listener
          },
        },
      } as unknown as MockPort
      connectListener?.(mockPort as unknown as chrome.runtime.Port)
      return {
        port: mockPort,
        emitMessage(message: unknown) {
          msgListener?.(message)
        },
        emitDisconnect() {
          disconnectListener?.()
        },
      }
    },
  }
}
