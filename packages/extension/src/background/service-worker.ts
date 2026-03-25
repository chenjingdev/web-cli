import type { NativeMessage } from '@agrune/core'
import { createBackgroundMessageRouter } from './message-router'
import { createNativeHostController } from './native-host-controller'
import { createTabBroadcaster } from './tab-broadcast'

const broadcaster = createTabBroadcaster()

let handleNativeHostMessage: (msg: NativeMessage) => void = () => {}

const controller = createNativeHostController({
  onMessage: (msg) => handleNativeHostMessage(msg),
  onStatusChange: (status) => {
    broadcaster.broadcastNativeHostStatus(status)
    try {
      const pending = chrome.runtime.sendMessage({ type: 'native_host_status_changed', status })
      if (pending && typeof pending === 'object' && 'catch' in pending && typeof pending.catch === 'function') {
        pending.catch(() => {
          // Popup may not be open — ignore.
        })
      }
    } catch {
      // Popup may not be open — ignore.
    }
  },
})

const router = createBackgroundMessageRouter({
  api: chrome,
  controller,
  broadcaster,
})
handleNativeHostMessage = router.handleNativeHostMessage
router.register()
