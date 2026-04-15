import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import type { PageSnapshot, Session } from '@agrune/core'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface DevtoolsDriver {
  listSessions(): Session[]
  getSnapshot(tabId: number): PageSnapshot | null
  onSnapshotUpdate(cb: (tabId: number, snapshot: PageSnapshot) => void): void
  onSessionOpen(cb: (session: Session) => void): void
  onSessionClose(cb: (tabId: number) => void): void
  execute(tabId: number, command: Record<string, unknown> & { kind: string }): Promise<unknown>
}

interface ConnectedClient {
  ws: WebSocket
  subscribedTabId: number | null
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
}

let httpServer: ReturnType<typeof createServer> | null = null
let wss: WebSocketServer | null = null

export function resolveDevtoolsDist(): string {
  // Primary: sibling devtools package dist (monorepo layout)
  const monorepoPath = join(__dirname, '..', '..', 'devtools', 'dist')
  // Fallback: bundled devtools-dist alongside this package
  const fallbackPath = join(__dirname, '..', 'devtools-dist')
  // We try monorepo first at startup; stat is async so we just return the
  // candidate paths and let the caller check.  For synchronous resolution we
  // return the first path — the static file handler will 404 gracefully if
  // neither exists.
  return monorepoPath
}

export async function resolveDevtoolsDistAsync(): Promise<string> {
  const monorepoPath = join(__dirname, '..', '..', 'devtools', 'dist')
  try {
    const s = await stat(monorepoPath)
    if (s.isDirectory()) return monorepoPath
  } catch { /* not found */ }

  const fallbackPath = join(__dirname, '..', 'devtools-dist')
  try {
    const s = await stat(fallbackPath)
    if (s.isDirectory()) return fallbackPath
  } catch { /* not found */ }

  return monorepoPath // fall back to monorepo path even if missing
}

export async function startDevtoolsServer(driver: DevtoolsDriver): Promise<number> {
  if (httpServer) {
    const addr = httpServer.address()
    if (addr && typeof addr === 'object') return addr.port
    throw new Error('DevTools server already running but address unavailable.')
  }

  const distDir = await resolveDevtoolsDistAsync()
  const clients: ConnectedClient[] = []

  // --- HTTP server ---
  httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'

    if (!url.startsWith('/devtools')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }

    // Strip /devtools prefix to get the file path
    let filePath = url.replace(/^\/devtools/, '') || '/index.html'

    // Default to index.html for the root path
    if (filePath === '' || filePath === '/') {
      filePath = '/index.html'
    }

    // Strip query string
    filePath = filePath.split('?')[0]

    const fullPath = join(distDir, filePath)

    // Basic path traversal protection
    if (!fullPath.startsWith(distDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden')
      return
    }

    try {
      const content = await readFile(fullPath)
      const ext = extname(fullPath)
      const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    }
  })

  // --- WebSocket server ---
  wss = new WebSocketServer({ server: httpServer, path: '/devtools/ws' })

  wss.on('connection', (ws: WebSocket) => {
    const client: ConnectedClient = { ws, subscribedTabId: null }
    clients.push(client)

    ws.on('message', (raw: Buffer | string) => {
      try {
        const message = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'))
        handleClientMessage(client, message, driver, clients)
      } catch {
        // Ignore malformed messages
      }
    })

    ws.on('close', () => {
      const index = clients.indexOf(client)
      if (index !== -1) clients.splice(index, 1)
    })
  })

  // --- Driver event subscriptions ---
  driver.onSnapshotUpdate((tabId: number, snapshot: PageSnapshot) => {
    for (const client of clients) {
      if (client.subscribedTabId === tabId && client.ws.readyState === client.ws.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'snapshot_update',
          data: { tabId, snapshot },
        }))
      }
    }
  })

  driver.onSessionOpen(() => {
    broadcastSessions(clients, driver)
  })

  driver.onSessionClose(() => {
    broadcastSessions(clients, driver)
  })

  // --- Listen ---
  return new Promise<number>((resolve, reject) => {
    httpServer!.listen(0, '127.0.0.1', () => {
      const addr = httpServer!.address()
      if (addr && typeof addr === 'object') {
        resolve(addr.port)
      } else {
        reject(new Error('Failed to determine server port.'))
      }
    })
    httpServer!.on('error', reject)
  })
}

export async function stopDevtoolsServer(): Promise<void> {
  if (wss) {
    for (const client of wss.clients) {
      client.close()
    }
    wss.close()
    wss = null
  }
  if (httpServer) {
    await new Promise<void>((resolve, reject) => {
      httpServer!.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    httpServer = null
  }
}

function handleClientMessage(
  client: ConnectedClient,
  message: { type: string; tabId?: number; targetId?: string },
  driver: DevtoolsDriver,
  clients: ConnectedClient[],
): void {
  switch (message.type) {
    case 'subscribe': {
      if (typeof message.tabId !== 'number') return
      client.subscribedTabId = message.tabId

      // Send current sessions list
      sendToClient(client.ws, {
        type: 'sessions_update',
        data: driver.listSessions(),
      })

      // Send current snapshot if available
      const snapshot = driver.getSnapshot(message.tabId)
      if (snapshot) {
        sendToClient(client.ws, {
          type: 'snapshot_update',
          data: { tabId: message.tabId, snapshot },
        })
      }
      return
    }
    case 'highlight': {
      if (typeof message.targetId !== 'string') return
      if (client.subscribedTabId == null) return
      void driver.execute(client.subscribedTabId, {
        kind: 'highlight',
        targetId: message.targetId,
      })
      return
    }
    case 'clear_highlight': {
      if (client.subscribedTabId == null) return
      void driver.execute(client.subscribedTabId, {
        kind: 'clear_highlight',
      })
      return
    }
    default:
      return
  }
}

function broadcastSessions(
  clients: ConnectedClient[],
  driver: DevtoolsDriver,
): void {
  const sessions = driver.listSessions()
  const payload = JSON.stringify({
    type: 'sessions_update',
    data: sessions,
  })
  for (const client of clients) {
    if (client.ws.readyState === client.ws.OPEN) {
      client.ws.send(payload)
    }
  }
}

function sendToClient(ws: WebSocket, data: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data))
  }
}
