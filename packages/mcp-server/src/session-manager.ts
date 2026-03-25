import type { PageSnapshot } from '@agrune/core'

export interface Session {
  tabId: number
  url: string
  title: string
  snapshot: PageSnapshot | null
  openedAt: number
}

export class SessionManager {
  private sessions = new Map<number, Session>()
  private snapshotWaiters: Array<() => void> = []

  openSession(tabId: number, url: string, title: string): void {
    this.sessions.set(tabId, {
      tabId,
      url,
      title,
      snapshot: null,
      openedAt: Date.now(),
    })
  }

  closeSession(tabId: number): void {
    this.sessions.delete(tabId)
  }

  getSession(tabId: number): Session | null {
    return this.sessions.get(tabId) ?? null
  }

  getSessions(): Session[] {
    return [...this.sessions.values()]
  }

  updateSnapshot(tabId: number, snapshot: PageSnapshot): void {
    const session = this.sessions.get(tabId)
    if (session) {
      session.snapshot = snapshot
      this.notifyWaiters()
    }
  }

  getSnapshot(tabId: number): PageSnapshot | null {
    return this.sessions.get(tabId)?.snapshot ?? null
  }

  hasReadySession(): boolean {
    for (const session of this.sessions.values()) {
      if (session.snapshot !== null) return true
    }
    return false
  }

  waitForSnapshot(timeoutMs: number): Promise<boolean> {
    if (this.hasReadySession()) return Promise.resolve(true)

    return new Promise<boolean>((resolve) => {
      const onReady = () => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        const idx = this.snapshotWaiters.indexOf(onReady)
        if (idx !== -1) this.snapshotWaiters.splice(idx, 1)
        resolve(false)
      }, timeoutMs)
      this.snapshotWaiters.push(onReady)
    })
  }

  private notifyWaiters(): void {
    if (!this.hasReadySession()) return
    const waiters = this.snapshotWaiters.splice(0)
    for (const waiter of waiters) waiter()
  }
}
