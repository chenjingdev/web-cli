import type { AgagruneRuntimeConfig } from '@agrune/core'
import { DEFAULT_RUNTIME_CONFIG, mergeRuntimeConfig } from '@agrune/core'

const STORAGE_KEY = ['com', 'panion_config'].join('')

function getStorage(): typeof chrome.storage.sync | null {
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    return chrome.storage.sync
  }
  return null
}

export async function getConfig(): Promise<AgagruneRuntimeConfig> {
  const storage = getStorage()
  if (!storage) {
    return { ...DEFAULT_RUNTIME_CONFIG }
  }

  const result = await storage.get(STORAGE_KEY)
  const stored: Partial<AgagruneRuntimeConfig> | undefined = result[STORAGE_KEY]
  return mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, stored)
}

export async function setConfig(
  partial: Partial<AgagruneRuntimeConfig>,
): Promise<AgagruneRuntimeConfig> {
  const current = await getConfig()
  const updated = mergeRuntimeConfig(current, partial)

  const storage = getStorage()
  if (storage) {
    await storage.set({ [STORAGE_KEY]: updated })
  }

  return updated
}
