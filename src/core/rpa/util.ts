import { createRequire } from 'node:module'
import { getErrorMessage } from '../error-utils'

const runtimeRequire = createRequire(import.meta.url)

export interface RobotJs {
  getMousePos(): { x: number; y: number }
  moveMouse(x: number, y: number): void
  mouseToggle(down: 'down' | 'up', button?: 'left' | 'right'): void
  mouseClick(button?: 'left' | 'right'): void
  keyTap(key: string, modifiers?: string[]): void
  keyToggle(key: string, down: 'down' | 'up'): void
}

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
export const randomDelay = (ms: number): Promise<void> => delay(ms + Math.random() * 20 - 10)
export const randomDelayIn = (min: number, max: number): Promise<void> =>
  delay(min + Math.random() * (max - min))

export function getRobot(): RobotJs | null {
  try {
    // We use runtime require to prevent Vite/Webpack from attempting to eagerly bundle
    // native C++ add-ons which can cause build failures or crash the main process on load.
    return runtimeRequire('@hurdlegroup/robotjs') as RobotJs
  } catch (err: unknown) {
    console.error(
      'Failed to load @hurdlegroup/robotjs. Core RPA functions will not work.',
      getErrorMessage(err)
    )
    return null
  }
}
