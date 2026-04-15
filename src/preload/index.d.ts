import { ElectronHandler } from './index'

declare global {
  interface Window {
    electron: ElectronHandler
    osInfo: { platform: NodeJS.Platform }
  }
}

export {}
