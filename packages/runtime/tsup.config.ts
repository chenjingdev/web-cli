import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    clean: true,
    sourcemap: true,
    target: 'es2022',
    dts: true,
  },
  {
    entry: { 'page-runtime': 'src/runtime/index.ts' },
    format: ['iife'],
    clean: false,
    sourcemap: true,
    target: 'es2022',
    noExternal: [/.*/],
    globalName: '__agrune_runtime__',
  },
])
