import { existsSync } from 'node:fs'
import type { Check } from './types.js'
import { getClaudeConfigPath, MCP_SERVER_ENTRY } from '../utils/paths.js'
import { readJsonFile, writeJsonFile, backupFile } from '../utils/fs-helpers.js'

export function claudeMcpCheck(): Check {
  return {
    name: 'Claude MCP config',
    async check() {
      const configPath = getClaudeConfigPath()
      if (!existsSync(configPath)) {
        return { ok: false, message: 'Claude settings.json not found' }
      }
      const config = readJsonFile<Record<string, unknown>>(configPath)
      const servers = (config as any)?.mcpServers
      if (!servers?.agrune) {
        return { ok: false, message: 'mcpServers.agrune not registered' }
      }
      return { ok: true, message: 'Claude MCP configured' }
    },
    async fix() {
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
    },
  }
}

export function codexMcpCheck(): Check {
  return {
    name: 'Codex MCP config',
    async check() {
      try {
        const { execSync } = await import('node:child_process')
        const output = execSync('codex mcp list', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
        if (output.includes('agrune')) {
          return { ok: true, message: 'Codex MCP configured' }
        }
        return { ok: false, message: 'agrune not in Codex MCP list' }
      } catch {
        return { ok: false, message: 'Codex CLI not available or agrune not registered' }
      }
    },
    async fix() {
      const { execSync } = await import('node:child_process')
      execSync(`codex mcp add agrune --command "node" --args "${MCP_SERVER_ENTRY}"`, {
        stdio: 'inherit',
      })
    },
  }
}
