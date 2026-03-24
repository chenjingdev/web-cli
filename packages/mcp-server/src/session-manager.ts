import type { PageSnapshot } from '@runeai/core'

export interface Session {
  tabId: number
  url: string
  title: string
  snapshot: PageSnapshot | null
  openedAt: number
}

export class SessionManager {
  private sessions = new Map<number, Session>()

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
    }
  }

  getSnapshot(tabId: number): PageSnapshot | null {
    return this.sessions.get(tabId)?.snapshot ?? null
  }
}
