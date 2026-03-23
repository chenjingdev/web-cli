#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

function parseFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx === -1) return undefined
  return args[idx + 1]
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function requireFlag(args: string[], name: string): string {
  const value = parseFlag(args, name)
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function resolveMcpServerBin(): string {
  const cliDir = path.dirname(fileURLToPath(import.meta.url))
  // From packages/cli/src (or dist), go up to repo root, then into mcp-server/bin
  return path.resolve(cliDir, '../../mcp-server/bin/webcli-mcp.ts')
}

async function createMcpClient(): Promise<Client> {
  const serverBin = resolveMcpServerBin()
  const transport = new StdioClientTransport({
    command: 'tsx',
    args: [serverBin],
    stderr: 'inherit',
  })
  const client = new Client({ name: 'webcli-cli', version: '0.1.0' })
  await client.connect(transport)
  return client
}

type ContentItem = { type: string; text?: string }

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as ContentItem[])
    .filter(c => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text!)
    .join('\n')
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args })

  const text = extractText(result.content)

  if (result.isError) {
    throw new Error(text || 'Tool call failed')
  }

  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function runStatus(client: Client): Promise<void> {
  printJson(await callTool(client, 'webcli_sessions'))
}

async function runSessions(client: Client, args: string[]): Promise<void> {
  const sub = args[0] ?? 'list'
  if (sub === 'list') {
    printJson(await callTool(client, 'webcli_sessions'))
    return
  }

  if (sub === 'use') {
    const sessionId = args[1]
    if (!sessionId) {
      throw new Error('sessionId is required')
    }
    // MCP server only has webcli_sessions (list); 'use' is not supported in the MCP tool set.
    // For now, list sessions with a note.
    throw new Error('sessions use is not yet supported via MCP')
  }

  throw new Error(`unsupported sessions subcommand: ${sub}`)
}

export function buildSnapshotArgs(args: string[]): Record<string, unknown> {
  const sessionId = parseFlag(args, '--session')
  const summary = hasFlag(args, '--summary')
  const groupId = parseFlag(args, '--group')
  const query = parseFlag(args, '--query')
  const includeBlocked = hasFlag(args, '--include-blocked')
  const includeBackground = hasFlag(args, '--include-background')

  if (summary && groupId) {
    throw new Error('--summary and --group cannot be used together')
  }
  if (query && !groupId) {
    throw new Error('--query requires --group')
  }
  if (includeBlocked && !groupId) {
    throw new Error('--include-blocked requires --group')
  }
  if (includeBackground && !summary && !groupId) {
    throw new Error('--include-background requires --summary or --group')
  }

  const toolArgs: Record<string, unknown> = {}
  if (sessionId) toolArgs.tabId = Number(sessionId)
  if (summary) toolArgs.summary = true
  if (groupId) toolArgs.groupId = groupId
  if (query) toolArgs.query = query
  if (includeBlocked) toolArgs.includeBlocked = true
  if (includeBackground) toolArgs.includeBackground = true

  return toolArgs
}

async function runSnapshot(client: Client, args: string[]): Promise<void> {
  printJson(await callTool(client, 'webcli_snapshot', buildSnapshotArgs(args)))
}

async function runAct(client: Client, args: string[]): Promise<void> {
  const targetId = requireFlag(args, '--target')
  const expectedVersionRaw = parseFlag(args, '--expected-version')
  printJson(
    await callTool(client, 'webcli_act', {
      targetId,
      ...(expectedVersionRaw ? { expectedVersion: Number(expectedVersionRaw) } : {}),
    }),
  )
}

async function runGuide(client: Client, args: string[]): Promise<void> {
  const targetId = requireFlag(args, '--target')
  const expectedVersionRaw = parseFlag(args, '--expected-version')
  printJson(
    await callTool(client, 'webcli_guide', {
      targetId,
      ...(expectedVersionRaw ? { expectedVersion: Number(expectedVersionRaw) } : {}),
    }),
  )
}

async function runDrag(client: Client, args: string[]): Promise<void> {
  const sourceTargetId = requireFlag(args, '--source')
  const destinationTargetId = requireFlag(args, '--destination')
  const placement = parseFlag(args, '--placement')
  const expectedVersionRaw = parseFlag(args, '--expected-version')
  printJson(
    await callTool(client, 'webcli_drag', {
      sourceTargetId,
      destinationTargetId,
      ...(
        placement === 'before' || placement === 'inside' || placement === 'after'
          ? { placement }
          : {}
      ),
      ...(expectedVersionRaw ? { expectedVersion: Number(expectedVersionRaw) } : {}),
    }),
  )
}

async function runFill(client: Client, args: string[]): Promise<void> {
  const targetId = requireFlag(args, '--target')
  const value = requireFlag(args, '--value')
  const expectedVersionRaw = parseFlag(args, '--expected-version')
  printJson(
    await callTool(client, 'webcli_fill', {
      targetId,
      value,
      ...(expectedVersionRaw ? { expectedVersion: Number(expectedVersionRaw) } : {}),
    }),
  )
}

async function runWait(client: Client, args: string[]): Promise<void> {
  const targetId = requireFlag(args, '--target')
  const state = requireFlag(args, '--state')
  const timeoutMs = parseFlag(args, '--timeout-ms')
  printJson(
    await callTool(client, 'webcli_wait', {
      targetId,
      state,
      ...(timeoutMs ? { timeoutMs: Number(timeoutMs) } : {}),
    }),
  )
}

async function runConfig(client: Client, args: string[]): Promise<void> {
  const sub = args[0] ?? 'get'
  if (sub === 'get') {
    printJson(await callTool(client, 'webcli_config'))
    return
  }

  if (sub === 'set') {
    const payload: Record<string, unknown> = {}
    const clickDelayMs = parseFlag(args, '--click-delay-ms')
    const pointerAnimation = parseFlag(args, '--pointer-animation')
    const autoScroll = parseFlag(args, '--auto-scroll')
    const auroraTheme = parseFlag(args, '--aurora-theme')

    if (clickDelayMs !== undefined) {
      payload.clickDelayMs = Number(clickDelayMs)
    }
    if (pointerAnimation !== undefined) {
      payload.pointerAnimation = pointerAnimation === 'on'
    }
    if (autoScroll !== undefined) {
      payload.autoScroll = autoScroll === 'on'
    }
    if (auroraTheme === 'dark' || auroraTheme === 'light') {
      payload.auroraTheme = auroraTheme
    }

    printJson(await callTool(client, 'webcli_config', payload))
    return
  }

  throw new Error(`unsupported config subcommand: ${sub}`)
}

async function runAgent(client: Client, args: string[]): Promise<void> {
  // Agent activity management is not available as an MCP tool.
  // This would need a dedicated MCP tool or resource in the future.
  const sub = args[0] ?? 'begin'
  void client // suppress unused warning
  throw new Error(`agent command is not yet supported via MCP (subcommand: ${sub})`)
}

function printHelp(): void {
  printJson({
    commands: [
      'webcli status',
      'webcli sessions list',
      'webcli snapshot [--session <id>]',
      'webcli snapshot --summary [--session <id>] [--include-background]',
      'webcli snapshot --group <groupId> [--session <id>] [--query <text>] [--include-blocked] [--include-background]',
      'webcli act --target <targetId> [--expected-version <n>]',
      'webcli guide --target <targetId> [--expected-version <n>]',
      'webcli drag --source <targetId> --destination <targetId> [--placement <before|inside|after>] [--expected-version <n>]',
      'webcli fill --target <targetId> --value <text> [--expected-version <n>]',
      'webcli wait --target <targetId> --state <visible|hidden|enabled|disabled> [--timeout-ms <n>]',
      'webcli config get',
      'webcli config set --click-delay-ms <n> --pointer-animation <on|off> --auto-scroll <on|off> --aurora-theme <dark|light>',
    ],
  })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp()
    return
  }

  const client = await createMcpClient()

  try {
    if (command === 'status') {
      await runStatus(client)
      return
    }
    if (command === 'sessions') {
      await runSessions(client, args.slice(1))
      return
    }
    if (command === 'snapshot') {
      await runSnapshot(client, args.slice(1))
      return
    }
    if (command === 'act') {
      await runAct(client, args.slice(1))
      return
    }
    if (command === 'guide') {
      await runGuide(client, args.slice(1))
      return
    }
    if (command === 'drag') {
      await runDrag(client, args.slice(1))
      return
    }
    if (command === 'fill') {
      await runFill(client, args.slice(1))
      return
    }
    if (command === 'wait') {
      await runWait(client, args.slice(1))
      return
    }
    if (command === 'config') {
      await runConfig(client, args.slice(1))
      return
    }
    if (command === 'agent') {
      await runAgent(client, args.slice(1))
      return
    }

    throw new Error(`unsupported command: ${command}`)
  } finally {
    await client.close()
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  void main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
