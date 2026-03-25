import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runtimeFilesCheck } from '../src/checks/runtime-files.js'

describe('runtimeFilesCheck', () => {
  const testDir = join(tmpdir(), 'agrune-test-checks')
  const mcpServerDir = join(testDir, 'mcp-server')

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('fails when mcp-server dir does not exist', async () => {
    const check = runtimeFilesCheck(testDir)
    const result = await check.check()
    expect(result.ok).toBe(false)
  })

  it('passes when mcp-server dir exists with entry file', async () => {
    mkdirSync(join(mcpServerDir, 'bin'), { recursive: true })
    writeFileSync(join(mcpServerDir, 'bin/agrune-mcp.js'), '')
    const check = runtimeFilesCheck(testDir)
    const result = await check.check()
    expect(result.ok).toBe(true)
  })
})
