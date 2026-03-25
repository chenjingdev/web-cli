import * as p from '@clack/prompts'
import { existsSync, rmSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { AGRUNE_HOME } from '../constants.js'
import { getNativeHostManifestPath, getClaudeConfigPath } from '../utils/paths.js'
import { readJsonFile, writeJsonFile, backupFile } from '../utils/fs-helpers.js'
import { readVersionFile } from '../utils/version.js'
import { join } from 'node:path'

/** Testable core logic */
export function removeRuntimeFiles(agruneHome: string): void {
  if (existsSync(agruneHome)) {
    rmSync(agruneHome, { recursive: true })
  }
}

export function removeNativeHostManifest(): void {
  const manifestPath = getNativeHostManifestPath()
  if (existsSync(manifestPath)) {
    unlinkSync(manifestPath)
  }
}

export function removeClaudeMcpConfig(): void {
  const configPath = getClaudeConfigPath()
  if (!existsSync(configPath)) return
  backupFile(configPath)
  const config = readJsonFile<Record<string, unknown>>(configPath)
  if (!config) return
  const servers = (config as any).mcpServers
  if (servers?.agrune) {
    delete servers.agrune
    writeJsonFile(configPath, config)
  }
}

export function removeCodexMcpConfig(): void {
  try {
    execSync('codex mcp remove agrune', { stdio: 'pipe' })
  } catch {
    // codex CLI not available or agrune not registered — ignore
  }
}

export async function runUninstall(): Promise<void> {
  p.intro('agrune uninstall')

  const options = await p.multiselect({
    message: '제거할 항목을 선택하세요',
    options: [
      { value: 'runtime', label: '런타임 파일 (~/.agrune/)' },
      { value: 'native-host', label: '네이티브 호스트 매니페스트' },
      { value: 'claude-mcp', label: 'Claude MCP 설정' },
      { value: 'codex-mcp', label: 'Codex MCP 설정' },
      { value: 'chrome-extension', label: 'Chrome Extension (수동 제거 안내)' },
    ],
    initialValues: ['runtime', 'native-host'],
  })

  if (p.isCancel(options)) {
    p.cancel('제거 취소됨')
    return
  }

  const selected = options as string[]

  if (selected.includes('claude-mcp')) {
    removeClaudeMcpConfig()
    p.log.success('Claude MCP 설정 제거 완료')
  }

  if (selected.includes('codex-mcp')) {
    removeCodexMcpConfig()
    p.log.success('Codex MCP 설정 제거 완료')
  }

  if (selected.includes('native-host')) {
    removeNativeHostManifest()
    p.log.success('네이티브 호스트 매니페스트 제거 완료')
  }

  if (selected.includes('runtime')) {
    removeRuntimeFiles(AGRUNE_HOME)
    p.log.success('런타임 파일 제거 완료')
  }

  if (selected.includes('chrome-extension')) {
    p.note('chrome://extensions 에서 agrune 확장을 직접 제거해주세요.', 'Chrome Extension')
  }

  p.outro('제거 완료')
}
