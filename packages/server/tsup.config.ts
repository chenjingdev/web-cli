import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  entry: ['src/index.ts', 'bin/agrune-mcp.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'es2022',
  noExternal: [/.*/],
  define: {
    __MCP_SERVER_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
})
