#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CdpDriver } from '@agrune/browser'
import { createMcpServer } from '../src/index.js'

const args = process.argv.slice(2)
const attachEndpoint = getArgValue('--attach')
const headless = args.includes('--headless')
const noDevtools = args.includes('--no-devtools')

const driver = new CdpDriver({
  mode: attachEndpoint ? 'attach' : 'launch',
  ...(attachEndpoint ? { wsEndpoint: attachEndpoint } : {}),
  headless,
})

const { server } = createMcpServer(driver)
await driver.connect()

if (!noDevtools) {
  const { startDevtoolsServer } = await import('../src/devtools-server.js')
  const devtoolsPort = await startDevtoolsServer(driver)
  process.stderr.write(`[agrune] DevTools: http://localhost:${devtoolsPort}/devtools\n`)
}

const transport = new StdioServerTransport()
await server.connect(transport)

const cleanup = async () => {
  await driver.disconnect().catch(() => {})
}

process.once('SIGINT', () => {
  void cleanup().finally(() => process.exit(0))
})
process.once('SIGTERM', () => {
  void cleanup().finally(() => process.exit(0))
})

function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}
