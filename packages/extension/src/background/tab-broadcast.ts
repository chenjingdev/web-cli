import type { AgruneRuntimeConfig } from '@agrune/core'
import type { NativeHostStatus } from './messages'

export interface TabBroadcaster {
  broadcastToAllTabs(msg: Record<string, unknown>): void
  sendToTab(tabId: number, msg: Record<string, unknown>): void
  broadcastConfig(config: Partial<AgruneRuntimeConfig>): void
  broadcastAgentActivity(active: boolean): void
  broadcastNativeHostStatus(status: NativeHostStatus): void
}

export function createTabBroadcaster(api: Pick<typeof chrome, 'tabs'> = chrome): TabBroadcaster {
  const sendToTab = (tabId: number, msg: Record<string, unknown>): void => {
    api.tabs.sendMessage(tabId, msg).catch(() => {
      // Tab may not have content script — ignore
    })
  }

  const broadcastToAllTabs = (msg: Record<string, unknown>): void => {
    api.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id != null) {
          sendToTab(tab.id, msg)
        }
      }
    })
  }

  return {
    broadcastToAllTabs,
    sendToTab,
    broadcastConfig(config: Partial<AgruneRuntimeConfig>): void {
      broadcastToAllTabs({ type: 'config_update', config })
    },
    broadcastAgentActivity(active: boolean): void {
      broadcastToAllTabs({ type: 'agent_activity', active })
    },
    broadcastNativeHostStatus(status: NativeHostStatus): void {
      broadcastToAllTabs({ type: 'native_host_status_changed', status })
    },
  }
}
