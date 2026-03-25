import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installRuntime } from '../src/commands/setup.js'

describe('installRuntime', () => {
  const testHome = join(tmpdir(), 'agrune-test-setup')
  const fakeAssets = join(tmpdir(), 'agrune-test-assets')

  beforeEach(() => {
    mkdirSync(testHome, { recursive: true })
    mkdirSync(join(fakeAssets, 'mcp-server/bin'), { recursive: true })
    writeFileSync(join(fakeAssets, 'mcp-server/bin/agrune-mcp.js'), '// stub')
  })

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true })
    rmSync(fakeAssets, { recursive: true, force: true })
  })

  it('copies mcp-server assets to target directory', () => {
    installRuntime(fakeAssets, testHome)
    expect(existsSync(join(testHome, 'mcp-server/bin/agrune-mcp.js'))).toBe(true)
  })

  it('writes version.json', () => {
    installRuntime(fakeAssets, testHome)
    const versionPath = join(testHome, 'version.json')
    expect(existsSync(versionPath)).toBe(true)
    const data = JSON.parse(readFileSync(versionPath, 'utf-8'))
    expect(data.version).toBeDefined()
    expect(data.components['mcp-server']).toBe(true)
  })
})
