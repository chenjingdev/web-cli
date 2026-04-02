# CDP Quick Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 확장프로그램 없이 CDP WebSocket으로 Chrome을 직접 launch/attach하여 agrune MCP 도구를 사용할 수 있게 한다.

**Architecture:** `CdpDriver implements BrowserDriver`를 `@agrune/browser`에 추가한다. ChromeLauncher가 Chrome 프로세스를 관리하고, CdpConnection이 WebSocket CDP 프로토콜을 처리하고, CdpTargetManager가 탭을 추적하고, CdpRuntimeInjector가 page-runtime을 주입한다. `@agrune/runtime`에 CDP용 self-bootstrapping 번들을 추가하여 DOM 스캔 → 매니페스트 빌드 → 런타임 초기화를 확장프로그램 없이 처리한다.

**Tech Stack:** TypeScript, WebSocket (`ws` 패키지), Chrome CDP Protocol, tsup

**Spec:** `docs/superpowers/specs/2026-04-02-cdp-quick-mode-design.md`

---

### Task 1: BrowserDriver 인터페이스 업데이트 — sendRaw → updateConfig

**Files:**
- Modify: `packages/core/src/driver.ts`
- Modify: `packages/browser/src/extension-driver.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/browser/tests/extension-driver.spec.ts`

- [ ] **Step 1: core/driver.ts에서 sendRaw 제거, updateConfig 추가**

`packages/core/src/driver.ts`:

```typescript
import type { PageSnapshot, CommandResult, AgruneRuntimeConfig } from './index.js'

export interface Session {
  tabId: number
  url: string
  title: string
  hasSnapshot: boolean
}

export interface BrowserDriver {
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  listSessions(): Session[]
  getSnapshot(tabId: number): PageSnapshot | null
  onSessionOpen(cb: (session: Session) => void): void
  onSessionClose(cb: (tabId: number) => void): void
  onSnapshotUpdate(cb: (tabId: number, snapshot: PageSnapshot) => void): void

  execute(tabId: number, command: Record<string, unknown> & { kind: string }): Promise<CommandResult>
  updateConfig(config: Partial<AgruneRuntimeConfig>): void

  ensureReady(): Promise<string | null>
  resolveTabId(tabId?: number): number | null
}
```

- [ ] **Step 2: ExtensionDriver에서 sendRaw를 BrowserDriver에서 제거, updateConfig 추가**

`packages/browser/src/extension-driver.ts`에서:

`sendRaw`는 public 메서드로 유지하되 BrowserDriver 인터페이스에서는 빠짐 (extension 전용).

`updateConfig` 추가:

```typescript
updateConfig(config: Partial<AgruneRuntimeConfig>): void {
  this.commands.sendRaw({ type: 'config_update', config } as NativeMessage)
}
```

- [ ] **Step 3: server/index.ts에서 driver.sendRaw → driver.updateConfig 사용**

`packages/server/src/index.ts`의 `agrune_config` case:

```typescript
// 변경 전
if (Object.keys(config).length > 0) driver.sendRaw({ type: 'config_update', config } as NativeMessage)

// 변경 후
if (Object.keys(config).length > 0) driver.updateConfig(config)
```

- [ ] **Step 4: server/index.ts에서 createMcpServer가 driver를 주입받도록 변경**

```typescript
// 변경 전
export function createMcpServer() {
  const driver = new ExtensionDriver()

// 변경 후
export function createMcpServer(driver: BrowserDriver & { sessions: SessionManager; onActivity: (() => void) | null }) {
```

이렇게 하면 CdpDriver도 주입 가능. `agrune-mcp.ts`에서 driver를 생성하여 넘김.

- [ ] **Step 5: 빌드 + 테스트 확인**

```bash
pnpm build && pnpm test
```

- [ ] **Step 6: 커밋**

```bash
git add packages/core packages/browser packages/server
git commit -m "refactor: update BrowserDriver — remove sendRaw, add updateConfig, inject driver into createMcpServer"
```

---

### Task 2: ChromeLauncher — Chrome 프로세스 관리

**Files:**
- Create: `packages/browser/src/chrome-launcher.ts`
- Create: `packages/browser/tests/chrome-launcher.spec.ts`

- [ ] **Step 1: chrome-launcher 테스트 작성**

`packages/browser/tests/chrome-launcher.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { findChromePath } from '../src/chrome-launcher.js'

describe('findChromePath', () => {
  it('returns a string path or null', () => {
    const result = findChromePath()
    // CI에서 Chrome이 없을 수 있으므로 타입만 확인
    expect(result === null || typeof result === 'string').toBe(true)
  })

  it('respects AGRUNE_CHROME_PATH env var', () => {
    const original = process.env.AGRUNE_CHROME_PATH
    process.env.AGRUNE_CHROME_PATH = '/custom/chrome'
    try {
      expect(findChromePath()).toBe('/custom/chrome')
    } finally {
      if (original !== undefined) process.env.AGRUNE_CHROME_PATH = original
      else delete process.env.AGRUNE_CHROME_PATH
    }
  })
})
```

- [ ] **Step 2: chrome-launcher 구현**

`packages/browser/src/chrome-launcher.ts`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface LaunchOptions {
  headless?: boolean
  userDataDir?: string
  args?: string[]
  chromePath?: string
}

export interface LaunchResult {
  wsEndpoint: string
  process: ChildProcess
  userDataDir: string
}

const CHROME_PATHS_MACOS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]

const CHROME_PATHS_LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]

const CHROME_PATHS_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

export function findChromePath(): string | null {
  if (process.env.AGRUNE_CHROME_PATH) {
    return process.env.AGRUNE_CHROME_PATH
  }

  const candidates =
    process.platform === 'darwin' ? CHROME_PATHS_MACOS :
    process.platform === 'win32' ? CHROME_PATHS_WIN :
    CHROME_PATHS_LINUX

  for (const path of candidates) {
    if (existsSync(path)) return path
  }

  return null
}

export async function launchChrome(options: LaunchOptions = {}): Promise<LaunchResult> {
  const chromePath = options.chromePath ?? findChromePath()
  if (!chromePath) {
    throw new Error(
      'Chrome not found. Set AGRUNE_CHROME_PATH environment variable or install Google Chrome.',
    )
  }

  const userDataDir = options.userDataDir ?? join(tmpdir(), `agrune-chrome-${Date.now()}`)

  const chromeArgs = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(options.headless ? ['--headless=new'] : []),
    ...(options.args ?? []),
  ]

  const child = spawn(chromePath, chromeArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  })

  const wsEndpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Chrome to start'))
    }, 30_000)

    let stderrData = ''

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString()
      const match = stderrData.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1])
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Chrome exited with code ${code}`))
    })
  })

  return { wsEndpoint, process: child, userDataDir }
}
```

- [ ] **Step 3: 테스트 실행**

```bash
cd packages/browser && pnpm test -- tests/chrome-launcher.spec.ts
```

- [ ] **Step 4: 커밋**

```bash
git add packages/browser/src/chrome-launcher.ts packages/browser/tests/chrome-launcher.spec.ts
git commit -m "feat(browser): add ChromeLauncher for Chrome process management"
```

---

### Task 3: CdpConnection — WebSocket CDP 프로토콜

**Files:**
- Create: `packages/browser/src/cdp-connection.ts`
- Create: `packages/browser/tests/cdp-connection.spec.ts`
- Modify: `packages/browser/package.json` — `ws` 의존성 추가

- [ ] **Step 1: ws 의존성 추가**

`packages/browser/package.json`의 dependencies에:

```json
"ws": "^8.18.0"
```

devDependencies에:

```json
"@types/ws": "^8.5.0"
```

`pnpm install`

- [ ] **Step 2: cdp-connection 구현**

`packages/browser/src/cdp-connection.ts`:

```typescript
import WebSocket from 'ws'

export interface CdpResponse {
  id: number
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

export class CdpConnection {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, {
    resolve: (result: Record<string, unknown>) => void
    reject: (error: Error) => void
  }>()
  private eventListeners = new Map<string, Set<(params: Record<string, unknown>) => void>>()
  private _connected = false

  async connect(wsEndpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsEndpoint)

      ws.on('open', () => {
        this.ws = ws
        this._connected = true
        resolve()
      })

      ws.on('message', (data: WebSocket.Data) => {
        const msg = JSON.parse(data.toString())

        // Response to a command
        if (typeof msg.id === 'number') {
          const entry = this.pending.get(msg.id)
          if (entry) {
            this.pending.delete(msg.id)
            if (msg.error) {
              entry.reject(new Error(`CDP error: ${msg.error.message} (${msg.error.code})`))
            } else {
              entry.resolve(msg.result ?? {})
            }
          }
          return
        }

        // Event
        if (typeof msg.method === 'string') {
          const listeners = this.eventListeners.get(msg.method)
          if (listeners) {
            for (const cb of listeners) cb(msg.params ?? {})
          }
        }
      })

      ws.on('close', () => {
        this._connected = false
        for (const [, entry] of this.pending) {
          entry.reject(new Error('CDP connection closed'))
        }
        this.pending.clear()
      })

      ws.on('error', (err) => {
        if (!this._connected) reject(err)
      })
    })
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close()
      this.ws = null
      this._connected = false
    }
  }

  get connected(): boolean {
    return this._connected
  }

  async send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.ws || !this._connected) {
      throw new Error('CDP not connected')
    }

    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP request timed out: ${method}`))
      }, 30_000)

      this.pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result) },
        reject: (err) => { clearTimeout(timer); reject(err) },
      })

      this.ws!.send(JSON.stringify({ id, method, params }))
    })
  }

  on(event: string, callback: (params: Record<string, unknown>) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(callback)
  }

  off(event: string, callback: (params: Record<string, unknown>) => void): void {
    this.eventListeners.get(event)?.delete(callback)
  }
}
```

- [ ] **Step 3: 테스트 작성 (단위 테스트 — WebSocket 모킹)**

`packages/browser/tests/cdp-connection.spec.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CdpConnection } from '../src/cdp-connection.js'

// 실제 WebSocket 없이 기본 구조만 테스트
describe('CdpConnection', () => {
  it('starts disconnected', () => {
    const conn = new CdpConnection()
    expect(conn.connected).toBe(false)
  })

  it('send throws when not connected', async () => {
    const conn = new CdpConnection()
    await expect(conn.send('Runtime.evaluate')).rejects.toThrow('CDP not connected')
  })

  it('registers and removes event listeners', () => {
    const conn = new CdpConnection()
    const cb = vi.fn()
    conn.on('Target.targetCreated', cb)
    conn.off('Target.targetCreated', cb)
    // No error, no crash
  })
})
```

- [ ] **Step 4: 빌드 + 테스트**

```bash
cd packages/browser && pnpm build && pnpm test
```

- [ ] **Step 5: 커밋**

```bash
git add packages/browser
git commit -m "feat(browser): add CdpConnection for WebSocket CDP protocol"
```

---

### Task 4: CdpTargetManager — 탭 lifecycle 추적

**Files:**
- Create: `packages/browser/src/cdp-target-manager.ts`
- Create: `packages/browser/tests/cdp-target-manager.spec.ts`

- [ ] **Step 1: cdp-target-manager 구현**

`packages/browser/src/cdp-target-manager.ts`:

```typescript
import type { CdpConnection } from './cdp-connection.js'

export interface TargetInfo {
  targetId: string
  type: string
  title: string
  url: string
  attached: boolean
  browserContextId?: string
}

export class CdpTargetManager {
  private targets = new Map<string, TargetInfo>()
  private targetCreatedCbs: ((target: TargetInfo) => void)[] = []
  private targetDestroyedCbs: ((targetId: string) => void)[] = []
  private targetInfoChangedCbs: ((target: TargetInfo) => void)[] = []
  private connection: CdpConnection | null = null

  async start(connection: CdpConnection): Promise<void> {
    this.connection = connection

    connection.on('Target.targetCreated', (params) => {
      const info = params.targetInfo as TargetInfo
      if (info.type !== 'page') return
      this.targets.set(info.targetId, info)
      this.targetCreatedCbs.forEach((cb) => cb(info))
    })

    connection.on('Target.targetDestroyed', (params) => {
      const targetId = params.targetId as string
      if (!this.targets.has(targetId)) return
      this.targets.delete(targetId)
      this.targetDestroyedCbs.forEach((cb) => cb(targetId))
    })

    connection.on('Target.targetInfoChanged', (params) => {
      const info = params.targetInfo as TargetInfo
      if (info.type !== 'page') return
      this.targets.set(info.targetId, info)
      this.targetInfoChangedCbs.forEach((cb) => cb(info))
    })

    await connection.send('Target.setDiscoverTargets', { discover: true })
  }

  stop(): void {
    this.targets.clear()
    this.connection = null
  }

  getTargets(): TargetInfo[] {
    return [...this.targets.values()]
  }

  getTarget(targetId: string): TargetInfo | undefined {
    return this.targets.get(targetId)
  }

  onTargetCreated(cb: (target: TargetInfo) => void): void {
    this.targetCreatedCbs.push(cb)
  }

  onTargetDestroyed(cb: (targetId: string) => void): void {
    this.targetDestroyedCbs.push(cb)
  }

  onTargetInfoChanged(cb: (target: TargetInfo) => void): void {
    this.targetInfoChangedCbs.push(cb)
  }

  async attachToTarget(targetId: string): Promise<string> {
    const result = await this.connection!.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })
    return result.sessionId as string
  }
}
```

- [ ] **Step 2: 테스트 작성**

`packages/browser/tests/cdp-target-manager.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { CdpTargetManager } from '../src/cdp-target-manager.js'

describe('CdpTargetManager', () => {
  it('starts with no targets', () => {
    const manager = new CdpTargetManager()
    expect(manager.getTargets()).toEqual([])
  })

  it('registers callbacks without error', () => {
    const manager = new CdpTargetManager()
    manager.onTargetCreated(vi.fn())
    manager.onTargetDestroyed(vi.fn())
    manager.onTargetInfoChanged(vi.fn())
  })
})
```

- [ ] **Step 3: 빌드 + 테스트**

```bash
cd packages/browser && pnpm build && pnpm test
```

- [ ] **Step 4: 커밋**

```bash
git add packages/browser/src/cdp-target-manager.ts packages/browser/tests/cdp-target-manager.spec.ts
git commit -m "feat(browser): add CdpTargetManager for tab lifecycle tracking"
```

---

### Task 5: CDP self-bootstrapping runtime 번들

**Files:**
- Create: `packages/runtime/src/cdp-bootstrap.ts`
- Modify: `packages/runtime/tsup.config.ts` — cdp-page-runtime 엔트리 추가

- [ ] **Step 1: cdp-bootstrap.ts 작성**

extension mode에서는 content script가 DOM 스캔 → 매니페스트 빌드 → runtime init을 하지만, CDP mode에서는 주입된 스크립트가 이 전체를 자체 수행해야 한다.

`packages/runtime/src/cdp-bootstrap.ts`:

```typescript
import { scanAnnotations, scanGroups } from './dom-scanner.js'
import { buildManifest } from './manifest-builder.js'
import { installPageAgentRuntime } from './runtime/page-agent-runtime.js'

/**
 * CDP mode self-bootstrap.
 * DOM 스캔 → 매니페스트 빌드 → runtime 설치 → binding 통신 설정.
 * 이 파일은 IIFE로 번들되어 CDP Runtime.evaluate로 페이지에 주입된다.
 */

function bootstrap(): void {
  // 이미 설치되어 있으면 스킵
  if ((window as any).__agrune_runtime_installed__) return

  const targets = scanAnnotations(document)
  const groups = scanGroups(document)
  const manifest = buildManifest(targets, groups)

  const handle = installPageAgentRuntime(manifest, {
    clickAutoScroll: true,
    clickRetryCount: 2,
    clickRetryDelayMs: 150,
    postMessage: (type: string, data: unknown) => {
      // CDP binding을 통해 서버로 전송
      if (typeof (window as any).agrune_send === 'function') {
        (window as any).agrune_send(JSON.stringify({ type, data }))
      }
    },
  })

  // 서버에서 명령을 받기 위한 글로벌 핸들러
  ;(window as any).__agrune__ = {
    handleCommand(commandJson: string): void {
      const { commandId, kind, ...rest } = JSON.parse(commandJson)
      const runtime = handle.runtime
      const method = kind as keyof typeof runtime
      if (typeof runtime[method] === 'function') {
        ;(runtime[method] as Function)(rest).then((result: any) => {
          const snapshot = runtime.getSnapshot()
          ;(window as any).agrune_send(JSON.stringify({
            type: 'command_result',
            data: { commandId, result: { ...result, snapshot } },
          }))
        }).catch((err: Error) => {
          ;(window as any).agrune_send(JSON.stringify({
            type: 'command_result',
            data: {
              commandId,
              result: { ok: false, error: { code: 'INVALID_COMMAND', message: err.message } },
            },
          }))
        })
      }
    },
    requestSnapshot(): void {
      const runtime = handle.runtime
      const snapshot = runtime.getSnapshot()
      ;(window as any).agrune_send(JSON.stringify({
        type: 'snapshot_update',
        data: { snapshot },
      }))
    },
    updateConfig(configJson: string): void {
      const config = JSON.parse(configJson)
      handle.runtime.applyConfig(config)
    },
  }

  ;(window as any).__agrune_runtime_installed__ = true

  // 초기 스냅샷 전송
  ;(window as any).__agrune__.requestSnapshot()
}

// DOM 준비 후 bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}
```

- [ ] **Step 2: tsup.config.ts에 cdp-page-runtime 엔트리 추가**

`packages/runtime/tsup.config.ts`의 두 번째 엔트리 배열에 추가:

```typescript
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    clean: true,
    sourcemap: true,
    target: 'es2022',
    dts: true,
  },
  {
    entry: {
      'page-runtime': 'src/runtime/index.ts',
      'cdp-page-runtime': 'src/cdp-bootstrap.ts',
    },
    format: ['iife'],
    clean: false,
    sourcemap: true,
    target: 'es2022',
    noExternal: [/.*/],
    globalName: '__agrune_runtime__',
  },
])
```

- [ ] **Step 3: 빌드 확인**

```bash
cd packages/runtime && pnpm build
ls dist/cdp-page-runtime.global.js
```
Expected: `cdp-page-runtime.global.js` 번들 생성

- [ ] **Step 4: 커밋**

```bash
git add packages/runtime
git commit -m "feat(runtime): add CDP self-bootstrapping page-runtime bundle"
```

---

### Task 6: CdpRuntimeInjector — runtime 주입 + binding 설정

**Files:**
- Create: `packages/browser/src/cdp-runtime-injector.ts`

- [ ] **Step 1: cdp-runtime-injector 구현**

`packages/browser/src/cdp-runtime-injector.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CdpConnection } from './cdp-connection.js'

let cachedRuntimeCode: string | null = null

function getRuntimeCode(): string {
  if (cachedRuntimeCode) return cachedRuntimeCode
  // @agrune/runtime의 cdp-page-runtime 번들 읽기
  const runtimePkg = dirname(require.resolve('@agrune/runtime/package.json'))
  const bundlePath = join(runtimePkg, 'dist', 'cdp-page-runtime.global.js')
  cachedRuntimeCode = readFileSync(bundlePath, 'utf-8')
  return cachedRuntimeCode
}

export class CdpRuntimeInjector {
  private connection: CdpConnection
  private injectedSessions = new Set<string>()

  constructor(connection: CdpConnection) {
    this.connection = connection
  }

  /**
   * 새로 열리는 모든 document에 자동 주입 설정.
   * Page.addScriptToEvaluateOnNewDocument 사용.
   */
  async setupAutoInjection(): Promise<void> {
    const runtimeCode = getRuntimeCode()

    // binding 등록 (모든 세션에 적용)
    await this.connection.send('Runtime.addBinding', { name: 'agrune_send' })

    // 새 document에 자동 주입
    await this.connection.send('Page.addScriptToEvaluateOnNewDocument', {
      source: runtimeCode,
    })

    await this.connection.send('Page.enable')
    await this.connection.send('Runtime.enable')
  }

  /**
   * 이미 열린 탭에 runtime 주입.
   * Target.attachToTarget으로 세션을 얻은 뒤 Runtime.evaluate 사용.
   */
  async injectIntoTarget(sessionId: string): Promise<void> {
    if (this.injectedSessions.has(sessionId)) return

    const runtimeCode = getRuntimeCode()

    // 세션별 binding 등록
    await this.connection.send('Runtime.addBinding', {
      name: 'agrune_send',
    })

    // runtime 주입
    await this.connection.send('Runtime.evaluate', {
      expression: runtimeCode,
      awaitPromise: false,
    })

    this.injectedSessions.add(sessionId)
  }

  removeSession(sessionId: string): void {
    this.injectedSessions.delete(sessionId)
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add packages/browser/src/cdp-runtime-injector.ts
git commit -m "feat(browser): add CdpRuntimeInjector for page-runtime injection via CDP"
```

---

### Task 7: CdpDriver — 전체 통합

**Files:**
- Create: `packages/browser/src/cdp-driver.ts`
- Modify: `packages/browser/src/index.ts` — export 추가
- Create: `packages/browser/tests/cdp-driver.spec.ts`

- [ ] **Step 1: CdpDriver 구현**

`packages/browser/src/cdp-driver.ts`:

```typescript
import type {
  BrowserDriver,
  Session,
  PageSnapshot,
  CommandResult,
  AgruneRuntimeConfig,
} from '@agrune/core'
import type { ChildProcess } from 'node:child_process'
import { CdpConnection } from './cdp-connection.js'
import { CdpTargetManager, type TargetInfo } from './cdp-target-manager.js'
import { CdpRuntimeInjector } from './cdp-runtime-injector.js'
import { launchChrome, findChromePath, type LaunchResult } from './chrome-launcher.js'
import { SessionManager } from './session-manager.js'

export interface CdpDriverOptions {
  mode: 'launch' | 'attach'
  wsEndpoint?: string
  headless?: boolean
  userDataDir?: string
  chromePath?: string
  args?: string[]
}

export class CdpDriver implements BrowserDriver {
  readonly sessions = new SessionManager()
  private connection = new CdpConnection()
  private targetManager = new CdpTargetManager()
  private injector: CdpRuntimeInjector | null = null
  private launchResult: LaunchResult | null = null
  private options: CdpDriverOptions
  private sessionOpenCbs: ((session: Session) => void)[] = []
  private sessionCloseCbs: ((tabId: number) => void)[] = []
  private snapshotUpdateCbs: ((tabId: number, snapshot: PageSnapshot) => void)[] = []
  private targetToTabId = new Map<string, number>()
  private tabIdCounter = 1
  onActivity: (() => void) | null = null

  constructor(options: CdpDriverOptions) {
    this.options = options
  }

  async connect(): Promise<void> {
    let wsEndpoint: string

    if (this.options.mode === 'launch') {
      this.launchResult = await launchChrome({
        headless: this.options.headless,
        userDataDir: this.options.userDataDir,
        chromePath: this.options.chromePath,
        args: this.options.args,
      })
      wsEndpoint = this.launchResult.wsEndpoint
    } else {
      if (!this.options.wsEndpoint) {
        throw new Error('wsEndpoint is required for attach mode')
      }
      wsEndpoint = this.options.wsEndpoint
    }

    await this.connection.connect(wsEndpoint)
    this.injector = new CdpRuntimeInjector(this.connection)

    // binding callback 등록
    this.connection.on('Runtime.bindingCalled', (params) => {
      if (params.name === 'agrune_send') {
        this.handleBindingMessage(params.payload as string, params.executionContextId as number)
      }
    })

    // 탭 추적 시작
    this.targetManager.onTargetCreated((target) => this.handleTargetCreated(target))
    this.targetManager.onTargetDestroyed((targetId) => this.handleTargetDestroyed(targetId))
    this.targetManager.onTargetInfoChanged((target) => this.handleTargetInfoChanged(target))
    await this.targetManager.start(this.connection)

    // 기존 탭에 runtime 주입
    for (const target of this.targetManager.getTargets()) {
      await this.handleTargetCreated(target)
    }
  }

  async disconnect(): Promise<void> {
    this.targetManager.stop()
    await this.connection.disconnect()

    if (this.launchResult?.process) {
      this.launchResult.process.kill()
      this.launchResult = null
    }
  }

  isConnected(): boolean {
    return this.connection.connected
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

  onSessionOpen(cb: (session: Session) => void): void { this.sessionOpenCbs.push(cb) }
  onSessionClose(cb: (tabId: number) => void): void { this.sessionCloseCbs.push(cb) }
  onSnapshotUpdate(cb: (tabId: number, snapshot: PageSnapshot) => void): void { this.snapshotUpdateCbs.push(cb) }

  async execute(
    tabId: number,
    command: Record<string, unknown> & { kind: string },
  ): Promise<CommandResult> {
    const session = this.sessions.getSession(tabId)
    if (!session) {
      return {
        commandId: `cdp-${Date.now()}`,
        ok: false,
        error: { code: 'SESSION_NOT_ACTIVE', message: `No session for tab ${tabId}` },
      } as CommandResult
    }

    const commandId = `cdp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const commandJson = JSON.stringify({ commandId, ...command })

    return new Promise<CommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId)
        resolve({
          commandId,
          ok: false,
          error: { code: 'TIMEOUT', message: 'Command timed out' },
        } as CommandResult)
      }, 30_000)

      this.pendingCommands.set(commandId, { resolve, timeout })

      // page runtime에 명령 전달
      this.connection.send('Runtime.evaluate', {
        expression: `window.__agrune__?.handleCommand(${JSON.stringify(commandJson)})`,
        awaitPromise: false,
      }).catch((err) => {
        clearTimeout(timeout)
        this.pendingCommands.delete(commandId)
        resolve({
          commandId,
          ok: false,
          error: { code: 'INVALID_COMMAND', message: err.message },
        } as CommandResult)
      })
    })
  }

  updateConfig(config: Partial<AgruneRuntimeConfig>): void {
    const configJson = JSON.stringify(config)
    // 모든 활성 탭에 config 전파
    for (const session of this.sessions.getSessions()) {
      this.connection.send('Runtime.evaluate', {
        expression: `window.__agrune__?.updateConfig(${JSON.stringify(configJson)})`,
        awaitPromise: false,
      }).catch(() => {})
    }
  }

  async ensureReady(): Promise<string | null> {
    if (!this.connection.connected) {
      return 'CDP not connected. Call connect() first.'
    }
    if (this.sessions.hasReadySession()) return null

    // 짧은 대기 — 새 탭이 열리고 스냅샷이 도착할 때까지
    const ready = await this.sessions.waitForSnapshot(10_000)
    if (!ready) {
      return 'No browser sessions with agrune annotations found.'
    }
    return null
  }

  resolveTabId(tabId?: number): number | null {
    if (typeof tabId === 'number') return tabId
    const all = this.sessions.getSessions()
    return all.length > 0 ? all[0].tabId : null
  }

  // --- Internal ---

  private pendingCommands = new Map<string, {
    resolve: (result: CommandResult) => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  private async handleTargetCreated(target: TargetInfo): Promise<void> {
    const tabId = this.tabIdCounter++
    this.targetToTabId.set(target.targetId, tabId)

    this.sessions.openSession(tabId, target.url, target.title)
    this.sessionOpenCbs.forEach((cb) => cb({
      tabId, url: target.url, title: target.title, hasSnapshot: false,
    }))

    // runtime 주입
    try {
      const sessionId = await this.targetManager.attachToTarget(target.targetId)
      await this.injector!.injectIntoTarget(sessionId)
    } catch {
      // 주입 실패 시 무시 (about:blank 등)
    }
  }

  private handleTargetDestroyed(targetId: string): void {
    const tabId = this.targetToTabId.get(targetId)
    if (tabId == null) return
    this.targetToTabId.delete(targetId)
    this.sessions.closeSession(tabId)
    this.sessionCloseCbs.forEach((cb) => cb(tabId))
  }

  private handleTargetInfoChanged(target: TargetInfo): void {
    const tabId = this.targetToTabId.get(target.targetId)
    if (tabId == null) return
    // URL/title 변경 시 세션 업데이트
    const session = this.sessions.getSession(tabId)
    if (session) {
      session.url = target.url
      session.title = target.title
    }
  }

  private handleBindingMessage(payload: string, _contextId: number): void {
    try {
      const msg = JSON.parse(payload) as { type: string; data: unknown }

      if (msg.type === 'command_result') {
        const data = msg.data as { commandId: string; result: CommandResult }
        const entry = this.pendingCommands.get(data.commandId)
        if (entry) {
          clearTimeout(entry.timeout)
          this.pendingCommands.delete(data.commandId)

          // 스냅샷 업데이트
          const result = data.result as CommandResult & { snapshot?: PageSnapshot }
          if (result.snapshot) {
            // 어떤 탭의 결과인지 결정 (첫 번째 세션 사용)
            const firstSession = this.sessions.getSessions()[0]
            if (firstSession) {
              this.sessions.updateSnapshot(firstSession.tabId, result.snapshot)
              this.snapshotUpdateCbs.forEach((cb) => cb(firstSession.tabId, result.snapshot!))
            }
          }

          entry.resolve(data.result)
        }
      }

      if (msg.type === 'snapshot_update') {
        const data = msg.data as { snapshot: PageSnapshot }
        const firstSession = this.sessions.getSessions()[0]
        if (firstSession) {
          this.sessions.updateSnapshot(firstSession.tabId, data.snapshot)
          this.snapshotUpdateCbs.forEach((cb) => cb(firstSession.tabId, data.snapshot))
        }
      }
    } catch {
      // malformed message — ignore
    }
  }
}
```

- [ ] **Step 2: browser/index.ts에 export 추가**

`packages/browser/src/index.ts`에 추가:

```typescript
export { CdpDriver } from './cdp-driver.js'
export type { CdpDriverOptions } from './cdp-driver.js'
export { CdpConnection } from './cdp-connection.js'
export { CdpTargetManager } from './cdp-target-manager.js'
export { CdpRuntimeInjector } from './cdp-runtime-injector.js'
export { launchChrome, findChromePath } from './chrome-launcher.js'
```

- [ ] **Step 3: 빌드 확인**

```bash
cd packages/browser && pnpm build
```

- [ ] **Step 4: 커밋**

```bash
git add packages/browser
git commit -m "feat(browser): add CdpDriver implementing BrowserDriver via WebSocket CDP"
```

---

### Task 8: server 진입점 — `--mode cdp` 옵션

**Files:**
- Modify: `packages/server/src/index.ts` — createMcpServer에 driver 주입
- Modify: `packages/server/bin/agrune-mcp.ts` — --mode cdp 옵션 추가

- [ ] **Step 1: agrune-mcp.ts에 --mode cdp 분기 추가**

`packages/server/bin/agrune-mcp.ts`의 시작 부분에서 mode를 파싱하고, CDP mode일 때 CdpDriver를 생성:

기본 MCP frontend 모드(파일 끝부분)를 수정:

```typescript
// 기존 default mode 앞에 추가
const modeIdx = args.indexOf('--mode')
const mode = modeIdx !== -1 ? args[modeIdx + 1] : 'extension'
const headless = args.includes('--headless')
const attachIdx = args.indexOf('--attach')
const wsEndpoint = attachIdx !== -1 ? args[attachIdx + 1] : undefined

if (mode === 'cdp') {
  // CDP Quick Mode — 직접 Chrome에 연결
  const { CdpDriver } = await import('@agrune/browser')
  const { createMcpServer } = await import('../src/index.js')

  const driver = new CdpDriver({
    mode: wsEndpoint ? 'attach' : 'launch',
    wsEndpoint,
    headless,
  })

  await driver.connect()
  console.error(`[agrune] CDP mode: connected to Chrome`)

  const { server } = createMcpServer(driver)

  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const transport = new StdioServerTransport()
  await server.connect(transport)

  process.on('SIGINT', async () => {
    await driver.disconnect()
    process.exit(0)
  })
} else {
  // 기존 extension mode (default) — 변경 없음
  // ... existing code ...
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd packages/server && pnpm build
```

- [ ] **Step 3: 커밋**

```bash
git add packages/server
git commit -m "feat(server): add --mode cdp option to agrune-mcp entry point"
```

---

### Task 9: 통합 검증

- [ ] **Step 1: 전체 빌드**

```bash
pnpm build
```
Expected: 모든 패키지 빌드 성공

- [ ] **Step 2: 전체 테스트**

```bash
pnpm test
```
Expected: 기존 테스트 전체 통과

- [ ] **Step 3: CDP launch 수동 테스트**

Chrome이 설치된 환경에서:

```bash
cd packages/server
node dist/bin/agrune-mcp.js --mode cdp
```

Expected: Chrome이 자동으로 뜨고, MCP server가 stdio로 대기. `agrune_sessions`를 호출하면 열린 탭 목록이 반환됨.

- [ ] **Step 4: CDP headless 테스트**

```bash
node dist/bin/agrune-mcp.js --mode cdp --headless
```

Expected: headless Chrome이 뜨고 동일하게 동작.

- [ ] **Step 5: 기존 extension mode 확인**

```bash
node dist/bin/agrune-mcp.js
```

Expected: 기존과 동일하게 동작 (extension native messaging 경유).

- [ ] **Step 6: 최종 커밋**

```bash
git add -A
git commit -m "feat: CDP Quick Mode — launch/attach Chrome without extension

CdpDriver implements BrowserDriver via WebSocket CDP.
agrune-mcp --mode cdp launches Chrome directly.
agrune-mcp --mode cdp --headless for CI/QA.
agrune-mcp --mode cdp --attach ws://... for existing browsers."
```
