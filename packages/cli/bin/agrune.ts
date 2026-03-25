#!/usr/bin/env node

const command = process.argv[2]

const COMMANDS = ['setup', 'doctor', 'repair', 'update', 'uninstall'] as const

if (!command || !COMMANDS.includes(command as typeof COMMANDS[number])) {
  console.log(`Usage: agrune <command>

Commands:
  setup       Install agrune components
  doctor      Check installation health
  repair      Auto-fix installation issues
  update      Update installed runtime
  uninstall   Remove agrune components`)
  process.exit(command ? 1 : 0)
}

console.log(`agrune ${command}: not implemented yet`)
