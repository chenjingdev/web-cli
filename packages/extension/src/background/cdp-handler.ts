export class CdpAttachError extends Error {
  constructor(message: string) {
    super(`CDP attach failed: ${message}`)
    this.name = 'CdpAttachError'
  }
}

export interface CdpHandler {
  handleRequest(tabId: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  detach(tabId: number): void
  detachAll(): void
  isAttached(tabId: number): boolean
  register(): void
}

export interface CdpHandlerOptions {
  api: typeof chrome
}

export function createCdpHandler(options: CdpHandlerOptions): CdpHandler {
  const { api } = options
  const attachedTabs = new Set<number>()

  async function ensureAttached(tabId: number): Promise<void> {
    if (attachedTabs.has(tabId)) return
    try {
      await api.debugger.attach({ tabId }, '1.3')
      attachedTabs.add(tabId)
    } catch (err: unknown) {
      throw new CdpAttachError(err instanceof Error ? err.message : String(err))
    }
  }

  function detach(tabId: number): void {
    if (!attachedTabs.has(tabId)) return
    attachedTabs.delete(tabId)
    api.debugger.detach({ tabId }).catch(() => {})
  }

  function detachAll(): void {
    for (const tabId of attachedTabs) {
      detach(tabId)
    }
  }

  async function handleRequest(
    tabId: number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await ensureAttached(tabId)
    const result = await api.debugger.sendCommand({ tabId }, method, params)
    return (result ?? {}) as Record<string, unknown>
  }

  function register(): void {
    api.debugger.onDetach.addListener((source: chrome.debugger.Debuggee) => {
      if (source.tabId != null) attachedTabs.delete(source.tabId)
    })

    api.debugger.onEvent.addListener(
      (source: chrome.debugger.Debuggee, method: string, params?: object) => {
        if (method === 'Input.dragIntercepted' && source.tabId != null) {
          api.tabs.sendMessage(source.tabId, {
            type: 'cdp_event',
            method,
            params: params ?? {},
          })
        }
      },
    )

    api.tabs.onRemoved.addListener((tabId: number) => {
      detach(tabId)
    })
  }

  return { handleRequest, detach, detachAll, isAttached: (id) => attachedTabs.has(id), register }
}
