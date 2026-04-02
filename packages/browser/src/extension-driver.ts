import type {
  BrowserDriver,
  Session,
  PageSnapshot,
  CommandResult,
  NativeMessage,
} from '@agrune/core'
import { SessionManager } from './session-manager.js'
import { CommandQueue } from './command-queue.js'
import { ActivityBlockStack } from './activity-tracker.js'

const ACTIVITY_TAIL_BLOCK_MS = 5_000
const ENSURE_READY_TIMEOUT_MS = 10_000

export class ExtensionDriver implements BrowserDriver {
  readonly sessions = new SessionManager()
  readonly commands = new CommandQueue()
  private readonly activityBlocks: ActivityBlockStack
  private sessionOpenCbs: ((session: Session) => void)[] = []
  private sessionCloseCbs: ((tabId: number) => void)[] = []
  private snapshotUpdateCbs: ((tabId: number, snapshot: PageSnapshot) => void)[] = []
  private pendingResync: Promise<boolean> | null = null
  onActivity: (() => void) | null = null

  constructor() {
    this.activityBlocks = new ActivityBlockStack((active) => {
      this.commands.sendRaw({ type: 'agent_activity', active } as NativeMessage)
    })
  }

  // --- BrowserDriver interface ---

  async connect(): Promise<void> {
    /* extension mode: sender is set externally via setNativeSender() */
  }

  async disconnect(): Promise<void> {
    this.commands.setSender(null)
  }

  isConnected(): boolean {
    return this.commands.hasSender()
  }

  listSessions(): Session[] {
    return this.sessions.getSessions().map((s) => ({
      tabId: s.tabId,
      url: s.url,
      title: s.title,
      hasSnapshot: s.snapshot != null,
    }))
  }

  getSnapshot(tabId: number): PageSnapshot | null {
    return this.sessions.getSnapshot(tabId)
  }

  onSessionOpen(cb: (session: Session) => void): void {
    this.sessionOpenCbs.push(cb)
  }

  onSessionClose(cb: (tabId: number) => void): void {
    this.sessionCloseCbs.push(cb)
  }

  onSnapshotUpdate(cb: (tabId: number, snapshot: PageSnapshot) => void): void {
    this.snapshotUpdateCbs.push(cb)
  }

  async execute(
    tabId: number,
    command: Record<string, unknown> & { kind: string },
  ): Promise<CommandResult> {
    return this.withActivityBlocks(command.kind, () =>
      this.commands.enqueue(tabId, command),
    )
  }

  sendRaw(msg: NativeMessage): void {
    this.commands.sendRaw(msg)
  }

  // --- Extension-specific methods ---

  setNativeSender(sender: ((msg: NativeMessage) => void) | null): void {
    this.commands.setSender(sender)
  }

  handleNativeMessage(msg: NativeMessage): void {
    switch (msg.type) {
      case 'session_open': {
        this.sessions.openSession(msg.tabId, msg.url, msg.title)
        this.sessionOpenCbs.forEach((cb) =>
          cb({
            tabId: msg.tabId,
            url: msg.url,
            title: msg.title,
            hasSnapshot: false,
          }),
        )
        break
      }
      case 'session_close': {
        this.sessions.closeSession(msg.tabId)
        this.sessionCloseCbs.forEach((cb) => cb(msg.tabId))
        break
      }
      case 'snapshot_update': {
        this.sessions.updateSnapshot(msg.tabId, msg.snapshot)
        this.snapshotUpdateCbs.forEach((cb) => cb(msg.tabId, msg.snapshot))
        break
      }
      case 'command_result': {
        if (msg.result.snapshot) {
          this.sessions.updateSnapshot(msg.tabId, msg.result.snapshot)
        }
        this.commands.resolve(msg.commandId, msg.result)
        break
      }
      case 'ping':
        this.commands.sendRaw({ type: 'pong' } as NativeMessage)
        break
      case 'get_status':
        this.commands.sendRaw(this.createStatusResponse())
        break
      case 'resync_request':
      case 'pong':
      case 'status_response':
        break
    }
  }

  async ensureReady(): Promise<string | null> {
    const deadline = Date.now() + ENSURE_READY_TIMEOUT_MS

    // Phase 1: wait for native host connection
    if (!this.commands.hasSender()) {
      const connected = await this.commands.waitForSender(ENSURE_READY_TIMEOUT_MS)
      if (!connected) {
        return 'Native host not connected. Ensure the browser extension is installed and running.'
      }
    }

    // Phase 2: wait for session + snapshot (using remaining time)
    if (this.sessions.hasReadySession()) return null

    const remaining = Math.max(0, deadline - Date.now())
    if (remaining === 0) {
      return 'No browser sessions available. Ensure a page with agrune annotations is open.'
    }

    // Dedup: join existing resync if already in progress
    if (!this.pendingResync) {
      this.commands.sendRaw({ type: 'resync_request' } as NativeMessage)
      this.pendingResync = this.sessions
        .waitForSnapshot(remaining)
        .finally(() => {
          this.pendingResync = null
        })
    }

    const ready = await this.pendingResync
    if (!ready) {
      return 'No browser sessions available. Ensure a page with agrune annotations is open.'
    }

    return null
  }

  resolveTabId(tabId?: number): number | null {
    if (typeof tabId === 'number') return tabId
    const all = this.sessions.getSessions()
    return all.length > 0 ? all[0].tabId : null
  }

  // --- Internal helpers ---

  private async withActivityBlocks<T>(
    kind: string,
    effect: () => Promise<T>,
  ): Promise<T> {
    const guardId = this.activityBlocks.pushGuard(`${kind}:guard`)
    try {
      return await effect()
    } finally {
      this.activityBlocks.pushTimed(`${kind}:tail`, ACTIVITY_TAIL_BLOCK_MS)
      this.activityBlocks.release(guardId)
    }
  }

  private createStatusResponse(): NativeMessage {
    return {
      type: 'status_response',
      status: {
        hostName: 'com.agrune.agrune',
        phase: 'connected',
        connected: true,
        lastError: null,
        sessionCount: this.sessions.getSessions().length,
        mcpConnected: this.activityBlocks.hasActiveBlocks(),
      },
    } as NativeMessage
  }
}
