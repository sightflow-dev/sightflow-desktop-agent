export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
  )
}
