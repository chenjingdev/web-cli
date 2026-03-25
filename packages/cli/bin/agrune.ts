#!/usr/bin/env node
export {}

const command = process.argv[2]

const COMMANDS = ['setup', 'doctor', 'repair', 'update', 'uninstall'] as const
type Command = typeof COMMANDS[number]

const resolved = (!command ? 'setup' : command) as string

if (!COMMANDS.includes(resolved as Command)) {
  console.log(`Usage: agrune [command]

Commands:
  setup       Install agrune components (default)
  doctor      Check installation health
  repair      Auto-fix installation issues
  update      Update installed runtime
  uninstall   Remove agrune components`)
  process.exit(1)
}

switch (resolved as Command) {
  case 'setup': {
    const force = process.argv.includes('--force')
    const { runSetup } = await import('../src/commands/setup.js')
    await runSetup({ force })
    break
  }
  case 'doctor': {
    const { runDoctor } = await import('../src/commands/doctor.js')
    await runDoctor()
    break
  }
  case 'repair': {
    const { runRepair } = await import('../src/commands/repair.js')
    await runRepair()
    break
  }
  case 'update': {
    const { runUpdate } = await import('../src/commands/update.js')
    await runUpdate()
    break
  }
  case 'uninstall': {
    const { runUninstall } = await import('../src/commands/uninstall.js')
    await runUninstall()
    break
  }
}
