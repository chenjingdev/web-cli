import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  deriveExtensionIdFromManifestKey,
  getExtensionLoadPlan,
  getNativeHostManifest,
  getNativeHostPath,
  readExtensionManifest,
  resolveExtensionId,
} from '../src/install'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const TEST_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqLVmjeM2Lfnlwtas6edYoGZwPYZeRe8AnI1zmbkJWpskfHMGga9t9k4tfn99EEsV4Ebsoh+H9lCHyp6AHsaM1t3cAUlXALNBJzcpVts6PFOvMMlVI78NSshwbX79YoA2KP5UFCTk7ulqNbHPm5s/zcp6Q2eO+DH+PGGmjDGDFUiWXOJiWrCiLs7rRe1aibTOVktYKaobdKgLEvBrUO7JItRvyp9mMwaZbUl+6NWyhjfvivmjJ+qslvWrr+zlXsp8RKkN+0mlURnhsR1CPZA9arI1QKjt5007w99oOCXZ6Auuc5O8pYugZrj0EojjUW8dp2UX8ys2PcojSzTffzkVpQIDAQAB'
const TEST_EXTENSION_ID = 'homjkbmhgmccfjpcllcbofcnpciephlh'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getNativeHostManifest', () => {
  it('generates correct manifest structure', () => {
    const binaryPath = '/usr/local/bin/rune'
    const extensionId = 'abcdefghijklmnopqrstuvwxyz'

    const manifest = getNativeHostManifest(binaryPath, extensionId)

    expect(manifest).toEqual({
      name: 'com.webcli.dom',
      description: 'rune MCP server native messaging host',
      path: binaryPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    })
  })

  it('uses the provided binaryPath and extensionId', () => {
    const manifest = getNativeHostManifest('/other/path', 'xyz123')

    expect(manifest.path).toBe('/other/path')
    expect(manifest.allowed_origins).toEqual(['chrome-extension://xyz123/'])
  })
})

describe('getNativeHostPath', () => {
  it('returns macOS path on darwin', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    const result = getNativeHostPath()
    const home = os.homedir()

    expect(result).toBe(
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'com.webcli.dom.json'),
    )
  })

  it('returns Linux path on linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    const result = getNativeHostPath()
    const home = os.homedir()

    expect(result).toBe(
      path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts', 'com.webcli.dom.json'),
    )
  })

  it('throws on unsupported platform', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    expect(() => getNativeHostPath()).toThrow()
  })
})

describe('extension manifest ID derivation', () => {
  it('derives a stable extension ID from a manifest key', () => {
    expect(deriveExtensionIdFromManifestKey(TEST_EXTENSION_KEY)).toBe(TEST_EXTENSION_ID)
  })

  it('reads the manifest key from disk', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'webcli-install-'))
    const manifestPath = path.join(dir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify({ key: TEST_EXTENSION_KEY }), 'utf-8')

    try {
      expect(readExtensionManifest(manifestPath)).toEqual({ key: TEST_EXTENSION_KEY })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers an explicit override extension ID', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'webcli-install-'))
    const manifestPath = path.join(dir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify({ key: TEST_EXTENSION_KEY }), 'utf-8')

    try {
      expect(resolveExtensionId(manifestPath, 'override-id')).toBe('override-id')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('derives the extension ID from the manifest key when no override is provided', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'webcli-install-'))
    const manifestPath = path.join(dir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify({ key: TEST_EXTENSION_KEY }), 'utf-8')

    try {
      expect(resolveExtensionId(manifestPath)).toBe(TEST_EXTENSION_ID)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws when neither override nor manifest key is available', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'webcli-install-'))
    const manifestPath = path.join(dir, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify({ manifest_version: 3, name: 'rune' }), 'utf-8')

    try {
      expect(() => resolveExtensionId(manifestPath)).toThrow(/missing "key"/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('getExtensionLoadPlan', () => {
  it('prefers manual instructions when Chrome is already running on macOS', () => {
    const plan = getExtensionLoadPlan('darwin', '/tmp/webcli-extension', true)

    expect(plan.shouldAttemptAutoLoad).toBe(false)
    expect(plan.shouldOpenExtensionsPage).toBe(true)
    expect(plan.instructions).toContain(
      'Google Chrome is already running, so automatic unpacked extension loading may be ignored.',
    )
    expect(plan.instructions).toContain('chrome://extensions -> Developer mode ON -> Load unpacked')
    expect(plan.instructions).toContain('/tmp/webcli-extension')
  })

  it('attempts automatic loading on macOS when Chrome is not already running', () => {
    const plan = getExtensionLoadPlan('darwin', '/tmp/webcli-extension', false)

    expect(plan.shouldAttemptAutoLoad).toBe(true)
    expect(plan.shouldOpenExtensionsPage).toBe(false)
    expect(plan.instructions).toContain('If the extension does not appear automatically, load it manually:')
  })

  it('uses manual loading instructions on non-macOS platforms', () => {
    const plan = getExtensionLoadPlan('linux', '/tmp/webcli-extension', false)

    expect(plan.shouldAttemptAutoLoad).toBe(false)
    expect(plan.shouldOpenExtensionsPage).toBe(false)
    expect(plan.instructions).toEqual([
      'chrome://extensions -> Developer mode ON -> Load unpacked',
      '/tmp/webcli-extension',
    ])
  })
})
