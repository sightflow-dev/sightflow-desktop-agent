// Minimal ESM resolve hook for the test runner.
// The core modules use extensionless relative imports (resolved by electron-vite
// at build time). Node's built-in TS runner (--experimental-transform-types) does
// not add extension resolution, so this hook appends .ts/.tsx for relative imports.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, next) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  const hasExt = /\.[cm]?[jt]sx?$/i.test(specifier)
  if (isRelative && !hasExt) {
    const base = new URL(specifier, context.parentURL)
    for (const ext of ['.ts', '.tsx']) {
      if (existsSync(fileURLToPath(new URL(base.href + ext)))) {
        return next(specifier + ext, context)
      }
    }
  }
  return next(specifier, context)
}
