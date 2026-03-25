import type { NativeMessage, AgagruneRuntimeConfig } from '@agrune/core'
import { ActivityBlockStack } from './activity-block-stack.js'
import { CommandQueue } from './command-queue.js'
import {
  type PublicSnapshotOptions,
  toPublicCommandResult,
  toPublicSession,
  toPublicSnapshot,
} from './public-shapes.js'
import { SessionManager } from './session-manager.js'
import type { ToolHandlerResult } from './mcp-tools.js'

const ACTIVITY_TAIL_BLOCK_MS = 5_000
const ENSURE_READY_TIMEOUT_MS = 10_000

export class AgagruneBackend {
  readonly sessions = new SessionManager()
  readonly commands = new CommandQueue()
  private readonly activityBlocks = new ActivityBlockStack((active) => {
    this.commands.sendRaw({ type: 'agent_activity', active })
  })
  private manualAgentBlockId: string | null = null
  private lastAgentActivityAt: number | null = null
  onActivity: (() => void) | null = null
  private pendingResync: Promise<boolean> | null = null

  setNativeSender(sender: ((msg: NativeMessage) => void) | null): void {
    this.commands.setSender(sender)
  }

  handleNativeMessage(msg: NativeMessage): void {
    switch (msg.type) {
      case 'session_open':
        this.sessions.openSession(msg.tabId, msg.url, msg.title)
        break
      case 'session_close':
        this.sessions.closeSession(msg.tabId)
        break
      case 'snapshot_update':
        this.sessions.updateSnapshot(msg.tabId, msg.snapshot)
        break
      case 'command_result':
        this.commands.resolve(msg.commandId, msg.result)
        break
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

  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolHandlerResult> {
    this.lastAgentActivityAt = Date.now()
    this.onActivity?.()

    if (name !== 'agrune_config') {
      const readyError = await this.ensureReady()
      if (readyError) return readyError
    }

    switch (name) {
      case 'agrune_sessions': {
        const list = this.sessions.getSessions()
        return this.textResult(JSON.stringify(list.map(toPublicSession), null, 2))
      }

      case 'agrune_snapshot': {
        const tabId = this.resolveTabId(args)
        if (tabId == null) {
          return this.textResult('No active sessions.', true)
        }
        return this.withActivityBlocks('snapshot', async () => {
          const snapshot = this.sessions.getSnapshot(tabId)
          if (!snapshot) {
            return this.textResult(`No snapshot available for tab ${tabId}.`, true)
          }
          return this.textResult(JSON.stringify(toPublicSnapshot(snapshot, this.resolveSnapshotOptions(args)), null, 2))
        })
      }

      case 'agrune_act':
      case 'agrune_fill':
      case 'agrune_drag':
      case 'agrune_wait':
      case 'agrune_guide': {
        const tabId = this.resolveTabId(args)
        if (tabId == null) {
          return this.textResult('No active sessions.', true)
        }
        return this.withActivityBlocks(name.replace('agrune_', ''), async () => {
          const command: Record<string, unknown> & { kind: string } = {
            kind: name.replace('agrune_', ''),
            ...args,
          }
          delete command.tabId
          const result = await this.commands.enqueue(tabId, command)
          return this.textResult(JSON.stringify(toPublicCommandResult(result), null, 2))
        })
      }

      case 'agrune_config': {
        const config: Partial<AgagruneRuntimeConfig> = {}
        if (typeof args.pointerAnimation === 'boolean') config.pointerAnimation = args.pointerAnimation
        if (typeof args.auroraGlow === 'boolean') config.auroraGlow = args.auroraGlow
        if (typeof args.auroraTheme === 'string') {
          config.auroraTheme = args.auroraTheme as AgagruneRuntimeConfig['auroraTheme']
        }
        if (typeof args.clickDelayMs === 'number') config.clickDelayMs = args.clickDelayMs
        if (typeof args.pointerDurationMs === 'number') config.pointerDurationMs = args.pointerDurationMs
        if (typeof args.autoScroll === 'boolean') config.autoScroll = args.autoScroll

        if (Object.keys(config).length > 0) {
          this.commands.sendRaw({ type: 'config_update', config })
        }

        if (typeof args.agentActive === 'boolean') {
          this.setManualAgentActivity(args.agentActive)
        }

        return this.textResult('Configuration updated.')
      }

      default:
        return this.textResult(`Unknown tool: ${name}`, true)
    }
  }

  private resolveTabId(args: Record<string, unknown>): number | null {
    if (typeof args.tabId === 'number') return args.tabId
    const all = this.sessions.getSessions()
    return all.length > 0 ? all[0].tabId : null
  }

  private resolveSnapshotOptions(args: Record<string, unknown>): PublicSnapshotOptions {
    const groupIds = new Set<string>()
    if (typeof args.groupId === 'string' && args.groupId.trim()) {
      groupIds.add(args.groupId.trim())
    }
    if (Array.isArray(args.groupIds)) {
      for (const value of args.groupIds) {
        if (typeof value === 'string' && value.trim()) {
          groupIds.add(value.trim())
        }
      }
    }

    return {
      mode: args.mode === 'full' ? 'full' : 'outline',
      ...(groupIds.size > 0 ? { groupIds: [...groupIds] } : {}),
      ...(args.includeTextContent === true ? { includeTextContent: true } : {}),
    }
  }

  private async ensureReady(): Promise<ToolHandlerResult | null> {
    const deadline = Date.now() + ENSURE_READY_TIMEOUT_MS

    // Phase 1: wait for native host connection
    if (!this.commands.hasSender()) {
      const connected = await this.commands.waitForSender(ENSURE_READY_TIMEOUT_MS)
      if (!connected) {
        return this.textResult(
          'Native host not connected. Ensure the browser extension is installed and running.',
          true,
        )
      }
    }

    // Phase 2: wait for session + snapshot (using remaining time)
    if (this.sessions.hasReadySession()) return null

    const remaining = Math.max(0, deadline - Date.now())
    if (remaining === 0) {
      return this.textResult(
        'No browser sessions available. Ensure a page with agrune annotations is open.',
        true,
      )
    }

    // Dedup: join existing resync if already in progress
    if (!this.pendingResync) {
      this.commands.sendRaw({ type: 'resync_request' } as NativeMessage)
      this.pendingResync = this.sessions.waitForSnapshot(remaining)
        .finally(() => { this.pendingResync = null })
    }

    const ready = await this.pendingResync
    if (!ready) {
      return this.textResult(
        'No browser sessions available. Ensure a page with agrune annotations is open.',
        true,
      )
    }

    return null
  }

  private async withActivityBlocks<T>(kind: string, effect: () => Promise<T>): Promise<T> {
    const guardId = this.activityBlocks.pushGuard(`${kind}:guard`)
    try {
      return await effect()
    } finally {
      this.activityBlocks.pushTimed(`${kind}:tail`, ACTIVITY_TAIL_BLOCK_MS)
      this.activityBlocks.release(guardId)
    }
  }

  private setManualAgentActivity(active: boolean): void {
    if (active) {
      if (!this.manualAgentBlockId) {
        this.manualAgentBlockId = this.activityBlocks.pushGuard('manual:agent')
      }
      return
    }

    if (!this.manualAgentBlockId) {
      return
    }

    this.activityBlocks.release(this.manualAgentBlockId)
    this.manualAgentBlockId = null
  }

  private textResult(text: string, isError = false): ToolHandlerResult {
    return { text, ...(isError ? { isError: true } : {}) }
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
        mcpConnected: this.isAgentRecentlyActive() || this.activityBlocks.hasActiveBlocks(),
      },
    } as NativeMessage
  }

  private isAgentRecentlyActive(): boolean {
    return this.lastAgentActivityAt != null
      && Date.now() - this.lastAgentActivityAt <= ACTIVITY_TAIL_BLOCK_MS
  }
}
