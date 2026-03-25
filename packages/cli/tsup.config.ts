import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'bin/agrune': 'bin/agrune.ts' },
  outDir: 'dist',
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'es2022',
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
})
