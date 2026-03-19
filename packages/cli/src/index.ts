#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

type JsonRecord = Record<string, unknown>

const DEFAULT_BASE_URL = process.env.WEBCLI_COMPANION_URL ?? 'http://127.0.0.1:9444'
const DEFAULT_TOKEN_PATH =
  process.env.WEBCLI_COMPANION_TOKEN_PATH ??
  path.join(os.homedir(), '.webcli-dom', 'companion', 'agent-token')

function readAgentToken(): string {
  const direct = process.env.WEBCLI_COMPANION_TOKEN?.trim()
  if (direct) {
    return direct
  }

  try {
    return fs.readFileSync(DEFAULT_TOKEN_PATH, 'utf8').trim()
  } catch {
    throw new Error(`agent token not found: ${DEFAULT_TOKEN_PATH}`)
  }
}

async function requestApi(
  method: string,
  pathname: string,
  payload?: unknown,
): Promise<unknown> {
  const token = readAgentToken()
  const response = await fetch(new URL(pathname, DEFAULT_BASE_URL), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  })

  const text = await response.text()
  const parsed = text ? (JSON.parse(text) as unknown) : {}
  if (!response.ok) {
    throw new Error(
      JSON.stringify({
        status: response.status,
        body: parsed,
      }),
    )
  }
  return parsed
}

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

async function runStatus(): Promise<void> {
  printJson(await requestApi('GET', '/api/status'))
}

async function runSessions(args: string[]): Promise<void> {
  const sub = args[0] ?? 'list'
  if (sub === 'list') {
    printJson(await requestApi('GET', '/api/sessions'))
    return
  }

  if (sub === 'use') {
    const sessionId = args[1]
    if (!sessionId) {
      throw new Error('sessionId is required')
    }
    printJson(await requestApi('POST', '/api/sessions/activate', { sessionId }))
    return
  }

  throw new Error(`unsupported sessions subcommand: ${sub}`)
}

async function runSnapshot(args: string[]): Promise<void> {
  const sessionId = parseFlag(args, '--session')
  const pathname = sessionId
    ? `/api/snapshot?sessionId=${encodeURIComponent(sessionId)}`
    : '/api/snapshot'
  printJson(await requestApi('GET', pathname))
}

async function runAct(args: string[]): Promise<void> {
  const targetId = requireFlag(args, '--target')
  const expectedVersionRaw = parseFlag(args, '--expected-version')
  printJson(
    await requestApi('POST', '/api/commands/act', {
      targetId,
      ...(expectedVersionRaw ? { expectedVersion: Number(expectedVersionRaw) } : {}),
    }),
  )
}

async function runGuide(args: string[]): Promise<void> {
  const targetId = requireFlag(args, '--target')
  const expectedVersionRaw = parseFlag(args, '--expected-version')
  printJson(
    await requestApi('POST', '/api/commands/guide', {
      targetId,
      ...(expectedVersionRaw ? { expectedVersion: Number(expectedVersionRaw) } : {}),
    }),
  )
}

async function runDrag(args: string[]): Promise<void> {
  const sourceTargetId = requireFlag(args, '--source')
  const destinationTargetId = requireFlag(args, '--destination')
  const placement = parseFlag(args, '--placement')
  const expectedVersionRaw = parseFlag(args, '--expected-version')
  printJson(
    await requestApi('POST', '/api/commands/drag', {
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

async function runFill(args: string[]): Promise<void> {
  const targetId = requireFlag(args, '--target')
  const value = requireFlag(args, '--value')
  const expectedVersionRaw = parseFlag(args, '--expected-version')
  printJson(
    await requestApi('POST', '/api/commands/fill', {
      targetId,
      value,
      ...(expectedVersionRaw ? { expectedVersion: Number(expectedVersionRaw) } : {}),
    }),
  )
}

async function runWait(args: string[]): Promise<void> {
  const targetId = requireFlag(args, '--target')
  const state = requireFlag(args, '--state')
  const timeoutMs = parseFlag(args, '--timeout-ms')
  printJson(
    await requestApi('POST', '/api/commands/wait', {
      targetId,
      state,
      ...(timeoutMs ? { timeoutMs: Number(timeoutMs) } : {}),
    }),
  )
}

async function runConfig(args: string[]): Promise<void> {
  const sub = args[0] ?? 'get'
  if (sub === 'get') {
    printJson(await requestApi('GET', '/api/config'))
    return
  }

  if (sub === 'set') {
    const payload: JsonRecord = {}
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

    printJson(await requestApi('PUT', '/api/config', payload))
    return
  }

  throw new Error(`unsupported config subcommand: ${sub}`)
}

async function runAgent(args: string[]): Promise<void> {
  const sub = args[0] ?? 'begin'

  if (sub === 'begin' || sub === 'start') {
    printJson(await requestApi('POST', '/api/agent-activity/start'))
    return
  }

  if (sub === 'end' || sub === 'stop') {
    const pathname = sub === 'stop' ? '/api/agent-activity/stop' : '/api/agent-activity/end'
    printJson(await requestApi('POST', pathname))
    return
  }

  if (sub === 'finish') {
    printJson(await requestApi('POST', '/api/agent-activity/end'))
    return
  }

  throw new Error(`unsupported agent subcommand: ${sub}`)
}

async function runTui(): Promise<void> {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
  const child = spawn(
    'pnpm',
    ['--dir', rootDir, '--reporter', 'silent', '--filter', '@webcli-dom/companion', 'run', 'start'],
    {
      stdio: 'inherit',
      env: process.env,
    },
  )

  await new Promise<void>((resolve, reject) => {
    child.once('exit', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`companion exited with code ${code ?? 1}`))
    })
    child.once('error', reject)
  })
}

function printHelp(): void {
  printJson({
    commands: [
      'webcli status',
      'webcli sessions list',
      'webcli sessions use <sessionId>',
      'webcli snapshot [--session <id>]',
      'webcli act --target <targetId> [--expected-version <n>]',
      'webcli guide --target <targetId> [--expected-version <n>]',
      'webcli drag --source <targetId> --destination <targetId> [--placement <before|inside|after>] [--expected-version <n>]',
      'webcli fill --target <targetId> --value <text> [--expected-version <n>]',
      'webcli wait --target <targetId> --state <visible|hidden|enabled|disabled> [--timeout-ms <n>]',
      'webcli agent begin',
      'webcli agent end',
      'webcli agent stop',
      'webcli config get',
      'webcli config set --click-delay-ms <n> --pointer-animation <on|off> --auto-scroll <on|off> --aurora-theme <dark|light>',
      'webcli tui',
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

  if (command === 'status') {
    await runStatus()
    return
  }
  if (command === 'sessions') {
    await runSessions(args.slice(1))
    return
  }
  if (command === 'snapshot') {
    await runSnapshot(args.slice(1))
    return
  }
  if (command === 'act') {
    await runAct(args.slice(1))
    return
  }
  if (command === 'guide') {
    await runGuide(args.slice(1))
    return
  }
  if (command === 'drag') {
    await runDrag(args.slice(1))
    return
  }
  if (command === 'fill') {
    await runFill(args.slice(1))
    return
  }
  if (command === 'wait') {
    await runWait(args.slice(1))
    return
  }
  if (command === 'config') {
    await runConfig(args.slice(1))
    return
  }
  if (command === 'agent') {
    await runAgent(args.slice(1))
    return
  }
  if (command === 'tui') {
    await runTui()
    return
  }

  throw new Error(`unsupported command: ${command}`)
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
