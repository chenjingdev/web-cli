import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/install.ts', 'bin/webcli-mcp.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'es2022',
})
