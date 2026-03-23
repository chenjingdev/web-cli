import { getConfig, setConfig } from '../shared/config.js'
import type { CompanionConfig } from '@webcli-dom/core'

const ids = {
  pointerAnimation: 'pointerAnimation',
  auroraGlow: 'auroraGlow',
  auroraTheme: 'auroraTheme',
  clickDelayMs: 'clickDelayMs',
  autoScroll: 'autoScroll',
} as const

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

function populateForm(config: CompanionConfig): void {
  checkbox(ids.pointerAnimation).checked = config.pointerAnimation
  checkbox(ids.auroraGlow).checked = config.auroraGlow
  checkbox(ids.autoScroll).checked = config.autoScroll
  select(ids.auroraTheme).value = config.auroraTheme
  numberInput(ids.clickDelayMs).value = String(config.clickDelayMs)
}

function readForm(): Partial<CompanionConfig> {
  return {
    pointerAnimation: checkbox(ids.pointerAnimation).checked,
    auroraGlow: checkbox(ids.auroraGlow).checked,
    autoScroll: checkbox(ids.autoScroll).checked,
    auroraTheme: select(ids.auroraTheme).value as 'dark' | 'light',
    clickDelayMs: Number(numberInput(ids.clickDelayMs).value),
  }
}

async function handleChange(): Promise<void> {
  const updated = await setConfig(readForm())
  chrome.runtime.sendMessage({ type: 'config_broadcast', config: updated })
}

document.addEventListener('DOMContentLoaded', async () => {
  const config = await getConfig()
  populateForm(config)

  const inputs = document.querySelectorAll('input, select')
  for (const el of inputs) {
    el.addEventListener('change', handleChange)
  }
})
