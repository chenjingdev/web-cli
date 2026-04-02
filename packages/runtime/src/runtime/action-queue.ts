export interface Block {
  type: string
  execute(): Promise<void>
}

export interface AnimationBlock extends Block {
  type: 'animation'
  target: { x: number; y: number }
}

export interface ActionQueueOptions {
  idleTimeoutMs: number
}

interface QueueEntry {
  block: Block
  settled: boolean
  resolve: () => void
  reject: (reason?: unknown) => void
}

export class ActionQueue {
  private readonly idleTimeoutMs: number
  private readonly entries: QueueEntry[] = []
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private activeEntry: QueueEntry | null = null
  private _processing = false
  private _paused = false
  private _active = false
  private disposed = false

  onActivate: (() => void) | null = null
  onDeactivate: (() => void) | null = null

  constructor(options: ActionQueueOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs
  }

  get length(): number {
    return this.entries.length
  }

  get processing(): boolean {
    return this._processing
  }

  get paused(): boolean {
    return this._paused
  }

  get active(): boolean {
    return this._active
  }

  push(block: Block): Promise<void> {
    if (this.disposed) {
      const promise = Promise.reject(new Error('Queue disposed'))
      promise.catch(() => {})
      return promise
    }

    this.clearIdleTimer()

    if (!this._active) {
      this._active = true
      this.onActivate?.()
    }

    let entry: QueueEntry
    const promise = new Promise<void>((resolve, reject) => {
      entry = {
        block,
        settled: false,
        resolve,
        reject,
      }
      this.entries.push(entry)
    })

    promise.catch(() => {})

    if (!this._paused && !this._processing) {
      void this.processLoop()
    }

    return promise
  }

  pause(): void {
    if (this.disposed) {
      return
    }

    this._paused = true
    this.clearIdleTimer()
  }

  resume(): void {
    if (this.disposed || !this._paused) {
      return
    }

    this._paused = false

    if (this.entries.length > 0 && !this._processing) {
      void this.processLoop()
      return
    }

    if (this.entries.length === 0 && !this._processing && this._active) {
      this.startIdleTimer()
    }
  }

  clear(): void {
    if (this.disposed) {
      return
    }

    for (const entry of this.entries.splice(0)) {
      this.rejectEntry(entry, new Error('Queue cleared'))
    }

    if (!this._paused && !this._processing && this._active) {
      this.startIdleTimer()
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.clearIdleTimer()

    for (const entry of this.entries.splice(0)) {
      this.rejectEntry(entry, new Error('Queue disposed'))
    }

    if (this.activeEntry) {
      this.rejectEntry(this.activeEntry, new Error('Queue disposed'))
      this.activeEntry = null
    }

    this._processing = false
    this._paused = false
    this._active = false
    this.onActivate = null
    this.onDeactivate = null
  }

  private async processLoop(): Promise<void> {
    if (this._processing || this.disposed) {
      return
    }

    this._processing = true

    try {
      while (!this.disposed && !this._paused && this.entries.length > 0) {
        const entry = this.entries.shift()
        if (!entry) {
          break
        }

        this.activeEntry = entry

        try {
          await entry.block.execute()
          this.resolveEntry(entry)
        } catch (error) {
          this.rejectEntry(entry, error)
        } finally {
          if (this.activeEntry === entry) {
            this.activeEntry = null
          }
        }
      }
    } finally {
      this._processing = false

      if (!this.disposed && !this._paused && this.entries.length === 0 && this._active) {
        this.startIdleTimer()
      }
    }
  }

  private startIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      this._active = false
      this.onDeactivate?.()
    }, this.idleTimeoutMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private resolveEntry(entry: QueueEntry): void {
    if (entry.settled) {
      return
    }

    entry.settled = true
    entry.resolve()
  }

  private rejectEntry(entry: QueueEntry, reason?: unknown): void {
    if (entry.settled) {
      return
    }

    entry.settled = true
    entry.reject(reason)
  }
}

export function createAnimationBlock(
  target: { x: number; y: number },
  animate: () => Promise<void>,
): AnimationBlock {
  return {
    type: 'animation',
    target,
    execute: animate,
  }
}

export function createDelayBlock(ms: number): Block {
  return {
    type: 'delay',
    execute: () => new Promise(resolve => setTimeout(resolve, ms)),
  }
}
