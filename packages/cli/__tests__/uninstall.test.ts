import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { removeRuntimeFiles } from '../src/commands/uninstall.js'

describe('removeRuntimeFiles', () => {
  const testDir = join(tmpdir(), 'agrune-test-uninstall')

  beforeEach(() => {
    mkdirSync(join(testDir, 'mcp-server/bin'), { recursive: true })
    writeFileSync(join(testDir, 'mcp-server/bin/agrune-mcp.js'), '')
    writeFileSync(join(testDir, 'version.json'), '{}')
    writeFileSync(join(testDir, 'native-host'), '')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('removes ~/.agrune directory contents', () => {
    removeRuntimeFiles(testDir)
    expect(existsSync(testDir)).toBe(false)
  })
})
