export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export const randomDelay = (ms: number) => delay(ms + Math.random() * 20 - 10)
export const randomDelayIn = (min: number, max: number) => delay(min + Math.random() * (max - min))

export function getRobot() {
  try {
    // We use runtime require to prevent Vite/Webpack from attempting to eagerly bundle
    // native C++ add-ons which can cause build failures or crash the main process on load.
    return require('@hurdlegroup/robotjs')
  } catch (err: any) {
    console.error('Failed to load @hurdlegroup/robotjs. Core RPA functions will not work.', err.message)
    return null
  }
}
