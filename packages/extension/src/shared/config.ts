import type { CompanionConfig } from '@webcli-dom/core'
import { DEFAULT_COMPANION_CONFIG, mergeCompanionConfig } from '@webcli-dom/core'

const STORAGE_KEY = 'companion_config'

function getStorage(): typeof chrome.storage.sync | null {
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    return chrome.storage.sync
  }
  return null
}

export async function getConfig(): Promise<CompanionConfig> {
  const storage = getStorage()
  if (!storage) {
    return { ...DEFAULT_COMPANION_CONFIG }
  }

  const result = await storage.get(STORAGE_KEY)
  const stored: Partial<CompanionConfig> | undefined = result[STORAGE_KEY]
  return mergeCompanionConfig(DEFAULT_COMPANION_CONFIG, stored)
}

export async function setConfig(
  partial: Partial<CompanionConfig>,
): Promise<CompanionConfig> {
  const current = await getConfig()
  const updated = mergeCompanionConfig(current, partial)

  const storage = getStorage()
  if (storage) {
    await storage.set({ [STORAGE_KEY]: updated })
  }

  return updated
}
