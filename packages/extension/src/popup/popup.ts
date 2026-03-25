import { getConfig, setConfig } from '../shared/config.js'
import type {
  NativeHostConnectionPhase,
  NativeHostStatus,
  AgagruneRuntimeConfig,
} from '@agrune/core'
import type { ExtensionMessage } from '../shared/messages.js'

const ids = {
  hostStatusBadge: 'hostStatusBadge',
  hostStatusDetail: 'hostStatusDetail',
  reconnectNativeHost: 'reconnectNativeHost',
  pointerAnimation: 'pointerAnimation',
  auroraGlow: 'auroraGlow',
  auroraTheme: 'auroraTheme',
  clickDelayMs: 'clickDelayMs',
  pointerDurationMs: 'pointerDurationMs',
  autoScroll: 'autoScroll',
} as const

const DEFAULT_NATIVE_HOST_NAME = 'com.agrune.agrune'

const HOST_STATUS_LABELS: Record<NativeHostConnectionPhase, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  error: 'Error',
}

function $(id: string): HTMLElement {
  return document.getElementById(id)!
}

function checkbox(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement
}

function select(id: string): HTMLSelectElement {
  return $(id) as HTMLSelectElement
}

function numberInput(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement
}

function hostStatusBadge(): HTMLElement {
  return $(ids.hostStatusBadge)
}

function hostStatusDetail(): HTMLElement {
  return $(ids.hostStatusDetail)
}

function reconnectNativeHostButton(): HTMLButtonElement {
  return $(ids.reconnectNativeHost) as HTMLButtonElement
}

function populateForm(config: AgagruneRuntimeConfig): void {
  checkbox(ids.pointerAnimation).checked = config.pointerAnimation
  checkbox(ids.auroraGlow).checked = config.auroraGlow
  checkbox(ids.autoScroll).checked = config.autoScroll
  select(ids.auroraTheme).value = config.auroraTheme
  numberInput(ids.clickDelayMs).value = String(config.clickDelayMs)
  numberInput(ids.pointerDurationMs).value = String(config.pointerDurationMs)
}

function readForm(): Partial<AgagruneRuntimeConfig> {
  return {
    pointerAnimation: checkbox(ids.pointerAnimation).checked,
    auroraGlow: checkbox(ids.auroraGlow).checked,
    autoScroll: checkbox(ids.autoScroll).checked,
    auroraTheme: select(ids.auroraTheme).value as 'dark' | 'light',
    clickDelayMs: Number(numberInput(ids.clickDelayMs).value),
    pointerDurationMs: Number(numberInput(ids.pointerDurationMs).value),
  }
}

function renderNativeHostStatus(status: NativeHostStatus): void {
  const badge = hostStatusBadge()
  const detail = hostStatusDetail()

  badge.dataset.phase = status.phase
  badge.textContent = HOST_STATUS_LABELS[status.phase]

  if (status.phase === 'error' && status.lastError) {
    detail.textContent = `${status.hostName}: ${status.lastError}`
    return
  }

  if (status.phase === 'connected') {
    detail.textContent = `Connected to ${status.hostName}`
    return
  }

  detail.textContent = `Waiting for ${status.hostName}`
}

function sendRuntimeMessage<T>(message: ExtensionMessage): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }

      resolve((response as T | null | undefined) ?? null)
    })
  })
}

async function handleChange(): Promise<void> {
  const updated = await setConfig(readForm())
  chrome.runtime.sendMessage({ type: 'config_broadcast', config: updated })
}

async function refreshNativeHostStatus(): Promise<void> {
  const response = await sendRuntimeMessage<{ status?: NativeHostStatus }>({
    type: 'get_native_host_status',
  })

  if (response?.status) {
    renderNativeHostStatus(response.status)
    return
  }

  renderNativeHostStatus({
    connected: false,
    phase: 'error',
    hostName: DEFAULT_NATIVE_HOST_NAME,
    lastError: 'No status response from the service worker',
  })
}

async function reconnectNativeHost(): Promise<void> {
  reconnectNativeHostButton().disabled = true

  try {
    await sendRuntimeMessage({ type: 'reconnect_native_host' })
    await refreshNativeHostStatus()
  } finally {
    reconnectNativeHostButton().disabled = false
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const config = await getConfig()
  populateForm(config)

  renderNativeHostStatus({
    connected: false,
    phase: 'connecting',
    hostName: DEFAULT_NATIVE_HOST_NAME,
  })

  const inputs = document.querySelectorAll('input, select')
  for (const el of inputs) {
    el.addEventListener('change', handleChange)
  }

  reconnectNativeHostButton().addEventListener('click', () => {
    void reconnectNativeHost()
  })

  chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
    if (msg.type === 'native_host_status_changed') {
      renderNativeHostStatus(msg.status)
      return
    }

    if (msg.type === 'config_update') {
      void getConfig().then(populateForm)
    }
  })

  await refreshNativeHostStatus()
})
