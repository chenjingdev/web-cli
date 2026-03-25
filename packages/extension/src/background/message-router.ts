import type { NativeMessage } from '@agrune/core'
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
}

export function createBackgroundMessageRouter(options: BackgroundMessageRouterOptions): BackgroundMessageRouter {
  const api = options.api ?? chrome
  const controller = options.controller
  const broadcaster = options.broadcaster

  const handleNativeHostMessage = (msg: NativeMessage): void => {
    switch (msg.type) {
      case 'command_request':
        if (typeof msg.tabId === 'number') {
          broadcaster.sendToTab(msg.tabId, msg as unknown as Record<string, unknown>)
        }
        break
      case 'config_update':
        broadcaster.broadcastConfig(msg.config)
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

    switch (msg.type) {
      case 'session_open':
        controller.postMessage({
          type: 'session_open',
          tabId,
          url: msg.url,
          title: msg.title,
        } as NativeMessage)
        break
      case 'snapshot':
        controller.postMessage({
          type: 'snapshot_update',
          tabId,
          snapshot: msg.snapshot,
        } as NativeMessage)
        break
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
    api.tabs.onRemoved.addListener((tabId) => {
      controller.postMessage({ type: 'session_close', tabId } as NativeMessage)
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
