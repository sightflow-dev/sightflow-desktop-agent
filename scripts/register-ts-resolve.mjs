// Registers the extensionless-import resolve hook for `npm test`.
import { register } from 'node:module'

register('./ts-resolve.mjs', import.meta.url)
