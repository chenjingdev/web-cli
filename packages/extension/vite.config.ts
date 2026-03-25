import { defineConfig } from 'vite'
import { resolve } from 'path'
import { build } from 'vite'

async function buildEntry(options: {
  entry: string
  fileName: string
  name: string
  emptyOutDir?: boolean
}) {
  await build({
    configFile: false,
    build: {
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: options.emptyOutDir ?? false,
      lib: {
        entry: resolve(__dirname, options.entry),
        name: options.name,
        formats: ['iife'],
        fileName: () => options.fileName,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  })
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'agruneContentScript',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    {
      name: 'build-extension-bundles',
      closeBundle: async () => {
        await buildEntry({
          entry: 'src/background/service-worker.ts',
          fileName: 'service-worker.js',
          name: 'agruneBackgroundServiceWorker',
        })
        await buildEntry({
          entry: 'src/popup/popup.ts',
          fileName: 'popup.js',
          name: 'agrunePopup',
        })
        await buildEntry({
          entry: 'src/runtime/page-runtime.ts',
          fileName: 'page-runtime.js',
          name: 'agrunePageRuntime',
        })
      },
    },
  ],
})
