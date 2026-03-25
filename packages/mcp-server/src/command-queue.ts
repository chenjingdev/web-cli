import type { NativeMessage, CommandRequestMessage } from '@agrune/core'
import type { CommandResult } from '@agrune/core'

interface PendingCommand {
  resolve: (result: CommandResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class CommandQueue {
  private sender: ((msg: NativeMessage) => void) | null = null
  private pending = new Map<string, PendingCommand>()
  private counter = 0

  setSender(sender: ((msg: NativeMessage) => void) | null): void {
    this.sender = sender
  }

  sendRaw(msg: NativeMessage): void {
    if (this.sender) this.sender(msg)
  }

  hasSender(): boolean {
    return this.sender !== null
  }

  enqueue(
    tabId: number,
    command: Record<string, unknown> & { kind: string },
    opts?: { timeoutMs?: number },
  ): Promise<CommandResult> {
    const timeoutMs = opts?.timeoutMs ?? 30_000
    const commandId = `cmd-${++this.counter}-${Date.now()}`

    const msg: CommandRequestMessage = {
      type: 'command_request',
      tabId,
      commandId,
      command: command as CommandRequestMessage['command'],
    }

    if (this.sender) {
      this.sender(msg)
    }

    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId)
        reject(new Error('Command timed out'))
      }, timeoutMs)

      this.pending.set(commandId, { resolve, reject, timer })
    })
  }

  resolve(commandId: string, result: CommandResult): void {
    const entry = this.pending.get(commandId)
    if (!entry) return

    clearTimeout(entry.timer)
    this.pending.delete(commandId)
    entry.resolve(result)
  }
}
