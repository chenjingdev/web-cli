import { existsSync, accessSync, constants, readFileSync } from 'node:fs'
import type { Check } from './types.js'
import { getNativeHostManifestPath, NATIVE_HOST_WRAPPER } from '../utils/paths.js'
import { installNativeHostWrapper, installNativeHostManifest } from '../utils/native-host.js'
import { CWS_EXTENSION_ID } from '../constants.js'

export function nativeHostManifestCheck(): Check {
  return {
    name: 'Native host manifest',
    async check() {
      const manifestPath = getNativeHostManifestPath()
      if (!existsSync(manifestPath)) {
        return { ok: false, message: 'Native host manifest not found' }
      }
      try {
        const content = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        if (content.name !== 'com.agrune.agrune') {
          return { ok: false, message: 'Native host manifest has wrong name' }
        }
        return { ok: true, message: 'Native host manifest valid' }
      } catch {
        return { ok: false, message: 'Native host manifest is not valid JSON' }
      }
    },
    async fix() {
      installNativeHostManifest(CWS_EXTENSION_ID)
    },
  }
}

export function nativeHostWrapperCheck(): Check {
  return {
    name: 'Native host wrapper',
    async check() {
      if (!existsSync(NATIVE_HOST_WRAPPER)) {
        return { ok: false, message: 'Native host wrapper not found' }
      }
      try {
        accessSync(NATIVE_HOST_WRAPPER, constants.X_OK)
        return { ok: true, message: 'Native host wrapper executable' }
      } catch {
        return { ok: false, message: 'Native host wrapper not executable' }
      }
    },
    async fix() {
      installNativeHostWrapper()
    },
  }
}
