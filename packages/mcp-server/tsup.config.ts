import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/install.ts', 'bin/rune-mcp.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'es2022',
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
})
