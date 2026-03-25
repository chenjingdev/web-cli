import * as p from '@clack/prompts'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, execFileSync } from 'node:child_process'
import { copyDir } from '../utils/fs-helpers.js'
import { writeVersionFile, readVersionFile, type VersionData } from '../utils/version.js'
import { installNativeHostWrapper, installNativeHostManifest } from '../utils/native-host.js'
import { CWS_EXTENSION_ID, DEV_EXTENSION_ID, CLI_VERSION, AGRUNE_HOME } from '../constants.js'
import { MCP_SERVER_ENTRY } from '../utils/paths.js'
import { readJsonFile, writeJsonFile, backupFile } from '../utils/fs-helpers.js'
import { getClaudeConfigPath } from '../utils/paths.js'
import { getPlatform } from '../utils/platform.js'

export function getAssetsDir(): string {
  let dir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))
  // Walk up until we find package.json (works from dist/, dist/bin/, or chunks)
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) {
      return join(dir, 'assets')
    }
    dir = dirname(dir)
  }
  throw new Error('Could not find package root with assets/')
}

/** Core install logic — testable without TUI */
export function installRuntime(assetsDir: string, agruneHome: string): void {
  const mcpServerSrc = join(assetsDir, 'mcp-server')
  const mcpServerDest = join(agruneHome, 'mcp-server')

  mkdirSync(agruneHome, { recursive: true })

  if (existsSync(mcpServerDest)) {
    rmSync(mcpServerDest, { recursive: true })
  }
  copyDir(mcpServerSrc, mcpServerDest)

  const versionPath = join(agruneHome, 'version.json')
  const existing = readVersionFile(versionPath)
  const now = new Date().toISOString()

  const data: VersionData = {
    version: CLI_VERSION,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    components: existing?.components ?? {
      'mcp-server': true,
      'native-host': false,
      'claude-mcp': false,
      'codex-mcp': false,
      'chrome-extension': false,
    },
  }
  data.components['mcp-server'] = true
  writeVersionFile(versionPath, data)
}

export async function runSetup(opts: { force?: boolean } = {}): Promise<void> {
  getPlatform()

  if (!process.stdout.isTTY) {
    console.error('Error: setup requires an interactive terminal. Do not run in CI or piped environments.')
    process.exit(1)
  }

  p.intro('agrune installer v' + CLI_VERSION)

  const options = await p.multiselect({
    message: '설치할 항목을 선택하세요',
    options: [
      { value: 'chrome-extension', label: 'Chrome Extension (CWS에서 설치)' },
      { value: 'claude-mcp', label: 'Claude MCP' },
      { value: 'codex-mcp', label: 'Codex MCP' },
    ],
    initialValues: ['chrome-extension', 'claude-mcp'],
  })

  if (p.isCancel(options)) {
    p.cancel('설치 취소됨')
    process.exit(0)
  }

  const selected = options as string[]
  const assetsDir = getAssetsDir()

  const s = p.spinner()
  s.start('런타임 설치 중...')
  installRuntime(assetsDir, AGRUNE_HOME)
  s.stop('런타임 설치 완료')

  s.start('네이티브 호스트 등록 중...')
  installNativeHostWrapper()
  installNativeHostManifest([CWS_EXTENSION_ID, DEV_EXTENSION_ID])
  s.stop('네이티브 호스트 등록 완료')

  const versionPath = join(AGRUNE_HOME, 'version.json')
  const vData = readVersionFile(versionPath)!
  vData.components['native-host'] = true

  if (selected.includes('chrome-extension')) {
    p.note('Chrome Web Store에서 agrune 확장을 설치해주세요.', 'Chrome Extension')
    try {
      const url = `https://chromewebstore.google.com/detail/${CWS_EXTENSION_ID}`
      if (process.platform === 'darwin') {
        execSync(`open "${url}"`)
      } else {
        execSync(`xdg-open "${url}"`)
      }
    } catch {
      // Ignore — user can open manually
    }
    vData.components['chrome-extension'] = true
  }

  if (selected.includes('claude-mcp')) {
    s.start('Claude MCP 설정 중...')
    const configPath = getClaudeConfigPath()
    backupFile(configPath)
    const config = readJsonFile<Record<string, unknown>>(configPath) ?? {}
    const servers = ((config as any).mcpServers ?? {}) as Record<string, unknown>
    servers.agrune = {
      command: 'node',
      args: [MCP_SERVER_ENTRY],
    }
    ;(config as any).mcpServers = servers
    writeJsonFile(configPath, config)
    s.stop('Claude MCP 설정 완료')
    vData.components['claude-mcp'] = true
  }

  if (selected.includes('codex-mcp')) {
    s.start('Codex MCP 설정 중...')
    try {
      execFileSync('codex', ['mcp', 'add', 'agrune', '--command', 'node', '--args', MCP_SERVER_ENTRY], {
        stdio: 'pipe',
      })
      s.stop('Codex MCP 설정 완료')
      vData.components['codex-mcp'] = true
    } catch {
      s.stop('Codex MCP 설정 실패 — codex CLI를 확인하세요')
    }
  }

  writeVersionFile(versionPath, vData)

  p.outro('설치 완료! `pnpm dlx @agrune/cli doctor`로 상태를 확인하세요.')
}
