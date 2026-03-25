export interface ActivityBlock {
  id: string
  kind: string
  expiresAt: number | null
}

export class ActivityBlockStack {
  private blocks: ActivityBlock[] = []
  private counter = 0
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private active = false

  constructor(
    private readonly onActiveChange: (active: boolean) => void,
  ) {}

  pushGuard(kind: string): string {
    const id = this.nextId(kind)
    this.blocks.push({ id, kind, expiresAt: null })
    this.sync()
    return id
  }

  pushTimed(kind: string, ttlMs: number): string {
    const id = this.nextId(kind)
    this.blocks.push({ id, kind, expiresAt: Date.now() + ttlMs })
    this.sync()
    return id
  }

  release(id: string): void {
    const next = this.blocks.filter((block) => block.id !== id)
    if (next.length === this.blocks.length) {
      return
    }
    this.blocks = next
    this.sync()
  }

  hasActiveBlocks(): boolean {
    this.pagruneExpired()
    return this.blocks.length > 0
  }

  getBlocks(): readonly ActivityBlock[] {
    this.pagruneExpired()
    return [...this.blocks]
  }

  private nextId(kind: string): string {
    this.counter += 1
    return `${kind}-${this.counter}`
  }

  private pagruneExpired(): void {
    const now = Date.now()
    const next = this.blocks.filter((block) => block.expiresAt == null || block.expiresAt > now)
    if (next.length !== this.blocks.length) {
      this.blocks = next
    }
  }

  private sync(): void {
    this.pagruneExpired()
    this.scheduleNextExpiry()

    const nextActive = this.blocks.length > 0
    if (nextActive !== this.active) {
      this.active = nextActive
      this.onActiveChange(nextActive)
    }
  }

  private scheduleNextExpiry(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer)
      this.expiryTimer = null
    }

    const nextExpiry = this.blocks
      .map((block) => block.expiresAt)
      .filter((expiresAt): expiresAt is number => expiresAt != null)
      .sort((left, right) => left - right)[0]

    if (nextExpiry == null) {
      return
    }

    const delay = Math.max(0, nextExpiry - Date.now())
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null
      this.sync()
    }, delay)
  }
}
