#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, '..')
const repoRoot = resolve(packageDir, '..', '..')
const serverDistDir = join(repoRoot, 'packages', 'server', 'dist')
const cliAssetsDir = join(packageDir, 'assets')
const cliMcpAssetsDir = join(cliAssetsDir, 'mcp-server')

runPnpm(repoRoot, [
  '--filter', '@agrune/core',
  '--filter', '@agrune/runtime',
  '--filter', '@agrune/server',
  'run',
  'build',
])

if (!existsSync(serverDistDir)) {
  throw new Error(`server dist not found: ${serverDistDir}`)
}

rmSync(cliMcpAssetsDir, { recursive: true, force: true })
cpSync(serverDistDir, cliMcpAssetsDir, { recursive: true })

runPnpm(packageDir, ['run', 'build'])

function runPnpm(cwd, args) {
  execFileSync('pnpm', args, {
    cwd,
    stdio: 'inherit',
  })
}
