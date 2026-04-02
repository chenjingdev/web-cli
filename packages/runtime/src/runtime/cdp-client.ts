const CDP_TIMEOUT_MS = 5_000

export interface CdpClient {
  sendCdpEvent(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  getPendingDragData(): unknown | null
  clearPendingDragData(): void
  dispose(): void
}

export function createCdpClient(postMessage: (type: string, data: unknown) => void): CdpClient {
  const pending = new Map<string, {
    resolve: (v: Record<string, unknown>) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  let pendingDragData: unknown | null = null

  function handleCdpMessage(e: Event): void {
    const detail = (e as CustomEvent).detail
    if (!detail) return

    if (detail.type === 'cdp_response') {
      const entry = pending.get(detail.requestId)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(detail.requestId)
      if (detail.error) {
        entry.reject(new Error(detail.error))
      } else {
        entry.resolve(detail.result ?? {})
      }
    }

    if (detail.type === 'cdp_event') {
      if (detail.method === 'Input.dragIntercepted') {
        pendingDragData = detail.params?.data ?? null
      }
    }
  }

  window.addEventListener('agrune:cdp', handleCdpMessage)

  function sendCdpEvent(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`CDP request timed out: ${method}`))
      }, CDP_TIMEOUT_MS)
      pending.set(requestId, { resolve, reject, timer })
      postMessage('cdp_request', { requestId, method, params })
    })
  }

  function dispose(): void {
    window.removeEventListener('agrune:cdp', handleCdpMessage)
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('CDP client disposed'))
    }
    pending.clear()
  }

  return {
    sendCdpEvent,
    getPendingDragData: () => pendingDragData,
    clearPendingDragData: () => { pendingDragData = null },
    dispose,
  }
}
