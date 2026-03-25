import { vi } from 'vitest'

type Listener<T> = (payload: T) => void

interface MockPort {
  postMessage: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  onMessage: { addListener(listener: Listener<unknown>): void }
  onDisconnect: { addListener(listener: Listener<void>): void }
}

export interface ChromeMockOptions {
  tabs?: Array<{ id?: number }>
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
}

export function createChromeMock(options: ChromeMockOptions = {}): ChromeMockBundle {
  let runtimeListener: ((msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | void) | null = null
  let removedListener: ((tabId: number) => void) | null = null
  let updatedListener: ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) | null = null
  let portMessageListener: Listener<unknown> | null = null
  let portDisconnectListener: Listener<void> | null = null

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
  }
}
