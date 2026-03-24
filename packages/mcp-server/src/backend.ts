import type { NativeMessage, WebCliRuntimeConfig } from '@runeai/core'
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

export class WebCliBackend {
  readonly sessions = new SessionManager()
  readonly commands = new CommandQueue()
  private readonly activityBlocks = new ActivityBlockStack((active) => {
    this.commands.sendRaw({ type: 'agent_activity', active })
  })
  private manualAgentBlockId: string | null = null
  private lastAgentActivityAt: number | null = null

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

    switch (name) {
      case 'webcli_sessions': {
        const list = this.sessions.getSessions()
        return this.textResult(JSON.stringify(list.map(toPublicSession), null, 2))
      }

      case 'webcli_snapshot': {
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

      case 'webcli_act':
      case 'webcli_fill':
      case 'webcli_drag':
      case 'webcli_wait':
      case 'webcli_guide': {
        const tabId = this.resolveTabId(args)
        if (tabId == null) {
          return this.textResult('No active sessions.', true)
        }
        return this.withActivityBlocks(name.replace('webcli_', ''), async () => {
          const command: Record<string, unknown> & { kind: string } = {
            kind: name.replace('webcli_', ''),
            ...args,
          }
          delete command.tabId
          const result = await this.commands.enqueue(tabId, command)
          return this.textResult(JSON.stringify(toPublicCommandResult(result), null, 2))
        })
      }

      case 'webcli_config': {
        const config: Partial<WebCliRuntimeConfig> = {}
        if (typeof args.pointerAnimation === 'boolean') config.pointerAnimation = args.pointerAnimation
        if (typeof args.auroraGlow === 'boolean') config.auroraGlow = args.auroraGlow
        if (typeof args.auroraTheme === 'string') {
          config.auroraTheme = args.auroraTheme as WebCliRuntimeConfig['auroraTheme']
        }
        if (typeof args.clickDelayMs === 'number') config.clickDelayMs = args.clickDelayMs
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
    }
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
        hostName: 'com.runeai.rune',
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
