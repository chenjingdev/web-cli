export const BRIDGE_MESSAGE_KEY = '__agrune_bridge__'

/** Create a bridge message envelope */
export function createBridgeMessage(type: string, data: unknown) {
  return { source: BRIDGE_MESSAGE_KEY, payload: { type, data } }
}

/** Check if a MessageEvent is from our bridge */
export function isBridgeMessage(event: unknown): boolean {
  if (!(event instanceof MessageEvent)) return false
  if (event.source !== window) return false
  if (!event.data || event.data.source !== BRIDGE_MESSAGE_KEY) return false
  return true
}

/**
 * Listen for bridge messages from the page runtime.
 * Returns a cleanup function that removes the listener.
 */
export function setupBridge(onMessage: (type: string, data: unknown) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (!isBridgeMessage(event)) return
    const { type, data } = event.data.payload
    onMessage(type, data)
  }

  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}

/** Send a message to the page runtime via postMessage */
export function sendToBridge(type: string, data: unknown): void {
  window.postMessage(createBridgeMessage(type, data), '*')
}
