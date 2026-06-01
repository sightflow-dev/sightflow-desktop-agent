import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'provider-worker': resolve(__dirname, 'src/main/provider-worker.ts'),
          'test-cli': resolve(__dirname, 'scripts/test-cli.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Box-select wizard runs in a separate transparent BrowserWindow
          // and loads its own React tree; second entry keeps its bundle isolated.
          overlay: resolve(__dirname, 'src/renderer/overlay.html')
        }
      }
    }
  }
})
