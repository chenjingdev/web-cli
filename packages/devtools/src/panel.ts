import type { PageSnapshot, PageTarget, Session } from '@agrune/core'

// --- State ---
let snapshot: PageSnapshot | null = null
let selectedTargetId: string | null = null
let paused = false
const collapsedGroups = new Set<string>()
let sessions: Session[] = []
let subscribedTabId: number | null = null

// --- DOM refs ---
const connectionStatus = document.getElementById('connectionStatus') as HTMLSpanElement
const tabSelect = document.getElementById('tabSelect') as HTMLSelectElement
const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement
const snapshotInfo = document.getElementById('snapshotInfo') as HTMLSpanElement
const reasonFilter = document.getElementById('reasonFilter') as HTMLSelectElement
const actionFilter = document.getElementById('actionFilter') as HTMLSelectElement
const searchInput = document.getElementById('searchInput') as HTMLInputElement
const targetList = document.getElementById('targetList') as HTMLDivElement
const detailPane = document.getElementById('detailPane') as HTMLDivElement

// --- WebSocket connection ---
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function getWsUrl(): string {
  // Connect to the same host that served this page, at /devtools/ws
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/devtools/ws`
}

function setConnectionStatus(connected: boolean): void {
  connectionStatus.className = connected
    ? 'status-dot connected'
    : 'status-dot disconnected'
  connectionStatus.title = connected ? 'Connected' : 'Disconnected'
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  try {
    ws = new WebSocket(getWsUrl())
  } catch {
    scheduleReconnect()
    return
  }

  ws.addEventListener('open', () => {
    setConnectionStatus(true)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    // Re-subscribe to previously selected tab
    if (subscribedTabId != null) {
      wsSend({ type: 'subscribe', tabId: subscribedTabId })
    }
  })

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data as string) as { type: string; data: unknown }
      handleMessage(msg)
    } catch {
      // Ignore malformed messages
    }
  })

  ws.addEventListener('close', () => {
    setConnectionStatus(false)
    ws = null
    scheduleReconnect()
  })

  ws.addEventListener('error', () => {
    // The close event will fire after this — reconnect is handled there
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 2000)
}

function wsSend(data: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

function handleMessage(msg: { type: string; data: unknown }): void {
  switch (msg.type) {
    case 'sessions_update': {
      sessions = msg.data as Session[]
      updateTabSelect()
      return
    }
    case 'snapshot_update': {
      const { snapshot: snap } = msg.data as { tabId: number; snapshot: PageSnapshot }
      if (!paused) {
        snapshot = snap
        render()
      }
      return
    }
  }
}

function updateTabSelect(): void {
  const currentValue = tabSelect.value
  tabSelect.innerHTML = sessions.length === 0
    ? '<option value="">No sessions</option>'
    : sessions.map(s =>
        `<option value="${s.tabId}"${String(s.tabId) === currentValue ? ' selected' : ''}>${s.title || s.url} (tab ${s.tabId})</option>`
      ).join('')

  // Auto-select first session if none selected
  if (sessions.length > 0 && (subscribedTabId == null || !sessions.some(s => s.tabId === subscribedTabId))) {
    tabSelect.value = String(sessions[0].tabId)
    subscribeToTab(sessions[0].tabId)
  }
}

function subscribeToTab(tabId: number): void {
  subscribedTabId = tabId
  snapshot = null
  selectedTargetId = null
  render()
  wsSend({ type: 'subscribe', tabId })
}

// --- Tab select handler ---
tabSelect.addEventListener('change', () => {
  const tabId = Number(tabSelect.value)
  if (!isNaN(tabId) && tabId > 0) {
    subscribeToTab(tabId)
  }
})

// --- Pause/Resume ---
pauseBtn.addEventListener('click', () => {
  paused = !paused
  pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause'
  pauseBtn.classList.toggle('paused', paused)
})

// --- Filters ---
reasonFilter.addEventListener('change', render)
actionFilter.addEventListener('change', render)
searchInput.addEventListener('input', render)

// --- Render ---
function reasonClass(reason: string): string {
  if (reason === 'hidden') return 'hidden-reason'
  return reason
}

function render() {
  if (!snapshot) {
    snapshotInfo.textContent = 'Waiting for snapshot...'
    targetList.innerHTML = ''
    detailPane.innerHTML = '<p class="empty-detail">No snapshot yet</p>'
    return
  }

  const elapsed = ((Date.now() - snapshot.capturedAt) / 1000).toFixed(1)
  snapshotInfo.textContent = `v${snapshot.version} · ${elapsed}s ago · ${snapshot.targets.length} targets`

  // Populate reason filter dynamically
  const reasons = [...new Set(snapshot.targets.map(t => t.reason))]
  const currentReason = reasonFilter.value
  reasonFilter.innerHTML = '<option value="">All reasons</option>' +
    reasons.map(r => `<option value="${r}"${r === currentReason ? ' selected' : ''}>${r}</option>`).join('')

  // Populate action filter dynamically
  const actionKinds = [...new Set(snapshot.targets.flatMap(t => t.actionKinds))]
  const currentAction = actionFilter.value
  actionFilter.innerHTML = '<option value="">All actions</option>' +
    actionKinds.map(k => `<option value="${k}"${k === currentAction ? ' selected' : ''}>${k}</option>`).join('')

  const rFilter = reasonFilter.value
  const aFilter = actionFilter.value
  const search = searchInput.value.toLowerCase()

  // Build target list by group
  targetList.innerHTML = ''
  for (const group of snapshot.groups) {
    const groupTargets = group.targetIds
      .map(id => snapshot!.targets.find(t => t.targetId === id))
      .filter((t): t is PageTarget => !!t)
      .filter(t => !rFilter || t.reason === rFilter)
      .filter(t => !aFilter || t.actionKinds.includes(aFilter as any))
      .filter(t => !search || t.name.toLowerCase().includes(search) || (t.groupName ?? '').toLowerCase().includes(search) || (t.textContent ?? '').toLowerCase().includes(search))

    if (groupTargets.length === 0) continue

    const collapsed = collapsedGroups.has(group.groupId)

    // Group header
    const header = document.createElement('div')
    header.className = 'group-header'
    header.innerHTML = `<span>${collapsed ? '▸' : '▾'} ${group.groupName ?? group.groupId} <span class="group-desc">${group.groupDesc ? '— ' + group.groupDesc : ''}</span></span><span class="group-count">${groupTargets.length}</span>`
    header.addEventListener('click', () => {
      if (collapsedGroups.has(group.groupId)) collapsedGroups.delete(group.groupId)
      else collapsedGroups.add(group.groupId)
      render()
    })
    targetList.appendChild(header)

    if (collapsed) continue

    // Target rows
    for (const target of groupTargets) {
      const row = document.createElement('div')
      row.className = 'target-row' + (target.targetId === selectedTargetId ? ' selected' : '')
      row.innerHTML = `<span class="reason-dot ${reasonClass(target.reason)}">●</span><span class="target-name${target.reason !== 'ready' ? ' not-ready' : ''}">${target.name}</span><span class="target-action">${target.actionKinds.join(', ')}</span><span class="reason-badge ${reasonClass(target.reason)}">${target.reason}</span>`
      row.addEventListener('click', () => {
        selectedTargetId = target.targetId
        render()
        highlightInPage(target)
      })
      targetList.appendChild(row)
    }
  }

  renderDetail()
}

function renderDetail() {
  if (!snapshot || !selectedTargetId) {
    detailPane.innerHTML = '<p class="empty-detail">Select a target</p>'
    return
  }

  const target = snapshot.targets.find(t => t.targetId === selectedTargetId)
  if (!target) {
    detailPane.innerHTML = '<p class="empty-detail">Target not found in current snapshot</p>'
    return
  }

  const boolCell = (v: boolean) => `<span class="${v ? 'detail-bool-true' : 'detail-bool-false'}">${v}</span>`

  detailPane.innerHTML = `
    <div class="detail-name">${target.name}</div>
    <div class="detail-group">${target.groupName ?? target.groupId} group</div>
    <table class="detail-table">
      <tr><td>targetId</td><td>${target.targetId}</td></tr>
      <tr><td>actionKinds</td><td>${target.actionKinds.map(k => `<span class="action-badge">${k}</span>`).join(' ')}</td></tr>
      <tr><td>visible</td><td>${boolCell(target.visible)}</td></tr>
      <tr><td>enabled</td><td>${boolCell(target.enabled)}</td></tr>
      <tr><td>inViewport</td><td>${boolCell(target.inViewport)}</td></tr>
      <tr><td>covered</td><td>${boolCell(target.covered)}</td></tr>
      <tr><td>actionableNow</td><td>${boolCell(target.actionableNow)}</td></tr>
      <tr><td>reason</td><td><span class="reason-badge ${reasonClass(target.reason)}">${target.reason}</span></td></tr>
      <tr><td>sensitive</td><td>${target.sensitive ? '<span class="detail-bool-false">true</span>' : boolCell(false)}</td></tr>
      <tr><td>selector</td><td style="color:#89dceb;font-size:9px;">${target.selector}</td></tr>
      <tr><td>textContent</td><td>${target.textContent ? target.textContent : '<span style="color:#585b70;font-style:italic;">—</span>'}</td></tr>
      <tr><td>valuePreview</td><td>${target.valuePreview ?? '<span style="color:#585b70;font-style:italic;">—</span>'}</td></tr>
    </table>
    <div class="detail-source">
      <div class="detail-source-label">Source</div>
      <div class="detail-source-link">${target.sourceFile}:${target.sourceLine}:${target.sourceColumn}</div>
    </div>
    <button class="highlight-btn" id="highlightBtn">Highlight in Page</button>
  `

  document.getElementById('highlightBtn')?.addEventListener('click', () => {
    highlightInPage(target)
  })
}

function highlightInPage(target: PageTarget) {
  wsSend({
    type: 'highlight',
    targetId: target.targetId,
  })
}

// --- Connection status + tab select CSS ---
const style = document.createElement('style')
style.textContent = `
  .status-dot {
    font-size: 14px;
    line-height: 1;
  }
  .status-dot.connected {
    color: #a6e3a1;
  }
  .status-dot.disconnected {
    color: #f38ba8;
  }
  #tabSelect {
    max-width: 200px;
  }
`
document.head.appendChild(style)

// --- Initial render & connect ---
render()
connect()
