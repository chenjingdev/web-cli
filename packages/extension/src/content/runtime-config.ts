import type { WebCliRuntimeConfig } from '@runeai/core'
import { getConfig } from '../shared/config.js'

type BridgeSender = (type: 'config_update', data: Partial<WebCliRuntimeConfig>) => void

export async function syncStoredConfigToRuntime(
  sendToBridge: BridgeSender,
): Promise<void> {
  try {
    const config = await getConfig()
    sendToBridge('config_update', config)
  } catch (error) {
    console.warn('[webcli-extension] failed to sync stored config to runtime', error)
  }
}
