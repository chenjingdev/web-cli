import type { NativeMessage } from '@agrune/core'
import { setConfig } from '../shared/config.js'
import type { ExtensionMessage } from '../shared/messages.js'
import type { CdpHandler } from './cdp-handler'
import type { BackgroundRuntimeMessage } from './messages'
import type { NativeHostController } from './native-host-controller'
import type { TabBroadcaster } from './tab-broadcast'

export interface BackgroundMessageRouter {
  register(): void
  handleNativeHostMessage(msg: NativeMessage): void
}

export interface BackgroundMessageRouterOptions {
  api?: Pick<typeof chrome, 'runtime' | 'tabs'>
  controller: Pick<NativeHostController, 'postMessage' | 'requestStatus' | 'reconnect' | 'getStatus'>
  broadcaster: TabBroadcaster
  persistConfig?: typeof setConfig
  cdpHandler?: Pick<CdpHandler, 'handleRequest' | 'notifyActivity'>
}

export function createBackgroundMessageRouter(options: BackgroundMessageRouterOptions): BackgroundMessageRouter {
  const api = options.api ?? chrome
  const controller = options.controller
  const broadcaster = options.broadcaster
  const persistConfig = options.persistConfig ?? setConfig
  const cdpHandler = options.cdpHandler

  const notifyExtensionContexts = (msg: ExtensionMessage): void => {
    try {
      const pending = api.runtime.sendMessage(msg)
      if (pending && typeof pending === 'object' && 'catch' in pending && typeof pending.catch === 'function') {
        pending.catch(() => {
          // Popup may not be open — ignore.
        })
      }
    } catch {
      // No listening extension context — ignore.
    }
  }

  const devtoolsSubscribers = new Map<number, Set<chrome.runtime.Port>>()

  const sendMessageToTab = (tabId: number, message: Record<string, unknown>): void => {
    try {
      const pending = api.tabs.sendMessage(tabId, message)
      if (pending && typeof pending === 'object' && 'catch' in pending && typeof pending.catch === 'function') {
        pending.catch(() => {
          // Content script may not be ready on this tab yet.
        })
      }
    } catch {
      // Ignore tabs without a live content script.
    }
  }

  const handleDevtoolsConnect = (port: chrome.runtime.Port): void => {
    if (port.name !== 'devtools-inspector') return

    port.onMessage.addListener((msg: unknown) => {
      const m = msg as { type: string; tabId?: number }
      if (m.type === 'subscribe_snapshot' && typeof m.tabId === 'number') {
        let subs = devtoolsSubscribers.get(m.tabId)
        if (!subs) {
          subs = new Set()
          devtoolsSubscribers.set(m.tabId, subs)
        }
        subs.add(port)
        sendMessageToTab(m.tabId, { type: 'resync' })
      }
      if (m.type === 'highlight_target' && typeof m.tabId === 'number') {
        sendMessageToTab(m.tabId, msg as Record<string, unknown>)
      }
      if (m.type === 'clear_highlight' && typeof m.tabId === 'number') {
        sendMessageToTab(m.tabId, msg as Record<string, unknown>)
      }
    })

    port.onDisconnect.addListener(() => {
      for (const [tabId, subs] of devtoolsSubscribers) {
        subs.delete(port)
        if (subs.size === 0) devtoolsSubscribers.delete(tabId)
      }
    })
  }

  const handleNativeHostMessage = (msg: NativeMessage): void => {
    switch (msg.type) {
      case 'command_request':
        if (typeof msg.tabId === 'number') {
          cdpHandler?.notifyActivity(msg.tabId)
          broadcaster.sendToTab(msg.tabId, msg as unknown as Record<string, unknown>)
        }
        break
      case 'config_update':
        void persistConfig(msg.config)
          .then((config) => {
            broadcaster.broadcastConfig(config)
            notifyExtensionContexts({ type: 'config_update', config })
          })
          .catch((error) => {
            console.warn('[agrune-extension] failed to persist native host config update', error)
            broadcaster.broadcastConfig(msg.config)
            notifyExtensionContexts({ type: 'config_update', config: msg.config })
          })
        break
      case 'agent_activity':
        broadcaster.broadcastAgentActivity(msg.active)
        break
      case 'resync_request':
        broadcaster.broadcastToAllTabs({ type: 'resync' })
        break
    }
  }

  const handleRuntimeMessage = (
    msg: BackgroundRuntimeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    if (msg.type === 'config_broadcast') {
      broadcaster.broadcastConfig(msg.config)
      notifyExtensionContexts({ type: 'config_update', config: msg.config })
      return false
    }

    if (msg.type === 'get_native_host_status') {
      controller.requestStatus()
      sendResponse({ status: controller.getStatus() })
      return false
    }

    if (msg.type === 'reconnect_native_host') {
      try {
        controller.reconnect()
        sendResponse({ status: controller.getStatus() })
      } catch (error) {
        sendResponse({
          status: controller.getStatus(),
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return false
    }

    if (!sender.tab?.id) {
      return false
    }

    const tabId = sender.tab.id

    if (msg.type === 'cdp_request' && cdpHandler) {
      cdpHandler.handleRequest(tabId, msg.method, msg.params)
        .then(result => {
          api.tabs.sendMessage(tabId, {
            type: 'cdp_response',
            requestId: msg.requestId,
            result,
          })
        })
        .catch(err => {
          api.tabs.sendMessage(tabId, {
            type: 'cdp_response',
            requestId: msg.requestId,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      return true // async response
    }

    switch (msg.type) {
      case 'session_open':
        controller.postMessage({
          type: 'session_open',
          tabId,
          url: msg.url,
          title: msg.title,
        } as NativeMessage)
        break
      case 'snapshot': {
        controller.postMessage({
          type: 'snapshot_update',
          tabId,
          snapshot: msg.snapshot,
        } as NativeMessage)
        const subs = devtoolsSubscribers.get(tabId)
        if (subs) {
          const devMsg = { type: 'devtools_snapshot' as const, tabId, snapshot: msg.snapshot }
          for (const p of subs) {
            try { p.postMessage(devMsg) } catch { /* port may be dead */ }
          }
        }
        break
      }
      case 'command_result':
        controller.postMessage({
          type: 'command_result',
          tabId,
          commandId: msg.commandId,
          result: msg.result,
        } as NativeMessage)
        break
    }

    return false
  }

  const register = (): void => {
    api.runtime.onMessage.addListener(handleRuntimeMessage)
    api.runtime.onConnect.addListener(handleDevtoolsConnect)
    api.tabs.onRemoved.addListener((tabId) => {
      controller.postMessage({ type: 'session_close', tabId } as NativeMessage)
      devtoolsSubscribers.delete(tabId)
    })
    api.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.url) {
        controller.postMessage({
          type: 'session_open',
          tabId,
          url: changeInfo.url,
          title: changeInfo.title ?? '',
        } as NativeMessage)
      }
    })
  }

  return {
    register,
    handleNativeHostMessage,
  }
}
